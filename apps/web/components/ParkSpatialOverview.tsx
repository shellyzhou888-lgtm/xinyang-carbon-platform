"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ChartData } from "@xinyang/db-agent";
import { loadAmap, type AmapApi } from "@/lib/amap";
import { enterprises, geography, type Sector } from "@/lib/park-geography";
import { enterpriseBadge, enterpriseBrands } from "@/lib/enterprise-branding";
import directory from "@/data/enterprise-directory.json";
import planning from "@/data/planning-overlay.json";
import Link from "next/link";

const Energy3D = dynamic(() => import("./EnterpriseEnergy3D"), { ssr: false, loading: () => <div className="map-empty">3D 能耗图加载中…</div> });
const EMPTY_RANKING: ChartData["ranking"] = [];
const FEATURED = new Set(directory.items.filter(row=>row.featured&&row.mapCode).map(row=>row.mapCode));
const value = (number: number | null | undefined, digits = 1) => number == null ? "—" : number.toLocaleString("zh-CN", { maximumFractionDigits: digits });
const pinIcon = (color: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="11" fill="#0b1d1a88"/><circle cx="15" cy="15" r="6" fill="${color}" stroke="#e6f2ef" stroke-width="2"/></svg>`);
function planningLabel(name:string,color:string,area:number) {
  const canvas=document.createElement("canvas");canvas.width=380;canvas.height=88;
  const ctx=canvas.getContext("2d")!;ctx.scale(2,2);
  ctx.fillStyle="rgba(10,30,25,.95)";ctx.strokeStyle=color;ctx.lineWidth=1;
  ctx.beginPath();ctx.roundRect(.5,.5,189,43,4);ctx.fill();ctx.stroke();
  ctx.textAlign="center";ctx.font='600 12px "Microsoft YaHei", sans-serif';ctx.fillStyle=color;ctx.fillText(name,95,18);
  ctx.font='10px "Microsoft YaHei", sans-serif';ctx.fillStyle="#d7e9e0";ctx.fillText(`${area.toFixed(2)} km² · 规划示意`,95,34);
  return canvas.toDataURL("image/png");
}

export default function ParkSpatialOverview({ year, ranking = EMPTY_RANKING, compact = false, initialEnterprise }: { year: number; ranking?: ChartData["ranking"]; compact?: boolean; initialEnterprise?: string }) {
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
  const [view, setView] = useState<"map" | "energy">("map");
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
  const visibleRanking = useMemo(() => ranking.filter((row) => visible.some((feature) => feature.properties.code === row.code)), [ranking, visible]);

  pick.current = (code) => {
    const feature = enterprises.find((candidate) => candidate.properties.code === code);
    if (!feature) return;
    setSelected(code);
    setView("map");
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
      areaLayer.current = new AMap.LabelsLayer({ zIndex: 160, collision: false });
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
        icon: { image: pinIcon(active ? "#f2b84b" : feature.properties.color), size: [30, 30], anchor: "center" } });
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
    instance.setFitView(targets, true, [75,45,55,45], sector === "全部" ? 14 : 16);
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
        const polygon=new AMap.Polygon({path:rings[0],fillColor:area.properties.color,fillOpacity:.12,strokeColor:area.properties.color,strokeOpacity:.95,strokeWeight:2,strokeStyle:"dashed",strokeDasharray:[8,4],zIndex:60,cursor:"default"});
        polygon.setMap(map.current);
        planningPolygons.current.push(polygon);
      }
      areaLayer.current.add(new AMap.LabelMarker({position:area.properties.labelPosition,icon:{image:planningLabel(area.properties.name,area.properties.color,area.properties.areaKm2),size:[190,44],anchor:"center"}}));
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
    if (view === "map") requestAnimationFrame(() => map.current?.resize());
  }, [view]);

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

  return <section className={`spatial-overview section ${compact ? "map-compact" : ""}`} ref={shell} data-labels={labels} aria-label="园区空间总览">
    <header className="spatial-head">
      <div><div className="map-eyebrow">PARK AT A GLANCE</div><h2>园区空间总览 <span className="map-count">4 个规划功能片区 · {enterprises.length} 个公开POI</span></h2></div>
      <div className="map-view-tabs" role="group" aria-label="空间视图">
        <button type="button" aria-pressed={view==="map"} className={view==="map"?"on":""} onClick={()=>setView("map")}>卫星定位</button>
        {compact ? <button type="button" aria-pressed={listOpen} onClick={()=>setListOpen(open=>!open)}>企业列表</button> : <button type="button" className={view === "map" ? "on" : ""} onClick={() => setView("map")}>企业地图</button>}
        {!compact && <button type="button" className={view === "energy" ? "on" : ""} onClick={() => setView("energy")}>3D 能耗</button>}
        <button type="button" onClick={toggleFullscreen}>{fullscreen ? "退出全屏" : "大屏全屏"}</button>
      </div>
    </header>
    <div className="spatial-body">
      <div className="map-workspace">
        <div className="map-sectors" role="group" aria-label="产业分类">
          {(["全部", "绿色家居", "电子信息"] as const).map((name) => <button type="button" key={name} onClick={() => {setSelected("");setSector(name);setPresetRevision(n=>n+1);}} className={sector === name ? "on" : ""} aria-pressed={sector===name}>{name === "全部" ? "整体全景" : name === "绿色家居" ? "羊山片区" : "金牛物流片区"}</button>)}
        </div>
        <div className={`amap-stage ${view !== "map" ? "map-hidden" : ""}`}>
          <div ref={container} className="amap-canvas" role="img" aria-label="高德地图：信阳经开区家居与电子信息企业点位" />
          {!ready && !error && <div className="map-empty map-overlay">正在载入高德地图…</div>}
          {error && <div className="map-message" role="status">{error} <button type="button" onClick={() => { setError(""); setRetry((n) => n + 1); }}>重试</button></div>}
          <div className="map-tools" role="group" aria-label="地图工具">
            <button type="button" aria-pressed={satellite} onClick={() => setSatellite((current) => !current)}>{satellite ? "标准底图" : "卫星影像"}</button>
            <button type="button" aria-pressed={pitched} onClick={() => setPitched((current) => !current)}>{pitched ? "俯视视角" : "倾斜视角"}</button>
            <button type="button" aria-pressed={labels} onClick={() => setLabels((current) => !current)}>企业标识</button>
            <button type="button" aria-pressed={areaNames} onClick={()=>setAreaNames(current=>!current)}>规划分区</button>
          </div>
          <div className="map-legend">{planning.features.map(area=><span key={area.properties.id}><i style={{background:area.properties.color}}/>{area.properties.name.replace("产业园区","")}</span>)}<span className="map-crs">规划定位示意 · GCJ-02</span></div>
        </div>
        {view === "energy" && <Energy3D year={year} ranking={visibleRanking} selected={selected} onSelect={(code) => pick.current(code)} />}
        <div className="map-boundary-note">规划分区叠加于卫星底图，为图件初步定位示意，可能存在偏移；非企业红线，法定边界以26号文成果为准。<Link href={`/enterprises?year=${year}`}>查看核实名录 ↗</Link></div>
      </div>
      <aside className={`map-inspector ${compact && active ? "has-selection" : ""} ${listOpen?"show-list":""}`} aria-label="企业点位详情">
        <div className="enterprise-list-head"><b>企业档案</b><button type="button" onClick={exportCoordinates} title="导出GCJ-02企业点位与规划示意分区">导出坐标</button></div>
        <input className="enterprise-search" aria-label="搜索地图企业" placeholder="搜索企业名称" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="map-enterprise-list">
          {listed.map((feature) => <button type="button" key={feature.properties.code} className={selected === feature.properties.code ? "selected" : ""} onClick={() => pick.current(feature.properties.code)} aria-pressed={selected === feature.properties.code}>
            <i style={{ backgroundColor: feature.properties.color }} /><span>{feature.properties.name}</span><small>{value(feature.properties.metricBindingApproved?ranking.find((row) => row.code === feature.properties.code)?.tce:undefined)} <em>tce</em></small>
          </button>)}
          {!listed.length && <p className="muted">没有匹配的企业</p>}
        </div>
        {active ? <div className="map-enterprise-detail">
          {compact && <button type="button" className="map-detail-close" onClick={()=>setSelected("")} aria-label="关闭企业详情">×</button>}
          {enterpriseBrands.get(active.properties.code)?.logo && <img className="enterprise-detail-logo" src={enterpriseBrands.get(active.properties.code)!.logo!} alt={`${active.properties.name}品牌标识`} />}
          <span className="map-detail-sector">{active.properties.sector} / {year}</span><h3>{active.properties.name}</h3>
          <div className="map-detail-metrics"><div><b>{value(metric?.tce)}</b><span>综合能耗 · tce</span></div><div><b>{value(metric?.intensity, 4)}</b><span>tce / 万元产值</span></div></div>
          <p>{active.properties.address}</p><code>{active.geometry.coordinates.map((number) => number.toFixed(6)).join(", ")}</code>
          <p className="map-detail-note">{active.properties.note}</p>
          {!active.properties.metricBindingApproved&&<p className="map-detail-note">该点位尚未批准关联企业能耗台账，数值留空。</p>}
          <p className="map-detail-note">{enterpriseBrands.get(active.properties.code)?.note}</p>
          {enterpriseBrands.get(active.properties.code)?.sourceUrl && <p><a href={enterpriseBrands.get(active.properties.code)!.sourceUrl!} target="_blank" rel="noreferrer">标识来源 ↗</a></p>}
          <a href={active.properties.sourceUrl} target="_blank" rel="noreferrer">查看高德企业来源 ↗</a>
          <div className="map-precision">企业 POI · 厂区红线待核定</div>
        </div> : <div className="map-enterprise-detail"><h3>从地图走近企业</h3><p>点击地图或企业名称，查看公开位置。能耗仅在台账关联明确时展示。</p><div className="map-precision">{enterprises.length} 个公开POI · 非园区全部企业</div><Link href={`/enterprises?year=${year}`}>查看公开核实名录 ↗</Link></div>}
      </aside>
    </div>
    {!compact && <details className="map-source-details">
      <summary>边界与建模资料 <span>26号文优先 · 规划分区辅助 · 免费DEM已下载</span></summary>
      <div className="map-source-grid">
        <div><h3>边界依据</h3><p>2023年26号文：围合26.3429 km²，规划建设用地15.5630 km²，共3个四至片区。2020年设立时11.7 km²单独保留为历史口径。</p>
          <p>上传PDF第152页为4个规划功能片区示意，仅作辅助参考。现有四至文字未附界址坐标，尚未绘制法定边界。</p>
          <a href={geography.boundaryReference.primary.url} target="_blank" rel="noreferrer">查看26号文原文 ↗</a></div>
        <div><h3>备用地形资料</h3><p>ASTER GDEM V3 30米DEM已免费下载并保留。当前总览不显示地形起伏，使用卫星影像叠加规划分区与企业标识。</p><a href="/geography/dem-manifest.json" download>查看地形来源与处理记录</a></div>
      </div>
    </details>}

  </section>;
}
