"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import type { EnterpriseMonthly } from "@xinyang/db-agent";
import { enterprises, type Position } from "@/lib/park-geography";
import { canvas, fmt, frameParkTilted, HENAN_BOUNDS, infoCard, shortName, useParkMap, zonePolygons, pointInPolygon } from "@/lib/park-map";

/** Heat ramp from low (blue) to high (red), as in a floor-plan energy heat map. */
const RAMP = ["#2f6bff", "#22c3ee", "#2ee8a5", "#d4f75c", "#ffb02e", "#ff4d5e"];
const STEP_LNG = 0.0007, STEP_LAT = 0.0006;   // ≈ 66 m dot spacing
const SIGMA_M = 330;                            // spread of each plant's energy around its site
const M_PER_LNG = 94_200, M_PER_LAT = 111_000;  // metres per degree at 32.2°N

/** Dot grid covering the planning zones (computed once). */
function zoneGrid(): Position[] {
  const points: Position[] = [];
  for (const ring of zonePolygons("all")) {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += STEP_LNG)
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += STEP_LAT)
        if (pointInPolygon([x, y], ring)) points.push([x, y]);
  }
  return points;
}

/** Card on a stem ending in a cone pin (same marker as the flow maps), anchored at the cone tip (bottom-centre). */
function stemCard(title: string, rows: [string, string][], accent: string) {
  const card = infoCard(title, rows, accent);
  const [w, h] = card.size, stem = 50;
  const { element, ctx } = canvas(w, h + stem);
  return new Promise<{ image: string; size: [number, number] }>((resolve) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, w, h);
      const x = w / 2, tip = h + stem - 1, top = tip - 22;
      ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x, top); ctx.stroke();
      // Cone: gradient body, light elliptical cap.
      const g = ctx.createLinearGradient(0, top, 0, tip); g.addColorStop(0, accent); g.addColorStop(1, accent + "99");
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - 9, top); ctx.lineTo(x + 9, top); ctx.lineTo(x, tip); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.beginPath(); ctx.ellipse(x, top, 8, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      resolve({ image: element.toDataURL("image/png"), size: [w, h + stem] });
    };
    img.src = card.image;
  });
}

/**
 * Park energy heat twin: a dot-matrix heat map over the planning zones on a 3D dark map. Each dot carries the
 * Gaussian-weighted energy of nearby plants for the selected month; a timeline plays the year month by month.
 * The spread around each plant is a visual model of its consumption, not metered sub-area data.
 */
