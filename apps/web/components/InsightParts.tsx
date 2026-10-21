"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { axis, barFade, C, fade, legend, SERIES, tooltip } from "@/lib/chart-theme";
import { formatNumber as fmt } from "@/lib/workspace";
import { useChart } from "./EnergyCharts";
import { CountUp } from "./MotionParts";

type Tone = "energy" | "carbon" | "accent" | "info";
const TONE: Record<Tone, string> = { energy: C.energy, carbon: C.carbon, accent: C.accent, info: C.info };

/**
 * KPI card with a year-on-year change and an optional monthly sparkline.
 * `lowerIsBetter` colours a decrease green (energy, emissions, intensity) and an increase amber.
 */
export function KpiCard({ label, value, unit, digits = 1, tone = "energy", previous, lowerIsBetter = true, spark, foot, delay = 0 }: {
  label: string; value: number | null | undefined; unit: string; digits?: number; tone?: Tone; previous?: number | null;
  lowerIsBetter?: boolean; spark?: (number | null)[]; foot?: React.ReactNode; delay?: number;
}) {
  const reduce = useReducedMotion();
  const change = value != null && previous ? (value - previous) / Math.abs(previous) * 100 : null;
  const good = change == null ? null : lowerIsBetter ? change <= 0 : change >= 0;
  return <motion.div className={`kpi tone-${tone}`} style={{ ["--tone" as string]: TONE[tone] }}
    initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
    <div className="kpi-head"><i aria-hidden="true" /><span>{label}</span>
      {change != null && <em className={`kpi-delta ${good ? "good" : "bad"}`} title="与上年相比">{change > 0 ? "▲" : change < 0 ? "▼" : "■"} {fmt(Math.abs(change), 1)}%</em>}
    </div>
    <strong className="kpi-value"><CountUp value={value} digits={digits} /><small>{unit}</small></strong>
    {spark && spark.some((v) => v != null) && <KpiSpark values={spark} color={TONE[tone]} />}
    {foot && <span className="kpi-foot">{foot}</span>}
  </motion.div>;
}

function KpiSpark({ values, color }: { values: (number | null)[]; color: string }) {
  const option = useMemo(() => ({
    backgroundColor: "transparent", animationDuration: 900,
    grid: { left: 0, right: 0, top: 2, bottom: 0 },
    xAxis: { type: "category", show: false, data: values.map((_, i) => i), boundaryGap: false },
    yAxis: { type: "value", show: false, scale: true },
    series: [{ type: "line", data: values, smooth: 0.4, symbol: "none", lineStyle: { color, width: 1.6 }, areaStyle: { color: fade(color, 0.28) } }],
  }), [values, color]);
  const ref = useChart(option);
  return <div ref={ref} className="kpi-spark" aria-hidden="true" />;
}

/** Monthly comparison: this year as bars, last year as a dashed line, with the year-on-year change in the tooltip. */
export function YearCompareChart({ months, current, previous, year, unit, color = C.energy, label }: {
  months: string[]; current: (number | null)[]; previous: (number | null)[]; year: number; unit: string; color?: string; label: string;
}) {
  const option = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: { ...tooltip(), formatter: (items: { dataIndex: number }[]) => {
      const i = items[0]?.dataIndex ?? 0, a = current[i], b = previous[i];
      const change = a != null && b ? `${a >= b ? "+" : ""}${fmt((a - b) / b * 100, 1)}%` : "—";
      return `<b>${months[i]}</b><br/>${year} 年：${fmt(a, 0)} ${unit}<br/>${year - 1} 年：${fmt(b, 0)} ${unit}<br/>同比：${change}`;
    } },
    legend: legend({ top: 0, right: 0, data: [`${year} 年`, `${year - 1} 年`] }),
    grid: { left: 8, right: 12, top: 36, bottom: 6, containLabel: true },
    xAxis: { type: "category", data: months, ...axis },
    yAxis: { type: "value", name: unit, nameTextStyle: { color: C.muted, align: "left" }, ...axis },
    series: [
      { name: `${year} 年`, type: "bar", data: current, barMaxWidth: 22, itemStyle: { color: barFade(color), borderRadius: [6, 6, 0, 0] },
        emphasis: { itemStyle: { color } } },
      { name: `${year - 1} 年`, type: "line", data: previous, smooth: 0.35, symbol: "circle", symbolSize: 5, lineStyle: { color: "rgba(238,244,241,.55)", width: 1.6, type: "dashed" }, itemStyle: { color: "rgba(238,244,241,.7)" } },
    ],
  }), [months, current, previous, year, unit, color]);
  const ref = useChart(option);
  return <div ref={ref} className="chart tall" role="img" aria-label={label} />;
}

