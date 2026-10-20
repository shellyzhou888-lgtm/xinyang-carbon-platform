"use client";
import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart,LineChart,PieChart,GridComponent,TooltipComponent,LegendComponent,CanvasRenderer]);
export default function MetricChart({ rows, kind = "bar", unit, color = "#3ddc97", label }: {
  rows: { name: string; value: number | null }[]; kind?: "bar" | "line" | "pie"; unit: string; color?: string; label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current || !rows.some(row=>row.value!=null)) return;
    const chart = echarts.init(host.current);
    const common = {backgroundColor:"transparent", color:[color,"#69baff","#f2b84b","#7dd3c0","#ef6f6c","#c5d9d3"], tooltip:{trigger:kind==="pie"?"item":"axis"}};
    chart.setOption(kind === "pie" ? {...common, legend:{bottom:0,textStyle:{color:"#9cbab3"}}, series:[{type:"pie",radius:["42%","68%"],center:["50%","44%"],label:{color:"#e6f2ef",formatter:"{b}\n{d}%"},data:rows.map(row=>({name:row.name,value:row.value}))}]} : {
      ...common,grid:{left:65,right:25,top:35,bottom:65}, xAxis:{type:"category",data:rows.map(row=>row.name),axisLabel:{color:"#9cbab3",rotate:rows.length>10?40:0},axisLine:{lineStyle:{color:"#24524a"}}},
      yAxis:{type:"value",name:unit,nameTextStyle:{color:"#9cbab3"},axisLabel:{color:"#9cbab3"},splitLine:{lineStyle:{color:"#24524a",type:"dashed"}}},
      series:[{type:kind,data:rows.map(row=>row.value),connectNulls:false,symbolSize:6,lineStyle:{width:2},itemStyle:{borderRadius:kind==="bar"?[4,4,0,0]:undefined},barMaxWidth:32}]
    });
    const resize = new ResizeObserver(()=>chart.resize());resize.observe(host.current);
    return ()=>{resize.disconnect();chart.dispose();};
  },[rows,kind,unit,color]);
  return rows.some(row=>row.value!=null) ? <div ref={host} className="metric-chart" role="img" aria-label={label} /> : <div className="workspace-empty">暂无可展示数据</div>;
}