export default function EnergyHeatTwin({ year: initialYear, rowsByYear }: { year: number; rowsByYear: Record<number, EnterpriseMonthly[]> }) {
  const years = Object.keys(rowsByYear).map(Number).filter((y) => rowsByYear[y]?.length).sort();
  const router = useRouter();
  const year = initialYear;
  const rows = useMemo(() => rowsByYear[year] ?? [], [rowsByYear, year]);
  const container = useRef<HTMLDivElement>(null);
  // Free zoom and drag within Henan province (the view cannot be dragged off to unrelated regions).
  const { handle, ready, l7Ready, error, retry } = useParkMap(container, { pitch: 55, rotation: -12, zoom: 14.3, limit: HENAN_BOUNDS, zooms: [7, 19] });
  const dots = useRef<any>(null);
  const callouts = useRef<any>(null);
  const ripples = useRef<any>(null);
  const months = useMemo(() => [...new Set(rows.map((row) => row.month))].sort(), [rows]);
  const [index, setIndex] = useState(() => Math.max(0, months.length - 1));
  // A different year starts at its last month.
  useEffect(() => { setIndex(Math.max(0, months.length - 1)); }, [months.length, year]);
  const [playing, setPlaying] = useState(false);
  const month = months[index];

  const sites = useMemo(() => enterprises.filter((feature) => feature.properties.metricBindingApproved)
    .map((feature) => ({ code: feature.properties.code, name: feature.properties.name, at: feature.geometry.coordinates })), []);
  const grid = useMemo(() => zoneGrid(), []);
  /** Per-month energy per site (tce). */
  const energyAt = useMemo(() => {
    const table = new Map<string, Map<string, number>>();
    for (const row of rows) {
      if (!table.has(row.month)) table.set(row.month, new Map());
      table.get(row.month)!.set(row.code, row.tce ?? 0);
    }
    return (m: string, code: string) => table.get(m)?.get(code) ?? 0;
  }, [rows]);
  const valuesFor = useMemo(() => (m: string) => grid.map(([x, y]) => {
    let v = 0;
    for (const site of sites) {
      const dx = (x - site.at[0]) * M_PER_LNG, dy = (y - site.at[1]) * M_PER_LAT;
      const d2 = dx * dx + dy * dy;
      if (d2 < 9 * SIGMA_M * SIGMA_M) v += energyAt(m, site.code) * Math.exp(-d2 / (2 * SIGMA_M * SIGMA_M));
    }
    return v;
  }), [grid, sites, energyAt]);
  // A fixed colour domain across the year so months stay comparable while playing.
  const domainMax = useMemo(() => Math.max(1, ...months.map((m) => Math.max(...valuesFor(m)))), [months, valuesFor]);

  const ranking = useMemo(() => sites.map((site) => ({ ...site, value: month ? energyAt(month, site.code) : 0, prev: index > 0 ? energyAt(months[index - 1], site.code) : null }))
    .sort((a, b) => b.value - a.value), [sites, month, index, months, energyAt]);
  const total = ranking.reduce((sum, row) => sum + row.value, 0);
  const prevTotal = index > 0 ? sites.reduce((sum, site) => sum + energyAt(months[index - 1], site.code), 0) : null;

  // Camera over the park: the zones fill the space left of the analysis panel, above the timeline and below room for the
  // month callouts. Until the user drags or zooms, the view is refitted when the map box changes size.
  useEffect(() => {
    const current = handle.current, element = container.current;
    if (!ready || !current || !element) return;
    let touched = false, timer = 0;
    const frame = () => frameParkTilted(current.map, current.AMap, { avoid: [100, 96, 40, 330], fill: 0.95 });
    frame();
    const mark = () => { touched = true; };
    element.addEventListener("pointerdown", mark);
    element.addEventListener("wheel", mark, { passive: true });
    const observer = new ResizeObserver(() => { if (touched) return; window.clearTimeout(timer); timer = window.setTimeout(frame, 150); });
    observer.observe(element);
    return () => { observer.disconnect(); window.clearTimeout(timer); element.removeEventListener("pointerdown", mark); element.removeEventListener("wheel", mark); };
  }, [ready, handle]);

  // Dot layer: created once, data refreshed per month.
  useEffect(() => {
    const current = handle.current;
    if (!l7Ready || !current?.scene || !month) return;
    // Square-root scale: one very large plant must not wash every other area out to blue.
    const data = valuesFor(month).map((v, i) => ({ lng: grid[i][0], lat: grid[i][1], v: Math.sqrt(Math.min(1, v / domainMax)) }));
    if (dots.current) { dots.current.setData(data); return; }
    import("@antv/l7-layers").then(({ PointLayer }) => {
      if (!handle.current?.scene) return;
      dots.current = new PointLayer({ name: "energy-heat-dots", zIndex: 5, blend: "additive" })
        .source(data, { parser: { type: "json", x: "lng", y: "lat" } })
        .shape("circle").size("v", (v: number) => 2.8 + v * 3.2)
        .color("v", RAMP).scale("v", { type: "linear", domain: [0, 1] })
        .style({ opacity: 0.95 });
      handle.current.scene.addLayer(dots.current);
    });
  }, [l7Ready, handle, month, valuesFor, grid, domainMax]);
  useEffect(() => () => { dots.current = null; }, []);

  // Callouts for the three largest consumers of the month.
  useEffect(() => {
    const current = handle.current;
    if (!ready || !current) return;
    if (!callouts.current) { callouts.current = new current.AMap.LabelsLayer({ zIndex: 170, collision: true, allowCollision: false }); current.map.add(callouts.current); }
    let disposed = false;
    const layer = callouts.current;
    Promise.all(ranking.slice(0, 3).map((row) => stemCard(shortName(row.name), [
      ["本月综合能耗", `${fmt(row.value, 0)} tce`],
      ["较上月", row.prev ? `${row.value >= row.prev ? "+" : ""}${fmt((row.value - row.prev) / row.prev * 100, 1)}%` : "—"],
    ], RAMP[Math.max(2, 5 - ranking.indexOf(row))]).then((card) => ({ row, card })))).then((cards) => {
      if (disposed) return;
      layer.clear();
      // Larger consumers win label collisions.
      for (const { row, card } of cards) layer.add(new current.AMap.LabelMarker({ position: row.at, zIndex: 5, rank: row.value, icon: { image: card.image, size: card.size, anchor: "bottom-center" } }));
    });
    return () => { disposed = true; };
  }, [ready, handle, ranking]);
  useEffect(() => () => { callouts.current = null; ripples.current = null; }, []);

  // Ripple under each callout cone, in the callout colour.
  useEffect(() => {
    const scene = handle.current?.scene;
    if (!l7Ready || !scene) return;
    const data = ranking.slice(0, 3).map((row, i) => ({ lng: row.at[0], lat: row.at[1], color: RAMP[Math.max(2, 5 - i)] }));
    if (ripples.current) { ripples.current.setData(data); return; }
    let disposed = false;
    import("@antv/l7-layers").then(({ PointLayer }) => {
      if (disposed || !handle.current?.scene) return;
      ripples.current = new PointLayer({ name: "energy-callout-ripple", zIndex: 6, blend: "additive" }).source(data, { parser: { type: "json", x: "lng", y: "lat" } })
        .shape("circle").size(30).color("color", (c: string) => c).animate({ enable: true, speed: 0.7, rings: 3 }).style({ opacity: 0.9 });
      handle.current.scene.addLayer(ripples.current);
    }).catch((reason) => console.warn("[heat-twin] ripple layer unavailable", reason));
    return () => { disposed = true; };
  }, [l7Ready, handle, ranking]);

  // Timeline playback.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % Math.max(1, months.length)), 1600);
    return () => window.clearInterval(timer);
  }, [playing, months.length]);

  const change = prevTotal ? (total - prevTotal) / prevTotal * 100 : null;
  return <div className="twin">
    <div ref={container} className="twin-map" role="img" aria-label={`园区能耗热力孪生图，${month ?? ""}`} />
    {!ready && !error && <div className="map-loading" role="status"><span className="spinner" />正在载入园区三维底图…</div>}
    {error && <div className="map-error" role="status">{error}<button type="button" className="btn-ghost small" onClick={retry}>重试</button></div>}

    <div className="twin-legend" aria-label="热力色标">
      <b>tce</b>
      <div className="twin-ramp" style={{ background: `linear-gradient(0deg, ${RAMP.join(", ")})` }} />
      <div className="twin-ticks"><span>高</span><span>中</span><span>低</span></div>
    </div>

    <aside className="twin-panel glass" aria-label="本月能耗分析">
      <span className="eyebrow">能耗分析 · {month ? `${Number(month.slice(5))} 月` : "—"}</span>
      <div className="twin-total"><strong className="num">{fmt(total, 0)}</strong><small>tce</small>
        {change != null && <em className={`kpi-delta ${change <= 0 ? "good" : "bad"}`}>{change > 0 ? "▲" : "▼"} {fmt(Math.abs(change), 1)}% 环比</em>}</div>
      <small className="twin-note">重点用能企业合计</small>
      <ol className="twin-rank">{ranking.slice(0, 6).map((row) => <li key={row.code}>
        <span>{shortName(row.name)}</span><b className="num">{fmt(row.value, 0)}</b>
        <i><motion.em layout style={{ width: `${(row.value / (ranking[0]?.value || 1)) * 100}%`, background: `linear-gradient(90deg, ${RAMP[2]}, ${RAMP[Math.min(5, 2 + Math.round(row.value / (ranking[0]?.value || 1) * 3))]})` }} /></i>
      </li>)}</ol>
    </aside>

    <div className="twin-timeline glass" role="group" aria-label="月份时间轴">
      <button type="button" className="twin-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "暂停播放" : "按月播放"}>{playing ? "❚❚" : "▶"}</button>
      <div className="twin-months">
        {months.map((m, i) => <button key={m} type="button" className={i === index ? "on" : ""} aria-pressed={i === index} onClick={() => { setPlaying(false); setIndex(i); }}>
          {i === index && <motion.span layoutId="twin-month" className="twin-month-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
          <span>{Number(m.slice(5))}月</span>
        </button>)}
      </div>
      <span className="twin-years" role="group" aria-label="年份">{years.map((y) => <button key={y} type="button" className={y === year ? "on" : ""} aria-pressed={y === year} onClick={() => { setPlaying(false); router.push(`/energy?year=${y}&tab=heat`, { scroll: false }); }}>{y}</button>)}</span>
    </div>
  </div>;
}
