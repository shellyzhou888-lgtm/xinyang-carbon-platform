"use client";

import { useMemo, useState } from "react";
import type { CarbonManagementData } from "@xinyang/db-agent";
import { useChart } from "./EnergyCharts";
import { StatStrip } from "./ProgressViz";
import { axis, barFade, C, legend, tooltip } from "@/lib/chart-theme";
import { formatNumber as fmt } from "@/lib/workspace";

/** Period use and cumulative progress share a timeline, with separately labelled axes. */
export default function EnergyBudgetChart({ budget }: { budget: CarbonManagementData["budget"][number] }) {
  const [period, setPeriod] = useState<"quarter" | "month">("quarter");
  const annual = budget.annual_budget!;
  const actual = budget.months.reduce((sum, row) => sum + (row.actual ?? 0), 0);
  const quarters = useMemo(() => [0, 1, 2, 3].map(q => {
    const months = budget.months.filter(row => Math.floor((Number(row.month.slice(5)) - 1) / 3) === q);
    const known = months.filter(row => row.actual != null);
    return { label: `第${"一二三四"[q]}季度`, actual: known.length ? known.reduce((sum, row) => sum + row.actual!, 0) : null,
      cumulative: months.at(-1)?.cumulative ?? null, target: annual * (q + 1) / 4, budget: annual / 4 };
  }), [budget.months, annual]);
  const rows = useMemo(() => period === "quarter" ? quarters : budget.months.map(row => ({
    label: `${Number(row.month.slice(5))}月`, actual: row.actual, cumulative: row.cumulative,
    target: row.budget_cumulative, budget: annual / 12,
  })), [period, quarters, budget.months, annual]);
  const option = useMemo(() => ({
    backgroundColor: "transparent", tooltip: { ...tooltip(), formatter: (items: { dataIndex: number; seriesName: string; value: number | null; marker: string }[]) => {
      const row = rows[items[0]?.dataIndex ?? 0];
      return `<b>${row.label}</b><br/>${items.map(item => `${item.marker}${item.seriesName}：${fmt(item.value, 1)} tce`).join("<br/>")}<br/>当期预算使用：${row.actual != null && row.budget ? `${fmt(row.actual / row.budget * 100, 1)}%` : "—"}`;
    } },
    legend: legend({ top: 0, left: "center", itemGap: 12 }),
    grid: { left: 8, right: 8, top: 64, bottom: 8, containLabel: true },
    xAxis: { type: "category", data: rows.map(row => row.label), ...axis, axisLabel: { ...axis.axisLabel, interval: 0, fontSize: period === "month" ? 10 : 12 } },
    yAxis: [
      { type: "value", name: `${period === "quarter" ? "季度" : "月度"}用量 / tce`, nameTextStyle: { color: C.muted, align: "left" }, ...axis },
      { type: "value", name: "累计 / tce", nameTextStyle: { color: C.muted, align: "right" }, ...axis, splitLine: { show: false } },
    ],
    series: [
      { name: "当期预算", type: "bar", data: rows.map(row => row.budget), barMaxWidth: 32, barGap: "-100%", itemStyle: { color: "rgba(197,240,92,.12)", borderRadius: [8, 8, 0, 0] } },
      { name: "当期实际", type: "bar", data: rows.map(row => row.actual), barMaxWidth: 32, itemStyle: { color: barFade(C.energy), borderRadius: [8, 8, 0, 0] } },
      { name: "累计实际", type: "line", yAxisIndex: 1, data: rows.map(row => row.cumulative), smooth: .25, symbolSize: 6, lineStyle: { color: C.accent, width: 2 }, itemStyle: { color: C.accent } },
      { name: "累计预算", type: "line", yAxisIndex: 1, data: rows.map(row => row.target), symbol: "none", lineStyle: { color: C.muted, width: 1.5, type: "dashed" }, itemStyle: { color: C.muted } },
    ],
  }), [rows, period]);
  const ref = useChart(option);
  return <div className="energy-budget-combo">
    <StatStrip items={[
      { label: "年度预算", value: annual, unit: "tce" },
      { label: "累计实际", value: actual, unit: "tce", tone: "energy" },
      { label: actual > annual ? "超出预算" : "剩余额度", value: Math.abs(annual - actual), unit: "tce", tone: actual > annual ? "bad" : undefined },
    ]} />
    <div className="budget-period" role="group" aria-label="预算统计周期">
      <span>当期用量与累计进度</span>
      <div>{([['quarter', '按季度'], ['month', '按月份']] as const).map(([key, name]) => <button key={key} type="button" aria-pressed={period === key} onClick={() => setPeriod(key)}>{name}</button>)}</div>
    </div>
    <div ref={ref} className="chart" role="img" aria-label={`${period === "quarter" ? "季度" : "月度"}用能柱状图与累计能耗预算折线图`} />
    <ul className="budget-quarter-summary" aria-label="季度用能明细">{quarters.map(row => <li key={row.label}>
      <b>{row.label}</b><strong className="num">{fmt(row.actual, 0)}<small> tce</small></strong>
      <span>预算使用 {row.actual != null && row.budget ? `${fmt(row.actual / row.budget * 100, 1)}%` : "—"}</span>
    </li>)}</ul>
  </div>;
}
