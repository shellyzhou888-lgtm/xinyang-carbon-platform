"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { CarbonManagementData, EnterpriseMonthly, ManagementData } from "@xinyang/db-agent";
import { enterprises, type Position } from "@/lib/park-geography";
import { BOUNDARY, conePin, fmt, SECTOR_ZONE, shortName, smoothRing, useParkMap, zonePoints, zonePolygons, type ZoneKey } from "@/lib/park-map";
import { ALERT_GROUPS, alertGroup, alertSeverity, type AlertGroupKey } from "@/lib/diagnosis-alerts";

type Alert = ManagementData["alerts"][number];
type Ranking = ManagementData["carbonRanking"][number];
type Plan = CarbonManagementData["plans"][number];
type Contributor = { node: string; name: string; share_pct?: number; delta?: number };

const PARK = "XYEDZ";
/** The two industry zones holding the metered enterprises; the diagnosis opens one at building scale. */
const DIAG_ZONES: { key: ZoneKey; label: string }[] = [{ key: "green-home", label: "绿色家居" }, { key: "electronics", label: "电子信息" }];
const SEVERITY_COLOR: Record<string, string> = { critical: "#ff4d5e", high: "#ff6b81", warning: "#ffab3d", medium: "#ffab3d", info: "#4cb4ff", low: "#4cb4ff" };
const severityRank = (s: string) => ({ critical: 4, high: 3, warning: 2, medium: 2, info: 1, low: 1 } as Record<string, number>)[s] ?? 0;
const contributors = (alert: Alert): Contributor[] => {
  const root = alert.root_cause as { top_contributors?: Contributor[] } | null;
  return Array.isArray(root?.top_contributors) ? root!.top_contributors : [];
};
/** Map objects an alert concerns: the enterprise itself, or for a park-level alert its top contributors (or the park). */
const alertTargets = (alert: Alert): string[] => {
  if (alert.node_type === "enterprise") return [alert.node_code];
  const list = contributors(alert).filter((c) => (c.share_pct ?? 100) >= 10).map((c) => c.node);
  return list.length ? list : [PARK];
};

/**
 * Spatial diagnosis: the park map is the base layer. Each enterprise sits at its real location, sized by emissions;
 * alerts light up where they occur (park-level alerts on the enterprises that drive them), and the side panel shows
 * the selected object's figures, monthly evidence, alerts and matching reduction measures.
 */
