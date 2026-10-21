"use client";

import { useEffect, useMemo, useRef } from "react";
import { enterprises, type Position } from "@/lib/park-geography";
import { conePin, fmt, frameParkTilted, infoCard, SECTOR_ZONE, shortName, useParkMap, zoneFeature, zoneHub, type ZoneKey } from "@/lib/park-map";

export interface FlowNode { code: string; name: string; value: number; intensity?: number | null }
type Mode = "energy" | "carbon";

const STYLE: Record<Mode, { label: string; unit: string; line: string; glow: string; pin: string; card: string; intensityUnit: string }> = {
  energy: { label: "能流", unit: "tce", line: "#d4f75c", glow: "#2ee8a5", pin: "#ffb02e", card: "#2ee8a5", intensityUnit: "tce/万元" },
  carbon: { label: "碳流", unit: "tCO₂", line: "#ffc15a", glow: "#ff8a3d", pin: "#ffb02e", card: "#ffab3d", intensityUnit: "tCO₂/万元" },
};
const ALERT = "#ff4d5e";

/**
 * Interactive flow network on a 3D dark map: dotted links follow the accounting hierarchy park ↔ zone ↔ enterprise,
 * with cone pins, equipment-style info cards and a red dome over enterprises that have open alerts.
 * Energy is drawn from the park to the plants; carbon from the plants up to the park total.
 * The park node is the aggregation point at the centre of the planning zones, not a physical facility.
 */
