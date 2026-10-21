"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { LegacyGridContainLabel } from "echarts/features";
import type { ChartData } from "@xinyang/db-agent";
import { axis, barFade, C, fade, legend, SERIES, tooltip } from "@/lib/chart-theme";

// Only the chart types we use are bundled (tree-shaking keeps the page small).
echarts.use([LegacyGridContainLabel, LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkAreaComponent, CanvasRenderer]);

export function useChart(option: echarts.EChartsCoreOption) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chart.setOption(option);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.dispose(); };
  }, [option]);
  return ref;
}

/** Monthly park energy (tce) and CO2 (t), with the latest forecast: dashed median and 10–90 % band. */
export function TrendChart({ data: original, forecast = true, recentYears = false, height = "tall" }: { data: ChartData; forecast?: boolean; recentYears?: boolean; height?: "tall" | "short" }) {
  const monthly = original.monthly.filter(row => (forecast && !recentYears || Number(row.month.slice(0,4)) <= original.year) && (!recentYears || Number(row.month.slice(0,4)) >= original.year - 2));
  const data = { ...original, monthly, forecast: forecast ? original.forecast : [] };
  const fe = data.forecast.find((f) => f.target === "energy_tce");
  const fc = data.forecast.find((f) => f.target === "co2_t");
  const months = [...data.monthly.map((m) => m.month), ...(fe?.points.map((p) => p.month) ?? [])];
  const pad = (n: number) => Array(Math.max(0,n)).fill(null);
  const hist = data.monthly.length;
  const lastE = data.monthly.at(-1)?.tce ?? null, lastC = data.monthly.at(-1)?.co2_t ?? null;
  // Forecast lines start at the last actual month so the dashed line connects to the history.
  const fLine = (f: typeof fe, last: number | null) => f ? [...pad(hist - 1), last, ...f.points.map((p) => p.value)] : [];
  const lower = (f: typeof fe) => f ? [...pad(hist), ...f.points.map((p) => p.lower)] : [];
  const width = (f: typeof fe) => f ? [...pad(hist), ...f.points.map((p) => (p.upper ?? 0) - (p.lower ?? 0))] : [];
  const option = {
    backgroundColor: "transparent",
    tooltip: tooltip(),
    legend: legend({ top: 0, right: 0, data: forecast ? ["综合能耗", "碳排放", "能耗预测", "碳排放预测"] : ["综合能耗", "碳排放"] }),
    grid: { left: 8, right: 8, top: 40, bottom: hist + (fe?.points.length ?? 0) > 18 ? 44 : 8, containLabel: true },
    dataZoom: hist + (fe?.points.length ?? 0) > 18 ? [{ type: "slider", height: 14, bottom: 6, borderColor: "transparent", backgroundColor: "rgba(255,255,255,0.03)", fillerColor: "rgba(197,240,92,0.12)", handleStyle: { color: C.accent, borderColor: C.accent }, moveHandleSize: 0, textStyle: { color: C.muted }, dataBackground: { lineStyle: { color: "rgba(255,255,255,.15)" }, areaStyle: { color: "rgba(255,255,255,.04)" } } }, { type: "inside" }] : [],
    xAxis: { type: "category", data: months, boundaryGap: false, ...axis },
    yAxis: [{ type: "value", name: "tce", nameTextStyle: { color: C.muted, align: "left" }, ...axis },
            { type: "value", name: "tCO₂", nameTextStyle: { color: C.muted, align: "right" }, ...axis, splitLine: { show: false } }],
    series: [
      { name: "综合能耗", type: "line", data: data.monthly.map((m) => m.tce), smooth: 0.35, symbol: "none", lineStyle: { color: C.energy, width: 2.2 }, itemStyle: { color: C.energy }, areaStyle: { color: fade(C.energy, 0.28) },
        markArea: fe ? { silent: true, itemStyle: { color: "rgba(255,255,255,0.025)" }, label: { color: C.muted, position: "insideTop", fontSize: 12 },
                         data: [[{ name: "预测区间", xAxis: fe.points[0].month }, { xAxis: fe.points.at(-1)!.month }]] } : undefined },
      { name: "碳排放", type: "line", yAxisIndex: 1, data: data.monthly.map((m) => m.co2_t), smooth: 0.35, symbol: "none", lineStyle: { color: C.carbon, width: 2.2 }, itemStyle: { color: C.carbon }, areaStyle: { color: fade(C.carbon, 0.16) } },
      { name: "能耗区间下沿", type: "line", data: lower(fe), stack: "e-band", symbol: "none", lineStyle: { opacity: 0 }, tooltip: { show: false } },
      { name: "能耗 10–90% 区间", type: "line", data: width(fe), stack: "e-band", symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: C.band }, tooltip: { show: false } },
      { name: "碳排放区间下沿", type: "line", yAxisIndex: 1, data: lower(fc), stack: "c-band", symbol: "none", lineStyle: { opacity: 0 }, tooltip: { show: false } },
      { name: "碳排放 10–90% 区间", type: "line", yAxisIndex: 1, data: width(fc), stack: "c-band", symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: C.bandCo2 }, tooltip: { show: false } },
      { name: "能耗预测", type: "line", data: fLine(fe, lastE), symbol: "none", lineStyle: { color: C.energy, type: "dashed" }, itemStyle: { color: C.energy } },
      { name: "碳排放预测", type: "line", yAxisIndex: 1, data: fLine(fc, lastC), symbol: "none", lineStyle: { color: C.carbon, type: "dashed" }, itemStyle: { color: C.carbon } },
    ],
  };
  const ref = useChart(option);
  return <div ref={ref} className={`chart ${height}`} role="img" aria-label="月度综合能耗与碳排放趋势" />;
}

