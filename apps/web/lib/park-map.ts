"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { loadAmap, type AmapApi } from "@/lib/amap";
import { enterprises, type Position } from "@/lib/park-geography";
import planning from "@/data/planning-overlay.json";

/**
 * Shared plumbing for the park maps (overview, energy heat twin, energy / carbon flow maps):
 * zone geometry, a palette that matches the UI tokens, canvas label helpers and one AMap + L7 setup hook.
 */

export type ZoneKey = "all" | "green-home" | "electronics" | "research" | "innovation-community";
export const ZONES: { key: ZoneKey; label: string; short: string }[] = [
  { key: "all", label: "园区全景", short: "全景" },
  { key: "green-home", label: "绿色家居产业园区", short: "绿色家居" },
  { key: "electronics", label: "电子信息产业园区", short: "电子信息" },
  { key: "research", label: "科创研发片区", short: "科创研发" },
  { key: "innovation-community", label: "科创部落", short: "科创部落" },
];
/** Zone colours follow the UI accents (lime, blue, violet, green) instead of the planning map's pastel fills. */
export const ZONE_COLOR: Record<Exclude<ZoneKey, "all">, string> = {
  "green-home": "#d4f75c", electronics: "#4cb4ff", research: "#9b87ff", "innovation-community": "#2ee8a5",
};
export const SECTOR_ZONE: Record<string, ZoneKey> = { "绿色家居": "green-home", "电子信息": "electronics" };
export const zoneFeatures = planning.features;
export const zoneFeature = (key: ZoneKey) => planning.features.find((feature) => feature.properties.id === key);
export const zonePolygons = (key: ZoneKey) => planning.features.filter((feature) => key === "all" || feature.properties.id === key)
  .flatMap((feature) => feature.geometry.coordinates.map((polygon) => polygon[0] as Position[]));