export default function FlowNetworkMap({ mode, year, nodes, parkTotal, alerts = [] }: { mode: Mode; year: number; nodes: FlowNode[]; parkTotal: number | null | undefined; alerts?: string[] }) {
  const container = useRef<HTMLDivElement>(null);
  const { handle, ready, l7Ready, error, retry } = useParkMap(container, { pitch: 55, rotation: 18, zoom: 14 });
  const style = STYLE[mode];
  const labels = useRef<any>(null);
  const flowLayers = useRef<any[]>([]);

  const network = useMemo(() => {
    const park = zoneHub("all");
    const sites = enterprises.flatMap((feature) => {
      const node = nodes.find((row) => row.code === feature.properties.code);
      if (!feature.properties.metricBindingApproved || !node?.value) return [];
      return [{ ...node, zone: SECTOR_ZONE[feature.properties.sector], at: feature.geometry.coordinates as Position, alert: alerts.includes(node.name) }];
    });
    const zones = (["green-home", "electronics"] as ZoneKey[]).map((key) => ({ key, at: zoneHub(key), value: sites.filter((s) => s.zone === key).reduce((a, s) => a + s.value, 0), count: sites.filter((s) => s.zone === key).length }))
      .filter((zone) => zone.value > 0);
    const link = (from: Position, to: Position, extra: { value: number; alert: number }) => mode === "energy"
      ? { fromLng: from[0], fromLat: from[1], toLng: to[0], toLat: to[1], ...extra }
      : { fromLng: to[0], fromLat: to[1], toLng: from[0], toLat: from[1], ...extra };
    const links = [
      ...zones.map((zone) => link(park, zone.at, { value: zone.value, alert: 0 })),
      ...sites.map((site) => link(zoneHub(site.zone), site.at, { value: site.value, alert: site.alert ? 1 : 0 })),
    ];
    return { park, sites, zones, links };
  }, [nodes, alerts, mode]);

  useEffect(() => {
    const current = handle.current;
    if (!ready || !current) return;
    frameParkTilted(current.map, current.AMap, { avoid: [60, 150, 40, 220], boost: 0.7 });
  }, [ready, handle]);

  // Dotted links (static dots + a moving highlight), hub glows and alert domes.
  useEffect(() => {
    const scene = handle.current?.scene;
    if (!l7Ready || !scene) return;
    let disposed = false;
    for (const layer of flowLayers.current) scene.removeLayer(layer);
    flowLayers.current = [];
    import("@antv/l7-layers").then(({ LineLayer, PointLayer }) => {
      if (disposed || handle.current?.scene !== scene) return;
      const parser = { type: "json", x: "fromLng", y: "fromLat", x1: "toLng", y1: "toLat" };
      const max = Math.max(...network.links.map((l) => l.value));
      const width = (v: number) => 1.2 + 2.2 * Math.sqrt(v / max);
      const dots = new LineLayer({ name: "flow-dots", zIndex: 4 }).source(network.links, { parser })
        .shape("line").size("value", width).color("alert", (a: number) => a ? ALERT : style.line)
        .style({ opacity: 0.95, lineType: "dash", dashArray: [0.5, 1.6] });
      const moving = new LineLayer({ name: "flow-moving", zIndex: 5, blend: "additive" }).source(network.links, { parser })
        .shape("line").size("value", (v: number) => width(v) + 1.4).color("alert", (a: number) => a ? ALERT : style.glow)
        .animate({ duration: 2.4, interval: 0.6, trailLength: 0.35 }).style({ opacity: 0.9 });
      const hubs = [{ lng: network.park[0], lat: network.park[1], size: 70 }, ...network.zones.map((z) => ({ lng: z.at[0], lat: z.at[1], size: 46 }))];
      const glow = new PointLayer({ name: "flow-hub-glow", zIndex: 6, blend: "additive" }).source(hubs, { parser: { type: "json", x: "lng", y: "lat" } })
        .shape("circle").size("size", (s: number) => s).color(style.glow).animate(true).style({ opacity: 0.9 });
      const alertSites = network.sites.filter((s) => s.alert).map((s) => ({ lng: s.at[0], lat: s.at[1] }));
      flowLayers.current = [dots, moving, glow];
      if (alertSites.length) {
        flowLayers.current.push(new PointLayer({ name: "flow-alert-dome", zIndex: 7, blend: "additive" }).source(alertSites, { parser: { type: "json", x: "lng", y: "lat" } })
          .shape("circle").size(90).color(ALERT).animate({ enable: true, speed: 0.8, rings: 3 }).style({ opacity: 1 }));
      }
      for (const layer of flowLayers.current) scene.addLayer(layer);
    });
    return () => { disposed = true; };
  }, [l7Ready, handle, network, style]);

  // Cone pins and info cards (park, zones, the three largest enterprises and every enterprise with an alert).
  useEffect(() => {
    const current = handle.current;
    if (!ready || !current) return;
    const { AMap, map } = current;
    // Pins never collide; cards avoid each other (larger flows win).
    if (!labels.current) {
      labels.current = { pins: new AMap.LabelsLayer({ zIndex: 165, collision: false }), cards: new AMap.LabelsLayer({ zIndex: 170, collision: true, allowCollision: false }) };
      map.add([labels.current.pins, labels.current.cards]);
    }
    const { pins, cards } = labels.current;
    pins.clear(); cards.clear();
    const total = parkTotal ?? network.sites.reduce((a, s) => a + s.value, 0);
    const add = (at: Position, card: { image: string; size: [number, number] }, rank: number, pinColor: string) => {
      const pin = conePin(pinColor, 22);
      pins.add(new AMap.LabelMarker({ position: at, zIndex: 3, icon: { image: pin.image, size: pin.size, anchor: "bottom-center" } }));
      // One collision layer for every card: alerts rank highest, then the park and zone cards, then by flow size.
      cards.add(new AMap.LabelMarker({ position: at, zIndex: rank >= 1e5 ? 6 : 4, rank, icon: { image: card.image, size: card.size, anchor: "bottom-left", offset: [14, -30] } }));
    };
    add(network.park, infoCard(`信阳经开区 · 园区${mode === "energy" ? "综合能耗" : "碳排放"}`, [[`${year} 年`, `${fmt(total, 0)} ${style.unit}`], ["重点企业", `${network.sites.length} 家`]], style.card), 1e6, style.pin);
    for (const zone of network.zones) {
      add(zone.at, infoCard(zoneFeature(zone.key)?.properties.name ?? zone.key, [[`${style.label}汇聚`, `${fmt(zone.value, 0)} ${style.unit}`], ["占园区", `${fmt(zone.value / (total || 1) * 100, 1)}%`]], style.card), 1e5, style.pin);
    }
    const shown = [...network.sites].sort((a, b) => b.value - a.value).filter((s, i) => i < 3 || s.alert);
    for (const site of shown) {
      const rows: [string, string][] = [[mode === "energy" ? "综合能耗" : "碳排放", `${fmt(site.value, 0)} ${style.unit}`], ["占园区", `${fmt(site.value / (total || 1) * 100, 1)}%`]];
      if (site.intensity != null) rows.push(["强度", `${fmt(site.intensity, 3)} ${style.intensityUnit}`]);
      if (site.alert) rows.unshift(["状态", "存在未处理预警"]);
      add(site.at, infoCard(shortName(site.name), rows, site.alert ? ALERT : style.card, site.alert), site.alert ? 5e6 : site.value, site.alert ? ALERT : style.pin);
    }
  }, [ready, handle, network, mode, style, parkTotal, year]);
  useEffect(() => () => { labels.current = null; flowLayers.current = []; }, []);

  return <div className="flowmap">
    <div ref={container} className="twin-map" role="img" aria-label={`${style.label}网络互动地图`} />
    {!ready && !error && <div className="map-loading" role="status"><span className="spinner" />正在载入园区三维底图…</div>}
    {error && <div className="map-error" role="status">{error}<button type="button" className="btn-ghost small" onClick={retry}>重试</button></div>}
    <div className="flowmap-legend glass">
      <span><i className="dash" style={{ ["--c" as string]: style.line }} />{mode === "energy" ? "园区 → 片区 → 企业 供能" : "企业 → 片区 → 园区 排放汇聚"}</span>
      <span><i className="dot" style={{ ["--c" as string]: style.glow }} />汇聚节点</span>
      {network.sites.some((s) => s.alert) && <span><i className="dot" style={{ ["--c" as string]: ALERT }} />存在未处理预警</span>}
    </div>
  </div>;
}
