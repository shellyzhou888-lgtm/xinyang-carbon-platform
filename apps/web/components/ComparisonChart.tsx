"use client";
import { useEffect,useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent,TooltipComponent,LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([LineChart,GridComponent,TooltipComponent,LegendComponent,CanvasRenderer]);

export default function ComparisonChart({labels,series,unit,label}:{labels:string[];series:{name:string;values:(number|null)[];color:string;dashed?:boolean}[];unit:string;label:string}){
  const host=useRef<HTMLDivElement>(null);
  const available=series.some(row=>row.values.some(value=>value!=null));
  useEffect(()=>{
    if(!host.current||!available)return;
    const chart=echarts.init(host.current);
    chart.setOption({backgroundColor:"transparent",tooltip:{trigger:"axis"},legend:{bottom:0,textStyle:{color:"#9cbab3"}},grid:{left:75,right:25,top:40,bottom:70},xAxis:{type:"category",data:labels,axisLabel:{color:"#9cbab3"},axisLine:{lineStyle:{color:"#24524a"}}},yAxis:{type:"value",name:unit,nameTextStyle:{color:"#9cbab3"},axisLabel:{color:"#9cbab3"},splitLine:{lineStyle:{color:"#24524a",type:"dashed"}}},series:series.map(row=>({name:row.name,type:"line",data:row.values,connectNulls:false,symbolSize:5,itemStyle:{color:row.color},lineStyle:{color:row.color,width:2,type:row.dashed?"dashed":"solid"}}))});
    const observer=new ResizeObserver(()=>chart.resize());observer.observe(host.current);
    return()=>{observer.disconnect();chart.dispose();};
  },[labels,series,unit,available]);
  return available?<div className="metric-chart" ref={host} role="img" aria-label={label}/>:<div className="workspace-empty">暂无可比较数据</div>;
}
