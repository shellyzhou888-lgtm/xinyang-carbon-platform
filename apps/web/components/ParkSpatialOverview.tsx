"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ChartData } from "@xinyang/db-agent";
import { loadAmap, type AmapApi } from "@/lib/amap";
import { enterprises, geography, type Sector } from "@/lib/park-geography";
import { enterpriseBadge, enterpriseBrands } from "@/lib/enterprise-branding";
import directory from "@/data/enterprise-directory.json";
import planning from "@/data/planning-overlay.json";
import Link from "next/link";

import { IconClose, IconExpand, IconLayers, IconSearch } from "./icons";
const EMPTY_RANKING: ChartData["ranking"] = [];
const FEATURED = new Set(directory.items.filter(row=>row.featured&&row.mapCode).map(row=>row.mapCode));
const value = (number: number | null | undefined, digits = 1) => number == null ? "—" : number.toLocaleString("zh-CN", { maximumFractionDigits: digits });
const pinIcon = (color: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="12" fill="${color}" fill-opacity=".18"/><circle cx="15" cy="15" r="6" fill="${color}" stroke="#0b100f" stroke-width="2"/></svg>`);
function planningLabel(name:string,color:string,area:number) {
  const canvas=document.createElement("canvas");canvas.width=380;canvas.height=88;
  const ctx=canvas.getContext("2d")!;ctx.scale(2,2);
  ctx.fillStyle="rgba(10,15,14,.82)";
  ctx.beginPath();ctx.roundRect(0,0,190,44,10);ctx.fill();
  ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(10,15,4,14,2);ctx.fill();
  ctx.textAlign="left";ctx.font='600 12px "Microsoft YaHei", sans-serif';ctx.fillStyle="#eef4f1";ctx.fillText(name,22,19);
  ctx.font='10px "Microsoft YaHei", sans-serif';ctx.fillStyle="#9fb0aa";ctx.fillText(`${area.toFixed(2)} km² · 规划示意`,22,34);
  return canvas.toDataURL("image/png");
}

/**
 * Full-bleed park map: AMap satellite imagery, planning-zone overlay and enterprise POIs.
 * `left` / `right` are floating panels laid over the map edges (they stack below the map on narrow screens).
 */
export default function ParkSpatialOverview({ year, ranking = EMPTY_RANKING, initialEnterprise, left, right }: { year: number; ranking?: ChartData["ranking"]; initialEnterprise?: string; left?: React.ReactNode; right?: React.ReactNode }) {
  const shell = useRef<HTMLElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<AmapApi>(null);
  const amap = useRef<AmapApi>(null);
  const scene = useRef<any>(null);
  const pinLayer = useRef<any>(null);
  const nameLayer = useRef<any>(null);
  const areaLayer = useRef<any>(null);
  const satelliteLayers = useRef<any[]>([]);
  const planningPolygons = useRef<any[]>([]);
  const l7Layers = useRef<any[]>([]);
  const pick = useRef<(code: string) => void>(() => {});
  const [ready, setReady] = useState(false);
  const [l7Ready, setL7Ready] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [sector, setSector] = useState<Sector | "全部">("全部");
  const [selected, setSelected] = useState("");
  const [satellite, setSatellite] = useState(true);
  const [pitched, setPitched] = useState(false);
  const [labels, setLabels] = useState(true);
  const [areaNames,setAreaNames] = useState(true);
  const [query, setQuery] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [presetRevision, setPresetRevision] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const visible = useMemo(() => enterprises.filter((feature) => sector === "全部" || feature.properties.sector === sector), [sector]);
  const listed = visible.filter((feature) => (feature.properties.name + feature.properties.poiName).includes(query.trim()));
  const active = enterprises.find((feature) => feature.properties.code === selected);
  const metric = active?.properties.metricBindingApproved ? ranking.find((row) => row.code === selected) : undefined;

  pick.current = (code) => {
    const feature = enterprises.find((candidate) => candidate.properties.code === code);
    if (!feature) return;
    setSelected(code);
    setListOpen(false);
    if (sector !== "全部" && feature.properties.sector !== sector) setSector(feature.properties.sector);
    if (map.current) map.current.setZoomAndCenter(16.3, feature.geometry.coordinates, true);
  };

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
        viewMode: "3D", zoom: 13.3, center: [114.103, 32.203], pitch: 0, rotation: 0,
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
      satelliteLayers.current = [new AMap.TileLayer.Satellite({ zIndex: 10 }), new AMap.TileLayer.RoadNet({ zIndex: 11 })];
      currentMap.add(satelliteLayers.current);
      satelliteLayers.current.forEach((layer) => layer.hide());
      // WebGL label layers tolerate off-screen points behind a pitched camera.
      // DOM markers can instead throw Pixel(NaN, NaN) when zooming into one factory.
      pinLayer.current = new AMap.LabelsLayer({ zIndex: 150, collision: false });
      nameLayer.current = new AMap.LabelsLayer({ zIndex: 151, collision: true, allowCollision: false });
      areaLayer.current = new AMap.LabelsLayer({ zIndex: 160, collision: true, allowCollision: false });
      currentMap.add([pinLayer.current, nameLayer.current,areaLayer.current]);
      setReady(true);
      // Real AMap overlays remain usable if the optional WebGL visualization layer fails.
      try {
        const [{ Scene }, { PointLayer }, { GaodeMap }] = await Promise.all([
          import("@antv/l7-scene"), import("@antv/l7-layers"), import("@antv/l7-maps/gaode"),
        ]);
        if (disposed || !container.current) return;
        currentScene = new Scene({ id: mapElement, map: new GaodeMap({ mapInstance: currentMap }), logoVisible: false });
        scene.current = currentScene;
        currentScene.on("loaded", () => {
          if (disposed) return;
          const points = new PointLayer({ name: "enterprise-locations", zIndex: 3 })
            .source({ type: "FeatureCollection", features: enterprises }).shape("circle").size(10).color("color")
            .style({ opacity: 0.35, stroke: "#e6f2ef", strokeWidth: 1 });
          l7Layers.current = [points];
          currentScene.addLayer(points);
          shell.current?.setAttribute("data-map-engine", "amap-l7");
          setL7Ready(true);
        });
      } catch (reason) {
        // Native planning polygons and enterprise labels remain available.
        console.warn("[park-map] L7 overlay unavailable", reason instanceof Error ? reason.message : "unknown error");
      }
    }).catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : "地图初始化失败"); });
    return () => {
      disposed = true;
      window.clearTimeout(readyTimer);
      resize?.disconnect();
      pinLayer.current = null;
      nameLayer.current = null;
      areaLayer.current = null;
      satelliteLayers.current = [];
      planningPolygons.current = [];
      l7Layers.current = [];
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

  useEffect(() => {
    if (!ready || !map.current || !amap.current || !pinLayer.current || !nameLayer.current) return;
    const AMap = amap.current;
    pinLayer.current.clear();
    nameLayer.current.clear();
    let disposed = false;
    for (const feature of visible) {
      const active = feature.properties.code === selected;
      const marker = new AMap.LabelMarker({ position: [...feature.geometry.coordinates], zIndex: active ? 3 : 1,
        icon: { image: pinIcon(active ? "#c5f05c" : feature.properties.color), size: [30, 30], anchor: "center" } });
      marker.on("click", () => pick.current(feature.properties.code));
      pinLayer.current.add(marker);
      if (labels && FEATURED.has(feature.properties.code) && enterpriseBrands.get(feature.properties.code)?.logo || active) {
        enterpriseBadge(feature.properties.code, feature.properties.name, feature.properties.color, active).then(image => {
          if (disposed || !nameLayer.current) return;
          const label = new AMap.LabelMarker({ position: [...feature.geometry.coordinates], zIndex: active ? 3 : 1, rank: active ? 1e12 : 1,
            icon: { image, size:[120,60], anchor:"bottom-center", offset:[0,-12] } });
          label.on("click", () => pick.current(feature.properties.code));
          nameLayer.current.add(label);
        });
      }
    }
    shell.current?.setAttribute("data-enterprise-count", String(visible.length));
    shell.current?.setAttribute("data-selected-enterprise", selected);
    return () => { disposed = true; };
  }, [ready, visible, selected, labels]);

  useEffect(() => {
    if (!ready || !map.current || !amap.current) return;
    const AMap = amap.current;
    const instance = map.current;
    const targets = visible.map(feature => new AMap.Marker({position:[...feature.geometry.coordinates]}));
    const areas=planning.features.filter(feature=>sector==="全部"||feature.properties.id===(sector==="绿色家居"?"green-home":"electronics"));
    for(const area of areas)for(const polygon of area.geometry.coordinates)for(const point of polygon[0])targets.push(new AMap.Marker({position:point}));
    // Leave room for the floating side panels so the zones land in the visible centre.
    // AMap's avoid margins are ordered [top, bottom, left, right] (not CSS order).
    const wide = (shell.current?.clientWidth ?? 0) > 1180;
    instance.setFitView(targets, true, wide ? [130, 110, 360, 360] : [70, 70, 40, 40], sector === "全部" ? 14.5 : 16);
    shell.current?.setAttribute("data-map-preset", sector === "全部" ? "panorama" : sector === "绿色家居" ? "yangshan" : "jinniu");
    if (selected && !visible.some((feature) => feature.properties.code === selected)) setSelected("");
    // Camera follows the sector once; selecting a point zooms independently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sector, presetRevision]);

  useEffect(()=>{if(ready&&initialEnterprise)pick.current(initialEnterprise);},[ready,initialEnterprise]);

  useEffect(()=>{
    if(!ready||!areaLayer.current||!amap.current||!map.current)return;
    areaLayer.current.clear();
    planningPolygons.current.forEach(polygon=>polygon.setMap(null));
    planningPolygons.current=[];
    const areas=planning.features.filter(feature=>sector==="全部"||feature.properties.id===(sector==="绿色家居"?"green-home":"electronics"));
    shell.current?.setAttribute("data-planning-area-count",String(areaNames?areas.length:0));
    shell.current?.setAttribute("data-planning-polygon-count",String(areaNames?areas.reduce((count,area)=>count+area.geometry.coordinates.length,0):0));
    if(!areaNames)return;
    const AMap=amap.current;
    for(const area of areas){
      for(const rings of area.geometry.coordinates){
        const polygon=new AMap.Polygon({path:rings[0],fillColor:area.properties.color,fillOpacity:.14,strokeColor:area.properties.color,strokeOpacity:.9,strokeWeight:1.6,strokeStyle:"dashed",strokeDasharray:[6,4],zIndex:60,cursor:"default"});
        polygon.setMap(map.current);
        planningPolygons.current.push(polygon);
      }
      // Larger zones win label collisions; the small 科创部落 label reappears when zoomed in.
      areaLayer.current.add(new AMap.LabelMarker({position:area.properties.labelPosition,rank:area.properties.areaKm2,icon:{image:planningLabel(area.properties.name,area.properties.color,area.properties.areaKm2),size:[190,44],anchor:"center"}}));
    }
  },[ready,areaNames,sector]);

  useEffect(() => {
    if (!map.current || !amap.current) return;
    // Toggle only the imagery layers; setLayers() would also detach enterprise labels.
    satelliteLayers.current.forEach((layer) => satellite ? layer.show() : layer.hide());
  }, [satellite, ready]);

  useEffect(() => {
    map.current?.setPitch(pitched ? 30 : 0);
  }, [pitched, ready]);

  useEffect(()=>{
    if(l7Ready)l7Layers.current[0]?.setData({type:"FeatureCollection",features:visible});
  },[visible,l7Ready]);

  useEffect(() => {
    const changed = () => { setFullscreen(document.fullscreenElement === shell.current); map.current?.resize(); };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shell.current?.requestFullscreen();
    } catch { setError("浏览器未允许全屏，请使用浏览器的全屏快捷键。"); }
  }

  function exportCoordinates() {
    const blob = new Blob([JSON.stringify({...geography,features:[...enterprises,...planning.features],planningRegistration:planning.registration}, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "xinyang-enterprises-planning-gcj02.geojson"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const brand = active ? enterpriseBrands.get(active.properties.code) : undefined;
  return <section className="map-stage" ref={shell} data-labels={labels} aria-label="园区空间总览">
    <div ref={container} className="map-canvas" role="img" aria-label="高德地图：信阳经开区规划功能片区与企业点位" />
    <div className="map-vignette" aria-hidden="true" />
    {!ready && !error && <div className="map-loading" role="status"><span className="spinner" />正在载入园区卫星地图…</div>}
    {error && <div className="map-error" role="status">{error}<button type="button" className="btn-ghost small" onClick={() => { setError(""); setRetry((n) => n + 1); }}>重试</button></div>}

    <div className="map-top">
      <nav className="segmented glass" role="group" aria-label="片区视角">
        {(["全部", "绿色家居", "电子信息"] as const).map((name) => <button type="button" key={name} onClick={() => { setSelected(""); setSector(name); setPresetRevision((n) => n + 1); }} className={sector === name ? "on" : ""} aria-pressed={sector === name}>
          {sector === name && <motion.span layoutId="sector-pill" className="segmented-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
          <span>{name === "全部" ? "整体全景" : name === "绿色家居" ? "羊山片区" : "金牛物流片区"}</span>
        </button>)}
      </nav>
      <div className="map-legend glass">{planning.features.map((area) => <span key={area.properties.id}><i style={{ background: area.properties.color }} />{area.properties.name.replace("产业园区", "")}</span>)}</div>
    </div>

    {left && <div className="map-float left">{left}</div>}
    {right && <div className="map-float right">{right}</div>}

    <div className="map-bottom">
      <div className="map-tools glass" role="group" aria-label="地图工具">
        <button type="button" aria-pressed={listOpen} onClick={() => setListOpen((open) => !open)}><IconSearch />企业列表</button>
        <button type="button" aria-pressed={satellite} onClick={() => setSatellite((current) => !current)}><IconLayers />{satellite ? "卫星影像" : "标准底图"}</button>
        <button type="button" aria-pressed={pitched} onClick={() => setPitched((current) => !current)}>{pitched ? "倾斜视角" : "俯视视角"}</button>
        <button type="button" aria-pressed={labels} onClick={() => setLabels((current) => !current)}>企业标识</button>
        <button type="button" aria-pressed={areaNames} onClick={() => setAreaNames((current) => !current)}>规划分区</button>
        <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "退出全屏" : "全屏查看"}><IconExpand />{fullscreen ? "退出" : "全屏"}</button>
      </div>
      <p className="map-caption">规划分区为图件初步定位示意（GCJ-02），可能存在偏移，非企业红线；法定边界以26号文成果为准。</p>
    </div>

    <AnimatePresence>
      {listOpen && <motion.aside key="list" className="map-drawer glass" aria-label="企业列表" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.25 }}>
        <header><b>企业档案 <small>{enterprises.length} 个公开 POI</small></b><button type="button" className="icon-btn" onClick={() => setListOpen(false)} aria-label="关闭企业列表"><IconClose /></button></header>
        <label className="search"><IconSearch /><input aria-label="搜索地图企业" placeholder="搜索企业名称" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="map-list">
          {listed.map((feature) => <button type="button" key={feature.properties.code} className={selected === feature.properties.code ? "on" : ""} onClick={() => pick.current(feature.properties.code)} aria-pressed={selected === feature.properties.code}>
            <i style={{ backgroundColor: feature.properties.color }} /><span>{feature.properties.name}<small>{feature.properties.sector}</small></span>
            <em className="num">{value(feature.properties.metricBindingApproved ? ranking.find((row) => row.code === feature.properties.code)?.tce : undefined)}<small>tce</small></em>
          </button>)}
          {!listed.length && <p className="panel-note">没有匹配的企业</p>}
        </div>
        <footer><button type="button" className="btn-ghost small" onClick={exportCoordinates}>导出坐标 GeoJSON</button><Link className="more-link" href={`/enterprises?year=${year}`}>公开核实名录</Link></footer>
      </motion.aside>}
      {active && !listOpen && <motion.aside key={active.properties.code} className="map-drawer detail glass" aria-label="企业详情" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.25 }}>
        <header>
          <div className="detail-title">{brand?.logo && <img className="detail-logo" src={brand.logo} alt={`${active.properties.name}品牌标识`} />}<div><span className="eyebrow">{active.properties.sector} · {year}</span><h3>{active.properties.name}</h3></div></div>
          <button type="button" className="icon-btn" onClick={() => setSelected("")} aria-label="关闭企业详情"><IconClose /></button>
        </header>
        <div className="detail-metrics"><div><span className="num">{value(metric?.tce)}</span><small>综合能耗 · tce</small></div><div><span className="num">{value(metric?.intensity, 4)}</span><small>tce / 万元产值</small></div></div>
        {!active.properties.metricBindingApproved && <p className="panel-note">该点位尚未批准关联企业能耗台账，数值留空。</p>}
        <p className="detail-address">{active.properties.address}<code>{active.geometry.coordinates.map((number) => number.toFixed(5)).join(", ")}</code></p>
        <p className="panel-note">{active.properties.note}</p>
        <footer>
          <a className="more-link" href={active.properties.sourceUrl} target="_blank" rel="noreferrer">高德企业来源</a>
          {brand?.sourceUrl && <a className="more-link" href={brand.sourceUrl} target="_blank" rel="noreferrer">标识来源</a>}
          <span className="chip">企业 POI · 厂区红线待核定</span>
        </footer>
      </motion.aside>}
    </AnimatePresence>
  </section>;
}
