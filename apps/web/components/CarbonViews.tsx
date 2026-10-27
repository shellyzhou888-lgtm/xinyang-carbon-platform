"use client";

import { useMemo } from "react";
import * as echarts from "echarts/core";
import { GaugeChart, ScatterChart } from "echarts/charts";
import { MarkLineComponent } from "echarts/components";
import type { CarbonAsset, CarbonManagementData, FootprintComparison } from "@xinyang/db-agent";
import { formatNumber as fmt } from "@/lib/workspace";
import { axis, barFade, C, fade, hexA, legend, tooltip } from "@/lib/chart-theme";
import { BOUNDARY } from "@/lib/footprint-labels";
import { useChart } from "./EnergyCharts";
import { StatStrip } from "./ProgressViz";

echarts.use([GaugeChart, ScatterChart, MarkLineComponent]);

const shortName = (name: string) => name.replace(/（[^）]*）/g, "").replace(/\(.*?\)/g, "");
/** Purchased electricity and heat are indirect (scope 2); fuels burnt on site are direct (scope 1). */
const isScope2 = (name: string) => /电力|热力|蒸汽|绿电|光伏/.test(name);

/** Scope 1 / scope 2 split: headline figures, one split bar and the sources under each scope. */
export function ScopeSplit({ rows }: { rows: { name: string; value: number }[] }) {
  const items = rows.filter((row) => row.value > 0).sort((a, b) => b.value - a.value);
  const s1 = items.filter((row) => !isScope2(row.name)), s2 = items.filter((row) => isScope2(row.name));
  const t1 = s1.reduce((a, row) => a + row.value, 0), t2 = s2.reduce((a, row) => a + row.value, 0), total = t1 + t2 || 1;
  if (!items.length) return <div className="empty"><b>暂无排放结构数据</b></div>;
  const group = (title: string, note: string, list: typeof items, sum: number, tone: string) => <div className={`scope-group ${tone}`}>
    <header><b>{title}</b><small>{note}</small><strong className="num">{fmt(sum / total * 100, 1)}%</strong></header>
    <ul>{list.map((row) => <li key={row.name}><span>{row.name.replace(/（.*?）/g, "")}</span><b className="num">{fmt(row.value, 0)}<small>tCO₂</small></b>
      <i><em style={{ width: `${row.value / (items[0]?.value || 1) * 100}%` }} /></i></li>)}</ul>
  </div>;
  return <div className="scope-split">
    <StatStrip items={[{ label: "范围一 · 直接排放", value: t1, unit: "tCO₂", tone: "carbon" }, { label: "范围二 · 外购电热", value: t2, unit: "tCO₂" }, { label: "外购电热占比", value: t2 / total * 100, unit: "%", digits: 1 }]} />
    <div className="scope-bar" role="img" aria-label={`范围一 ${fmt(t1 / total * 100, 1)}%，范围二 ${fmt(t2 / total * 100, 1)}%`}>
      <i className="s1" style={{ width: `${t1 / total * 100}%` }} /><i className="s2" style={{ width: `${t2 / total * 100}%` }} />
    </div>
    <div className="scope-groups">
      {group("范围二", "外购电力、热力", s2, t2, "s2")}
      {group("范围一", "厂内燃料燃烧", s1, t1, "s1")}
    </div>
  </div>;
}