/** Tiny trend line for KPI panels (no axes). */
export function Sparkline({ values, color = C.energy, label }: { values: (number | null)[]; color?: string; label: string }) {
  const option = {
    backgroundColor: "transparent", animationDuration: 900,
    grid: { left: 0, right: 0, top: 4, bottom: 0 },
    xAxis: { type: "category", show: false, data: values.map((_, i) => i), boundaryGap: false },
    yAxis: { type: "value", show: false, scale: true },
    series: [{ type: "line", data: values, smooth: 0.4, symbol: "none", lineStyle: { color, width: 1.8 }, areaStyle: { color: fade(color, 0.3) } }],
  };
  const ref = useChart(option);
  return <div ref={ref} className="sparkline" role="img" aria-label={label} />;
}

export function StructureChart({ data }: { data: ChartData }) {
  const total = data.structure.reduce((a, s) => a + s.tce, 0);
  const option = {
    backgroundColor: "transparent", color: SERIES,
    tooltip: { ...tooltip("item"), formatter: "{b}<br/><b>{c}</b> tce（{d}%）" },
    legend: legend({ orient: "vertical", right: 0, top: "middle", itemWidth: 8, itemHeight: 8, icon: "circle" }),
    series: [{ type: "pie", radius: ["58%", "80%"], center: ["32%", "50%"], padAngle: 2, itemStyle: { borderRadius: 6, borderWidth: 0 },
               label: { show: true, position: "center", formatter: () => `{v|${Math.round(total).toLocaleString("zh-CN")}}\n{u|tce 合计}`, rich: { v: { color: C.text, fontSize: 24, fontWeight: 600, fontFamily: "Bahnschrift, DIN Alternate, sans-serif" }, u: { color: C.muted, fontSize: 12, padding: [6, 0, 0, 0] } } },
               emphasis: { scale: true, scaleSize: 4, label: { show: true } },
               data: data.structure.map((s) => ({ name: s.name, value: s.tce })) }],
  };
  const ref = useChart(option);
  return <div ref={ref} className="chart" role="img" aria-label="能源消费结构" />;
}

export function RankingChart({ data }: { data: ChartData }) {
  const rows = [...data.ranking].reverse();
  const option = {
    backgroundColor: "transparent",
    tooltip: { ...tooltip(), axisPointer: { type: "shadow", shadowStyle: { color: "rgba(255,255,255,0.03)" } } },
    legend: legend({ top: 0, right: 0, data: ["综合能耗", "单位产值能耗"] }),
    grid: { left: 8, right: 16, top: 36, bottom: 4, containLabel: true },
    xAxis: [{ type: "value", name: "tce", nameTextStyle: { color: C.muted }, ...axis },
            { type: "value", name: "tce/万元", position: "top", nameTextStyle: { color: C.muted }, ...axis, splitLine: { show: false } }],
    yAxis: { type: "category", data: rows.map((r) => r.name.replace(/（.*?）/g, "")), ...axis, axisLabel: { color: C.text, fontSize: 12 } },
    series: [
      { name: "综合能耗", type: "bar", data: rows.map((r) => r.tce), itemStyle: { color: barFade(C.energy, true), borderRadius: [0, 6, 6, 0] }, barWidth: 12, showBackground: true, backgroundStyle: { color: "rgba(255,255,255,0.03)", borderRadius: 6 } },
      { name: "单位产值能耗", type: "line", xAxisIndex: 1, data: rows.map((r) => r.intensity), symbolSize: 7, itemStyle: { color: C.carbon }, lineStyle: { color: C.carbon, width: 1.6 } },
    ],
  };
  const ref = useChart(option);
  return <div ref={ref} className="chart tall" role="img" aria-label="企业综合能耗与单位产值能耗" />;
}
