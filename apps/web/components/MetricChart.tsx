"use client";
import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { LegacyGridContainLabel } from "echarts/features";
import { axis, barFade, C, fade, legend, SERIES, tooltip } from "@/lib/chart-theme";

echarts.use([LegacyGridContainLabel, BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export default function MetricChart({ rows, kind = "bar", unit, color = C.energy, label }: {
  rows: { name: string; value: number | null }[]; kind?: "bar" | "line" | "pie"; unit: string; color?: string; label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const available = rows.some((row) => row.value != null);
  useEffect(() => {
    if (!host.current || !available) return;
    const chart = echarts.init(host.current);
    const common = { backgroundColor: "transparent", color: [color, ...SERIES.filter((c) => c !== color)], tooltip: tooltip(kind === "pie" ? "item" : "axis") };
    chart.setOption(kind === "pie" ? {
      ...common,
      legend: legend({ bottom: 0, icon: "circle", itemWidth: 8, itemHeight: 8 }),
      series: [{ type: "pie", radius: ["50%", "74%"], center: ["50%", "44%"], padAngle: 2, itemStyle: { borderRadius: 6 }, label: { color: C.text, formatter: "{b}\n{d}%", fontSize: 11 }, labelLine: { lineStyle: { color: "rgba(255,255,255,.2)" } }, data: rows.map((row) => ({ name: row.name, value: row.value })) }],
    } : {
      ...common,
      grid: { left: 8, right: 12, top: 32, bottom: 8, containLabel: true },
      xAxis: { type: "category", data: rows.map((row) => row.name), ...axis, axisLabel: { ...axis.axisLabel, rotate: rows.length > 12 ? 35 : 0 }, boundaryGap: kind === "bar" },
      yAxis: { type: "value", name: unit, nameTextStyle: { color: C.muted, align: "left" }, ...axis },
      series: [{ type: kind, data: rows.map((row) => row.value), connectNulls: false, smooth: kind === "line" ? 0.35 : undefined, symbol: kind === "line" ? "circle" : undefined, symbolSize: 6,
        lineStyle: { width: 2.2, color }, areaStyle: kind === "line" ? { color: fade(color, 0.25) } : undefined,
        itemStyle: kind === "bar" ? { color: barFade(color), borderRadius: [6, 6, 0, 0] } : { color }, barMaxWidth: 26,
        showBackground: kind === "bar", backgroundStyle: { color: "rgba(255,255,255,0.025)", borderRadius: [6, 6, 0, 0] } }],
    });
    const resize = new ResizeObserver(() => chart.resize()); resize.observe(host.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, [rows, kind, unit, color, available]);
  return available ? <div ref={host} className="chart" role="img" aria-label={label} /> : <div className="empty"><b>暂无可展示数据</b></div>;
}