/** Year-on-year change explained by source: last year's total, the change of each source, this year's total. */
export function ChangeWaterfall({ previous, current, year }: { previous: { name: string; value: number }[]; current: { name: string; value: number }[]; year: number }) {
  const option = useMemo(() => {
    const names = [...new Set([...current, ...previous].map((row) => row.name))];
    const get = (list: typeof current, name: string) => list.find((row) => row.name === name)?.value ?? 0;
    const deltas = names.map((name) => ({ name: name.replace(/（.*?）/g, ""), delta: get(current, name) - get(previous, name) }))
      .filter((row) => Math.abs(row.delta) >= 1).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const start = previous.reduce((a, row) => a + row.value, 0), end = current.reduce((a, row) => a + row.value, 0);
    const labels = [`${year - 1} 年`, ...deltas.map((row) => row.name), `${year} 年`];
    const base: (number | string)[] = [0], up: (number | string)[] = ["-"], down: (number | string)[] = ["-"];
    let level = start;
    for (const row of deltas) {
      base.push(row.delta >= 0 ? level : level + row.delta);
      up.push(row.delta >= 0 ? row.delta : "-"); down.push(row.delta < 0 ? -row.delta : "-");
      level += row.delta;
    }
    base.push(0); up.push("-"); down.push("-");
    // The axis starts just below the lowest running total so the changes are readable (the base bars are clipped).
    let low = Math.min(start, end), run = start;
    for (const row of deltas) { run += row.delta; low = Math.min(low, run); }
    const floor = Math.max(0, Math.floor(low * 0.9 / 10000) * 10000);
    const totals = labels.map((_, i) => i === 0 ? start : i === labels.length - 1 ? end : "-");
    return {
      backgroundColor: "transparent",
      tooltip: { ...tooltip(), formatter: (items: { dataIndex: number }[]) => {
        const i = items[0]?.dataIndex ?? 0;
        if (i === 0 || i === labels.length - 1) return `<b>${labels[i]}</b><br/>排放 ${fmt(i === 0 ? start : end, 0)} tCO₂`;
        const d = deltas[i - 1]; return `<b>${d.name}</b><br/>较上年 ${d.delta > 0 ? "+" : ""}${fmt(d.delta, 0)} tCO₂`;
      } },
      legend: legend({ top: 0, right: 0, data: ["增加", "减少"] }),
      grid: { left: 8, right: 12, top: 36, bottom: 6, containLabel: true },
      xAxis: { type: "category", data: labels, ...axis, axisLabel: { ...axis.axisLabel, interval: 0 } },
      yAxis: { type: "value", name: "tCO₂", nameTextStyle: { color: C.muted, align: "left" }, ...axis, min: floor },
      series: [
        { type: "bar", stack: "w", data: base, itemStyle: { color: "transparent" }, emphasis: { disabled: true }, tooltip: { show: false } },
        { name: "总量", type: "bar", stack: "w", data: totals, barMaxWidth: 46, itemStyle: { color: hexA(C.text, 0.28), borderRadius: [8, 8, 0, 0] },
          label: { show: true, position: "top", color: C.text, fontSize: 12, formatter: ({ value }: { value: number }) => fmt(value, 0) } },
        { name: "增加", type: "bar", stack: "w", data: up, barMaxWidth: 46, itemStyle: { color: barFade(C.carbon), borderRadius: 6 },
          label: { show: true, position: "top", color: C.carbon, fontSize: 12, formatter: ({ value }: { value: number }) => `+${fmt(value, 0)}` } },
        { name: "减少", type: "bar", stack: "w", data: down, barMaxWidth: 46, itemStyle: { color: barFade(C.energy), borderRadius: 6 },
          label: { show: true, position: "bottom", color: C.energy, fontSize: 12, formatter: ({ value }: { value: number }) => `−${fmt(value, 0)}` } },
      ],
    };
  }, [previous, current, year]);
  const ref = useChart(option);
  if (!previous.length || !current.length) return <div className="empty"><b>缺少上年排放结构，无法分解变化</b></div>;
  return <div ref={ref} className="chart" role="img" aria-label={`${year - 1} 至 ${year} 年排放变化按能源品种分解`} />;
}