export default function SpatialDiagnosis({ year, alerts, ranking, monthly, previous, plans, parkCo2 }: {
  year: number; alerts: Alert[]; ranking: Ranking[]; monthly: EnterpriseMonthly[]; previous: EnterpriseMonthly[]; plans: Plan[]; parkCo2: number | null | undefined;
}) {
  const container = useRef<HTMLDivElement>(null);
  const { handle, ready, l7Ready, error, retry } = useParkMap(container, { satellite: true, pitch: 48 });
  const layer = useRef<any>(null);
  const ripple = useRef<any>(null);
  const [status, setStatus] = useState<"open" | "all">("all");
  const [group, setGroup] = useState<AlertGroupKey | null>(null);
  const shown = useMemo(() => alerts.filter((a) => (status === "all" || a.severity !== "info") && (!group || alertGroup(a.rule_code) === group))
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity)), [alerts, status, group]);

  const allSites = useMemo(() => enterprises.filter((f) => f.properties.metricBindingApproved).map((f) => {
    const r = ranking.find((row) => row.code === f.properties.code);
    const own = shown.filter((a) => alertTargets(a).includes(f.properties.code));
    const worst = own.reduce((w, a) => Math.max(w, severityRank(a.severity)), 0);
    return { code: f.properties.code, name: f.properties.name, sector: f.properties.sector, zone: SECTOR_ZONE[f.properties.sector], at: f.geometry.coordinates as Position, co2: r?.co2_t ?? 0, intensity: r?.intensity ?? null, alerts: own, worst };
  }).filter((s) => s.co2 > 0), [ranking, shown]);
  // Default zone: the one whose enterprises carry the most alerts.
  const [zone, setZone] = useState<ZoneKey>(() => {
    const count = (k: ZoneKey) => allSites.filter((s) => s.zone === k).reduce((n, s) => n + s.alerts.length, 0);
    return count("electronics") > count("green-home") ? "electronics" : "green-home";
  });
  const sites = useMemo(() => allSites.filter((s) => s.zone === zone), [allSites, zone]);
  const zoneAlerts = shown.filter((a) => alertTargets(a).some((c) => c === PARK || sites.some((s) => s.code === c)));
  const parkAlerts = shown.filter((a) => alertTargets(a).includes(PARK));
  const topSite = [...sites].sort((a, b) => b.worst - a.worst || b.co2 - a.co2)[0];
  const [selected, setSelected] = useState<string>(() => topSite?.code ?? PARK);
  const switchZone = (key: ZoneKey) => {
    setZone(key);
    const top = [...allSites.filter((s) => s.zone === key)].sort((a, b) => b.worst - a.worst || b.co2 - a.co2)[0];
    setSelected(top?.code ?? PARK);
  };
  const site = sites.find((s) => s.code === selected);

  // Satellite imagery as the base; the active zone opens at building scale (tilted, close enough to read roofs and
  // yards) between the alert list and the detail panel, refitted on resize until the user moves the map.
  const outline = useRef<any[]>([]);
  useEffect(() => {
    const current = handle.current, element = container.current;
    if (!ready || !current || !element) return;
    const { AMap, map } = current;
    current.satellite.forEach((layer: any) => layer.show());
    outline.current.forEach((polygon) => polygon.setMap(null));
    outline.current = zonePolygons(zone).flatMap((ring) => {
      const path = smoothRing(ring);
      const glow = new AMap.Polygon({ path, fillOpacity: 0, strokeColor: BOUNDARY.glow, strokeOpacity: 0.22, strokeWeight: 14, lineJoin: "round", zIndex: 59, bubble: true });
      const line = new AMap.Polygon({ path, fillOpacity: 0, strokeColor: BOUNDARY.color, strokeOpacity: 1, strokeWeight: 3, lineJoin: "round", zIndex: 60, bubble: true });
      glow.setMap(map); line.setMap(map);
      return [glow, line];
    });
    let touched = false, timer = 0;
    // Frame the enterprises of the zone (not the whole outline, which includes woodland) so factories fill the view.
    const points = enterprises.filter((f) => f.properties.metricBindingApproved && SECTOR_ZONE[f.properties.sector] === zone).map((f) => f.geometry.coordinates as Position);
    const frame = () => {
      const targets = (points.length >= 2 ? points : zonePoints(zone)).map((point) => new AMap.Marker({ position: point }));
      map.setRotation(zone === "electronics" ? 0 : 20, true);
      map.setPitch(0, true);
      map.setFitView(targets, true, [150, 90, 360, 400], 17.8);
      map.setPitch(55, true);
      // The green-home enterprises are spread north to south; one extra step keeps the factories readable there.
      map.setZoom(Math.min(17.8, map.getZoom() + (zone === "green-home" ? 0.65 : 0.3)), true);
    };
    frame();
    const mark = () => { touched = true; };
    element.addEventListener("pointerdown", mark);
    element.addEventListener("wheel", mark, { passive: true });
    const observer = new ResizeObserver(() => { if (touched) return; window.clearTimeout(timer); timer = window.setTimeout(frame, 150); });
    observer.observe(element);
    return () => { observer.disconnect(); window.clearTimeout(timer); element.removeEventListener("pointerdown", mark); element.removeEventListener("wheel", mark); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, handle, zone]);

  // Markers: every enterprise and the park hub; colour = worst alert, size = emissions.
  useEffect(() => {
    const current = handle.current;
    if (!ready || !current) return;
    const { AMap, map } = current;
    if (!layer.current) { layer.current = new AMap.LabelsLayer({ zIndex: 160, collision: false }); map.add(layer.current); }
    layer.current.clear();
    const top = Math.max(1, ...sites.map((s) => s.co2));
    for (const s of sites) {
      const color = s.worst ? SEVERITY_COLOR[[...s.alerts].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0].severity] : "#2ee8a5";
      // Cone pin (size by emissions, white when selected) standing on its location; the ripple below marks the spot.
      const icon = conePin(s.code === selected ? "#ffffff" : color, Math.round(20 + Math.sqrt(s.co2 / top) * 14));
      const marker = new AMap.LabelMarker({ position: s.at, zIndex: s.code === selected ? 5 : s.worst ? 4 : 3, icon: { image: icon.image, size: icon.size, anchor: "bottom-center" },
        text: s.worst || s.code === selected ? { content: shortName(s.name), direction: "top", offset: [0, -2], style: { fontSize: 12, fillColor: "#fff", strokeColor: "rgba(10,12,16,.85)", strokeWidth: 3, fontWeight: 600 } } : undefined });
      marker.on("click", () => setSelected(s.code));
      layer.current.add(marker);
    }
  }, [ready, handle, sites, selected]);
  useEffect(() => () => { layer.current = null; ripple.current = null; }, []);

  // A ripple under every enterprise cone, in its alert colour (green when it has none); alerts ripple larger.
  useEffect(() => {
    const scene = handle.current?.scene;
    if (!l7Ready || !scene) return;
    const data = [
      ...sites.map((s) => ({ lng: s.at[0], lat: s.at[1], size: s.worst ? 46 : 28,
        color: s.worst ? SEVERITY_COLOR[[...s.alerts].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0].severity] : "#2ee8a5" })),
    ];
    if (ripple.current) { ripple.current.setData(data); return; }
    if (!data.length) return;
    let disposed = false;
    import("@antv/l7-layers").then(({ PointLayer }) => {
      if (disposed || !handle.current?.scene) return;
      ripple.current = new PointLayer({ name: "diagnosis-ripple", zIndex: 4, blend: "additive" }).source(data, { parser: { type: "json", x: "lng", y: "lat" } })
        .shape("circle").size("size", (v: number) => v).color("color", (c: string) => c).animate({ enable: true, speed: 0.8, rings: 3 }).style({ opacity: 1 });
      handle.current.scene.addLayer(ripple.current);
    }).catch((reason) => console.warn("[diagnosis] ripple layer unavailable", reason));
    return () => { disposed = true; };
  }, [l7Ready, handle, sites]);

  // Selecting an object (after the first view) flies the camera to it.
  const firstSelection = useRef(true);
  useEffect(() => {
    const map = handle.current?.map;
    if (!ready || !map) return;
    if (firstSelection.current) { firstSelection.current = false; return; }
    if (selected !== PARK && site?.at) map.panTo(site.at, 600);
  }, [ready, handle, selected, site?.at]);

  const openCount = alerts.filter((a) => a.severity !== "info").length;
  const high = shown.filter((a) => severityRank(a.severity) >= 3).length;
  const lead = [...sites].sort((a, b) => b.co2 - a.co2)[0];
  return <div className="spatial">
    <div ref={container} className="spatial-map" role="img" aria-label="园区实景诊断地图" />
    {!ready && !error && <div className="map-loading" role="status"><span className="spinner" />正在载入园区实景地图…</div>}
    {error && <div className="map-error" role="status">{error}<button type="button" className="btn-ghost small" onClick={retry}>重试</button></div>}

    <div className="spatial-kpis">
      <nav className="spatial-zones" aria-label="产业片区">{DIAG_ZONES.map((z) => <button key={z.key} type="button" className={zone === z.key ? "on" : ""} aria-pressed={zone === z.key} onClick={() => switchZone(z.key)}>{z.label}</button>)}</nav>
      <div><span>{year} 年诊断问题</span><strong className="num">{alerts.length}</strong><small>需关注 {openCount}</small></div>
      <div><span>需优先处理</span><strong className="num">{high}</strong><small>高风险及紧急</small></div>
      {lead && <div><span>片区最大排放</span><strong>{shortName(lead.name)}</strong><small>占园区 {fmt(parkCo2 ? lead.co2 / parkCo2 * 100 : 0, 1)}%</small></div>}
    </div>

    <aside className="spatial-list" aria-label="问题清单">
      <div className="spatial-filter">
        <button type="button" className={status === "open" ? "on" : ""} onClick={() => setStatus("open")}>需关注 {openCount}</button>
        <button type="button" className={status === "all" ? "on" : ""} onClick={() => setStatus("all")}>全部 {alerts.length}</button>
      </div>
      <div className="spatial-groups">{ALERT_GROUPS.map((g) => {
        const n = alerts.filter((a) => (status === "all" || a.severity !== "info") && alertGroup(a.rule_code) === g.key).length;
        return <button key={g.key} type="button" className={group === g.key ? "on" : ""} style={{ ["--g" as string]: g.color }} disabled={!n} onClick={() => setGroup(group === g.key ? null : g.key)}><i />{g.label}<b className="num">{n}</b></button>;
      })}</div>
      <ol>{zoneAlerts.length ? zoneAlerts.map((a) => {
        const targets = alertTargets(a);
        const on = targets.includes(selected);
        const pick = targets.find((c) => sites.some((s) => s.code === c)) ?? PARK;
        return <li key={a.id}><button type="button" className={on ? "on" : ""} onClick={() => setSelected(pick)} style={{ ["--sev" as string]: SEVERITY_COLOR[a.severity] ?? "#9aa3ad" }}>
          <span className="sev">{alertSeverity(a.severity)}</span>
          <b>{a.rule_name}</b>
          <small>{targets.map((c) => c === PARK ? "园区整体" : shortName(allSites.find((s) => s.code === c)?.name ?? c)).join("、")}{a.period ? ` · ${a.period}` : ""}</small>
        </button></li>;
      }) : <li className="spatial-empty">当前筛选下没有问题</li>}</ol>
    </aside>

    <AnimatePresence mode="wait">
      <motion.aside key={selected} className="spatial-detail" aria-label="诊断详情" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.25 }}>
        {selected === PARK || !site
          ? <ParkDetail alerts={parkAlerts} />
          : <SiteDetail site={site} parkCo2={parkCo2} year={year} monthly={monthly.filter((m) => m.code === site.code)} previous={previous.filter((m) => m.code === site.code)}
              plans={plans.filter((p) => shortName(p.node) === shortName(site.name))} />}
      </motion.aside>
    </AnimatePresence>
  </div>;
}

