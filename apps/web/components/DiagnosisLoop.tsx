"use client";

import Link from "next/link";
import { useMemo } from "react";
import * as echarts from "echarts/core";
import { MarkLineComponent } from "echarts/components";
import { motion, useReducedMotion } from "motion/react";
import type { DiagnosisLoop as Loop, LoopFinding } from "@xinyang/db-agent";
import { formatNumber as fmt } from "@/lib/workspace";
import { axis, barFade, C, hexA, legend, tooltip } from "@/lib/chart-theme";
import { useChart } from "./EnergyCharts";
import { StatStrip } from "./ProgressViz";
import { LOOP_STEPS, type LoopStep } from "@/lib/diagnosis-loop";

echarts.use([MarkLineComponent]);

const ease = [0.22, 1, 0.36, 1] as const;

const DIMENSION: Record<string, string> = { total: "总量", intensity: "强度", structure: "结构", indicator: "指标与数据" };
const CATEGORY: Record<string, string> = { clean_energy: "清洁能源", green_power: "绿电交易", efficiency: "能效提升", waste_heat: "余热回收", management: "运行管理", process: "工艺优化", electrification: "电气化" };
const SEVERITY: Record<string, string> = { high: "高", warning: "需关注", info: "提示" };

/** The closed loop as five connected steps, each with its key output; the arrow back closes the loop. */
export function LoopBar({ year, active, outputs }: { year: number; active: LoopStep; outputs: Record<LoopStep, string> }) {
  const reduce = useReducedMotion();
  return <nav className="loop-bar" aria-label="诊断闭环">
    <ol>{LOOP_STEPS.map((s, i) => <li key={s.key}>
      <Link href={`/diagnosis?year=${year}&tab=${s.key}`} scroll={false} className={active === s.key ? "on" : ""} aria-current={active === s.key ? "step" : undefined}>
        {active === s.key && <motion.span layoutId="loop-pill" className="loop-pill" transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 34 }} />}
        <span className="loop-no num">{s.no}</span>
        <span className="loop-text"><b>{s.label}</b><small>{s.question}</small><em>{outputs[s.key]}</em></span>
      </Link>
      {i < LOOP_STEPS.length - 1 && <i className="loop-arrow" aria-hidden="true" />}
    </li>)}</ol>
    <p className="loop-return"><span aria-hidden="true">↺</span>策略实施后，下一年度数据导入即按同一规则回到 01 复核，形成闭环</p>
  </nav>;
}

/** One line stating what a step takes in, how it works and what it hands on. */
export function LoopLogic({ input, method, output }: { input: string; method: string; output: string }) {
  return <div className="loop-logic">
    <span><b>输入</b>{input}</span><i aria-hidden="true">→</i>
    <span><b>方法</b>{method}</span><i aria-hidden="true">→</i>
    <span><b>输出</b>{output}</span>
  </div>;
}

/** Rule table and the object × rule matrix (pass / finding / not applicable). */
export function CheckMatrix({ loop }: { loop: Loop }) {
  const reduce = useReducedMotion();
  const entChecks = loop.checks.filter((c) => c.scope === "enterprise"), parkChecks = loop.checks.filter((c) => c.scope === "park");
  const count = (code: string) => loop.findings.filter((f) => f.check === code).length;
  const cell = (r: "pass" | "finding" | "na" | undefined) => r === "finding" ? <span className="cm-bad">!</span> : r === "pass" ? <span className="cm-ok">✓</span> : <span className="cm-na">—</span>;
  const park = loop.matrix.find((m) => m.object === "XYEDZ");
  return <div className="check-matrix">
    <table className="cm-rules"><thead><tr><th>维度</th><th>检查项</th><th>诊断规则</th><th className="num">对象</th><th className="num">发现</th></tr></thead>
      <tbody>{loop.checks.map((c) => <tr key={c.code}><td><span className={`dim d-${c.dimension}`}>{DIMENSION[c.dimension]}</span></td><td>{c.name}</td><td className="muted">{c.rule}</td>
        <td className="num">{c.scope === "park" ? "园区" : `${loop.matrix.length - 1} 家企业`}</td><td className="num"><b className={count(c.code) ? "bad" : "ok"}>{count(c.code)}</b></td></tr>)}</tbody></table>
    <div className="cm-grid" role="table" aria-label="检查矩阵">
      <div className="cm-row cm-head" role="row"><span role="columnheader">对象</span>{entChecks.map((c) => <span key={c.code} role="columnheader">{c.name}</span>)}</div>
      {loop.matrix.filter((m) => m.object !== "XYEDZ").map((m, i) => <motion.div key={m.object} className="cm-row" role="row"
        initial={reduce ? false : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i, duration: 0.3, ease }}>
        <span role="rowheader">{m.objectName}</span>{entChecks.map((c) => <span key={c.code} role="cell">{cell(m.results[c.code])}</span>)}
      </motion.div>)}
      {park && <div className="cm-row cm-park" role="row"><span role="rowheader">园区整体</span>
        {parkChecks.map((c) => <span key={c.code} role="cell" className="cm-park-cell">{cell(park.results[c.code])}<small>{c.name}</small></span>)}</div>}
      <p className="cm-legend"><span className="cm-ok">✓</span>符合　<span className="cm-bad">!</span>发现问题　<span className="cm-na">—</span>缺少数据不检查</p>
    </div>
  </div>;
}