/** Emissions × intensity: enterprises in four quadrants split at the medians; top-right are the first to act on. */
export function EmitterQuadrant({ rows, total }: { rows: { code: string; name: string; value: number; intensity: number | null }[]; total: number | null | undefined }) {
  const points = rows.filter((row) => row.value > 0 && row.intensity != null);
  const option = useMemo(() => {
    const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    const mx = median(points.map((row) => row.value)), my = median(points.map((row) => row.intensity!));
    const hot = (row: (typeof points)[number]) => row.value >= mx && row.intensity! >= my;
    return {
      backgroundColor: "transparent",
      tooltip: { ...tooltip("item"), formatter: ({ data }: { data: { name: string; value: [number, number] } }) =>
        `<b>${data.name}</b><br/>排放 ${fmt(data.value[0], 0)} tCO₂${total ? `（占 ${fmt(data.value[0] / total * 100, 1)}%）` : ""}<br/>单位产值 CO₂ ${fmt(data.value[1], 3)} t/万元` },
      grid: { left: 8, right: 56, top: 28, bottom: 30, containLabel: true },
      xAxis: { type: "log", name: "碳排放 tCO₂（对数）", nameLocation: "middle", nameGap: 30, nameTextStyle: { color: C.muted }, ...axis },
      yAxis: { type: "value", name: "t/万元", nameTextStyle: { color: C.muted, align: "left" }, ...axis },
      series: [{
        type: "scatter",
        // Only the three largest emitters are labelled; the small ones cluster together and are read on hover or in the list.
        data: points.map((row, i) => ({ name: shortName(row.name), value: [row.value, row.intensity], label: { show: i < 3 }, itemStyle: { color: hot(row) ? C.carbon : hexA(C.text, 0.55), shadowBlur: hot(row) ? 16 : 0, shadowColor: hexA(C.carbon, 0.6) } })),
        symbolSize: (value: [number, number]) => 10 + Math.sqrt(value[0] / (points[0]?.value || 1)) * 30,
        label: { show: true, position: "right", color: C.text, fontSize: 12, formatter: ({ name }: { name: string }) => name },
        labelLayout: { hideOverlap: true },
        markLine: { silent: true, symbol: "none", lineStyle: { color: hexA(C.text, 0.22), type: "dashed" }, label: { color: C.muted, fontSize: 11 },
          data: [{ xAxis: mx, label: { formatter: "排放中位", position: "insideEndTop" } }, { yAxis: my, label: { formatter: "强度中位", position: "insideEndTop" } }] },
      }],
    };
  }, [points, total]);
  const ref = useChart(option);
  if (!points.length) return <div className="empty"><b>暂无企业排放与产值数据</b></div>;
  return <div className="quadrant">
    <div ref={ref} className="chart" role="img" aria-label="企业碳排放量与碳强度四象限" />
    <p className="quadrant-note"><i />右上象限：排放量与单位产值排放都高于中位数，优先安排核查与减碳措施。</p>
  </div>;
}

/** Annual emissions quota use, with its original budget amounts and pace warning. */
export function CarbonBudgetGauge({ data, compact = false }: { data: CarbonManagementData | null; compact?: boolean }) {
  const budget = data?.budget.find((row) => row.kind === "carbon");
  const annual = budget?.annual_budget ?? null;
  const actual = budget?.months.reduce((sum, row) => sum + (row.actual ?? 0), 0) ?? 0;
  const pct = annual ? actual / annual * 100 : 0;
  const option = useMemo(() => ({
    backgroundColor: "transparent",
    series: [{
      type: "gauge", startAngle: 210, endAngle: -30, min: 0, max: 120, radius: "92%", center: ["50%", "58%"],
      progress: { show: true, width: compact ? 10 : 18, roundCap: true, itemStyle: { color: pct > 100 ? C.danger : C.carbon } },
      axisLine: { roundCap: true, lineStyle: { width: compact ? 10 : 18, color: [[100 / 120, hexA(C.text, 0.08)], [1, hexA(C.danger, 0.18)]] } },
      axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { distance: compact ? -26 : -46, color: C.muted, fontSize: compact ? 9 : 11, formatter: (v: number) => (v % 20 === 0 ? `${v}%` : "") },
      pointer: { show: false }, anchor: { show: false }, title: { show: false },
      detail: { offsetCenter: [0, "4%"], fontSize: compact ? 26 : 40, fontWeight: 600, color: C.text, formatter: (v: number) => `${fmt(v, 1)}%` },
      data: [{ value: Math.round(pct * 10) / 10 }],
    }],
  }), [pct, compact]);
  const ref = useChart(option);
  if (annual == null) return <div className="empty"><b>本年度未录入排放预算</b></div>;
  const over = budget!.months.filter((row) => row.cumulative != null && row.budget_cumulative != null && row.cumulative > row.budget_cumulative).length;
  return <div className={`viz-stack carbon-budget${compact ? " compact" : ""}`}>
    <StatStrip items={[{ label: "年度排放预算", value: annual, unit: "tCO₂" }, { label: "累计排放", value: actual, unit: "tCO₂", tone: "carbon" },
      { label: actual > annual ? "超出预算" : "剩余额度", value: Math.abs(annual - actual), unit: "tCO₂", tone: actual > annual ? "bad" : undefined }]} />
    <div ref={ref} className="chart gauge" role="img" aria-label={`排放预算使用 ${fmt(pct, 1)}%`} />
    <p className="gauge-note">{over ? `${over} 个月的累计排放高于预算进度` : "全年累计排放均在预算进度内"}</p>
  </div>;
}