function Evidence({ alert, code }: { alert: Alert; code?: string }) {
  const root = alert.root_cause as { months?: { month: string; deviation_pct: number }[]; top_contributors?: Contributor[] } | null;
  const mine = code ? contributors(alert).find((c) => c.node === code) : undefined;
  return <div className="spatial-alert" style={{ ["--sev" as string]: SEVERITY_COLOR[alert.severity] ?? "#9aa3ad" }}>
    <header><span className="sev">{alertSeverity(alert.severity)}</span><b>{alert.rule_name}</b><small>{alert.period}</small></header>
    <p>{alert.message}</p>
    {mine && <small className="spatial-share">本企业贡献 {fmt(mine.share_pct ?? 0, 1)}%{mine.delta != null ? `（${mine.delta > 0 ? "+" : ""}${fmt(mine.delta, 0)} t）` : ""}</small>}
    {root?.months?.length ? <div className="spatial-months">{root.months.map((m) => <i key={m.month} title={`${m.month} 同比 ${m.deviation_pct > 0 ? "+" : ""}${m.deviation_pct}%`}
      className={m.deviation_pct < 0 ? "down" : "up"} style={{ height: `${Math.min(100, Math.abs(m.deviation_pct) * 4)}%` }} />)}</div> : null}
  </div>;
}

