"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { ParkOverview } from "@xinyang/db-agent";
import { formatNumber as fmt } from "@/lib/workspace";
import { FLOW_EVENT, HONOR_KINDS, focusEnterprise, honorLevel, type HonorKind } from "@/lib/honors";
import type { FlowEnterprise, FlowMode, MapHonor } from "./ParkSpatialOverview";
import { IconAward, IconCheck } from "./icons";

const ease = [0.22, 1, 0.36, 1] as const;

/** Achieved GIP_2026 indicators, each with its value against the leading benchmark. */
export function IndicatorBoard({ rows, year }: { rows: ParkOverview["achieved"]; year: number }) {
  const reduce = useReducedMotion();
  return <section className="indicator-board" aria-label="绿色工业园区达标指标">
    <div className="float-head"><span className="eyebrow">绿色工业园区 · 达标情况</span><span className="eyebrow muted">{year}</span></div>
    <div className="park-title-badge"><IconAward /><div><b>河南省省级绿色工业园区</b><small>2024 年度 · 河南省工业和信息化厅</small></div></div>
    <div className="indicator-headline"><strong className="num">{rows.length}</strong><span>项评价指标<br />达到引领值</span></div>
    <ol className="indicator-list">
      {rows.map((row, index) => {
        const lower = row.comparator === "<=" || row.comparator === "<";
        const bench = row.benchmark ?? 0;
        // Bar scale: the larger of value and benchmark plus headroom; the tick marks the benchmark.
        const top = Math.max(Math.abs(row.value), Math.abs(bench)) * 1.18 || 1;
        const fill = Math.max(0.04, Math.min(1, Math.max(row.value, 0) / top));
        const tick = Math.min(1, Math.abs(bench) / top);
        return <motion.li key={row.code} initial={reduce ? false : { opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + index * 0.06, duration: 0.5, ease }}>
          <span className="indicator-check"><IconCheck /></span>
          <div className="indicator-body">
            <div className="indicator-row"><span className="indicator-name">{row.name}</span><strong className="num">{fmt(row.value, 2)}<small>{row.unit || ""}</small></strong></div>
            <div className="indicator-bar" aria-hidden="true">
              <motion.i initial={reduce ? false : { scaleX: 0 }} animate={{ scaleX: fill }} transition={{ delay: 0.3 + index * 0.06, duration: 0.9, ease }} />
              <b style={{ left: `${tick * 100}%` }} />
            </div>
            <small className="indicator-bench">引领值 {lower ? "≤" : "≥"} {fmt(bench, 2)}{row.unit || ""}</small>
          </div>
        </motion.li>;
      })}
    </ol>
  </section>;
}

/** Honour counts by category (green factory, zero-carbon factory …) with the holders; a name flies the map to it. */
export function HonorBoard({ honors }: { honors: MapHonor[] }) {
  const groups = HONOR_KINDS.filter((kind) => kind.kind !== "green_park")
    .map((kind) => ({ ...kind, rows: honors.filter((honor) => honor.kind === kind.kind) }))
    .filter((group) => group.rows.length);
  return <section aria-label="绿色制造与荣誉">
    <div className="float-head"><span className="eyebrow">绿色制造 · 荣誉认定</span><span className="achieved-count">{honors.length} 项</span></div>
    <div className="honor-grid">
      {groups.map((group) => <div key={group.kind} className="honor-tile" style={{ ["--tone" as string]: group.color }}>
        <div className="honor-tile-head"><i aria-hidden="true" /><span>{group.label}</span><strong className="num">{group.rows.length}</strong></div>
        <div className="honor-holders">{group.rows.map((honor, index) => <button key={index} type="button" disabled={!honor.code} onClick={() => focusEnterprise(honor.code)} title={honor.title}>
          {shortName(honor.node)}{honorLevel(honor.title) && <em>{honorLevel(honor.title)}</em>}
        </button>)}</div>
      </div>)}
    </div>
  </section>;
}

/** Enterprise ranking by energy or CO2; switching the tab also switches the map's flow layer. */
export function EnterpriseRanking({ rows }: { rows: FlowEnterprise[] }) {
  const [mode, setMode] = useState<Exclude<FlowMode, "off">>("energy");
  useEffect(() => {
    const sync = (event: Event) => { const next = (event as CustomEvent<FlowMode>).detail; if (next !== "off") setMode(next); };
    window.addEventListener(FLOW_EVENT, sync);
    return () => window.removeEventListener(FLOW_EVENT, sync);
  }, []);
  const choose = (next: Exclude<FlowMode, "off">) => { setMode(next); window.dispatchEvent(new CustomEvent(FLOW_EVENT, { detail: next })); };
  const valueOf = (row: FlowEnterprise) => (mode === "energy" ? row.tce : row.co2_t) ?? 0;
  const sorted = [...rows].filter((row) => valueOf(row) > 0).sort((a, b) => valueOf(b) - valueOf(a));
  const total = sorted.reduce((sum, row) => sum + valueOf(row), 0);
  return <section aria-label="重点企业排行">
    <div className="float-head">
      <span className="eyebrow">重点企业{mode === "energy" ? "能耗" : "碳排放"}排行</span>
      <nav className="mini-switch" aria-label="排行口径">
        <button type="button" aria-pressed={mode === "energy"} onClick={() => choose("energy")}>能流</button>
        <button type="button" aria-pressed={mode === "carbon"} onClick={() => choose("carbon")}>碳流</button>
      </nav>
    </div>
    <ol className={`rank-list tone-${mode}`}>
      {sorted.map((row, index) => <li key={row.code}>
        <button type="button" onClick={() => focusEnterprise(row.code)}>
          <span className="rank-no num">{String(index + 1).padStart(2, "0")}</span>
          <span className="rank-name">{shortName(row.name)}</span>
          <span className="rank-value num">{fmt(valueOf(row), 0)}<small>{mode === "energy" ? "tce" : "tCO₂"}</small></span>
          <span className="rank-share num">{total ? fmt((valueOf(row) / total) * 100, 1) : "—"}%</span>
          <span className="rank-bar" aria-hidden="true"><i style={{ width: `${(valueOf(row) / (valueOf(sorted[0]) || 1)) * 100}%` }} /></span>
        </button>
      </li>)}
    </ol>
  </section>;
}

export const shortName = (name: string) => name.replace(/（[^）]*）/g, "").replace(/\(.*?\)/g, "");
export type { HonorKind };