// ---------- Carbon asset tab ----------

/** Annual park exposure; enterprise totals already appear in the emissions view. */
export function ExposureView({ asset, year }: { asset: CarbonAsset | null; year: number }) {
  const park = (asset?.rows || []).filter((row) => row.node_code === "XYEDZ");
  const now = park.find((row) => row.year === year);
  const option = useMemo(() => ({
    backgroundColor: "transparent", tooltip: tooltip(),
    legend: legend({ top: 0, left: "center", data: ["碳成本敞口（实际排放）", "碳成本敞口（预测排放）", "全国碳市场年均价"] }),
    grid: { left: 8, right: 8, top: 52, bottom: 6, containLabel: true },
    xAxis: { type: "category", data: park.map((row) => String(row.year)), ...axis },
    yAxis: [{ type: "value", name: "万元", nameTextStyle: { color: C.muted, align: "left" }, ...axis, splitNumber: 3 },
            { type: "value", name: "元/t", nameTextStyle: { color: C.muted, align: "right" }, ...axis, splitNumber: 3, splitLine: { show: false } }],
    series: [
      { name: "碳成本敞口（实际排放）", type: "bar", stack: "c", barMaxWidth: 40, data: park.map((row) => row.co2_basis === "actual" ? row.cost_wan : "-"), itemStyle: { color: barFade(C.carbon), borderRadius: [8, 8, 0, 0] },
        label: { show: true, position: "top", color: C.text, fontSize: 12, formatter: ({ value }: { value: number }) => fmt(value, 0) } },
      { name: "碳成本敞口（预测排放）", type: "bar", stack: "c", barMaxWidth: 40, data: park.map((row) => row.co2_basis === "forecast" ? row.cost_wan : "-"), itemStyle: { color: hexA(C.carbon, 0.28), borderColor: C.carbon, borderType: "dashed", borderWidth: 1, borderRadius: [8, 8, 0, 0] },
        label: { show: true, position: "top", color: C.muted, fontSize: 12, formatter: ({ value }: { value: number }) => fmt(value, 0) } },
      { name: "全国碳市场年均价", type: "line", yAxisIndex: 1, data: park.map((row) => row.cea_price), smooth: 0.3, symbol: "circle", symbolSize: 7, lineStyle: { color: C.accent, width: 2 }, itemStyle: { color: C.accent }, areaStyle: { color: fade(C.accent, 0.12) } },
    ],
  }), [park]);
  const ref = useChart(option);
  if (!park.length) return <div className="empty"><b>暂无碳成本测算数据</b></div>;
  return <div className="asset-overview">
    <div className="viz-stack">
      <StatStrip items={[{ label: `${year} 年碳成本敞口`, value: now?.cost_wan, unit: "万元", tone: "carbon" }, { label: "全国碳市场年均价", value: now?.cea_price, unit: "元/t", digits: 2 },
        { label: "占园区工业总产值", value: now?.cost_share_of_output_pct, unit: "%", digits: 2 }, { label: "CCER 抵销可节省", value: now?.ccer_saving_wan, unit: "万元", digits: 1 }]} />
      <div ref={ref} className="chart" role="img" aria-label="历年碳成本敞口与碳价" />
      <p className="panel-note">敞口 = 当年碳排放 × 全国碳市场年均价，用于衡量碳价上涨的影响；园区企业目前不在全国碳市场强制履约范围内，不是实际支出。CCER 抵销按应清缴量的 5% 上限测算。</p>
    </div>
  </div>;
}

