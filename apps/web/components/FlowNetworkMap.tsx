"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { enterprises, type Position } from "@/lib/park-geography";
import { canvas, conePin, fmt, frameParkTilted, HENAN_BOUNDS, infoCard, roundRect, SECTOR_ZONE, shortName, useParkMap, zoneFeature, zoneHub, type ZoneKey } from "@/lib/park-map";

export interface FlowNode { code: string; name: string; value: number; intensity?: number | null }
export interface FlowMix { code: string; carrier: string; tce: number; co2_t: number }

/** One colour per energy carrier; carbon flows reuse them for the emission source of each carrier. */
const CARRIERS: { name: string; color: string }[] = [
  { name: "电网电力", color: "#4cb4ff" }, { name: "天然气", color: "#ffab3d" }, { name: "热力", color: "#ff6b81" },
  { name: "油品", color: "#b79cff" }, { name: "绿电", color: "#2ee8a5" }, { name: "煤炭", color: "#9aa3ad" }, { name: "生物质", color: "#d4f75c" },
];
const ALERT = "#ff4d5e";
const STYLE = {
  energy: { label: "能流", unit: "tce", pin: "#ffb02e", card: "#2ee8a5", intensityUnit: "tce/万元", direction: "园区 → 产业片区 → 企业（按能源品种供能）" },
  carbon: { label: "碳流", unit: "tCO₂", pin: "#ffb02e", card: "#ffab3d", intensityUnit: "tCO₂/万元", direction: "企业 → 产业片区 → 园区（按排放来源汇聚）" },
} as const;

/** White chevron used as a moving line texture (tinted by the layer colour via textureBlend "replace"). */
function arrowIcon() {
  const c = document.createElement("canvas"); c.width = 64; c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 10; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(20, 14); ctx.lineTo(42, 32); ctx.lineTo(20, 50); ctx.stroke();
  return c.toDataURL("image/png");
}

/** A numbered plate stays visible for every enterprise; the side list carries its full name. */
function sitePlate(number: number, name: string, color: string) {
  const w = 170, h = 30;
  const { element, ctx } = canvas(w, h);
  ctx.fillStyle = "rgba(14,15,19,.94)"; roundRect(ctx, 0, 0, w, h, 9); ctx.fill();
  ctx.fillStyle = color; roundRect(ctx, 5, 5, 22, 20, 6); ctx.fill();
  ctx.fillStyle = "#101714"; ctx.font = "700 12px sans-serif"; ctx.textAlign = "center"; ctx.fillText(String(number), 16, 19);
  ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.font = '600 12px "Microsoft YaHei", sans-serif';
  const label = shortName(name);
  ctx.fillText(label.length > 10 ? `${label.slice(0, 9)}…` : label, 34, 20);
  return { image: element.toDataURL("image/png"), size: [w, h] as [number, number] };
}

/**
 * Flow network on a 3D dark map, split by energy carrier: for each carrier a curved link runs park → zone → enterprise
 * (energy) or enterprise → zone → park (carbon), with a faint base arc, streaming particles and moving arrows in the
 * carrier colour; width follows the quantity. Arcs of different carriers are fanned out so they do not overlap.
 * Enterprises with open alerts get a red dome and card. The park node is the aggregation point at the centre of the
 * planning zones, not a physical facility.
 */