export const zonePoints = (key: ZoneKey) => zonePolygons(key).flat();
/** Centre of a zone's bounding box ("all" gives the park centre). */
export function zoneHub(key: ZoneKey): Position {
  const points = zonePoints(key);
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
/** Building-scale focus point of a zone: the centroid of its enterprises, or the zone centre when it has none. */
export function zoneFocus(key: ZoneKey): Position {
  const sites = enterprises.filter((feature) => SECTOR_ZONE[feature.properties.sector] === key).map((feature) => feature.geometry.coordinates);
  if (!sites.length) return zoneHub(key);
  return [sites.reduce((a, p) => a + p[0], 0) / sites.length, sites.reduce((a, p) => a + p[1], 0) / sites.length];
}
export function pointInPolygon([x, y]: Position, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const isLight = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "light";
export const shortName = (name: string) => name.replace(/（[^）]*）/g, "").replace(/\(.*?\)/g, "");
export const fmt = (number: number | null | undefined, digits = 1) => number == null || !Number.isFinite(number) ? "—" : number.toLocaleString("zh-CN", { maximumFractionDigits: digits });

// ---------- canvas label helpers (AMap LabelMarker icons) ----------
export function canvas(w: number, h: number) {
  const element = document.createElement("canvas"); element.width = Math.ceil(w * 2); element.height = Math.ceil(h * 2);
  const ctx = element.getContext("2d")!; ctx.scale(2, 2); return { element, ctx };
}
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
const FONT = '"Microsoft YaHei", "PingFang SC", sans-serif';
const NUM = 'Bahnschrift, "DIN Alternate", "Segoe UI", sans-serif';
const plate = () => isLight() ? { bg: "rgba(255,255,255,.92)", text: "#14181a", muted: "#5d666e" } : { bg: "rgba(14,15,19,.84)", text: "#f4f6f2", muted: "#9aa19b" };

/** Zone name plate: name and planned area, no colour bar. */
export function zoneLabel(name: string, area: number) {
  const { bg, text, muted } = plate();
  const probe = canvas(1, 1).ctx; probe.font = `600 13px ${FONT}`;
  const w = Math.max(132, Math.ceil(probe.measureText(name).width) + 28), h = 46;
  const { element, ctx } = canvas(w, h);
  ctx.fillStyle = bg; roundRect(ctx, 0, 0, w, h, 12); ctx.fill();
  ctx.font = `600 13px ${FONT}`; ctx.fillStyle = text; ctx.fillText(name, 14, 20);
  ctx.font = `11px ${FONT}`; ctx.fillStyle = muted; ctx.fillText(`规划面积 ${area.toFixed(2)} km²`, 14, 36);
  return { image: element.toDataURL("image/png"), size: [w, h] as [number, number] };
}

/** Gold trophy glyph drawn on a canvas (cup, handles, stem, base). */
export function drawTrophy(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color = "#ffc93c") {
  ctx.save(); ctx.translate(x, y); ctx.scale(s / 24, s / 24);
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.lineCap = "round";
  ctx.fill(new Path2D("M7 3h10v5.5a5 5 0 0 1-10 0z"));
  ctx.stroke(new Path2D("M7 5H4.5V7a3.5 3.5 0 0 0 3.6 3.5M17 5h2.5V7a3.5 3.5 0 0 1-3.6 3.5"));
  ctx.fill(new Path2D("M10.5 13.2h3l.6 3.8h-4.2z"));
  ctx.fill(new Path2D("M7.5 17.5h9v3h-9z"));
  ctx.restore();
}
/** Round trophy marker for honoured enterprises in the park panorama. */
export function trophyMarker(size = 30) {
  const { element, ctx } = canvas(size, size);
  ctx.fillStyle = "rgba(255,201,60,.22)"; ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = isLight() ? "#ffffff" : "#16171b"; ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2); ctx.fill();
  drawTrophy(ctx, size / 2 - 8, size / 2 - 8, 16);
  return { image: element.toDataURL("image/png"), size: [size, size] as [number, number] };
}
/** Honour plate under an enterprise in zone view: trophy + honour names. */
export function trophyPlate(titles: string[]) {
  const { bg, text } = plate();
  const probe = canvas(1, 1).ctx; probe.font = `600 11.5px ${FONT}`;
  const line = titles.join(" · ");
  const w = Math.ceil(probe.measureText(line).width) + 40, h = 24;
  const { element, ctx } = canvas(w, h);
  ctx.fillStyle = bg; roundRect(ctx, 0, 0, w, h, 12); ctx.fill();
  drawTrophy(ctx, 8, 4, 16);
  ctx.font = `600 11.5px ${FONT}`; ctx.fillStyle = text; ctx.fillText(line, 30, 16.5);
  return { image: element.toDataURL("image/png"), size: [w, h] as [number, number] };
}
/** Info card in the style of an equipment callout: title row and up to three label / value rows. */
export function infoCard(title: string, rows: [string, string][], accent: string, alert = false) {
  const { bg, text, muted } = plate();
  const w = 188, h = 34 + rows.length * 20;
  const { element, ctx } = canvas(w, h);
  ctx.fillStyle = bg; roundRect(ctx, 0, 0, w, h, 10); ctx.fill();
  ctx.fillStyle = accent; roundRect(ctx, 10, 9, 14, 14, 4); ctx.fill();
  ctx.fillStyle = "#11160a"; ctx.font = `700 10px ${FONT}`; ctx.fillText(alert ? "!" : "⚡", alert ? 15 : 12.5, 20);
  ctx.font = `700 12px ${FONT}`; ctx.fillStyle = text; ctx.fillText(title, 30, 21);
  rows.forEach(([label, value], index) => {
    const y = 44 + index * 20;
    ctx.font = `11px ${FONT}`; ctx.fillStyle = muted; ctx.fillText(label, 12, y);
    ctx.font = `600 12.5px ${NUM}`; ctx.fillStyle = index === 0 ? accent : text; ctx.textAlign = "right"; ctx.fillText(value, w - 12, y); ctx.textAlign = "left";
  });
  return { image: element.toDataURL("image/png"), size: [w, h] as [number, number] };
}
/** Cone-shaped location pin (like an equipment marker) in the given colour. */
export function conePin(color: string, size = 26) {
  const { element, ctx } = canvas(size, size * 1.3);
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, color); g.addColorStop(1, color + "99");
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(size * 0.12, size * 0.18); ctx.lineTo(size * 0.88, size * 0.18); ctx.lineTo(size / 2, size * 0.92); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.beginPath(); ctx.ellipse(size / 2, size * 0.18, size * 0.38, size * 0.1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(size / 2, size * 1.12, 3, 0, Math.PI * 2); ctx.fill();
  return { image: element.toDataURL("image/png"), size: [size, Math.round(size * 1.3)] as [number, number] };
}

// ---------- AMap + L7 setup ----------
export interface ParkMap { map: AmapApi; AMap: AmapApi; scene: any; satellite: any[] }

/**
 * Creates an AMap 3D map (dark or light vector style by theme, 3D buildings) with an AntV L7 scene on top.
 * `satellite` adds imagery layers (hidden until shown by the caller). Returns refs plus ready flags.
 */
export function useParkMap(container: RefObject<HTMLDivElement | null>, options: { center?: Position; zoom?: number; pitch?: number; rotation?: number; satellite?: boolean; limit?: boolean; zooms?: [number, number] } = {}) {
  const handle = useRef<ParkMap | null>(null);
  const [ready, setReady] = useState(false);
  const [l7Ready, setL7Ready] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const opts = useRef(options);
  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let map: AmapApi, scene: any, element: HTMLDivElement, resize: ResizeObserver | undefined, timer: number | undefined;
    const { center = zoneHub("all"), zoom = 14.2, pitch = 45, rotation = 0, satellite = false, limit = true, zooms = [12.6, 19] } = opts.current;
    setError("");
    loadAmap().then(async (AMap) => {
      if (disposed || !container.current) return;
      element = document.createElement("div");
      element.className = "amap-inner"; element.style.cssText = "width:100%;height:100%;";
      container.current.appendChild(element);
      map = new AMap.Map(element, { viewMode: "3D", zoom, center, pitch, rotation, zooms,
        mapStyle: isLight() ? "amap://styles/whitesmoke" : "amap://styles/dark", showBuildingBlock: true, features: ["bg", "road", "building", "point"] });
      resize = new ResizeObserver((entries) => { if (entries[0]?.contentRect.width > 0) map.resize(); });
      resize.observe(container.current);
      // The camera projection is not ready before the first complete event; overlays added earlier can get NaN pixels.
      await new Promise<void>((resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error("地图底图加载超时，请稍后重试")), 25_000);
        map.on("complete", () => { window.clearTimeout(timer); resolve(); });
      });
      if (disposed) return;
      if (limit) map.setLimitBounds(new AMap.Bounds([114.0, 32.125], [114.2, 32.275]));
      const imagery = satellite ? [new AMap.TileLayer.Satellite({ zIndex: 10 }), new AMap.TileLayer.RoadNet({ zIndex: 11 })] : [];
      if (imagery.length) { map.add(imagery); imagery.forEach((layer) => layer.hide()); }
      handle.current = { map, AMap, scene: null, satellite: imagery };
      setReady(true);
      try {
        const [{ Scene }, { GaodeMap }] = await Promise.all([import("@antv/l7-scene"), import("@antv/l7-maps/gaode")]);
        if (disposed) return;
        scene = new Scene({ id: element, map: new GaodeMap({ mapInstance: map }), logoVisible: false });
        scene.on("loaded", () => { if (disposed || !handle.current) return; handle.current.scene = scene; setL7Ready(true); });
      } catch (reason) {
        console.warn("[park-map] L7 unavailable", reason instanceof Error ? reason.message : reason);
      }
    }).catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : "地图初始化失败"); });
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      resize?.disconnect();
      handle.current = null;
      // The L7 scene owns the AMap instance once created.
      if (scene) scene.destroy(); else map?.destroy();
      element?.remove();
      setReady(false); setL7Ready(false);
    };
  }, [container, retry]);
  return { handle, ready, l7Ready, error, retry: () => setRetry((n) => n + 1) };
}