function SiteDetail({ site, parkCo2, year, monthly, previous, plans }: {
  site: { code: string; name: string; sector: string; co2: number; intensity: number | null; alerts: Alert[] }; parkCo2: number | null | undefined; year: number;
  monthly: EnterpriseMonthly[]; previous: EnterpriseMonthly[]; plans: Plan[];
}) {
  const months = Array.from({ length: 12 }, (_, i) => ({ now: monthly.find((m) => Number(m.month.slice(5)) === i + 1)?.co2_t ?? null, before: previous.find((m) => Number(m.month.slice(5)) === i + 1)?.co2_t ?? null }));
  const sumNow = months.reduce((a, m) => a + (m.now ?? 0), 0), sumBefore = months.reduce((a, m) => a + (m.before ?? 0), 0);
  const yoy = sumBefore ? (sumNow - sumBefore) / sumBefore * 100 : null;
  const top = Math.max(1, ...months.flatMap((m) => [m.now ?? 0, m.before ?? 0]));
  return <>
    <header className="spatial-head"><span className="eyebrow">{site.sector} · {SECTOR_ZONE[site.sector] === "electronics" ? "电子信息产业园区" : "绿色家居产业园区"}</span><h3>{site.name}</h3>
      <em className={site.alerts.length ? "warn" : "ok"}>{site.alerts.length ? `${site.alerts.length} 项问题` : "运行正常"}</em></header>
    <div className="spatial-stats">
      <div><span>{year} 年碳排放</span><strong className="num">{fmt(site.co2, 0)}<small>tCO₂</small></strong><small>占园区 {fmt(parkCo2 ? site.co2 / parkCo2 * 100 : 0, 1)}%</small></div>
      <div><span>同比</span><strong className={`num ${yoy != null && yoy <= 0 ? "good" : "bad"}`}>{yoy == null ? "—" : `${yoy > 0 ? "+" : ""}${fmt(yoy, 1)}%`}</strong><small>较上年</small></div>
      <div><span>单位产值 CO₂</span><strong className="num">{fmt(site.intensity, 3)}</strong><small>t/万元</small></div>
    </div>
    <div className="spatial-bars" aria-label="逐月碳排放与上年同期">
      <span className="spatial-label">逐月碳排放 <small>柱为本年，横线为上年同月</small></span>
      <div>{months.map((m, i) => <span key={i} title={`${i + 1}月 ${fmt(m.now, 0)} t${m.before != null ? `，上年 ${fmt(m.before, 0)} t` : ""}`}>
        <i style={{ height: `${(m.now ?? 0) / top * 100}%` }} className={m.now != null && m.before != null && m.now > m.before ? "up" : ""} />
        {m.before != null && <u style={{ bottom: `${m.before / top * 100}%` }} />}<small>{i + 1}</small></span>)}</div>
    </div>
    <span className="spatial-label">诊断出的问题</span>
    {site.alerts.length ? site.alerts.slice(0, 4).map((a) => <Evidence key={a.id} alert={a} code={site.code} />) : <p className="spatial-muted">本企业在当前筛选下没有问题。</p>}
    {plans.length > 0 && <><span className="spatial-label">生成的减碳策略</span>
      <ul className="spatial-plans">{plans.slice(0, 4).map((p, i) => <li key={i}><b>{p.strategy}</b><span className="num">{p.co2_reduction_t != null ? `${fmt(p.co2_reduction_t, 0)} tCO₂/年` : "—"}</span></li>)}</ul></>}
  </>;
}

function ParkDetail({ alerts }: { alerts: Alert[] }) {
  return <>
    <header className="spatial-head"><span className="eyebrow">园区整体</span><h3>信阳经济技术开发区</h3><em className={alerts.length ? "warn" : "ok"}>{alerts.length ? `${alerts.length} 项园区级问题` : "运行正常"}</em></header>
    <p className="spatial-muted">预算、评价指标与数据缺口等园区级问题无法落到单个企业，列在左侧清单中，并在“策略生成”中由排放最大的三家企业承接。</p>
    {alerts.length ? alerts.map((a) => <Evidence key={a.id} alert={a} />) : <p className="spatial-muted">当前筛选下没有园区级问题。</p>}
  </>;
}