/** Enterprise gate-to-gate product intensity against reference footprints with the same functional unit. */
export function FootprintView({ comparison }: { comparison: { comparisons: FootprintComparison[]; without: { node_code: string; node_name: string; reason: string }[] } | null }) {
  const list = comparison?.comparisons || [];
  if (!list.length) return <div className="empty"><b>暂无可对标的企业产品</b><p>录入企业产品产量（单一产品）并在后台批准对应的产品碳足迹参考值后，即可对标。</p></div>;
  return <div className="footprint-list">
    {list.map((row) => {
      const refs = row.references.filter((ref) => ref.comparable_unit && ref.ratio_pct != null);
      return <article key={row.node_code}>
        <header><b>{shortName(row.node_name)}</b><span>{row.product}</span>
          <strong className="num">{fmt(row.gate_intensity_kg, 1)}<small>kgCO₂/{row.unit.replace(/^.*\//, "")}</small></strong></header>
        {refs.length ? <ul>{refs.map((ref) => <li key={ref.ref_id}>
          <span title={ref.source}>{ref.product}{ref.boundary ? ` · ${BOUNDARY[ref.boundary] ?? ref.boundary}` : ""}</span>
          <i><u style={{ width: `${Math.min(100, ref.ratio_pct!)}%` }} className={ref.ratio_pct! > 100 ? "over" : ""} /></i>
          <em className="num">{fmt(ref.ratio_pct, 1)}%<small>参考值 {fmt(ref.value, 2)}</small></em>
        </li>)}</ul> : <p className="muted">暂无功能单位相同的参考值</p>}
      </article>;
    })}
    {!!comparison?.without.length && <p className="panel-note">{Object.entries(comparison.without.reduce<Record<string, string[]>>((groups, row) => {
      const reason = row.reason.replace(/（[A-Z_]+）/g, ""); (groups[reason] ||= []).push(shortName(row.node_name)); return groups;
    }, {})).map(([reason, names]) => `${names.length} 家企业${reason}，暂未对标（${names.join("、")}）`).join("；")}。厂内强度只含厂内能源排放，参考值多为“摇篮到大门”，比例用于找差距，不直接判优劣。</p>}
  </div>;
}

/** Reduction measures valued at the carbon price: the yearly carbon-cost each measure avoids, largest first. */
export function ReductionValue({ plans, price, exposure }: { plans: CarbonManagementData["plans"]; price: number | null | undefined; exposure: number | null | undefined }) {
  const rows = plans.filter((row) => row.co2_reduction_t).map((row) => ({ ...row, value: price ? row.co2_reduction_t! * price / 1e4 : null }))
    .sort((a, b) => (b.co2_reduction_t ?? 0) - (a.co2_reduction_t ?? 0));
  if (!rows.length) return <div className="empty"><b>本年度暂无减排策略测算</b></div>;
  const total = rows.reduce((a, row) => a + (row.co2_reduction_t ?? 0), 0), totalValue = price ? total * price / 1e4 : null;
  const top = rows[0].co2_reduction_t || 1;
  return <div className="viz-stack">
    <StatStrip items={[{ label: "策略减排潜力合计", value: total, unit: "tCO₂/年", tone: "energy" }, { label: "按碳价折算", value: totalValue, unit: "万元/年", digits: 1, tone: "carbon" },
      { label: "相当于当年敞口", value: totalValue != null && exposure ? totalValue / exposure * 100 : null, unit: "%", digits: 1 }]} />
    <ol className="value-list">{rows.map((row, i) => <li key={i}>
      <span className="num">{String(i + 1).padStart(2, "0")}</span>
      <div><b>{row.strategy}</b><small>{shortName(row.node)}</small></div>
      <i><u style={{ width: `${(row.co2_reduction_t ?? 0) / top * 100}%` }} /></i>
      <strong className="num">{fmt(row.co2_reduction_t, 0)}<small>tCO₂</small></strong>
      <em className="num">{row.value != null ? `${fmt(row.value, 1)} 万元` : "—"}</em>
    </li>)}</ol>
    <p className="panel-note">同一企业的多项策略可能重叠，合计为上限。录入各策略的投资与运行成本后，可按“每吨减排成本”生成边际减排成本曲线，并在预算内选出减排最多的组合。</p>
  </div>;
}
