"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { CarbonManagementData, EnterpriseMonthly } from "@xinyang/db-agent";
import { formatNumber as fmt } from "@/lib/workspace";
import ComparisonChart from "./ComparisonChart";
import { C } from "@/lib/chart-theme";

const ease = [0.22, 1, 0.36, 1] as const;
type Tone = "energy" | "carbon";
const shortName = (name: string) => name.replace(/（[^）]*）/g, "").replace(/\(.*?\)/g, "");

/** Headline figures separated by hairlines: "target | completed | remaining". */
export function StatStrip({ items }: { items: { label: string; value: number | null | undefined; unit?: string; digits?: number; tone?: Tone | "bad" }[] }) {
  return <div className="stat-strip">{items.map((item) => <div key={item.label} className={item.tone ? `tone-${item.tone}` : ""}>
    <strong className="num">{fmt(item.value, item.digits ?? 0)}{item.unit && <small>{item.unit}</small>}</strong>
    <span><i />{item.label}</span>
  </div>)}</div>;
}

/**
 * Capsule columns: each column fills to `fill` (0–100) with a round badge on the fill top; the empty part is hatched.
 * Used for shares (composition) and progress against a budget.
 */
export function CapsuleColumns({ columns, tone = "energy", caption }: {
  columns: { key: string; label: string; sub?: string; fill: number; badge: string; over?: boolean; muted?: boolean }[]; tone?: Tone; caption?: string;
}) {
  const reduce = useReducedMotion();
  return <figure className={`capsules ${tone}`}>
    <div className="capsule-row">{columns.map((col, i) => {
      const fill = Math.max(10, Math.min(100, col.fill));
      return <div key={col.key} className={`capsule${col.over ? " over" : ""}${col.muted ? " muted" : ""}${fill < 32 ? " low" : ""}`} title={`${col.label}${col.sub ? ` · ${col.sub}` : ""} · ${col.badge}`}>
        <div className="capsule-track">
          <motion.i className="capsule-fill" style={{ ["--i" as string]: i }} initial={reduce ? false : { height: "0%" }} animate={{ height: `${fill}%` }} transition={{ delay: 0.08 * i, duration: 0.9, ease }}>
            <span className="capsule-badge num">{col.badge}</span>
          </motion.i>
        </div>
        <b>{col.label}</b>{col.sub && <small>{col.sub}</small>}
      </div>;
    })}</div>
    {caption && <figcaption>{caption}</figcaption>}
  </figure>;
}

/** Composition as capsules: the largest item fills the column, each badge shows its share. */
export function CompositionCapsules({ rows, unit, tone = "energy", showAll = false }: { rows: { name: string; value: number }[]; unit: string; tone?: Tone; showAll?: boolean }) {
  const ranked = [...rows].filter((row) => row.value > 0).sort((a, b) => b.value - a.value).slice(0, showAll ? undefined : 5);
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0), max = ranked[0]?.value || 1;
  if (!ranked.length) return <div className="empty"><b>暂无可展示数据</b></div>;
  return <div className="viz-stack">
    <StatStrip items={[
      { label: "合计", value: total, unit },
      { label: "品种", value: rows.filter((row) => row.value > 0).length, unit: "类", tone },
      { label: `${ranked[0].name}占比`, value: total ? ranked[0].value / total * 100 : null, unit: "%", digits: 1 },
    ]} />
    <CapsuleColumns tone={tone} caption="各品种折算后的量与占比"
      columns={ranked.map((row) => ({ key: row.name, label: showAll ? row.name : row.name.replace(/（.*?）/g, ""), sub: `${fmt(row.value, 0)} ${unit}`, fill: row.value / max * 100, badge: `${fmt(total ? row.value / total * 100 : 0, 1)}%` }))} />
  </div>;
}

/**
 * Budget progress: quarterly use against a quarter of the annual budget as capsules, next to the cumulative curve.
 * Over-budget quarters turn amber.
 */
export function BudgetProgress({ data, kind }: { data: CarbonManagementData | null; kind: Tone }) {
  const budget = data?.budget.find((row) => row.kind === kind), unit = kind === "energy" ? "tce" : "tCO₂";
  if (budget?.annual_budget == null) return <div className="empty"><b>本年度未录入预算</b></div>;
  const annual = budget.annual_budget;
  const actual = budget.months.reduce((sum, row) => sum + (row.actual ?? 0), 0);
  const quarters = [0, 1, 2, 3].map((q) => {
    const months = budget.months.filter((row) => Math.floor((Number(row.month.slice(5)) - 1) / 3) === q);
    const used = months.reduce((sum, row) => sum + (row.actual ?? 0), 0), share = used / (annual / 4) * 100;
    return { key: `Q${q + 1}`, label: `第${"一二三四"[q]}季度`, sub: `${fmt(used, 0)} ${unit}`, fill: share, badge: `${fmt(share, 0)}%`, over: share > 100, muted: !months.some((row) => row.actual != null) };
  });
  const over = budget.months.filter((row) => row.cumulative != null && row.budget_cumulative != null && row.cumulative > row.budget_cumulative).length;
  return <div className="budget-progress">
    <div className="viz-stack">
      <StatStrip items={[
        { label: "年度预算", value: annual, unit },
        { label: "累计实际", value: actual, unit, tone: kind },
        { label: actual > annual ? "超出预算" : "剩余额度", value: Math.abs(annual - actual), unit, tone: actual > annual ? "bad" : undefined },
      ]} />
      <CapsuleColumns tone={kind} columns={quarters} caption={over ? `${over} 个月累计进度高于预算（超过 100% 的季度改用警示色）` : "季度用量占季度预算（年度预算 ÷ 4）"} />
    </div>
    <div className="budget-curve">
      <ComparisonChart labels={budget.months.map((row) => `${Number(row.month.slice(5))}月`)} unit={unit} label="累计实际与预算比较"
        series={[{ name: "累计实际", values: budget.months.map((row) => row.cumulative), color: kind === "energy" ? C.energy : C.carbon }, { name: "累计预算", values: budget.months.map((row) => row.budget_cumulative), color: "var(--text-3)", dashed: true }]} />
    </div>
  </div>;
}

