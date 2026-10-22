"use client";

import { useMemo } from "react";
import * as echarts from "echarts/core";
import { MarkPointComponent } from "echarts/components";
import { motion, useReducedMotion } from "motion/react";
import type { LcaSummary, ProductChain } from "@xinyang/db-agent";
import { formatNumber as fmt } from "@/lib/workspace";
import { axis, C, hexA, legend, tooltip } from "@/lib/chart-theme";
import { useChart } from "./EnergyCharts";
import { StatStrip } from "./ProgressViz";

echarts.use([MarkPointComponent]);

const ease = [0.22, 1, 0.36, 1] as const;
/** One colour per lifecycle phase, shared by the chart, the phase bar and the stage list. */
const PHASE: Record<string, string> = { 原料获取: "#5cc8ff", 运输: "#9b87ff", 园区生产: "#ffab3d", 包装: "#2ee8a5", 分销: "#d4f75c" };
const phaseColor = (phase: string) => PHASE[phase] ?? "#9aa3ad";
const kg = (v: number) => fmt(v, v >= 100 ? 0 : v >= 10 ? 1 : v >= 1 ? 2 : 3);
/** Product photos (AI-generated photorealistic illustrations, see 产品图片说明.md), matched by milestone product name. */
const PRODUCT_IMAGE: [RegExp, string][] = [[/刨花板/, "/products/straw-board.webp"], [/衣柜/, "/products/wardrobe.webp"], [/LED|芯片|晶圆/, "/products/led-wafer.webp"], [/背光/, "/products/backlight-module.webp"]];
const productImage = (name: string) => PRODUCT_IMAGE.find(([re]) => re.test(name))?.[1];
const SOURCE: Record<string, string> = { tiangong: "天工 LCI · Brightway", park_factor: "园区核算因子", park_enterprise: "园区企业排放" };

/**
 * Carbon trajectory: each stage lifts the running total (waterfall bars coloured by phase) and the line traces the
 * cumulative footprint along the chain; the shaded bands mark production inside the park.
 */
function TrajectoryChart({ chain }: { chain: ProductChain }) {
  const option = useMemo(() => {
    const labels = chain.stages.map((s) => s.name.replace(/^.+? · /, ""));
    const base = chain.stages.map((s) => s.cumulative - s.kgco2e);
    const parkBands = chain.stages.map((s, i) => s.phase === "园区生产" ? [{ xAxis: i - 0.45, itemStyle: { color: hexA(C.carbon, 0.07) } }, { xAxis: i + 0.45 }] : null).filter(Boolean);
    const milestoneMarks = chain.milestones.map((m) => {
      const i = chain.stages.findIndex((s) => s.code === m.after_stage);
      return { coord: [i, m.cumulative_kgco2e], value: `${m.product} ${kg(m.cumulative_kgco2e)}` };
    });
    return {
      backgroundColor: "transparent",
      tooltip: { ...tooltip(), formatter: (items: { dataIndex: number }[]) => {
        const s = chain.stages[items[0]?.dataIndex ?? 0];
        return `<b>${s.name}</b><br/>${s.phase} · ${fmt(s.amount, 4)} ${s.unit} × ${fmt(s.factor_value, 4)} ${s.factor_unit ?? ""}<br/>本阶段 ${kg(s.kgco2e)} kgCO₂e · 累计 ${kg(s.cumulative)} kgCO₂e`;
      } },
      legend: legend({ top: 0, right: 0, data: ["累计碳足迹"] }),
      grid: { left: 8, right: 16, top: 40, bottom: 4, containLabel: true },
      xAxis: { type: "category", data: labels, ...axis, axisLabel: { ...axis.axisLabel, interval: 0, fontSize: 11, formatter: (v: string) => v.length > 7 ? `${v.slice(0, 7)}\n${v.slice(7, 14)}` : v } },
      yAxis: { type: "value", name: "kgCO₂e", nameTextStyle: { color: C.muted, align: "left" }, ...axis },
      series: [
        { type: "bar", stack: "t", data: base, itemStyle: { color: "transparent" }, emphasis: { disabled: true }, tooltip: { show: false },
          markArea: { silent: true, data: parkBands, label: { show: false } } },
        { type: "bar", stack: "t", barMaxWidth: 40, data: chain.stages.map((s) => ({ value: s.kgco2e, itemStyle: { color: phaseColor(s.phase), borderRadius: 6 } })),
          label: { show: true, position: "top", color: C.text, fontSize: 11, formatter: ({ value }: { value: number }) => value >= chain.total * 0.02 ? `+${kg(value)}` : "" } },
        { name: "累计碳足迹", type: "line", data: chain.stages.map((s) => s.cumulative), step: "end", symbol: "circle", symbolSize: 6,
          lineStyle: { color: C.text, width: 1.6, type: "dashed" }, itemStyle: { color: C.text },
          markPoint: { symbol: "roundRect", symbolSize: [10, 10], itemStyle: { color: C.accent }, data: milestoneMarks,
            label: { show: true, position: "top", distance: 26, color: C.accent, fontSize: 12, fontWeight: 600, backgroundColor: hexA(C.surface, 0.85), padding: [3, 6], borderRadius: 6, formatter: ({ value }: { value: string }) => value } } },
      ],
    };
  }, [chain]);
  const ref = useChart(option);
  return <div ref={ref} className="chart" role="img" aria-label={`${chain.name}碳轨迹`} />;
}