/** Findings grouped by dimension, each with its evidence and the rule that raised it. */
export function FindingList({ findings, checks }: { findings: LoopFinding[]; checks: Loop["checks"] }) {
  const dims = ["total", "intensity", "structure", "indicator"].filter((d) => findings.some((f) => f.dimension === d));
  return <div className="finding-list">{dims.map((d) => <section key={d}>
    <h3><span className={`dim d-${d}`}>{DIMENSION[d]}</span><small>{findings.filter((f) => f.dimension === d).length} 项</small></h3>
    <ul>{findings.filter((f) => f.dimension === d).map((f) => <li key={f.id}>
      <span className={`sev s-${f.severity}`}>{SEVERITY[f.severity]}</span>
      <div><b>{f.objectName} · {f.title}</b><small>{f.evidence}</small><small className="rule">规则：{checks.find((c) => c.code === f.check)?.rule}</small></div>
    </li>)}</ul>
  </section>)}</div>;
}

/** Strategy generation as a traceable chain: finding → category → strategy → calculation → reduction and value. */
export function StrategyChain({ loop }: { loop: Loop }) {
  const total = loop.strategies.reduce((a, s) => a + s.co2Reduction, 0), tce = loop.strategies.reduce((a, s) => a + (s.tceSaving ?? 0), 0);
  const value = loop.strategies.reduce((a, s) => a + (s.valueWan ?? 0), 0);
  return <div className="strategy-chain">
    <StatStrip items={[{ label: "生成策略", value: loop.strategies.length, unit: "条" }, { label: "预计减碳", value: total, unit: "tCO₂/年", tone: "energy" },
      { label: "预计节能", value: tce, unit: "tce/年" }, { label: "按碳价折算", value: value, unit: "万元/年", digits: 1, tone: "carbon" }]} />
    <div className="sc-head" aria-hidden="true"><span>针对的问题</span><span>匹配类别</span><span>策略 · 实施企业</span><span>测算方法</span><span className="num">年减碳</span></div>
    <ol className="sc-list">{loop.strategies.map((s) => <li key={`${s.enterprise}:${s.code}`}>
      <span className="sc-find">{s.findings.map((f) => <small key={f}>{f}</small>)}</span>
      <span className="sc-cat">{CATEGORY[s.category] ?? s.category}</span>
      <span className="sc-name"><b>{s.name}</b><small>{s.enterpriseName}{s.basis ? ` · ${s.basis}` : ""}</small></span>
      <span className="sc-method">{s.method}</span>
      <strong className="num">{fmt(s.co2Reduction, 0)}<small>t</small>{s.valueWan != null && <em>{fmt(s.valueWan, 1)} 万元</em>}</strong>
    </li>)}</ol>
    {loop.gaps.length > 0 && <div className="sc-gaps"><b>策略库待补充</b>{loop.gaps.map((g) => <small key={g}>{g}</small>)}</div>}
  </div>;
}

