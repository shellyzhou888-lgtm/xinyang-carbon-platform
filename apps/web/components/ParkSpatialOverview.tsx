"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ChartData } from "@xinyang/db-agent";
import { loadAmap, type AmapApi } from "@/lib/amap";
import { enterprises, geography, type EnterpriseFeature, type Position } from "@/lib/park-geography";
import { enterpriseBadge, enterpriseBrands } from "@/lib/enterprise-branding";
import { FLOW_EVENT, FOCUS_EVENT, HONOR_KINDS, honorLevel, type HonorKind } from "@/lib/honors";
import directory from "@/data/enterprise-directory.json";
import planning from "@/data/planning-overlay.json";
import Link from "next/link";

import { IconClose, IconExpand, IconLayers, IconSearch } from "./icons";

export type FlowMode = "energy" | "carbon" | "off";
export interface FlowEnterprise { code: string; name: string; tce: number | null; co2_t: number | null; output_wan: number | null }
export interface MapHonor { code: string; node: string; title: string; kind: HonorKind }

const EMPTY_RANKING: ChartData["ranking"] = [];
const EMPTY_FLOWS: FlowEnterprise[] = [];
const EMPTY_HONORS: MapHonor[] = [];
const FEATURED = new Set(directory.items.filter(row => row.featured && row.mapCode).map(row => row.mapCode));
const value = (number: number | null | undefined, digits = 1) => number == null ? "—" : number.toLocaleString("zh-CN", { maximumFractionDigits: digits });
const shortName = (name: string) => name.replace(/（[^）]*）/g, "");
const pinIcon = (color: string, ring = false) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="12" fill="${color}" fill-opacity=".2"/>${ring ? `<circle cx="15" cy="15" r="13" fill="none" stroke="${color}" stroke-width="1.5"/>` : ""}<circle cx="15" cy="15" r="6" fill="${color}" stroke="#0b100f" stroke-width="2"/></svg>`);

const FLOW_STYLE = {
  energy: { label: "能流", unit: "tce", source: "#c5f05c", target: "#3ee0a1", hub: "#3ee0a1" },
  carbon: { label: "碳流", unit: "tCO₂", source: "#ffd27a", target: "#ff8a3d", hub: "#f6b54a" },
} as const;

/** Logo badges and honour ribbons appear from street scale; the park panorama shows zones, flows and callouts only. */
const STREET_ZOOM = 14.4;

type ZoneKey = "all" | "green-home" | "electronics" | "research" | "innovation-community";
const ZONES: { key: ZoneKey; label: string }[] = [
  { key: "all", label: "园区全景" }, { key: "green-home", label: "绿色家居" }, { key: "electronics", label: "电子信息" },
  { key: "research", label: "科创研发" }, { key: "innovation-community", label: "科创部落" },
];
const SECTOR_ZONE: Record<string, ZoneKey> = { "绿色家居": "green-home", "电子信息": "electronics" };
const zoneFeature = (key: ZoneKey) => planning.features.find((feature) => feature.properties.id === key);
const zonePoints = (key: ZoneKey) => planning.features.filter((feature) => key === "all" || feature.properties.id === key)
  .flatMap((feature) => feature.geometry.coordinates.flatMap((polygon) => polygon[0] as Position[]));
/** Hub of a zone's flows: centre of the zone's bounding box ("all" gives the park-level aggregation node). */
function zoneHub(key: ZoneKey): Position {
  const points = zonePoints(key);
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function canvas(w: number, h: number) {
  const element = document.createElement("canvas"); element.width = Math.ceil(w * 2); element.height = Math.ceil(h * 2);
  const ctx = element.getContext("2d")!; ctx.scale(2, 2); return { element, ctx };
}
function planningLabel(name: string, color: string, area: number) {
  const { element, ctx } = canvas(190, 44);
  ctx.fillStyle = "rgba(10,15,14,.82)"; roundRect(ctx, 0, 0, 190, 44, 10); ctx.fill();
  ctx.fillStyle = color; roundRect(ctx, 10, 15, 4, 14, 2); ctx.fill();
  ctx.font = '600 12px "Microsoft YaHei", sans-serif'; ctx.fillStyle = "#eef4f1"; ctx.fillText(name, 22, 19);
  ctx.font = '10px "Microsoft YaHei", sans-serif'; ctx.fillStyle = "#9fb0aa"; ctx.fillText(`规划面积 ${area.toFixed(2)} km²`, 22, 34);
  return element.toDataURL("image/png");
}
/** Honour ribbon under a pin: one coloured chip per honour category. */
function honorRibbon(kinds: HonorKind[]) {
  const chips = kinds.map((kind) => HONOR_KINDS.find((row) => row.kind === kind)!);
  const probe = canvas(1, 1).ctx; probe.font = '600 10.5px "Microsoft YaHei", sans-serif';
  const widths = chips.map((chip) => Math.ceil(probe.measureText(chip.short).width) + 22);
  const w = widths.reduce((a, b) => a + b, 0) + (chips.length - 1) * 4, h = 20;
  const { element, ctx } = canvas(w, h);
  let x = 0;
  chips.forEach((chip, index) => {
    ctx.fillStyle = "rgba(8,13,12,.86)"; roundRect(ctx, x, 0, widths[index], h, 10); ctx.fill();
    ctx.strokeStyle = chip.color; ctx.lineWidth = 1; roundRect(ctx, x + .5, .5, widths[index] - 1, h - 1, 9.5); ctx.stroke();
    ctx.fillStyle = chip.color; ctx.beginPath(); ctx.arc(x + 9, h / 2, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.font = '600 10.5px "Microsoft YaHei", sans-serif'; ctx.fillText(chip.short, x + 15, 14);
    x += widths[index] + 4;
  });
  return { image: element.toDataURL("image/png"), size: [w, h] as [number, number] };
}
/** Callout card in the style of a flow-map annotation: name, value and share. */
function flowCallout(title: string, figure: string, unit: string, note: string, color: string) {
  const w = 184, h = 62;
  const { element, ctx } = canvas(w, h);
  ctx.fillStyle = "rgba(8,13,12,.84)"; roundRect(ctx, 0, 0, w, h, 10); ctx.fill();
  ctx.fillStyle = color; roundRect(ctx, 0, 10, 3, h - 20, 1.5); ctx.fill();
  ctx.font = '600 11.5px "Microsoft YaHei", sans-serif'; ctx.fillStyle = "#eef4f1"; ctx.fillText(title, 12, 18);
  ctx.font = '600 18px Bahnschrift, "DIN Alternate", "Segoe UI", sans-serif'; ctx.fillStyle = color; ctx.fillText(figure, 12, 40);
  const fw = ctx.measureText(figure).width;
  ctx.font = '10.5px "Microsoft YaHei", sans-serif'; ctx.fillStyle = "#9fb0aa"; ctx.fillText(unit, 16 + fw, 40);
  ctx.fillText(note, 12, 55);
  return { image: element.toDataURL("image/png"), size: [w, h] as [number, number] };
}

/**
 * Full-screen park map: AMap satellite imagery, planning zones, enterprise POIs with honour ribbons,
 * and animated energy / carbon flow arcs (AntV L7) between each enterprise and its industrial zone.
 * `left` / `right` are floating panels laid over the map edges (they stack below the map on narrow screens).
 */
export default function ParkSpatialOverview({ year, ranking = EMPTY_RANKING, flows = EMPTY_FLOWS, honors = EMPTY_HONORS, parkTotal, initialEnterprise, left, right }: {
  year: number; ranking?: ChartData["ranking"]; flows?: FlowEnterprise[]; honors?: MapHonor[]; parkTotal?: { tce: number | null; co2_t: number | null };
  initialEnterprise?: string; left?: React.ReactNode; right?: React.ReactNode;
}) {
  const shell = useRef<HTMLElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<AmapApi>(null);
  const amap = useRef<AmapApi>(null);
  const scene = useRef<any>(null);
  const layers = useRef<Record<"pin" | "name" | "honor" | "area" | "callout", any>>({} as never);
  const satelliteLayers = useRef<any[]>([]);
  const planningPolygons = useRef<any[]>([]);
  const flowLayers = useRef<any[]>([]);
  const pick = useRef<(code: string) => void>(() => {});
  const [ready, setReady] = useState(false);
  const [l7Ready, setL7Ready] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [zone, setZone] = useState<ZoneKey>("all");
  const [zoneRevision, setZoneRevision] = useState(0);
  const [selected, setSelected] = useState("");
  const [satellite, setSatellite] = useState(true);
  const [pitched, setPitched] = useState(true);
  const [labels, setLabels] = useState(true);
  const [areaNames, setAreaNames] = useState(true);
  const [flow, setFlow] = useState<FlowMode>("energy");
  const [query, setQuery] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const listed = enterprises.filter((feature) => (feature.properties.name + feature.properties.poiName).includes(query.trim()));
  const active = enterprises.find((feature) => feature.properties.code === selected);
  const honorsOf = (code: string) => honors.filter((honor) => honor.code === code);

  /**
   * Flow arcs follow the accounting hierarchy: enterprise - industrial zone - park. Energy is drawn from the park
   * through the zone to each plant; carbon is drawn from each plant up through the zone to the park total.
   */
  const arcs = useMemo(() => {
    if (flow === "off") return [];
    const sites = enterprises.flatMap((feature) => {
      const row = flows.find((candidate) => candidate.code === feature.properties.code);
      const amount = flow === "energy" ? row?.tce : row?.co2_t;
      if (!feature.properties.metricBindingApproved || !amount) return [];
      const zoneKey = SECTOR_ZONE[feature.properties.sector];
      const hub = zoneHub(zoneKey);
      const site = feature.geometry.coordinates;
      // Energy is supplied from the zone network to the plant; carbon is accounted from the plant up to the zone.
      const [from, to] = flow === "energy" ? [hub, site] : [site, hub];
      return [{ level: "site" as const, code: feature.properties.code, name: feature.properties.name, zone: zoneKey, amount, fromLng: from[0], fromLat: from[1], toLng: to[0], toLat: to[1], siteLng: site[0], siteLat: site[1] }];
    });
    const park = zoneHub("all");
    const zones = (["green-home", "electronics"] as ZoneKey[]).flatMap((key) => {
      const amount = sites.filter((arc) => arc.zone === key).reduce((sum, arc) => sum + arc.amount, 0);
      if (!amount) return [];
      const hub = zoneHub(key);
      const [from, to] = flow === "energy" ? [park, hub] : [hub, park];
      return [{ level: "zone" as const, code: key, name: zoneFeature(key)?.properties.name ?? key, zone: key, amount, fromLng: from[0], fromLat: from[1], toLng: to[0], toLat: to[1], siteLng: hub[0], siteLat: hub[1] }];
    });
    return [...sites, ...zones];
  }, [flow, flows]);

  pick.current = (code) => {
    const feature = enterprises.find((candidate) => candidate.properties.code === code);
    if (!feature) return;
    setSelected(code);
    setListOpen(false);
    map.current?.setZoomAndCenter(16.6, feature.geometry.coordinates, false, 600);
  };

  useEffect(() => {
    const focus = (event: Event) => pick.current((event as CustomEvent<string>).detail);
    const mode = (event: Event) => setFlow((event as CustomEvent<FlowMode>).detail);
    window.addEventListener(FOCUS_EVENT, focus);
    window.addEventListener(FLOW_EVENT, mode);
    return () => { window.removeEventListener(FOCUS_EVENT, focus); window.removeEventListener(FLOW_EVENT, mode); };
  }, []);

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let currentMap: AmapApi;
    let currentScene: any;
    let mapElement: HTMLDivElement;
    let resize: ResizeObserver | undefined;
    let readyTimer: number | undefined;
    setError("");
    loadAmap().then(async (AMap) => {
      if (disposed || !container.current) return;
      amap.current = AMap;
      mapElement = document.createElement("div");
      mapElement.className = "amap-inner";
      mapElement.style.cssText = "width:100%;height:100%;";
      container.current.appendChild(mapElement);
      currentMap = new AMap.Map(mapElement, {
        viewMode: "3D", zoom: 14.2, center: zoneHub("all"), pitch: 45, rotation: 0, zooms: [12.6, 19],
        mapStyle: "amap://styles/dark", showBuildingBlock: true, features: ["bg", "road", "building", "point"],
      });
      map.current = currentMap;
      currentMap.addControl(new AMap.Scale({ position: "LB" }));
      resize = new ResizeObserver((entries) => {
        if (entries[0]?.contentRect.width > 0 && entries[0]?.contentRect.height > 0) currentMap.resize();
      });
      resize.observe(container.current);
      // AMap's camera projection is not ready immediately after construction.
      // Inserting DOM markers before its first complete event can produce NaN pixels.
      await new Promise<void>((resolve, reject) => {
        readyTimer = window.setTimeout(() => reject(new Error("地图底图加载超时，请稍后重试")), 20_000);
        currentMap.on("complete", () => { window.clearTimeout(readyTimer); resolve(); });
      });
      if (disposed) return;
      // Keep the camera on the park: panning stops a few kilometres outside the four zones.
      currentMap.setLimitBounds(new AMap.Bounds([114.0, 32.125], [114.2, 32.275]));
      satelliteLayers.current = [new AMap.TileLayer.Satellite({ zIndex: 10 }), new AMap.TileLayer.RoadNet({ zIndex: 11 })];
      currentMap.add(satelliteLayers.current);
      satelliteLayers.current.forEach((layer) => layer.hide());
      // WebGL label layers tolerate off-screen points behind a pitched camera.
      // DOM markers can instead throw Pixel(NaN, NaN) when zooming into one factory.
      layers.current = {
        pin: new AMap.LabelsLayer({ zIndex: 150, collision: false }),
        name: new AMap.LabelsLayer({ zIndex: 151, collision: true, allowCollision: false }),
        honor: new AMap.LabelsLayer({ zIndex: 152, collision: false }),
        area: new AMap.LabelsLayer({ zIndex: 160, collision: true, allowCollision: false }),
        callout: new AMap.LabelsLayer({ zIndex: 170, collision: false }),
      };
      currentMap.add(Object.values(layers.current));
      setReady(true);
      // Real AMap overlays remain usable if the optional WebGL flow layer fails.
      try {
        const [{ Scene }, { GaodeMap }] = await Promise.all([import("@antv/l7-scene"), import("@antv/l7-maps/gaode")]);
        if (disposed || !container.current) return;
        currentScene = new Scene({ id: mapElement, map: new GaodeMap({ mapInstance: currentMap }), logoVisible: false });
        scene.current = currentScene;
        currentScene.on("loaded", () => {
          if (disposed) return;
          shell.current?.setAttribute("data-map-engine", "amap-l7");
          setL7Ready(true);
        });
      } catch (reason) {
        console.warn("[park-map] L7 flow layer unavailable", reason instanceof Error ? reason.message : "unknown error");
      }
    }).catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : "地图初始化失败"); });
    return () => {
      disposed = true;
      window.clearTimeout(readyTimer);
      resize?.disconnect();
      layers.current = {} as never;
      satelliteLayers.current = [];
      planningPolygons.current = [];
      flowLayers.current = [];
      scene.current = null;
      map.current = null;
      // Scene owns the supplied AMap instance after it has been created.
      if (currentScene) currentScene.destroy();
      else currentMap?.destroy();
      mapElement?.remove();
      setReady(false);
      setL7Ready(false);
    };
  }, [retry]);

  // Enterprise pins, logo badges and honour ribbons.
  useEffect(() => {
    const { pin, name, honor } = layers.current;
    if (!ready || !amap.current || !pin || !name || !honor) return;
    const AMap = amap.current;
    pin.clear(); name.clear(); honor.clear();
    let disposed = false;
    for (const feature of enterprises) {
      const code = feature.properties.code;
      const on = code === selected;
      const kinds = [...new Set(honors.filter((row) => row.code === code).map((row) => row.kind))];
      const color = on ? "#c5f05c" : kinds.length ? HONOR_KINDS.find((row) => row.kind === kinds[0])!.color : feature.properties.color;
      const marker = new AMap.LabelMarker({ position: [...feature.geometry.coordinates], zIndex: on ? 3 : 1,
        icon: { image: pinIcon(color, kinds.length > 0), size: [30, 30], anchor: "center" } });
      marker.on("click", () => pick.current(code));
      pin.add(marker);
      if (labels && kinds.length) {
        const ribbon = honorRibbon(kinds);
        const label = new AMap.LabelMarker({ position: [...feature.geometry.coordinates], zIndex: 2, zooms: [STREET_ZOOM, 20], icon: { image: ribbon.image, size: ribbon.size, anchor: "top-center", offset: [0, 14] } });
        label.on("click", () => pick.current(code));
        honor.add(label);
      }
      if (labels && (FEATURED.has(code) && enterpriseBrands.get(code)?.logo || kinds.length) || on) {
        enterpriseBadge(code, feature.properties.name, feature.properties.color, on).then(image => {
          if (disposed || !layers.current.name) return;
          const label = new AMap.LabelMarker({ position: [...feature.geometry.coordinates], zIndex: on ? 3 : 1, rank: on ? 1e12 : kinds.length ? 10 : 1, zooms: on ? [3, 20] : [STREET_ZOOM, 20],
            icon: { image, size: [120, 60], anchor: "bottom-center", offset: [0, -12] } });
          label.on("click", () => pick.current(code));
          layers.current.name.add(label);
        });
      }
    }
    shell.current?.setAttribute("data-enterprise-count", String(enterprises.length));
    shell.current?.setAttribute("data-selected-enterprise", selected);
    return () => { disposed = true; };
  }, [ready, selected, labels, honors]);

  // Camera: whole park on load, street-level framing per zone.
  useEffect(() => {
    if (!ready || !map.current || !amap.current) return;
    const AMap = amap.current;
    const instance = map.current;
    const targets = zonePoints(zone).map((point) => new AMap.Marker({ position: point }));
    if (zone !== "all") for (const feature of enterprises) if (SECTOR_ZONE[feature.properties.sector] === zone) targets.push(new AMap.Marker({ position: [...feature.geometry.coordinates] }));
    // Leave room for the topbar and the floating side panels so the zones land in the visible centre.
    // AMap's avoid margins are ordered [top, bottom, left, right] (not CSS order).
    const wide = (shell.current?.clientWidth ?? 0) > 1180;
    instance.setPitch(0, true);
    instance.setFitView(targets, true, wide ? [150, 110, 420, 420] : [70, 70, 30, 30], zone === "all" ? 15.2 : 17);
    // Tilting enlarges the near (southern) edge, so step back slightly to keep every zone in frame.
    if (pitched) { instance.setPitch(45, true); instance.setZoom(instance.getZoom() - 0.25, true); }
    shell.current?.setAttribute("data-map-preset", zone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, zone, zoneRevision]);

  useEffect(() => { if (ready && initialEnterprise) pick.current(initialEnterprise); }, [ready, initialEnterprise]);

  // Planning zones and their name labels; the zone in focus is drawn brighter.
  useEffect(() => {
    const { area } = layers.current;
    if (!ready || !area || !amap.current || !map.current) return;
    area.clear();
    planningPolygons.current.forEach(polygon => polygon.setMap(null));
    planningPolygons.current = [];
    shell.current?.setAttribute("data-planning-area-count", String(areaNames ? planning.features.length : 0));
    if (!areaNames) return;
    const AMap = amap.current;
    for (const feature of planning.features) {
      const focus = zone === "all" || feature.properties.id === zone;
      for (const rings of feature.geometry.coordinates) {
        const polygon = new AMap.Polygon({ path: rings[0], fillColor: feature.properties.color, fillOpacity: focus ? .16 : .05, strokeColor: feature.properties.color,
          strokeOpacity: focus ? .95 : .35, strokeWeight: focus ? 2 : 1, zIndex: 60, cursor: "pointer" });
        polygon.on("click", () => { setZone(feature.properties.id as ZoneKey); setZoneRevision((n) => n + 1); });
        polygon.setMap(map.current);
        planningPolygons.current.push(polygon);
      }
      // Larger zones win label collisions; the small 科创部落 label reappears when zoomed in.
      area.add(new AMap.LabelMarker({ position: feature.properties.labelPosition, rank: feature.properties.areaKm2, icon: { image: planningLabel(feature.properties.name, feature.properties.color, feature.properties.areaKm2), size: [190, 44], anchor: "center" } }));
    }
  }, [ready, areaNames, zone]);

  // Flow arcs, hub ripples and the callouts for the largest flows.
  useEffect(() => {
    const currentScene = scene.current;
    if (!l7Ready || !currentScene) return;
    let disposed = false;
    for (const layer of flowLayers.current) currentScene.removeLayer(layer);
    flowLayers.current = [];
    layers.current.callout?.clear();
    shell.current?.setAttribute("data-flow-mode", flow);
    shell.current?.setAttribute("data-flow-arcs", String(arcs.length));
    if (flow === "off" || !arcs.length) return;
    const style = FLOW_STYLE[flow];
    const siteArcs = arcs.filter((arc) => arc.level === "site");
    const total = siteArcs.reduce((sum, arc) => sum + arc.amount, 0);
    const max = Math.max(...arcs.map((arc) => arc.amount));
    const siteMax = Math.max(...siteArcs.map((arc) => arc.amount));
    const width = (amount: number) => 2.2 + 5.8 * Math.sqrt(amount / max);
    import("@antv/l7-layers").then(({ LineLayer, PointLayer }) => {
      if (disposed || scene.current !== currentScene) return;
      const parser = { type: "json", x: "fromLng", y: "fromLat", x1: "toLng", y1: "toLat" };
      const base = new LineLayer({ name: "flow-base", zIndex: 4, blend: "additive" }).source(arcs, { parser })
        .shape("arc3d").size("amount", width).color(style.target).style({ opacity: 0.35, segmentNumber: 60 });
      const moving = new LineLayer({ name: "flow-moving", zIndex: 5 }).source(arcs, { parser })
        .shape("arc3d").size("amount", (amount: number) => width(amount) + 0.6).color(style.target)
        .style({ opacity: 1, sourceColor: style.source, targetColor: style.target, segmentNumber: 60 })
        .animate({ duration: 2.6, interval: 0.55, trailLength: 0.5 });
      const hubs = [...arcs.filter((arc) => arc.level === "zone").map((arc) => ({ key: arc.zone, size: 52, lng: arc.siteLng, lat: arc.siteLat })),
        { key: "all", size: 76, lng: zoneHub("all")[0], lat: zoneHub("all")[1] }];
      const pointParser = { type: "json", x: "lng", y: "lat" };
      const ripple = new PointLayer({ name: "flow-hubs", zIndex: 6, blend: "additive" }).source(hubs, { parser: pointParser })
        .shape("circle").size("size", (size: number) => size).color(style.hub).animate(true).style({ opacity: 1 });
      const core = new PointLayer({ name: "flow-hub-core", zIndex: 7 }).source(hubs, { parser: pointParser })
        .shape("circle").size("size", (size: number) => size / 8).color(style.hub).style({ opacity: 1, stroke: "#0b100f", strokeWidth: 2 });
      const sites = new PointLayer({ name: "flow-sites", zIndex: 6, blend: "additive" }).source(siteArcs, { parser: { type: "json", x: "siteLng", y: "siteLat" } })
        .shape("circle").size("amount", (amount: number) => 14 + 20 * Math.sqrt(amount / siteMax)).color(style.target).animate({ enable: true, speed: 0.6, rings: 2 }).style({ opacity: 0.8 });
      flowLayers.current = [base, moving, sites, ripple, core];
      for (const layer of flowLayers.current) currentScene.addLayer(layer);
    }).catch((reason) => console.warn("[park-map] flow layers unavailable", reason));

    // Callouts: the park total, each zone total and the two largest enterprises.
    const AMap = amap.current;
    const callout = layers.current.callout;
    if (AMap && callout) {
      const parkValue = (flow === "energy" ? parkTotal?.tce : parkTotal?.co2_t) ?? total;
      const parkCard = flowCallout(`信阳经开区 · 园区${flow === "energy" ? "综合能耗" : "碳排放"}`, value(parkValue, 0), style.unit, `${year} 年 · ${siteArcs.length} 家重点企业汇聚`, style.source);
      callout.add(new AMap.LabelMarker({ position: zoneHub("all"), zIndex: 6, icon: { image: parkCard.image, size: parkCard.size, anchor: "top-left", offset: [16, 12] } }));
      for (const arc of arcs.filter((row) => row.level === "zone")) {
        const count = siteArcs.filter((row) => row.zone === arc.zone).length;
        const card = flowCallout(arc.name, value(arc.amount, 0), style.unit, `${count} 家重点企业 · 占 ${value(arc.amount / total * 100, 1)}%`, style.hub);
        callout.add(new AMap.LabelMarker({ position: [arc.siteLng, arc.siteLat], zIndex: 5, icon: { image: card.image, size: card.size, anchor: "bottom-left", offset: [14, -14] } }));
      }
      for (const arc of [...siteArcs].sort((a, b) => b.amount - a.amount).slice(0, 2)) {
        const card = flowCallout(shortName(arc.name), value(arc.amount, 0), style.unit, `占重点企业合计 ${value(arc.amount / total * 100, 1)}%`, style.target);
        // West-side plants put the card below-right so it clears the left panel and the zone callout above the hub.
        const west = arc.siteLng < zoneHub("all")[0];
        const marker = new AMap.LabelMarker({ position: [arc.siteLng, arc.siteLat], zIndex: 4, icon: { image: card.image, size: card.size, anchor: west ? "top-left" : "bottom-right", offset: west ? [16, 10] : [-16, -10] } });
        marker.on("click", () => pick.current(arc.code));
        callout.add(marker);
      }
    }
    return () => { disposed = true; };
  }, [l7Ready, arcs, flow, parkTotal, year]);

  useEffect(() => {
    if (!map.current || !amap.current) return;
    // Toggle only the imagery layers; setLayers() would also detach enterprise labels.
    satelliteLayers.current.forEach((layer) => satellite ? layer.show() : layer.hide());
  }, [satellite, ready]);

  useEffect(() => { if (ready) map.current?.setPitch(pitched ? 45 : 0); }, [pitched, ready]);

  useEffect(() => {
    const changed = () => { setFullscreen(document.fullscreenElement === shell.current); map.current?.resize(); };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shell.current?.requestFullscreen();
    } catch { setError("浏览器未允许全屏，请使用浏览器的全屏快捷键（F11）。"); }
  }

  function chooseFlow(next: FlowMode) {
    setFlow(next);
    window.dispatchEvent(new CustomEvent(FLOW_EVENT, { detail: next }));
  }

  function exportCoordinates() {
    const blob = new Blob([JSON.stringify({ ...geography, features: [...enterprises, ...planning.features] }, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "xinyang-enterprises-planning-gcj02.geojson"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const brand = active ? enterpriseBrands.get(active.properties.code) : undefined;
  const activeFlow = active?.properties.metricBindingApproved ? flows.find((row) => row.code === active.properties.code) : undefined;
  const activeRank = active ? ranking.find((row) => row.code === active.properties.code) : undefined;
  return <section className="map-stage" ref={shell} data-labels={labels} aria-label="园区空间总览">
    <div ref={container} className="map-canvas" role="img" aria-label="高德地图：信阳经开区产业片区、企业点位与能碳流向" />
    <div className="map-vignette" aria-hidden="true" />
    {!ready && !error && <div className="map-loading" role="status"><span className="spinner" />正在载入园区卫星地图…</div>}
    {error && <div className="map-error" role="status">{error}<button type="button" className="btn-ghost small" onClick={() => { setError(""); setRetry((n) => n + 1); }}>重试</button></div>}

    <div className="map-top">
      <nav className="segmented glass" role="group" aria-label="产业片区">
        {ZONES.map(({ key, label }) => <button type="button" key={key} onClick={() => { setSelected(""); setZone(key); setZoneRevision((n) => n + 1); }} className={zone === key ? "on" : ""} aria-pressed={zone === key}>
          {zone === key && <motion.span layoutId="zone-pill" className="segmented-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
          <span>{label}</span>
        </button>)}
      </nav>
      <div className="map-legend glass">
        {flow !== "off" && <span className={`flow-legend tone-${flow}`}><i />{FLOW_STYLE[flow].label}：{flow === "energy" ? "片区 → 企业供能" : "企业 → 片区排放汇聚"}</span>}
        {HONOR_KINDS.filter((kind) => honors.some((honor) => honor.kind === kind.kind && honor.code)).map((kind) => <span key={kind.kind}><i style={{ background: kind.color }} />{kind.short}</span>)}
      </div>
    </div>

    {left && <div className="map-float left">{left}</div>}
    {right && <div className="map-float right">{right}</div>}

    <div className="map-bottom">
      <div className="map-tools glass" role="group" aria-label="地图工具">
        <span className="flow-switch" role="group" aria-label="流向图层">
          {(["energy", "carbon", "off"] as FlowMode[]).map((mode) => <button key={mode} type="button" aria-pressed={flow === mode} className={`tone-${mode}`} onClick={() => chooseFlow(mode)}>{mode === "off" ? "关闭流向" : FLOW_STYLE[mode].label}</button>)}
        </span>
        <button type="button" aria-pressed={listOpen} onClick={() => setListOpen((open) => !open)}><IconSearch />企业</button>
        <button type="button" aria-pressed={satellite} onClick={() => setSatellite((current) => !current)}><IconLayers />{satellite ? "卫星" : "矢量"}</button>
        <button type="button" aria-pressed={pitched} onClick={() => setPitched((current) => !current)}>3D</button>
        <button type="button" aria-pressed={labels} onClick={() => setLabels((current) => !current)}>标识</button>
        <button type="button" aria-pressed={areaNames} onClick={() => setAreaNames((current) => !current)}>片区</button>
        <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "退出全屏" : "全屏查看"}><IconExpand />{fullscreen ? "退出" : "全屏"}</button>
      </div>
    </div>

    <AnimatePresence>
      {listOpen && <motion.aside key="list" className="map-drawer glass" aria-label="企业列表" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.25 }}>
        <header><b>园区企业 <small>{enterprises.length} 家</small></b><button type="button" className="icon-btn" onClick={() => setListOpen(false)} aria-label="关闭企业列表"><IconClose /></button></header>
        <label className="search"><IconSearch /><input aria-label="搜索地图企业" placeholder="搜索企业名称" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="map-list">
          {listed.map((feature) => <button type="button" key={feature.properties.code} className={selected === feature.properties.code ? "on" : ""} onClick={() => pick.current(feature.properties.code)} aria-pressed={selected === feature.properties.code}>
            <i style={{ backgroundColor: feature.properties.color }} /><span>{feature.properties.name}<small>{feature.properties.sector}{honorsOf(feature.properties.code).length ? ` · ${honorsOf(feature.properties.code).length} 项荣誉` : ""}</small></span>
            <em className="num">{value(feature.properties.metricBindingApproved ? ranking.find((row) => row.code === feature.properties.code)?.tce : undefined)}<small>tce</small></em>
          </button>)}
          {!listed.length && <p className="panel-note">没有匹配的企业</p>}
        </div>
        <footer><button type="button" className="btn-ghost small" onClick={exportCoordinates}>导出坐标 GeoJSON</button><Link className="more-link" href={`/enterprises?year=${year}`}>企业名录</Link></footer>
      </motion.aside>}
      {active && !listOpen && <EnterpriseDetail key={active.properties.code} feature={active} year={year} logo={brand?.logo ?? undefined} flow={activeFlow} intensity={activeRank?.intensity} honors={honorsOf(active.properties.code)} onClose={() => setSelected("")} />}
    </AnimatePresence>
  </section>;
}

function EnterpriseDetail({ feature, year, logo, flow, intensity, honors, onClose }: { feature: EnterpriseFeature; year: number; logo?: string; flow?: FlowEnterprise; intensity?: number | null; honors: MapHonor[]; onClose: () => void }) {
  return <motion.aside className="map-drawer detail glass" aria-label="企业详情" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.25 }}>
    <header>
      <div className="detail-title">{logo && <img className="detail-logo" src={logo} alt={`${feature.properties.name}品牌标识`} />}<div><span className="eyebrow">{feature.properties.sector} · {year}</span><h3>{feature.properties.name}</h3></div></div>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭企业详情"><IconClose /></button>
    </header>
    <div className="detail-metrics three">
      <div><span className="num">{value(flow?.tce, 0)}</span><small>综合能耗 · tce</small></div>
      <div><span className="num">{value(flow?.co2_t, 0)}</span><small>碳排放 · tCO₂</small></div>
      <div><span className="num">{value(intensity, 3)}</span><small>tce / 万元产值</small></div>
    </div>
    {honors.length > 0 && <div className="detail-honors">{honors.map((honor, index) => {
      const kind = HONOR_KINDS.find((row) => row.kind === honor.kind)!;
      const level = honorLevel(honor.title);
      return <span key={index} style={{ ["--tone" as string]: kind.color }}><i />{honor.title}{level && !honor.title.includes(level) && <em>{level}</em>}</span>;
    })}</div>}
    <p className="detail-address">{feature.properties.address}</p>
    <footer><Link className="more-link" href={`/enterprises?year=${year}`}>企业名录</Link><Link className="more-link" href={`/energy?year=${year}`}>能源详情</Link></footer>
  </motion.aside>;
}
