"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ChartData } from "@xinyang/db-agent";
import { loadAmap, type AmapApi } from "@/lib/amap";
import { distributions, enterprises, geography, type Sector } from "@/lib/park-geography";
import osmManifest from "@/public/geography/osm-context-manifest.json";

const Energy3D = dynamic(() => import("./EnterpriseEnergy3D"), { ssr: false, loading: () => <div className="map-empty">3D 能耗图加载中…</div> });
const EMPTY_RANKING: ChartData["ranking"] = [];
const value = (number: number | null | undefined, digits = 1) => number == null ? "—" : number.toLocaleString("zh-CN", { maximumFractionDigits: digits });
const pinIcon = (color: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="11" fill="#0b1d1a88"/><circle cx="15" cy="15" r="6" fill="${color}" stroke="#e6f2ef" stroke-width="2"/></svg>`);

export default function ParkSpatialOverview({ year, ranking = EMPTY_RANKING }: { year: number; ranking?: ChartData["ranking"] }) {
  const shell = useRef<HTMLElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<AmapApi>(null);
  const amap = useRef<AmapApi>(null);
  const scene = useRef<any>(null);
  const pinLayer = useRef<any>(null);
  const nameLayer = useRef<any>(null);
  const satelliteLayers = useRef<any[]>([]);
  const nativePolygons = useRef<any[]>([]);
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
  const [pitched, setPitched] = useState(true);
  const [labels, setLabels] = useState(true);
  const [ranges, setRanges] = useState(true);
  const [query, setQuery] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const visible = useMemo(() => enterprises.filter((feature) => sector === "全部" || feature.properties.sector === sector), [sector]);
  const listed = visible.filter((feature) => (feature.properties.name + feature.properties.poiName).includes(query.trim()));
  const active = enterprises.find((feature) => feature.properties.code === selected);
  const metric = ranking.find((row) => row.code === selected);
  const visibleRanking = useMemo(() => ranking.filter((row) => visible.some((feature) => feature.properties.code === row.code)), [ranking, visible]);

  pick.current = (code) => {
    const feature = enterprises.find((candidate) => candidate.properties.code === code);
    if (!feature) return;
    setSelected(code);
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
        viewMode: "3D", zoom: 12.4, center: [114.103, 32.203], pitch: 42, rotation: 0,
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
      currentMap.add([pinLayer.current, nameLayer.current]);
      setReady(true);
      // Real AMap overlays remain usable if the optional WebGL visualization layer fails.
      try {
        const [{ Scene }, { PolygonLayer, LineLayer, PointLayer }, { GaodeMap }] = await Promise.all([
          import("@antv/l7-scene"), import("@antv/l7-layers"), import("@antv/l7-maps/gaode"),
        ]);
        if (disposed || !container.current) return;
        currentScene = new Scene({ id: mapElement, map: new GaodeMap({ mapInstance: currentMap }), logoVisible: false });
        scene.current = currentScene;
        currentScene.on("loaded", () => {
          if (disposed) return;
          const fill = new PolygonLayer({ name: "enterprise-distribution-fill", zIndex: 1 })
            .source({ type: "FeatureCollection", features: distributions }).shape("fill").color("color").style({ opacity: 0.09 });
          const outline = new LineLayer({ name: "enterprise-distribution-line", zIndex: 2 })
            .source({ type: "FeatureCollection", features: distributions }).shape("line").size(1.5).color("color").style({ opacity: 0.65, lineType: "dash", dashArray: [5, 5] });
          const points = new PointLayer({ name: "enterprise-locations", zIndex: 3 })
            .source({ type: "FeatureCollection", features: enterprises }).shape("circle").size(10).color("color")
            .style({ opacity: 0.35, stroke: "#e6f2ef", strokeWidth: 1 });
          l7Layers.current = [fill, outline, points];
          [fill, outline, points].forEach((layer) => currentScene.addLayer(layer));
          nativePolygons.current.forEach((polygon) => polygon.hide());
          shell.current?.setAttribute("data-map-engine", "amap-l7");
          setL7Ready(true);
        });
      } catch (reason) {
        // The base map, markers and distribution envelopes already provide the same facts.
        console.warn("[park-map] L7 overlay unavailable", reason instanceof Error ? reason.message : "unknown error");
      }
    }).catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : "地图初始化失败"); });
    return () => {
      disposed = true;
      window.clearTimeout(readyTimer);
      resize?.disconnect();
      pinLayer.current = null;
      nameLayer.current = null;
      satelliteLayers.current = [];
      nativePolygons.current = [];
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
    for (const feature of visible) {
      const active = feature.properties.code === selected;
      const marker = new AMap.LabelMarker({ position: [...feature.geometry.coordinates], zIndex: active ? 3 : 1,
        icon: { image: pinIcon(active ? "#f2b84b" : feature.properties.color), size: [30, 30], anchor: "center" } });
      marker.on("click", () => pick.current(feature.properties.code));
      pinLayer.current.add(marker);
      if (labels || active) {
        const label = new AMap.LabelMarker({ position: [...feature.geometry.coordinates], zIndex: active ? 3 : 1, rank: active ? 1e12 : 1,
          text: { content: feature.properties.name, direction: "top", offset: [0, -13], style: {
            fontSize: 11, fillColor: active ? "#fff0ca" : "#e6f2ef", padding: [4, 6], backgroundColor: "rgba(11,29,26,0.92)",
            borderColor: active ? "#f2b84b" : "#477164", borderWidth: 1,
          } } });
        label.on("click", () => pick.current(feature.properties.code));
        nameLayer.current.add(label);
      }
    }
    shell.current?.setAttribute("data-enterprise-count", String(visible.length));
    shell.current?.setAttribute("data-selected-enterprise", selected);
  }, [ready, visible, selected, labels]);

  useEffect(() => {
    if (!ready || !map.current || !amap.current) return;
    const AMap = amap.current;
    const instance = map.current;
    nativePolygons.current.forEach((polygon) => polygon.setMap(null));
    nativePolygons.current = distributions.filter((feature) => sector === "全部" || feature.properties.sector === sector).map((feature) => {
      const polygon = new AMap.Polygon({ path: feature.geometry.coordinates[0].map((position) => [...position]), fillColor: feature.properties.color, fillOpacity: 0.08,
        strokeColor: feature.properties.color, strokeOpacity: 0.65, strokeWeight: 2, strokeStyle: "dashed", strokeDasharray: [5, 5], zIndex: 40 });
      polygon.setMap(instance);
      if (!ranges || scene.current?.getLayerByName("enterprise-distribution-fill")) polygon.hide();
      return polygon;
    });
    const positions = visible.map((feature) => feature.geometry.coordinates);
    const center = [(Math.min(...positions.map((p) => p[0])) + Math.max(...positions.map((p) => p[0]))) / 2,
      (Math.min(...positions.map((p) => p[1])) + Math.max(...positions.map((p) => p[1]))) / 2];
    instance.setZoomAndCenter(sector === "全部" ? 12.4 : sector === "绿色家居" ? 14.1 : 14.8, center, true);
    if (selected && !visible.some((feature) => feature.properties.code === selected)) setSelected("");
    // Camera follows the sector once; selecting a point zooms independently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sector]);

  useEffect(() => {
    if (!map.current || !amap.current) return;
    // Toggle only the imagery layers; setLayers() would also detach enterprise labels.
    satelliteLayers.current.forEach((layer) => satellite ? layer.show() : layer.hide());
  }, [satellite, ready]);

  useEffect(() => {
    map.current?.setPitch(pitched ? 42 : 0);
  }, [pitched, ready]);

  useEffect(() => {
    nativePolygons.current.forEach((polygon) => ranges && !scene.current?.getLayerByName("enterprise-distribution-fill") ? polygon.show() : polygon.hide());
    if (l7Ready) {
      const areaFeatures = distributions.filter((feature) => sector === "全部" || feature.properties.sector === sector);
      l7Layers.current.slice(0, 2).forEach((layer) => {
        layer.setData({ type: "FeatureCollection", features: areaFeatures });
        ranges ? layer.show() : layer.hide();
      });
      l7Layers.current[2]?.setData({ type: "FeatureCollection", features: visible });
    }
  }, [ranges, sector, visible, l7Ready]);

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
    const blob = new Blob([JSON.stringify(geography, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "xinyang-enterprises-gcj02.geojson"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="spatial-overview section" ref={shell} data-labels={labels} aria-label="园区空间总览">
    <header className="spatial-head">
      <div><div className="map-eyebrow">PARK AT A GLANCE</div><h2>园区空间总览 <span className="map-count">10 家样本企业 · 2 类产业</span></h2></div>
      <div className="map-view-tabs" role="group" aria-label="空间视图">
        <button type="button" className={view === "map" ? "on" : ""} onClick={() => setView("map")}>企业地图</button>
        <button type="button" className={view === "energy" ? "on" : ""} onClick={() => setView("energy")}>3D 能耗</button>
        <button type="button" onClick={toggleFullscreen}>{fullscreen ? "退出全屏" : "大屏全屏"}</button>
      </div>
    </header>
    <div className="spatial-body">
      <div className="map-workspace">
        <div className="map-sectors" role="group" aria-label="产业分类">
          {(["全部", "绿色家居", "电子信息"] as const).map((name) => <button type="button" key={name} onClick={() => setSector(name)} className={sector === name ? "on" : ""}>{name === "全部" ? "全部企业" : name}</button>)}
        </div>
        <div className={`amap-stage ${view !== "map" ? "map-hidden" : ""}`}>
          <div ref={container} className="amap-canvas" role="img" aria-label="高德地图：信阳经开区家居与电子信息企业点位" />
          {!ready && !error && <div className="map-empty map-overlay">正在载入高德地图…</div>}
          {error && <div className="map-message" role="status">{error} <button type="button" onClick={() => { setError(""); setRetry((n) => n + 1); }}>重试</button></div>}
          <div className="map-tools" role="group" aria-label="地图工具">
            <button type="button" aria-pressed={satellite} onClick={() => setSatellite((current) => !current)}>{satellite ? "标准底图" : "卫星影像"}</button>
            <button type="button" aria-pressed={pitched} onClick={() => setPitched((current) => !current)}>{pitched ? "俯视 2D" : "倾斜 3D"}</button>
            <button type="button" aria-pressed={labels} onClick={() => setLabels((current) => !current)}>企业名称</button>
            <button type="button" aria-pressed={ranges} onClick={() => setRanges((current) => !current)}>分布范围</button>
          </div>
          <div className="map-legend"><span><i className="legend-home" />绿色家居</span><span><i className="legend-electronics" />电子信息</span><span className="map-crs">高德地图 · GCJ-02</span></div>
        </div>
        {view === "energy" && <Energy3D year={year} ranking={visibleRanking} selected={selected} onSelect={(code) => pick.current(code)} />}
        <div className="map-boundary-note">虚线面仅表示企业分布。已核对26号文四至，界址坐标与企业红线待补充。卫星底图来自高德，尚未导入DEM地形。{view === "energy" && " 能耗取自当前数据库，模拟数据属性与页面提示一致。"}</div>
      </div>
      <aside className="map-inspector" aria-label="企业点位详情">
        <div className="enterprise-list-head"><b>企业档案</b><button type="button" onClick={exportCoordinates} title="导出GCJ-02点位与分布示意范围">导出坐标</button></div>
        <input className="enterprise-search" aria-label="搜索地图企业" placeholder="搜索企业名称" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="map-enterprise-list">
          {listed.map((feature) => <button type="button" key={feature.properties.code} className={selected === feature.properties.code ? "selected" : ""} onClick={() => pick.current(feature.properties.code)} aria-pressed={selected === feature.properties.code}>
            <i style={{ backgroundColor: feature.properties.color }} /><span>{feature.properties.name}</span><small>{value(ranking.find((row) => row.code === feature.properties.code)?.tce)} <em>tce</em></small>
          </button>)}
          {!listed.length && <p className="muted">没有匹配的企业</p>}
        </div>
        {active ? <div className="map-enterprise-detail">
          <span className="map-detail-sector">{active.properties.sector} / {year}</span><h3>{active.properties.name}</h3>
          <div className="map-detail-metrics"><div><b>{value(metric?.tce)}</b><span>综合能耗 · tce</span></div><div><b>{value(metric?.intensity, 4)}</b><span>tce / 万元产值</span></div></div>
          <p>{active.properties.address}</p><code>{active.geometry.coordinates.map((number) => number.toFixed(6)).join(", ")}</code>
          <p className="map-detail-note">{active.properties.note}</p>
          <a href={active.properties.sourceUrl} target="_blank" rel="noreferrer">查看高德企业来源 ↗</a>
          <div className="map-precision">企业 POI · 厂区红线待核定</div>
        </div> : <div className="map-enterprise-detail"><h3>从地图走近企业</h3><p>点击地图或企业名称，查看厂区位置与年度能耗。</p><div className="map-precision">10 / 10 企业已取得公开 POI 点位</div></div>}
      </aside>
    </div>
    <details className="map-source-details">
      <summary>边界与建模资料 <span>26号文优先 · OSM矢量已下载 · DEM待导入</span></summary>
      <div className="map-source-grid">
        <div><h3>边界依据</h3><p>2023年26号文：围合26.3429 km²，规划建设用地15.5630 km²，共3个四至片区。2020年设立时11.7 km²单独保留为历史口径。</p>
          <p>上传PDF第152页为4个规划功能片区示意，仅作辅助参考。现有四至文字未附界址坐标，尚未绘制法定边界。</p>
          <a href={geography.boundaryReference.primary.url} target="_blank" rel="noreferrer">查看26号文原文 ↗</a></div>
        <div><h3>OSM建模素材</h3><p>周边查询框提取：{osmManifest.counts.road}段道路、{osmManifest.counts.building}个建筑轮廓、{osmManifest.counts.landuse}个用地面。查询框含园区外要素，不是园区内统计。</p>
          <p>建筑高度与企业归属未取得；用地面不能作为企业产权地块。数据为WGS84，叠加高德前须转换显示坐标。</p>
          <a href="/geography/osm-context-wgs84.geojson" download>下载OSM GeoJSON</a>{" · "}<a href="/geography/osm-context-manifest.json" download>来源与统计</a>
          <p><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a></p></div>
      </div>
    </details>
  </section>;
}
