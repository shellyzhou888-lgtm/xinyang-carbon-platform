"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ChartData } from "@xinyang/db-agent";
import { enterprises, geography, type EnterpriseFeature } from "@/lib/park-geography";
import { enterpriseBadge, enterpriseBrands } from "@/lib/enterprise-branding";
import { FOCUS_EVENT, HONOR_KINDS, honorLevel, type HonorKind } from "@/lib/honors";
import { fmt, isLight, SECTOR_ZONE, shortName, trophyMarker, trophyPlate, useParkMap, ZONE_COLOR, zoneFeature, zoneFeatures, zoneLabel, zonePoints, zonePolygons, ZONES, type ZoneKey } from "@/lib/park-map";
import { HonorIcon } from "./HonorIcons";
import Link from "next/link";

import { IconClose, IconExpand, IconLayers, IconRotateLeft, IconRotateRight, IconSearch, IconTiltDown, IconTiltUp, IconTrophy } from "./icons";
import directory from "@/data/enterprise-directory.json";

export interface MapHonor { code: string; node: string; title: string; kind: HonorKind }
export interface MapEnterprise { code: string; name: string; tce: number | null; co2_t: number | null }

const EMPTY_RANKING: ChartData["ranking"] = [];
const EMPTY_HONORS: MapHonor[] = [];
const EMPTY_ENTERPRISES: MapEnterprise[] = [];
const pinIcon = (color: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"><circle cx="13" cy="13" r="11" fill="${color}" fill-opacity=".22"/><circle cx="13" cy="13" r="5.5" fill="${color}" stroke="#101114" stroke-width="2"/></svg>`);
/** Upper zoom bound when fitting one zone; small zones open at building scale (3D buildings visible). */
const ZONE_MAX_ZOOM = 17.6;

/**
 * Full-screen park map: AMap satellite imagery, planning zones and enterprise POIs. Honoured enterprises carry a trophy
 * marker in the panorama; logos and honour plates appear once a zone is opened at building scale.
 * `left` / `right` are floating panels laid over the map edges (they stack below the map on narrow screens).
 */
/** Planning-zone boundary colour (overview and single-zone view). */
const ZONE_BOUNDARY = "#ff3b4f";

export default function ParkSpatialOverview({ year, ranking = EMPTY_RANKING, metrics = EMPTY_ENTERPRISES, honors = EMPTY_HONORS, initialEnterprise, left, right }: {
  year: number; ranking?: ChartData["ranking"]; metrics?: MapEnterprise[]; honors?: MapHonor[]; initialEnterprise?: string; left?: React.ReactNode; right?: React.ReactNode;
}) {
  const shell = useRef<HTMLElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const { handle, ready, error, retry } = useParkMap(container, { satellite: true, pitch: 45 });
  const layers = useRef<Record<"pin" | "name" | "honor" | "area", any>>({} as never);
  const polygons = useRef<any[]>([]);
  const pick = useRef<(code: string) => void>(() => {});
  const [zone, setZone] = useState<ZoneKey>("all");
  const [zoneRevision, setZoneRevision] = useState(0);
  const [selected, setSelected] = useState("");
  const [satellite, setSatellite] = useState(true);
  const [pitched, setPitched] = useState(true);
  const [labels, setLabels] = useState(true);
  const [areaNames, setAreaNames] = useState(true);
  const [query, setQuery] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const listed = enterprises.filter((feature) => (feature.properties.name + feature.properties.poiName).includes(query.trim()));
  const active = enterprises.find((feature) => feature.properties.code === selected);
  const honorsOf = (code: string) => honors.filter((honor) => honor.code === code);
  const openZone = (key: ZoneKey) => { setSelected(""); setZone(key); setZoneRevision((n) => n + 1); };

  pick.current = (code) => {
    const feature = enterprises.find((candidate) => candidate.properties.code === code);
    if (!feature) return;
    setSelected(code);
    setListOpen(false);
    // The zone tab is left as is: changing it would re-run the zone camera and override this fly-to.
    handle.current?.map.setZoomAndCenter(16.8, feature.geometry.coordinates, false, 600);
  };

  useEffect(() => {
    const focus = (event: Event) => pick.current((event as CustomEvent<string>).detail);
    window.addEventListener(FOCUS_EVENT, focus);
    return () => window.removeEventListener(FOCUS_EVENT, focus);
  }, []);

  // Label layers live on the map; created once it is ready.
  useEffect(() => {
    const current = handle.current;
    if (!ready || !current) return;
    const { AMap, map } = current;
    // WebGL label layers tolerate off-screen points behind a pitched camera (DOM markers can throw NaN pixels).
    layers.current = {
      pin: new AMap.LabelsLayer({ zIndex: 150, collision: false }),
      name: new AMap.LabelsLayer({ zIndex: 151, collision: true, allowCollision: false }),
      honor: new AMap.LabelsLayer({ zIndex: 152, collision: false }),
      area: new AMap.LabelsLayer({ zIndex: 160, collision: true, allowCollision: false }),
    };
    map.add(Object.values(layers.current));
    shell.current?.setAttribute("data-map-engine", "amap");
    return () => { layers.current = {} as never; };
  }, [ready, handle]);

  // Enterprise pins; logo badges and honour plates only inside a zone (building scale) or for the selected enterprise.
  useEffect(() => {
    const { pin, name, honor } = layers.current;
    const current = handle.current;
    if (!ready || !current || !pin || !name || !honor) return;
    const { AMap } = current;
    pin.clear(); name.clear(); honor.clear();
    let disposed = false;
    const inZone = zone !== "all";
    for (const feature of enterprises) {
      const code = feature.properties.code;
      const on = code === selected;
      if (inZone && SECTOR_ZONE[feature.properties.sector] !== zone && !on) continue;
      const titles = [...new Set(honors.filter((row) => row.code === code).map((row) => HONOR_KINDS.find((kind) => kind.kind === row.kind)!.label))];
      const zoneKey = SECTOR_ZONE[feature.properties.sector] as Exclude<ZoneKey, "all">;
      const color = on ? "#ffffff" : ZONE_COLOR[zoneKey] ?? "#d4f75c";
      const marker = titles.length && !inZone
        ? (() => { const t = trophyMarker(30); return new AMap.LabelMarker({ position: [...feature.geometry.coordinates], zIndex: 3, icon: { image: t.image, size: t.size, anchor: "center" } }); })()
        : new AMap.LabelMarker({ position: [...feature.geometry.coordinates], zIndex: on ? 3 : 1, icon: { image: pinIcon(color), size: [26, 26], anchor: "center" } });
      marker.on("click", () => pick.current(code));
      pin.add(marker);
      if (!labels || !(inZone || on)) continue;
      if (titles.length) {
        const plate = trophyPlate(titles);
        const label = new AMap.LabelMarker({ position: [...feature.geometry.coordinates], zIndex: 2, icon: { image: plate.image, size: plate.size, anchor: "top-center", offset: [0, 14] } });
        label.on("click", () => pick.current(code));
        honor.add(label);
      }
      enterpriseBadge(code, feature.properties.name, color, on).then((image) => {
        if (disposed || !layers.current.name) return;
        const label = new AMap.LabelMarker({ position: [...feature.geometry.coordinates], zIndex: on ? 3 : 1, rank: on ? 1e12 : titles.length ? 10 : enterpriseBrands.get(code)?.logo ? 5 : 1,
          icon: { image, size: [120, 60], anchor: "bottom-center", offset: [0, -12] } });
        label.on("click", () => pick.current(code));
        layers.current.name.add(label);
      });
    }
    shell.current?.setAttribute("data-enterprise-count", String(enterprises.length));
    shell.current?.setAttribute("data-selected-enterprise", selected);
    return () => { disposed = true; };
  }, [ready, handle, selected, labels, honors, zone]);

  // Camera: the four zones on load; a zone opens at building scale around its enterprises.
  useEffect(() => {
    const current = handle.current;
    if (!ready || !current) return;
    const { AMap, map } = current;
    if (zone === "all") {
      const targets = zonePoints("all").map((point) => new AMap.Marker({ position: point }));
      // Leave room for the topbar and the floating side panels; AMap's avoid order is [top, bottom, left, right].
      const wide = (shell.current?.clientWidth ?? 0) > 1180;
      map.setPitch(0, true);
      map.setFitView(targets, true, wide ? [150, 110, 420, 420] : [70, 70, 30, 30], 15.2);
      if (pitched) { map.setPitch(45, true); map.setZoom(map.getZoom() - 0.25, true); }
    } else {
      // Side panels are hidden in zone mode, so the outline is fitted to almost the whole screen (avoid: top, bottom, left, right).
      const targets = zonePoints(zone).map((point) => new AMap.Marker({ position: point }));
      map.setPitch(0, true);
      map.setFitView(targets, true, [130, 100, 60, 60], ZONE_MAX_ZOOM);
      if (pitched) { map.setPitch(50, true); map.setZoom(map.getZoom() + 0.45, true); }
    }
    shell.current?.setAttribute("data-map-preset", zone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, zone, zoneRevision]);

  useEffect(() => { if (ready && initialEnterprise) pick.current(initialEnterprise); }, [ready, initialEnterprise]);

  // Planning zones and their name plates; the zone in focus is drawn brighter.
  useEffect(() => {
    const { area } = layers.current;
    const current = handle.current;
    if (!ready || !area || !current) return;
    const { AMap, map } = current;
    area.clear();
    polygons.current.forEach((polygon) => polygon.setMap(null));
    polygons.current = [];
    shell.current?.setAttribute("data-planning-area-count", String(zone !== "all" ? 1 : areaNames ? zoneFeatures.length : 0));
    if (zone !== "all") {
      const rings = zonePolygons(zone);
      const color = ZONE_COLOR[zone as Exclude<ZoneKey, "all">];
      // Outside the zone is dimmed: one large polygon with the zone rings as holes.
      const outer = [[113.85, 32.02], [114.35, 32.02], [114.35, 32.38], [113.85, 32.38]];
      const mask = new AMap.Polygon({ path: [outer, ...rings], fillColor: isLight() ? "#f1f3ee" : "#0c0d10", fillOpacity: 0.62, strokeWeight: 0, zIndex: 55, bubble: true });
      mask.setMap(map); polygons.current.push(mask);
      for (const ring of rings) {
        const glow = new AMap.Polygon({ path: ring, fillOpacity: 0, strokeColor: ZONE_BOUNDARY, strokeOpacity: 0.25, strokeWeight: 12, zIndex: 61, bubble: true });
        const line = new AMap.Polygon({ path: ring, fillColor: color, fillOpacity: 0.06, strokeColor: ZONE_BOUNDARY, strokeOpacity: 1, strokeWeight: 4, zIndex: 62, bubble: true });
        glow.setMap(map); line.setMap(map); polygons.current.push(glow, line);
      }
      return;
    }
    if (!areaNames) return;
    for (const feature of zoneFeatures) {
      const key = feature.properties.id as Exclude<ZoneKey, "all">;
      for (const rings of feature.geometry.coordinates) {
        // Boundaries are bold red on every zone; the light fill keeps each zone's colour.
        const polygon = new AMap.Polygon({ path: rings[0], fillColor: ZONE_COLOR[key], fillOpacity: 0.12, strokeColor: ZONE_BOUNDARY,
          strokeOpacity: 1, strokeWeight: 4, zIndex: 60, cursor: "pointer" });
        polygon.on("click", () => openZone(key));
        polygon.setMap(map);
        polygons.current.push(polygon);
      }
      const plate = zoneLabel(feature.properties.name, feature.properties.areaKm2);
      const label = new AMap.LabelMarker({ position: feature.properties.labelPosition, rank: feature.properties.areaKm2, icon: { image: plate.image, size: plate.size, anchor: "center" } });
      label.on("click", () => openZone(key));
      area.add(label);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, areaNames, zone]);

  useEffect(() => { handle.current?.satellite.forEach((layer) => satellite ? layer.show() : layer.hide()); }, [satellite, ready, handle]);
  useEffect(() => { if (ready) handle.current?.map.setPitch(pitched ? (zone === "all" ? 45 : 55) : 0); }, [pitched, ready, handle, zone]);

  useEffect(() => {
    const changed = () => { setFullscreen(document.fullscreenElement === shell.current); handle.current?.map.resize(); };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, [handle]);

  // Camera buttons; the same moves are available with right-drag or Ctrl-drag on the map.
  function turn(degrees: number) { const map = handle.current?.map; if (map) map.setRotation((map.getRotation() + degrees + 360) % 360, false, 300); }
  function tilt(degrees: number) { const map = handle.current?.map; if (map) map.setPitch(Math.max(0, Math.min(75, map.getPitch() + degrees)), false, 300); }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shell.current?.requestFullscreen();
    } catch { /* the browser refused; F11 still works */ }
  }

  function exportCoordinates() {
    const blob = new Blob([JSON.stringify({ ...geography, features: [...enterprises, ...zoneFeatures] }, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "xinyang-enterprises-planning-gcj02.geojson"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const brand = active ? enterpriseBrands.get(active.properties.code) : undefined;
  const activeMetric = active?.properties.metricBindingApproved ? metrics.find((row) => row.code === active.properties.code) : undefined;
  const activeRank = active ? ranking.find((row) => row.code === active.properties.code) : undefined;
  return <section className="map-stage" ref={shell} data-labels={labels} data-zone-mode={zone !== "all"} aria-label="园区空间总览">
    <div ref={container} className="map-canvas" role="img" aria-label="高德地图：信阳经开区产业片区与企业点位" />
    <div className="map-vignette" aria-hidden="true" />
    {!ready && !error && <div className="map-loading" role="status"><span className="spinner" />正在载入园区卫星地图…</div>}
    {error && <div className="map-error" role="status">{error}<button type="button" className="btn-ghost small" onClick={retry}>重试</button></div>}

    <div className="map-top">
      <nav className="segmented glass" role="group" aria-label="产业片区">
        {ZONES.map(({ key, short }) => <button type="button" key={key} onClick={() => openZone(key)} className={zone === key ? "on" : ""} aria-pressed={zone === key}>
          {zone === key && <motion.span layoutId="zone-pill" className="segmented-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
          <span>{short === "全景" ? "园区全景" : short}</span>
        </button>)}
      </nav>
      <div className="map-legend glass">
        {zoneFeatures.map((feature) => <span key={feature.properties.id}><i style={{ background: ZONE_COLOR[feature.properties.id as Exclude<ZoneKey, "all">] }} />{feature.properties.name.replace(/产业园区|片区/, "")}</span>)}
        <span className="legend-trophy"><IconTrophy size={15} />获评荣誉企业</span>
      </div>
    </div>

    {zone === "all" && left && <div className="map-float left">{left}</div>}
    {zone === "all" && right && <div className="map-float right">{right}</div>}
    <AnimatePresence>{zone !== "all" && <ZoneCard key={zone} zone={zone} metrics={metrics} honors={honors} onBack={() => openZone("all")} onPick={(code) => pick.current(code)} />}</AnimatePresence>

    <div className="map-bottom">
      <div className="map-tools glass" role="group" aria-label="地图工具">
        <button type="button" aria-pressed={listOpen} onClick={() => setListOpen((open) => !open)}><IconSearch />企业</button>
        <button type="button" aria-pressed={satellite} onClick={() => setSatellite((current) => !current)}><IconLayers />{satellite ? "卫星" : "矢量"}</button>
        <button type="button" aria-pressed={pitched} onClick={() => setPitched((current) => !current)}>3D</button>
        <button type="button" aria-pressed={labels} onClick={() => setLabels((current) => !current)}>标识</button>
        <button type="button" aria-pressed={areaNames} onClick={() => setAreaNames((current) => !current)}>片区</button>
        <span className="camera-buttons" role="group" aria-label="视角">
          <button type="button" onClick={() => turn(-20)} title="向左旋转"><IconRotateLeft size={16} /></button>
          <button type="button" onClick={() => turn(20)} title="向右旋转"><IconRotateRight size={16} /></button>
          <button type="button" onClick={() => tilt(10)} title="抬高视角（更倾斜）"><IconTiltUp size={16} /></button>
          <button type="button" onClick={() => tilt(-10)} title="压低视角（更俯视）"><IconTiltDown size={16} /></button>
        </span>
        <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "退出全屏" : "全屏查看"}><IconExpand />{fullscreen ? "退出" : "全屏"}</button>
      </div>
    </div>

    <AnimatePresence>
      {listOpen && <motion.aside key="list" className="map-drawer glass" aria-label="企业列表" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.25 }}>
        <header><b>园区企业 <small>{enterprises.length} 家</small></b><button type="button" className="icon-btn" onClick={() => setListOpen(false)} aria-label="关闭企业列表"><IconClose /></button></header>
        <label className="search"><IconSearch /><input aria-label="搜索地图企业" placeholder="搜索企业名称" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="map-list">
          {listed.map((feature) => <button type="button" key={feature.properties.code} className={selected === feature.properties.code ? "on" : ""} onClick={() => pick.current(feature.properties.code)} aria-pressed={selected === feature.properties.code}>
            <i style={{ backgroundColor: ZONE_COLOR[SECTOR_ZONE[feature.properties.sector] as Exclude<ZoneKey, "all">] }} /><span>{feature.properties.name}<small>{feature.properties.sector}{honorsOf(feature.properties.code).length ? ` · ${honorsOf(feature.properties.code).length} 项荣誉` : ""}</small></span>
            <em className="num">{fmt(feature.properties.metricBindingApproved ? ranking.find((row) => row.code === feature.properties.code)?.tce : undefined)}<small>tce</small></em>
          </button>)}
          {!listed.length && <p className="panel-note">没有匹配的企业</p>}
        </div>
        <footer><button type="button" className="btn-ghost small" onClick={exportCoordinates}>导出坐标 GeoJSON</button><Link className="more-link" href={`/enterprises?year=${year}`}>企业名录</Link></footer>
      </motion.aside>}
      {active && !listOpen && <EnterpriseDetail key={active.properties.code} feature={active} year={year} logo={brand?.logo ?? undefined} metric={activeMetric} intensity={activeRank?.intensity} honors={honorsOf(active.properties.code)} onClose={() => setSelected("")} />}
    </AnimatePresence>
  </section>;
}

function EnterpriseDetail({ feature, year, logo, metric, intensity, honors, onClose }: { feature: EnterpriseFeature; year: number; logo?: string; metric?: MapEnterprise; intensity?: number | null; honors: MapHonor[]; onClose: () => void }) {
  return <motion.aside className="map-drawer detail glass" aria-label="企业详情" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.25 }}>
    <header>
      <div className="detail-title">{logo && <img className="detail-logo" src={logo} alt={`${feature.properties.name}品牌标识`} />}<div><span className="eyebrow">{feature.properties.sector}</span><h3>{feature.properties.name}</h3></div></div>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭企业详情"><IconClose /></button>
    </header>
    <div className="detail-metrics three">
      <div><span className="num">{fmt(metric?.tce, 0)}</span><small>综合能耗 · tce</small></div>
      <div><span className="num">{fmt(metric?.co2_t, 0)}</span><small>碳排放 · tCO₂</small></div>
      <div><span className="num">{fmt(intensity, 3)}</span><small>tce / 万元产值</small></div>
    </div>
    {honors.length > 0 && <ul className="trophy-list compact">{honors.map((honor, index) => <li key={index}><HonorIcon kind={honor.kind} size={18} /><span>{honor.title}</span>{honorLevel(honor.title) && !honor.title.includes(honorLevel(honor.title)) && <em>{honorLevel(honor.title)}</em>}</li>)}</ul>}
    <p className="detail-address">{feature.properties.address}</p>
    <footer><Link className="more-link" href={`/enterprises?year=${year}`}>企业名录</Link><Link className="more-link" href={`/energy?year=${year}`}>能源管理</Link></footer>
  </motion.aside>;
}

/** Industry focus of each zone, from the official master plan (产业布局规划图). */
const ZONE_FOCUS: Record<Exclude<ZoneKey, "all">, string> = {
  "green-home": "重点发展绿色制造、智能家居制造、绿色建材、装配式建筑等。",
  electronics: "重点发展新型显示、智能终端、电子元器件、能源电子、半导体、5G 智能制造等领域。",
  research: "以智慧岛建设为核心，重点发展科创研发、检验检测、创意设计、总部经济、电子商务、中介服务等业态。",
  "innovation-community": "主要承载大型企业总部办公、研发设计等生产性科创服务功能。",
};
/** Location of each zone centre (AMap reverse geocoding, 2026-10-21). */
const ZONE_PLACE: Record<Exclude<ZoneKey, "all">, { street: string; roads: string; landmarks: string }> = {
  "green-home": { street: "平桥区 · 信阳国际家居产业小镇", roads: "工业大道、纬北二路、纬北三路", landmarks: "信阳艺术职业学院、国际家居小镇" },
  electronics: { street: "浉河区 · 金牛山街道", roads: "107 国道、金工大道、北京大道", landmarks: "金牛物流产业集聚区" },
  research: { street: "平桥区 · 龙飞山街道", roads: "纬南四路、经南四路、新十八街", landmarks: "欧凯龙家居小镇、电商小镇" },
  "innovation-community": { street: "平桥区 · 北湖风景管理区", roads: "民乐路、新六大街", landmarks: "北湖风景区、北湖郊野公园" },
};
const PLANNED_TOTAL_KM2 = 15.56;
/** Directory entries by zone (area names in the directory use the old 片区 names). */
const DIRECTORY_ZONE: [RegExp, ZoneKey][] = [[/羊山/, "green-home"], [/金牛/, "electronics"], [/科创研发/, "research"], [/科创部落|北湖/, "innovation-community"]];
const directoryOf = (zone: ZoneKey) => directory.items.filter((item) => item.type !== "历史企业" && item.type !== "待核条目"
  && DIRECTORY_ZONE.some(([re, key]) => key === zone && re.test(item.area)));

/** Zone mode card: location, plan focus, energy / carbon of its enterprises with their honours, and directory entries. */
function ZoneCard({ zone, metrics, honors, onBack, onPick }: { zone: ZoneKey; metrics: MapEnterprise[]; honors: MapHonor[]; onBack: () => void; onPick: (code: string) => void }) {
  const key = zone as Exclude<ZoneKey, "all">;
  const feature = zoneFeature(zone);
  const place = ZONE_PLACE[key];
  const area = feature?.properties.areaKm2 ?? 0;
  const members = enterprises.filter((item) => SECTOR_ZONE[item.properties.sector] === zone);
  const business = new Map(directory.items.filter((item) => item.mapCode).map((item) => [item.mapCode as string, item.business]));
  const rows = members.map((item) => ({ code: item.properties.code, name: item.properties.name, metric: metrics.find((m) => m.code === item.properties.code), business: business.get(item.properties.code) ?? item.properties.sector }));
  const tce = rows.reduce((a, r) => a + (r.metric?.tce ?? 0), 0), co2 = rows.reduce((a, r) => a + (r.metric?.co2_t ?? 0), 0);
  const parkTce = metrics.reduce((a, m) => a + (m.tce ?? 0), 0), parkCo2 = metrics.reduce((a, m) => a + (m.co2_t ?? 0), 0);
  const listed = directoryOf(zone).filter((item) => !members.some((m) => m.properties.code === item.mapCode));
  return <motion.aside className="zone-card glass" style={{ ["--zone" as string]: ZONE_COLOR[key] }} aria-label="片区概况"
    initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
    <header><span className="zone-dot" /><div><h3>{feature?.properties.name}</h3><small>规划面积 {area.toFixed(2)} km² · 占四片区 {fmt(area / PLANNED_TOTAL_KM2 * 100, 1)}%</small></div></header>
    <dl className="zone-facts">
      <div><dt>区位</dt><dd>{place.street}</dd></div>
      <div><dt>主要道路</dt><dd>{place.roads}</dd></div>
      <div><dt>周边地标</dt><dd>{place.landmarks}</dd></div>
      <div><dt>产业定位</dt><dd>{ZONE_FOCUS[key]}<small>《信阳经济技术开发区总体发展规划（2022—2035年）》</small></dd></div>
    </dl>
    {rows.length > 0 && <div className="zone-figures">
      <div><span>重点企业</span><strong className="num">{rows.length}<small>家</small></strong></div>
      <div><span>综合能耗</span><strong className="num">{fmt(tce, 0)}<small>tce</small></strong><em>占园区 {fmt(tce / (parkTce || 1) * 100, 1)}%</em></div>
      <div><span>碳排放</span><strong className="num">{fmt(co2, 0)}<small>tCO₂</small></strong><em>占园区 {fmt(co2 / (parkCo2 || 1) * 100, 1)}%</em></div>
    </div>}
    {rows.length > 0 && <ul className="zone-members">{rows.sort((a, b) => (b.metric?.co2_t ?? 0) - (a.metric?.co2_t ?? 0)).map((row) => {
      const kinds = [...new Set(honors.filter((h) => h.code === row.code).map((h) => h.kind))];
      return <li key={row.code}><button type="button" onClick={() => onPick(row.code)}>
        <span className="zone-member-head"><b>{shortName(row.name)}</b><em>{row.business}</em></span>
        <span className="zone-member-figures num">{row.metric?.tce != null ? <>{fmt(row.metric.tce, 0)}<small>tce</small> · {fmt(row.metric.co2_t, 0)}<small>tCO₂</small> · 占片区 {fmt((row.metric.co2_t ?? 0) / (co2 || 1) * 100, 1)}%</> : <small>{row.business}</small>}</span>
        {kinds.length > 0 && <span className="zone-member-honors">{kinds.map((kind) => <span key={kind} className="zone-honor"><HonorIcon kind={kind} size={14} />{HONOR_KINDS.find((h) => h.kind === kind)?.short}</span>)}</span>}
      </button></li>;
    })}</ul>}
    {listed.length > 0 && <div className="zone-listed"><span>目录中的其他企业与项目</span><ul>{listed.map((item) => <li key={item.id}><b>{item.name}</b><small>{item.type} · {item.business}</small></li>)}</ul></div>}
    <button type="button" className="btn-ghost small zone-back" onClick={onBack}>返回园区全景</button>
  </motion.aside>;
}