/** One industry chain: milestones and phase shares, the trajectory chart, and every stage with its data source. */
export function ChainTrajectory({ chain }: { chain: ProductChain }) {
  const reduce = useReducedMotion();
  const phases = Object.entries(chain.stages.reduce<Record<string, number>>((acc, s) => { acc[s.phase] = (acc[s.phase] ?? 0) + s.kgco2e; return acc; }, {}))
    .sort((a, b) => b[1] - a[1]);
  const park = chain.stages.filter((s) => s.phase === "园区生产").reduce((a, s) => a + s.kgco2e, 0);
  const route = chain.stages.filter((s) => s.phase === "园区生产").map((s) => s.name.split(" · ")[0]);
  return <div className="trajectory">
    <div className="trajectory-top">
      <div className="trajectory-products">
        {chain.milestones.map((m, i) => <motion.div key={m.after_stage} className="milestone" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 * i, duration: 0.4, ease }}>
          {productImage(m.product) ? <img className="milestone-photo" src={productImage(m.product)} alt={m.product} loading="lazy" /> : <span className="milestone-step num">{String(i + 1).padStart(2, "0")}</span>}
          <div><span className="milestone-index num">{String(i + 1).padStart(2, "0")}</span><b>{m.product}</b><small>{m.per}</small></div>
          <strong className="num">{kg(m.cumulative_kgco2e)}<small>kgCO₂e</small></strong>
        </motion.div>)}
        <div className="milestone-route">{route.join(" → ")}<small>园区内流转</small></div>
      </div>
      <div className="trajectory-summary">
        <StatStrip items={[{ label: `碳足迹 · ${chain.functional_unit.replace(/（.*$/, "")}`, value: chain.total, unit: "kgCO₂e", digits: chain.total >= 10 ? 1 : 2, tone: "carbon" },
          { label: "园区生产占比", value: chain.total ? park / chain.total * 100 : null, unit: "%", digits: 1 }]} />
        <div className="phase-bar" role="img" aria-label="各环节占比">{phases.map(([p, v]) => <i key={p} style={{ width: `${v / (chain.total || 1) * 100}%`, background: phaseColor(p) }} title={`${p} ${kg(v)} kgCO₂e`} />)}</div>
        <ul className="phase-legend">{phases.map(([p, v]) => <li key={p}><i style={{ background: phaseColor(p) }} />{p}<b className="num">{fmt(v / (chain.total || 1) * 100, 1)}%</b></li>)}</ul>
      </div>
    </div>
    <TrajectoryChart chain={chain} />
    <ol className="stage-list">{chain.stages.map((s) => <li key={s.code} style={{ ["--phase" as string]: phaseColor(s.phase) }} title={s.note ?? ""}>
      <span className="stage-phase">{s.phase}</span>
      <div className="stage-name"><b>{s.name}</b><small>{fmt(s.amount, 4)} {s.unit} × {fmt(s.factor_value, 4)} {s.factor_unit}</small></div>
      <span className="stage-source">{s.factor_kind === "tiangong" && s.factor_basis?.includes("严格版") ? "天工 LCI · 严格版" : SOURCE[s.factor_kind]}<small>{s.factor_kind === "tiangong" ? s.process_name : s.factor_basis}</small></span>
      <strong className="num">{kg(s.kgco2e)}<small>{fmt(s.kgco2e / (chain.total || 1) * 100, 1)}%</small></strong>
    </li>)}</ol>
  </div>;
}

/** How the background data is obtained: TianGong coverage and, for each process used, Brightway vs TianGong's strict value. */
export function LcaMethod({ lca, rule }: { lca: LcaSummary; rule: string | null }) {
  return <div className="lca-method">
    <StatStrip items={[{ label: "天工 LCI 过程", value: lca.processes, unit: "个" }, { label: "供应链完整闭合", value: lca.complete, unit: "个", tone: "energy" },
      { label: "中国地区过程", value: lca.china, unit: "个" }, { label: "本页引用", value: lca.used.length, unit: "个", tone: "carbon" }]} />
    <ol className="method-steps">
      <li><b>导入</b><span>天工 LCI 20261019 版全部过程与投入产出，记入数据导入批次</span></li>
      <li><b>链接</b><span>投入按“中国 → 省级 → 全球”匹配生产过程，无生产者的投入截断并记录闭合程度</span></li>
      <li><b>计算</b><span>Brightway 2.5 组装技术矩阵，一次分解后求出每个过程的摇篮到大门足迹（IPCC GWP100）</span></li>
      <li><b>组合</b><span>产业链各阶段：用量 × 背景因子；园区生产段用企业范围一+二排放 ÷ 产量</span></li>
    </ol>
    {rule && <p className="panel-note">取值规则：{rule}。</p>}
    <div className="table-scroll"><table><thead><tr><th>天工过程</th><th>地区 · 年份</th><th>功能单位</th><th>闭合</th><th className="num">Brightway</th><th className="num">天工严格版</th></tr></thead>
      <tbody>{lca.used.map((p) => <tr key={p.process_code}><td>{p.name}</td><td>{p.region} · {p.year}</td><td>{p.functional_unit}</td>
        <td>{p.closure === "complete" ? "完整" : p.closure === "partial" ? "部分" : "无上游"}</td>
        <td className="num">{fmt(p.brightway, 4)}</td><td className="num">{fmt(p.strict, 4)}</td></tr>)}</tbody></table></div>
  </div>;
}
