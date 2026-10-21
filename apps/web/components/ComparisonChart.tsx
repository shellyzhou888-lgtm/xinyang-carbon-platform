"use client";
import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { LegacyGridContainLabel } from "echarts/features";
import { axis, C, fade, legend, resolveColor, tooltip } from "@/lib/chart-theme";
echarts.use([LegacyGridContainLabel, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export default function ComparisonChart({ labels, series, unit, label }: { labels: string[]; series: { name: string; values: (number | null)[]; color: string; dashed?: boolean }[]; unit: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const available = series.some((row) => row.values.some((value) => value != null));
  useEffect(() => {
    if (!host.current || !available) return;
    const chart = echarts.init(host.current);
    chart.setOption({
      backgroundColor: "transparent", tooltip: tooltip(), legend: legend({ top: 0, right: 0 }),
      grid: { left: 8, right: 12, top: 36, bottom: 8, containLabel: true },
      xAxis: { type: "category", data: labels, boundaryGap: false, ...axis },
      yAxis: { type: "value", name: unit, nameTextStyle: { color: C.muted, align: "left" }, ...axis },
      series: series.map((row, index) => ({
        name: row.name, type: "line", data: row.values, connectNulls: false, smooth: 0.3, symbol: row.dashed ? "none" : "circle", symbolSize: 5,
        itemStyle: { color: resolveColor(row.color) }, lineStyle: { color: resolveColor(row.color), width: row.dashed ? 1.6 : 2.2, type: row.dashed ? "dashed" : "solid" },
        areaStyle: !row.dashed && index === 0 ? { color: fade(resolveColor(row.color), 0.22) } : undefined,
      })),
    });
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(host.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [labels, series, unit, available]);
  return available ? <div className="chart" ref={host} role="img" aria-label={label} /> : <div className="empty"><b>暂无可比较数据</b></div>;
}
