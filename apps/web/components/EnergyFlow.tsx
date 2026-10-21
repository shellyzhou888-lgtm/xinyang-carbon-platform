"use client";
import { useEffect,useRef,useState } from "react";
import * as echarts from "echarts/core";
import { SankeyChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { C, SERIES, tooltip } from "@/lib/chart-theme";
echarts.use([SankeyChart,TooltipComponent,CanvasRenderer]);
type Transfer={source:string;target:string;energy:string;quantity:number;unit:string};
export default function EnergyFlow({rows}:{rows:Transfer[]}){
  const groups=[...new Set(rows.map(row=>`${row.energy} / ${row.unit}`))];
  const [group,setGroup]=useState(groups[0]||"");
  const active=groups.includes(group)?group:groups[0];
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!host.current)return;
    const links=rows.filter(row=>`${row.energy} / ${row.unit}`===active&&row.quantity>0);
    const nodes=[...new Set(links.flatMap(row=>[row.source,row.target]))];
    const chart=echarts.init(host.current);
    chart.setOption({animation:false,backgroundColor:"transparent",tooltip:tooltip("item"),series:[{type:"sankey",left:12,right:180,top:20,bottom:20,nodeWidth:10,nodeGap:18,layoutIterations:40,data:nodes.map((name,index)=>({name,itemStyle:{color:SERIES[index%SERIES.length],borderRadius:4}})),links:links.map(row=>({source:row.source,target:row.target,value:row.quantity})),label:{color:C.text,fontSize: 12},itemStyle:{borderWidth:0},lineStyle:{color:"gradient",opacity:.22,curveness:.5},emphasis:{focus:"adjacency",lineStyle:{opacity:.5}}}]});
    const resize=new ResizeObserver(()=>chart.resize());resize.observe(host.current);return()=>{resize.disconnect();chart.dispose();};
  },[rows,active]);
  return <><nav className="chips" aria-label="能流能源品种">{groups.map(value=><button key={value} type="button" aria-pressed={active===value} onClick={()=>setGroup(value)}>{value}</button>)}</nav><p className="panel-note">按能源品种及单位分别显示，不跨单位相加；内部层级转供不计作新增园区消费。</p><div ref={host} className="energy-flow-chart" role="img" aria-label={`${active}企业到厂区、产线的能流`}/></>;
}
