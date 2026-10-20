"use client";
import { useState } from "react";
import boundaries from "@/data/planning-boundaries.json";
import type { Sector } from "@/lib/park-geography";

/** Original-image coordinates deliberately avoid suggesting surveyed GIS precision. */
export default function PlanningBoundaryMap({sector,onSector}:{sector:Sector|"全部";onSector:(value:Sector|"全部")=>void}){
  const [source,setSource]=useState(false),[selected,setSelected]=useState("");
  const focus=sector==="绿色家居"?"green-home":sector==="电子信息"?"electronics":"";
  const viewBox=focus==="green-home"?"428 350 310 310":focus==="electronics"?"152 562 210 340":"155 350 595 550";
  const active=boundaries.areas.find(area=>area.id===selected);
  return <div className="planning-boundary-map" data-boundary-count={boundaries.areas.length} data-coordinate-space="image-pixels">
    <div className="planning-map-caption"><b>信阳经济技术开发区</b><span>总体发展规划（2022—2035年）</span></div>
    <button className="planning-underlay" type="button" aria-pressed={source} onClick={()=>setSource(value=>!value)}>{source?"隐藏规划底图":"对照规划底图"}</button>
    <svg viewBox={viewBox} role="img" aria-label="规划四个功能片区边界示意，按原规划图像素描绘" preserveAspectRatio="xMidYMid meet">
      <defs><pattern id="planning-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#2b5145" strokeWidth=".5"/></pattern></defs>
      <rect x="140" y="260" width="610" height="695" fill="url(#planning-grid)" opacity=".45"/>
      {source&&<image href="/geography/planning-reference.png" x="0" y="0" width="893" height="1263" opacity=".65"/>}
      <g className="planning-compass" transform="translate(189,405)"><path d="M0 -20 L-7 5 L0 0 L7 5 Z" fill="#b6cdc2"/><text x="0" y="-29" textAnchor="middle">N</text></g>
      {boundaries.areas.map(area=><g key={area.id} className={`planning-zone ${selected===area.id?"selected":""}`} opacity={focus&&focus!==area.id?0.16:1}>
        {area.polygons.map((polygon,index)=><polygon key={index} points={polygon.map(point=>point.join(",")).join(" ")} fill={area.color} fillOpacity={selected===area.id?0.32:.16} stroke={area.color} strokeWidth="2" vectorEffect="non-scaling-stroke" tabIndex={0} role="button" aria-label={`查看${area.name}规划范围${index?`组团${index+1}`:""}`} onClick={()=>setSelected(area.id)} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();setSelected(area.id);}}}><title>{`${area.name} · ${area.areaKm2}平方公里 · 规划图描绘`}</title></polygon>)}
        <g transform={`translate(${area.label.join(" ")})`} className="planning-area-label"><rect x="-92" y="-25" width="184" height="42" rx="3" fill="#0b2520" stroke={area.color} strokeWidth=".7"/><text textAnchor="middle" y="-8" fill={area.color}>{area.name}</text><text textAnchor="middle" y="9" className="planning-area-size">{area.areaKm2.toFixed(2)} km²</text></g>
      </g>)}
    </svg>
    <div className="planning-area-key">{boundaries.areas.map(area=><button type="button" key={area.id} aria-pressed={selected===area.id} onClick={()=>{setSelected(area.id);onSector(area.id==="green-home"?"绿色家居":area.id==="electronics"?"电子信息":"全部");}}><i style={{background:area.color}}/>{area.name}<b>{area.areaKm2.toFixed(2)}</b></button>)}</div>
    <div className="planning-map-foot"><strong>{active?active.name:"四个功能片区 · 15.56 km²"}</strong><span>{active?`${active.areaKm2.toFixed(2)} km² · ${active.id==="innovation-community"?"分散组团，逐块描绘":"按规划图有色片区外缘描绘"}`:"面积引用原规划图；描绘线不用于测量或确权"}</span></div>
  </div>;
}