/**
 * Enterprise × month status matrix. "同比" compares each month with the same month a year earlier (down ≥ 3 % green,
 * within ±3 % yellow, up > 3 % red); "月度负荷" compares each month with the enterprise's own monthly average
 * (≥ 8 % below green, within ±8 % yellow, ≥ 8 % above red), which shows peak and low months. No data is grey.
 */
export function EnterpriseMatrix({ current, previous, metric, unit, year }: { current: EnterpriseMonthly[]; previous: EnterpriseMonthly[]; metric: "tce" | "co2_t"; unit: string; year: number }) {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<"yoy" | "load">(previous.length ? "yoy" : "load");
  const key = (code: string, m: number) => `${code}|${m}`;
  const now = new Map(current.map((row) => [key(row.code, Number(row.month.slice(5))), row[metric]]));
  const before = new Map(previous.map((row) => [key(row.code, Number(row.month.slice(5))), row[metric]]));
  const names = new Map(current.map((row) => [row.code, row.name]));
  const rows = [...names.entries()].map(([code, name]) => {
    const values = Array.from({ length: 12 }, (_, i) => now.get(key(code, i + 1)) ?? null);
    const known = values.filter((v): v is number => v != null), mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
    const cells = values.map((a, i) => {
      const b = before.get(key(code, i + 1)) ?? null;
      const change = mode === "yoy" ? (a != null && b ? (a - b) / Math.abs(b) * 100 : null) : (a != null && mean ? (a - mean) / mean * 100 : null);
      const band = mode === "yoy" ? 3 : 8;
      return { a, b, change, state: a == null ? "none" : change == null ? "flat" : change <= -band ? "down" : change >= band ? "up" : "flat" };
    });
    const total = known.reduce((a, b) => a + b, 0), totalPrev = cells.reduce((sum, cell) => sum + (cell.b ?? 0), 0);
    return { code, name: shortName(name), cells, total, change: totalPrev ? (total - totalPrev) / totalPrev * 100 : null };
  }).filter((row) => row.total > 0).sort((a, b) => b.total - a.total);
  const ups = rows.reduce((n, row) => n + row.cells.filter((cell) => cell.state === "up").length, 0);
  const tracked = rows.reduce((n, row) => n + row.cells.filter((cell) => cell.state !== "none").length, 0);
  if (!rows.length) return <div className="empty"><b>暂无企业逐月数据</b></div>;
  const legend = mode === "yoy" ? ["同比下降", "基本持平", "同比上升"] : ["低于月均", "接近月均", "高于月均"];
  return <div className="matrix">
    <div className="matrix-head">
      <span className="matrix-legend"><i className="down" />{legend[0]}<i className="flat" />{legend[1]}<i className="up" />{legend[2]}<i className="none" />无数据</span>
      <span className="matrix-tools">
        <span className="matrix-summary"><b className="num">{ups}</b> / {tracked} 个企业月{mode === "yoy" ? "同比上升" : "高于自身月均"}</span>
        <span className="matrix-mode" role="group" aria-label="比较方式">
          <button type="button" className={mode === "yoy" ? "on" : ""} aria-pressed={mode === "yoy"} disabled={!previous.length} onClick={() => setMode("yoy")}>同比上年</button>
          <button type="button" className={mode === "load" ? "on" : ""} aria-pressed={mode === "load"} onClick={() => setMode("load")}>月度负荷</button>
        </span>
      </span>
    </div>
    <div className="matrix-grid" role="table" aria-label={`${year} 年企业逐月${mode === "yoy" ? "同比" : "负荷"}矩阵`} style={{ ["--rows" as string]: rows.length }}>
      <div className="matrix-row matrix-months" role="row"><span role="columnheader" />{Array.from({ length: 12 }, (_, i) => <span key={i} role="columnheader">{i + 1}月</span>)}<span role="columnheader">全年 / 同比</span></div>
      {rows.map((row, r) => <div className="matrix-row" role="row" key={row.code}>
        <span className="matrix-name" role="rowheader" title={row.name}>{row.name}</span>
        {row.cells.map((cell, i) => <motion.i key={`${mode}-${i}`} role="cell" className={`matrix-cell ${cell.state}`}
          title={`${row.name} ${i + 1}月：${fmt(cell.a, 0)} ${unit}${mode === "yoy" && cell.b != null ? `，上年同月 ${fmt(cell.b, 0)}` : ""}${cell.change != null ? `，${mode === "yoy" ? "同比" : "较自身月均"} ${cell.change > 0 ? "+" : ""}${fmt(cell.change, 1)}%` : ""}`}
          initial={reduce ? false : { opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.012 * (r * 12 + i), duration: 0.3, ease }} />)}
        <span className="matrix-total num">{fmt(row.total, 0)}<small>{unit}</small>{row.change != null && <em className={row.change <= 0 ? "good" : "bad"}>{row.change > 0 ? "▲" : "▼"}{fmt(Math.abs(row.change), 1)}%</em>}</span>
      </div>)}
    </div>
  </div>;
}