export default function FlowNetworkMap({ mode, year, nodes, mix, parkTotal, alerts = [] }: { mode: "energy" | "carbon"; year: number; nodes: FlowNode[]; mix: FlowMix[]; parkTotal: number | null | undefined; alerts?: string[] }) {
  const container = useRef<HTMLDivElement>(null);
  // Free zoom and drag within Henan province.
  const { handle, ready, l7Ready, error, retry } = useParkMap(container, { pitch: 55, rotation: 18, zoom: 14, limit: HENAN_BOUNDS, zooms: [7, 19] });
  const style = STYLE[mode];
  const labels = useRef<any>(null);
  const flowLayers = useRef<any[]>([]);
  const [only, setOnly] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const network = useMemo(() => {
    const amount = (row: FlowMix) => mode === "energy" ? row.tce : row.co2_t;
    const park = zoneHub("all");
    const sites = enterprises.flatMap((feature) => {
      const node = nodes.find((row) => row.code === feature.properties.code);
      if (!feature.properties.metricBindingApproved || !node?.value) return [];
      const carriers = mix.filter((row) => row.code === node.code && amount(row) > 0).map((row) => ({ carrier: row.carrier, value: amount(row) }));
      return [{ ...node, zone: SECTOR_ZONE[feature.properties.sector], at: feature.geometry.coordinates as Position, alert: alerts.includes(node.name), carriers }];
    });
    const zones = (["green-home", "electronics"] as ZoneKey[]).map((key) => {
      const members = sites.filter((s) => s.zone === key);
      const carriers = CARRIERS.map((c) => ({ carrier: c.name, value: members.reduce((a, s) => a + (s.carriers.find((x) => x.carrier === c.name)?.value ?? 0), 0) })).filter((c) => c.value > 0);
      return { key, at: zoneHub(key), value: members.reduce((a, s) => a + s.value, 0), count: members.length, carriers };
    }).filter((zone) => zone.value > 0);
    const link = (from: Position, to: Position, extra: { carrier: string; value: number; alert: number }) => mode === "energy"
      ? { fromLng: from[0], fromLat: from[1], toLng: to[0], toLat: to[1], ...extra }
      : { fromLng: to[0], fromLat: to[1], toLng: from[0], toLat: from[1], ...extra };
    const links = [
      ...zones.flatMap((zone) => zone.carriers.map((c) => link(park, zone.at, { carrier: c.carrier, value: c.value, alert: 0 }))),
      ...sites.flatMap((site) => site.carriers.map((c) => link(zoneHub(site.zone), site.at, { carrier: c.carrier, value: c.value, alert: site.alert ? 1 : 0 }))),
    ];
    const totals = CARRIERS.map((c) => ({ ...c, value: sites.reduce((a, s) => a + (s.carriers.find((x) => x.carrier === c.name)?.value ?? 0), 0) })).filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value);
    return { park, sites, zones, links, totals };
  }, [nodes, mix, alerts, mode]);
  const total = parkTotal ?? network.sites.reduce((a, s) => a + s.value, 0);

  useEffect(() => {
    const current = handle.current;
    if (!ready || !current) return;
    // Leave room on the right for the flow panel (avoid order: top, bottom, left, right).
    frameParkTilted(current.map, current.AMap, { avoid: [60, 150, 40, 300], boost: showAll ? 0.15 : 1.4 });
  }, [ready, handle, showAll]);

  // One set of layers per carrier (base arc, streaming particles, arrows), each with its own curve offset.
  useEffect(() => {
    const scene = handle.current?.scene;
    if (!l7Ready || !scene) return;
    let disposed = false;
    for (const layer of flowLayers.current) scene.removeLayer(layer);
    flowLayers.current = [];
    Promise.all([import("@antv/l7-layers"), scene.addImage("flow-arrow", arrowIcon())]).then(([{ LineLayer, PointLayer }]) => {
      if (disposed || handle.current?.scene !== scene) return;
      const parser = { type: "json", x: "fromLng", y: "fromLat", x1: "toLng", y1: "toLat" };
      const max = Math.max(...network.links.map((l) => l.value));
      const width = (v: number) => 1.4 + 4.2 * Math.sqrt(v / max);
      const layers: any[] = [];
      network.totals.forEach((carrier, index) => {
        if (only && only !== carrier.name) return;
        const data = network.links.filter((l) => l.carrier === carrier.name);
        if (!data.length) return;
        // Fan the carriers out: alternating sides, growing curvature.
        const theta = (index % 2 ? -1 : 1) * (0.18 + 0.12 * Math.floor(index / 2));
        const colour = (a: number) => a ? ALERT : carrier.color;
        layers.push(
          new LineLayer({ name: `flow-base-${index}`, zIndex: 4 }).source(data, { parser })
            .shape("arc").size("value", width).color("alert", colour).style({ thetaOffset: theta, opacity: 0.22, segmentNumber: 40 }),
          new LineLayer({ name: `flow-stream-${index}`, zIndex: 5, blend: "additive" }).source(data, { parser })
            .shape("arc").size("value", (v: number) => width(v) + 1).color("alert", colour)
            .style({ thetaOffset: theta, opacity: 1, segmentNumber: 40 })
            .animate({ duration: 2.4, interval: 0.3, trailLength: 0.2 }),
          new LineLayer({ name: `flow-arrows-${index}`, zIndex: 6 }).source(data, { parser })
            .shape("arc").size(10).texture("flow-arrow").color("alert", colour)
            .animate({ duration: 1.6, interval: 1, trailLength: 2 })
            .style({ thetaOffset: theta, opacity: 0.95, lineTexture: true, iconStep: 50, textureBlend: "replace", segmentNumber: 40 }),
        );
      });
      const hubs = [{ lng: network.park[0], lat: network.park[1], size: 70 }, ...network.zones.map((z) => ({ lng: z.at[0], lat: z.at[1], size: 46 }))];
      layers.push(new PointLayer({ name: "flow-hub-glow", zIndex: 7, blend: "additive" }).source(hubs, { parser: { type: "json", x: "lng", y: "lat" } })
        .shape("circle").size("size", (s: number) => s).color(style.card).animate(true).style({ opacity: 0.85 }));
      // Location ripple under every enterprise cone (same animation as the overview markers).
      layers.push(new PointLayer({ name: "flow-site-ripple", zIndex: 7, blend: "additive" })
        .source(network.sites.filter((s) => !s.alert).map((s) => ({ lng: s.at[0], lat: s.at[1] })), { parser: { type: "json", x: "lng", y: "lat" } })
        .shape("circle").size(24).color(style.card).animate({ enable: true, speed: 0.7, rings: 3 }).style({ opacity: 0.8 }));
      const alertSites = network.sites.filter((s) => s.alert).map((s) => ({ lng: s.at[0], lat: s.at[1] }));
      if (alertSites.length) layers.push(new PointLayer({ name: "flow-alert-dome", zIndex: 8, blend: "additive" }).source(alertSites, { parser: { type: "json", x: "lng", y: "lat" } })
        .shape("circle").size(36).color(ALERT).animate({ enable: true, speed: 0.8, rings: 3 }).style({ opacity: 1 }));
      flowLayers.current = layers;
      for (const layer of layers) scene.addLayer(layer);
    }).catch((reason) => console.warn("[flow-map] flow layers unavailable", reason));
    return () => { disposed = true; };
  }, [l7Ready, handle, network, style, only]);

  // Cone pins and numbered name plates for every enterprise; park and zones retain detailed cards.
  useEffect(() => {
    const current = handle.current;
    if (!ready || !current) return;
    const { AMap, map } = current;
    if (!labels.current) {
      labels.current = { pins: new AMap.LabelsLayer({ zIndex: 165, collision: false }), cards: new AMap.LabelsLayer({ zIndex: 170, collision: true, allowCollision: false }), names: new AMap.LabelsLayer({ zIndex: 175, collision: false }) };
      map.add([labels.current.pins, labels.current.cards, labels.current.names]);
    }
    const { pins, cards, names } = labels.current;
    pins.clear(); cards.clear(); names.clear();
    const mixText = (list: { carrier: string; value: number }[], sum: number) => list.slice().sort((a, b) => b.value - a.value).slice(0, 2)
      .map((c) => `${c.carrier} ${fmt(c.value / (sum || 1) * 100, 0)}%`).join(" · ");
    // Alerts rank highest, then the park and zone cards, then by flow size.
    const add = (at: Position, card: { image: string; size: [number, number] }, rank: number, pinColor: string) => {
      const pin = conePin(pinColor, 22);
      pins.add(new AMap.LabelMarker({ position: at, zIndex: 3, icon: { image: pin.image, size: pin.size, anchor: "bottom-center" } }));
      cards.add(new AMap.LabelMarker({ position: at, zIndex: rank >= 1e5 ? 6 : 4, rank, icon: { image: card.image, size: card.size, anchor: "bottom-left", offset: [14, -30] } }));
    };
    add(network.park, infoCard(`信阳经开区 · 园区${mode === "energy" ? "综合能耗" : "碳排放"}`, [[`${year} 年`, `${fmt(total, 0)} ${style.unit}`], ["主要品种", mixText(network.totals.map((t) => ({ carrier: t.name, value: t.value })), network.totals.reduce((a, t) => a + t.value, 0))]], style.card), 1e6, style.pin);
    for (const zone of network.zones) {
      add(zone.at, infoCard(zoneFeature(zone.key)?.properties.name ?? zone.key, [[`${style.label}汇聚`, `${fmt(zone.value, 0)} ${style.unit}`], ["占园区", `${fmt(zone.value / (total || 1) * 100, 1)}%`], ["主要品种", mixText(zone.carriers, zone.value)]], style.card), 1e5, style.pin);
    }
    [...network.sites].sort((a, b) => b.value - a.value).forEach((site, index) => {
      const color = site.alert ? ALERT : style.card;
      const pin = conePin(color, 18);
      pins.add(new AMap.LabelMarker({ position: site.at, zIndex: 3, icon: { image: pin.image, size: pin.size, anchor: "bottom-center" } }));
      // Enterprises stay as cones only (the side list names them in the same order); name plates collided with zone cards.
      void index; void sitePlate; void names;
    });
  }, [ready, handle, network, mode, style, total, year]);
  useEffect(() => () => { labels.current = null; flowLayers.current = []; }, []);

  const carrierSum = network.totals.reduce((a, t) => a + t.value, 0);
  const visibleSites = [...network.sites].sort((a, b) => b.value - a.value).filter((site) => !only || site.carriers.some((carrier) => carrier.carrier === only));
  return <div className="flowmap">
    <div ref={container} className="twin-map" role="img" aria-label={`${style.label}网络互动地图`} />
    {!ready && !error && <div className="map-loading" role="status"><span className="spinner" />正在载入园区三维底图…</div>}
    {error && <div className="map-error" role="status">{error}<button type="button" className="btn-ghost small" onClick={retry}>重试</button></div>}
    <aside className="flowmap-panel glass" aria-label="流向说明">
      <div className="flowmap-panel-head"><span className="eyebrow">{style.label}说明</span><button type="button" className="flowmap-view" onClick={() => setShowAll(!showAll)}>{showAll ? "放大视角" : "全览节点"}</button></div>
      <p className="flowmap-direction">{style.direction}</p>
      <ol className="flowmap-carriers">
        <li><button type="button" className={only === null ? "on" : ""} onClick={() => setOnly(null)}><i style={{ background: "linear-gradient(90deg,#4cb4ff,#ffab3d,#ff6b81)" }} /><span>全部品种</span><b className="num">{fmt(carrierSum, 0)}<small>{style.unit}</small></b></button></li>
        {network.totals.map((c) => <li key={c.name}><motion.button type="button" whileHover={{ x: 2 }} className={only === c.name ? "on" : ""} onClick={() => setOnly(only === c.name ? null : c.name)}>
          <i style={{ background: c.color }} /><span>{c.name}</span><b className="num">{fmt(c.value, 0)}<small>{fmt(c.value / (carrierSum || 1) * 100, 1)}%</small></b>
          <em><u style={{ width: `${c.value / (network.totals[0]?.value || 1) * 100}%`, background: c.color }} /></em>
        </motion.button></li>)}
      </ol>
      <div className="flowmap-node-title">{mode === "energy" ? "用能企业" : "排放企业"}<small>{only ?? "全部品种"}</small></div>
      <ol className="flowmap-sites">
        {visibleSites.slice(0, 8).map((site, i) => <li key={site.code}><b className="num">{i + 1}</b><span title={site.name}>{shortName(site.name)}</span><em className="num">{fmt(site.value, 0)}</em>
          <i><u style={{ width: `${site.value / (visibleSites[0]?.value || 1) * 100}%`, background: style.card }} /></i></li>)}
      </ol>
      <small className="flowmap-note">线宽表示量，光点与箭头表示方向；点选品种只看该品种的流向。</small>
    </aside>
    <div className="flowmap-legend glass">
      <span><i className="dot" style={{ ["--c" as string]: style.card }} />汇聚节点</span>
      {network.sites.some((s) => s.alert) && <span><i className="dot" style={{ ["--c" as string]: ALERT }} />存在未处理预警</span>}
    </div>
  </div>;
}
