"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ChartData } from "@xinyang/db-agent";
import { enterprises, geography, type EnterpriseFeature } from "@/lib/park-geography";
import { enterpriseBadge, enterpriseBrands } from "@/lib/enterprise-branding";
import { FOCUS_EVENT, HONOR_KINDS, honorLevel, type HonorKind } from "@/lib/honors";
import { fmt, SECTOR_ZONE, trophyMarker, trophyPlate, useParkMap, ZONE_COLOR, zoneFeatures, zoneFocus, zoneLabel, zonePoints, ZONES, type ZoneKey } from "@/lib/park-map";
import Link from "next/link";

import { IconClose, IconExpand, IconLayers, IconSearch, IconTrophy } from "./icons";

export interface MapHonor { code: string; node: string; title: string; kind: HonorKind }
export interface MapEnterprise { code: string; name: string; tce: number | null; co2_t: number | null }

const EMPTY_RANKING: ChartData["ranking"] = [];
const EMPTY_HONORS: MapHonor[] = [];
const EMPTY_ENTERPRISES: MapEnterprise[] = [];
const pinIcon = (color: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"><circle cx="13" cy="13" r="11" fill="${color}" fill-opacity=".22"/><circle cx="13" cy="13" r="5.5" fill="${color}" stroke="#101114" stroke-width="2"/></svg>`);
/** Building-scale zoom for a single zone (3D buildings visible). */
const ZONE_ZOOM = 16.4;

/**
 * Full-screen park map: AMap satellite imagery, planning zones and enterprise POIs. Honoured enterprises carry a trophy
 * marker in the panorama; logos and honour plates appear once a zone is opened at building scale.
 * `left` / `right` are floating panels laid over the map edges (they stack below the map on narrow screens).
 */
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
      map.setZoomAndCenter(ZONE_ZOOM, zoneFocus(zone), false, 700);
      map.setPitch(pitched ? 55 : 0);
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
    shell.current?.setAttribute("data-planning-area-count", String(areaNames ? zoneFeatures.length : 0));
    if (!areaNames) return;
    for (const feature of zoneFeatures) {
      const key = feature.properties.id as Exclude<ZoneKey, "all">;
      const focus = zone === "all" || key === zone;
      for (const rings of feature.geometry.coordinates) {
        const polygon = new AMap.Polygon({ path: rings[0], fillColor: ZONE_COLOR[key], fillOpacity: focus ? 0.12 : 0.04, strokeColor: ZONE_COLOR[key],
          strokeOpacity: focus ? 0.9 : 0.3, strokeWeight: focus ? 2 : 1, zIndex: 60, cursor: "pointer" });
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
  return <section className="map-stage" ref={shell} data-labels={labels} aria-label="园区空间总览">
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

    {left && <div className="map-float left">{left}</div>}
    {right && <div className="map-float right">{right}</div>}

    <div className="map-bottom">
      <div className="map-tools glass" role="group" aria-label="地图工具">
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
      <div className="detail-title">{logo && <img className="detail-logo" src={logo} alt={`${feature.properties.name}品牌标识`} />}<div><span className="eyebrow">{feature.properties.sector} · {year}</span><h3>{feature.properties.name}</h3></div></div>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭企业详情"><IconClose /></button>
    </header>
    <div className="detail-metrics three">
      <div><span className="num">{fmt(metric?.tce, 0)}</span><small>综合能耗 · tce</small></div>
      <div><span className="num">{fmt(metric?.co2_t, 0)}</span><small>碳排放 · tCO₂</small></div>
      <div><span className="num">{fmt(intensity, 3)}</span><small>tce / 万元产值</small></div>
    </div>
    {honors.length > 0 && <ul className="trophy-list compact">{honors.map((honor, index) => <li key={index}><IconTrophy size={18} className="trophy" /><span>{honor.title}</span>{honorLevel(honor.title) && !honor.title.includes(honorLevel(honor.title)) && <em>{honorLevel(honor.title)}</em>}</li>)}</ul>}
    <p className="detail-address">{feature.properties.address}</p>
    <footer><Link className="more-link" href={`/enterprises?year=${year}`}>企业名录</Link><Link className="more-link" href={`/energy?year=${year}`}>能源管理</Link></footer>
  </motion.aside>;
}