/** Effect: actual history, next year's baseline and with-strategies value, and the two roadmap scenarios. */
export function EffectView({ loop, history }: { loop: Loop; history: { year: number; co2: number | null }[] }) {
  const e = loop.effect;
  const option = useMemo(() => {
    const years = [...new Set([...history.map((h) => h.year), ...e.roadmap.map((r) => r.year)])].sort();
    const at = (y: number) => years.indexOf(y);
    const actual = years.map((y) => history.find((h) => h.year === y)?.co2 ?? "-");
    const base = years.map((y) => e.roadmap.find((r) => r.year === y)?.base ?? (y === loop.year ? e.co2.actual : "-"));
    const low = years.map((y) => e.roadmap.find((r) => r.year === y)?.low ?? (y === loop.year ? e.co2.actual : "-"));
    const withS = years.map((y) => y === loop.year ? e.co2.actual : y === e.nextYear ? e.withStrategiesCo2 : "-");
    return {
      backgroundColor: "transparent", tooltip: tooltip(),
      legend: legend({ top: 0, left: "center", data: ["实际排放", "基准情景", "低碳情景", "实施本次策略"] }),
      grid: { left: 8, right: 16, top: 40, bottom: 6, containLabel: true },
      xAxis: { type: "category", data: years.map(String), ...axis },
      yAxis: { type: "value", name: "tCO₂", nameTextStyle: { color: C.muted, align: "left" }, ...axis },
      series: [
        { name: "实际排放", type: "bar", data: actual, barMaxWidth: 34, itemStyle: { color: barFade(C.carbon), borderRadius: [6, 6, 0, 0] } },
        { name: "基准情景", type: "line", data: base, smooth: 0.3, symbol: "circle", symbolSize: 6, lineStyle: { color: C.muted, type: "dashed", width: 2 }, itemStyle: { color: C.muted } },
        { name: "低碳情景", type: "line", data: low, smooth: 0.3, symbol: "circle", symbolSize: 6, lineStyle: { color: C.energy, type: "dashed", width: 2 }, itemStyle: { color: C.energy } },
        { name: "实施本次策略", type: "line", data: withS, symbol: "circle", symbolSize: 10, lineStyle: { color: C.accent, width: 3 }, itemStyle: { color: C.accent },
          label: { show: true, position: "bottom", color: C.accent, fontSize: 12, formatter: ({ dataIndex, value }: { dataIndex: number; value: number }) => dataIndex === at(e.nextYear) ? fmt(value, 0) : "" },
          markLine: e.budgetNext ? { silent: true, symbol: "none", lineStyle: { color: hexA(C.danger, 0.7), type: "dotted" }, label: { formatter: `${e.nextYear} 年排放预算`, color: C.muted, position: "insideEndTop" },
            data: [{ yAxis: e.budgetNext }] } : undefined },
      ],
    };
  }, [loop, history, e]);
  const ref = useChart(option);
  const pct = (a: number | null, b: number | null) => a != null && b ? (a - b) / b * 100 : null;
  return <div className="effect-view">
    <div className="effect-compare">
      <div><span>{e.nextYear} 年基准预测</span><strong className="num">{fmt(e.baselineCo2, 0)}<small>tCO₂</small></strong><small>Chronos-2 中位数</small></div>
      <i aria-hidden="true">−</i>
      <div><span>本次策略减碳</span><strong className="num good">{fmt(e.reductionCo2, 0)}<small>tCO₂</small></strong><small>节能 {fmt(e.savingTce, 0)} tce</small></div>
      <i aria-hidden="true">=</i>
      <div className="hi"><span>实施后预计</span><strong className="num">{fmt(e.withStrategiesCo2, 0)}<small>tCO₂</small></strong>
        <small>较 {loop.year} 年 {fmt(pct(e.withStrategiesCo2, e.co2.actual), 1)}%{e.budgetNext ? ` · 预算 ${fmt(e.budgetNext, 0)}` : ""}</small></div>
      <div><span>单位增加值 CO₂</span><strong className="num">{fmt(e.intensityNow, 3)} → {fmt(e.intensityWithStrategies, 3)}<small>t/万元</small></strong><small>按增加值同比增速外推</small></div>
    </div>
    <div ref={ref} className="chart" role="img" aria-label="排放实际、情景与策略效果" />
  </div>;
}