/** Composition donut with a ranked legend (value, share and bar) beside it. */
export function ShareBreakdown({ rows, unit, digits = 0, label, centerLabel }: {
  rows: { name: string; value: number }[]; unit: string; digits?: number; label: string; centerLabel: string;
}) {
  const sorted = useMemo(() => [...rows].filter((row) => row.value > 0).sort((a, b) => b.value - a.value), [rows]);
  const total = sorted.reduce((sum, row) => sum + row.value, 0);
  const option = useMemo(() => ({
    backgroundColor: "transparent", color: SERIES,
    tooltip: { ...tooltip("item"), formatter: "{b}<br/>{c} " + unit + "（{d}%）" },
    series: [{ type: "pie", radius: ["62%", "86%"], center: ["50%", "50%"], padAngle: 2, itemStyle: { borderRadius: 5 }, label: { show: false },
      emphasis: { scale: true, scaleSize: 4 }, data: sorted.map((row) => ({ name: row.name, value: row.value })) }],
  }), [sorted, unit]);
  const ref = useChart(option);
  if (!sorted.length) return <div className="empty"><b>暂无可展示数据</b></div>;
  return <div className="share">
    <div className="share-donut">
      <div ref={ref} className="share-chart" role="img" aria-label={label} />
      <div className="share-center"><strong className="num">{fmt(total, digits)}</strong><small>{centerLabel}</small></div>
    </div>
    <ol className="share-list">{sorted.map((row, index) => {
      const share = total ? row.value / total * 100 : 0, color = SERIES[index % SERIES.length];
      return <li key={row.name} style={{ ["--c" as string]: color }}>
        <span className="share-name"><i />{row.name}</span>
        <span className="share-value num">{fmt(row.value, digits)}<small>{unit}</small></span>
        <span className="share-pct num">{fmt(share, 1)}%</span>
        <span className="share-bar" aria-hidden="true"><b style={{ width: `${Math.max(1.5, share)}%` }} /></span>
      </li>;
    })}</ol>
  </div>;
}

/** Annual totals as bars with an intensity line on the right axis (e.g. CO2 and CO2 per 10k yuan value added). */
export function AnnualComboChart({ years, totals, intensity, totalName, totalUnit, intensityName, intensityUnit, color = C.carbon, label }: {
  years: number[]; totals: (number | null)[]; intensity: (number | null)[]; totalName: string; totalUnit: string; intensityName: string; intensityUnit: string; color?: string; label: string;
}) {
  // Both axes start at zero so small intensity changes are not exaggerated; the intensity axis is stretched
  // so its line runs through the middle of the plot, clear of the bar-top labels.
  const peak = Math.max(0, ...intensity.map((v) => v ?? 0));
  const option = useMemo(() => ({
    backgroundColor: "transparent", tooltip: tooltip(),
    legend: legend({ top: 0, left: "center", data: [totalName, intensityName] }),
    grid: { left: 8, right: 8, top: 44, bottom: 6, containLabel: true },
    xAxis: { type: "category", data: years.map(String), ...axis },
    yAxis: [{ type: "value", name: totalUnit, nameTextStyle: { color: C.muted, align: "left" }, ...axis },
            { type: "value", name: intensityUnit, nameTextStyle: { color: C.muted, align: "right" }, ...axis, splitLine: { show: false }, min: 0, max: peak ? Number((peak * 2.4).toPrecision(2)) : undefined }],
    series: [
      { name: totalName, type: "bar", data: totals, barMaxWidth: 46, itemStyle: { color: barFade(color), borderRadius: [8, 8, 0, 0] },
        label: { show: true, position: "insideTop", distance: 10, color: "#1a1408", fontWeight: 600, fontSize: 11, formatter: ({ value }: { value: number }) => fmt(value, 0) } },
      { name: intensityName, type: "line", yAxisIndex: 1, data: intensity, smooth: 0.3, symbol: "circle", symbolSize: 8,
        lineStyle: { color: C.accent, width: 2.2 }, itemStyle: { color: C.accent, borderColor: "#0b100f", borderWidth: 2 },
        label: { show: true, position: "top", distance: 8, color: C.accent, fontSize: 11, backgroundColor: "rgba(8,13,12,.82)", padding: [2, 6], borderRadius: 4, formatter: ({ value }: { value: number }) => fmt(value, 3) } },
    ],
  }), [years, totals, intensity, totalName, totalUnit, intensityName, intensityUnit, color, peak]);
  const ref = useChart(option);
  return <div ref={ref} className="chart fill" role="img" aria-label={label} />;
}

/** Ranked contribution list: rank, name, value, share of the park total and an optional intensity. */
export function ContributionList({ rows, total, unit, intensityUnit, tone = "carbon" }: {
  rows: { code: string; name: string; value: number; intensity?: number | null }[]; total: number | null | undefined; unit: string; intensityUnit?: string; tone?: Tone;
}) {
  const top = rows[0]?.value || 1;
  return <ol className="contrib" style={{ ["--tone" as string]: TONE[tone] }}>
    {rows.map((row, index) => <li key={row.code}>
      <span className="contrib-rank num">{String(index + 1).padStart(2, "0")}</span>
      <span className="contrib-name">{row.name}</span>
      <span className="contrib-value num">{fmt(row.value, 0)}<small>{unit}</small></span>
      <span className="contrib-share num">{total ? `${fmt(row.value / total * 100, 1)}%` : "—"}</span>
      {intensityUnit && <span className="contrib-int num" title={intensityUnit}>{fmt(row.intensity, 3)}</span>}
      <span className="contrib-bar" aria-hidden="true"><b style={{ width: `${Math.max(1.5, row.value / top * 100)}%` }} /></span>
    </li>)}
  </ol>;
}
