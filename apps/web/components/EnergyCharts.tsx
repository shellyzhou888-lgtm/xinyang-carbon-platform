"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ChartData } from "@xinyang/db-agent";

// Only the chart types we use are bundled (tree-shaking keeps the page small).
echarts.use([LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkAreaComponent, CanvasRenderer]);

const C = { text: "#e6f2ef", muted: "#9cbab3", line: "#24524a", energy: "#3ddc97", carbon: "#f2b84b", band: "rgba(61,220,151,0.15)", bandCo2: "rgba(242,184,75,0.15)" };
const PIE = ["#3ddc97", "#4fb3ff", "#f2b84b", "#ef6f6c", "#a78bfa", "#7dd3c0", "#f472b6"];
const axis = { axisLine: { lineStyle: { color: C.line } }, axisLabel: { color: C.muted }, splitLine: { lineStyle: { color: C.line, type: "dashed" as const } } };

function useChart(option: echarts.EChartsCoreOption) {
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
export function TrendChart({ data: original, forecast = true, recentYears = false }: { data: ChartData; forecast?: boolean; recentYears?: boolean }) {
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
    tooltip: { trigger: "axis" },
    legend: { top: 0, textStyle: { color: C.muted }, data: forecast ? ["综合能耗", "碳排放", "能耗预测", "碳排放预测"] : ["综合能耗", "碳排放"] },
    grid: { left: 60, right: 60, top: 36, bottom: 56 },
    dataZoom: [{ type: "slider", height: 16, bottom: 8, textStyle: { color: C.muted }, borderColor: C.line }, { type: "inside" }],
    xAxis: { type: "category", data: months, ...axis },
    yAxis: [{ type: "value", name: "tce", nameTextStyle: { color: C.muted }, ...axis },
            { type: "value", name: "tCO₂", nameTextStyle: { color: C.muted }, ...axis, splitLine: { show: false } }],
    series: [
      { name: "综合能耗", type: "line", data: data.monthly.map((m) => m.tce), smooth: true, symbol: "none", lineStyle: { color: C.energy, width: 2 }, itemStyle: { color: C.energy },
        markArea: fe ? { silent: true, itemStyle: { color: "rgba(255,255,255,0.04)" }, label: { color: C.muted, position: "insideTop" },
                         data: [[{ name: "预测", xAxis: fe.points[0].month }, { xAxis: fe.points.at(-1)!.month }]] } : undefined },
      { name: "碳排放", type: "line", yAxisIndex: 1, data: data.monthly.map((m) => m.co2_t), smooth: true, symbol: "none", lineStyle: { color: C.carbon, width: 2 }, itemStyle: { color: C.carbon } },
      { name: "能耗区间下沿", type: "line", data: lower(fe), stack: "e-band", symbol: "none", lineStyle: { opacity: 0 }, tooltip: { show: false } },
      { name: "能耗 10–90% 区间", type: "line", data: width(fe), stack: "e-band", symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: C.band }, tooltip: { show: false } },
      { name: "碳排放区间下沿", type: "line", yAxisIndex: 1, data: lower(fc), stack: "c-band", symbol: "none", lineStyle: { opacity: 0 }, tooltip: { show: false } },
      { name: "碳排放 10–90% 区间", type: "line", yAxisIndex: 1, data: width(fc), stack: "c-band", symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: C.bandCo2 }, tooltip: { show: false } },
      { name: "能耗预测", type: "line", data: fLine(fe, lastE), symbol: "none", lineStyle: { color: C.energy, type: "dashed" }, itemStyle: { color: C.energy } },
      { name: "碳排放预测", type: "line", yAxisIndex: 1, data: fLine(fc, lastC), symbol: "none", lineStyle: { color: C.carbon, type: "dashed" }, itemStyle: { color: C.carbon } },
    ],
  };
  const ref = useChart(option);
  return <div ref={ref} className="chart tall" />;
}

export function StructureChart({ data }: { data: ChartData }) {
  const total = data.structure.reduce((a, s) => a + s.tce, 0);
  const option = {
    backgroundColor: "transparent", color: PIE,
    tooltip: { trigger: "item", formatter: "{b}：{c} tce（{d}%）" },
    legend: { orient: "vertical", right: 0, top: "middle", textStyle: { color: C.muted } },
    series: [{ type: "pie", radius: ["48%", "72%"], center: ["35%", "52%"], itemStyle: { borderColor: "#12302b", borderWidth: 2 },
               label: { show: true, position: "center", formatter: () => `${Math.round(total).toLocaleString("zh-CN")}\ntce`, color: C.text, fontSize: 16 },
               data: data.structure.map((s) => ({ name: s.name, value: s.tce })) }],
  };
  const ref = useChart(option);
  return <div ref={ref} className="chart" />;
}

export function RankingChart({ data }: { data: ChartData }) {
  const rows = [...data.ranking].reverse();
  const option = {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 0, textStyle: { color: C.muted }, data: ["综合能耗", "单位产值能耗"] },
    grid: { left: 110, right: 50, top: 30, bottom: 24 },
    xAxis: [{ type: "value", name: "tce", nameTextStyle: { color: C.muted }, ...axis },
            { type: "value", name: "tce/万元", position: "top", nameTextStyle: { color: C.muted }, ...axis, splitLine: { show: false } }],
    yAxis: { type: "category", data: rows.map((r) => r.name.replace(/（.*?）/g, "")), ...axis },
    series: [
      { name: "综合能耗", type: "bar", data: rows.map((r) => r.tce), itemStyle: { color: C.energy, borderRadius: [0, 4, 4, 0] }, barWidth: "55%" },
      { name: "单位产值能耗", type: "line", xAxisIndex: 1, data: rows.map((r) => r.intensity), itemStyle: { color: C.carbon }, lineStyle: { color: C.carbon } },
    ],
  };
  const ref = useChart(option);
  return <div ref={ref} className="chart" />;
}

export default function EnergyCharts({ data }: { data: ChartData }) {
  const fe = data.forecast.find((f) => f.target === "energy_tce");
  return (
    <>
      <section className="section">
        <h2>月度综合能耗与碳排放（{data.profile} 口径）{fe ? <span className="muted">　虚线为 {fe.model ?? "模型"} 预测，阴影为 10%–90% 区间</span> : null}</h2>
        <TrendChart data={data} />
      </section>
      <div className="chart-row">
        <section className="section"><h2>{data.year} 年能源消费结构</h2><StructureChart data={data} /></section>
        <section className="section"><h2>{data.year} 年企业综合能耗与单位产值能耗</h2><RankingChart data={data} /></section>
      </div>
    </>
  );
}
