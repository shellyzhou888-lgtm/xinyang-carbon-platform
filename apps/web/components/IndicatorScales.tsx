"use client";

import { motion, useReducedMotion } from "motion/react";
import type { IndicatorBoardRow } from "@xinyang/db-agent";
import { formatNumber as fmt } from "@/lib/workspace";
import { IconCheck } from "./icons";

const ease = [0.22, 1, 0.36, 1] as const;
const digits = (v: number) => (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2);

/** Year-by-year trend as an inline line; the last point is emphasised. `large` uses a wider canvas with value labels. */
function Trend({ series, large = false, unit, compact = false }: { series: { year: number; value: number | null }[]; large?: boolean; unit?: string | null; compact?: boolean }) {
  const pts = series.filter((p): p is { year: number; value: number } => p.value != null);
  if (pts.length < 2) return null;
  const W = large ? 360 : 120, H = large ? compact ? 76 : 130 : 34, top = large ? compact ? 18 : 22 : 4, bottom = large ? 18 : 4;
  const min = Math.min(...pts.map((p) => p.value)), max = Math.max(...pts.map((p) => p.value));
  const x = (i: number) => 8 + (i / (pts.length - 1)) * (W - 16), y = (v: number) => H - bottom - (max === min ? (H - top - bottom) / 2 : ((v - min) / (max - min)) * (H - top - bottom));
  const line = pts.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  return <svg className="ind-trend" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
    {large && <polygon points={`${x(0)},${H - bottom} ${line} ${x(pts.length - 1)},${H - bottom}`} fill="currentColor" fillOpacity={0.12} />}
    <polyline points={line} fill="none" stroke="currentColor" strokeWidth={large ? 2 : 1.8} strokeLinejoin="round" strokeLinecap="round" />
    {pts.map((p, i) => <g key={p.year}>
      {(large || i === pts.length - 1) && <circle cx={x(i)} cy={y(p.value)} r={i === pts.length - 1 ? 3.5 : 2.5} fill="currentColor" />}
      {large && <text x={x(i)} y={y(p.value) - 8} textAnchor={i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"} className="ind-trend-value">{fmt(p.value, digits(p.value))}</text>}
      <text x={x(i)} y={H - 2} textAnchor={i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"} className="ind-trend-year">{p.year}</text>
    </g>)}
    {large && unit && !compact && <text x={W - 8} y={10} textAnchor="end" className="ind-trend-year">{unit}</text>}
  </svg>;
}

/**
 * Indicator scales: the current value on a bar with the leading value marked. An indicator that meets its leading
 * value gets a check; one that does not is shown the same way without any status wording. Indicators without a
 * leading value show their five-year trend; indicators without statistics show their definition.
 */
export function IndicatorScales({ rows, year, columns = 2, grouped = false, large = false, showTrend = false, compact = false }: { rows: IndicatorBoardRow[]; year: number; columns?: 1 | 2 | 3; grouped?: boolean; large?: boolean; showTrend?: boolean; compact?: boolean }) {
  const reduce = useReducedMotion();
  const groups = grouped ? [...new Set(rows.map((r) => r.group ?? "其他"))] : [""];
  return <div className={`ind-board${large ? " lg" : ""}${compact ? " compact" : ""}`}>
    {groups.map((g) => <section key={g || "all"} className="ind-group">
      {grouped && <h3 className="ind-group-title">{g}<small>{rows.filter((r) => (r.group ?? "其他") === g).length} 项</small></h3>}
      <div className={`ind-grid cols-${columns}`}>
        {rows.filter((r) => !grouped || (r.group ?? "其他") === g).map((r, i) => {
          const lower = r.comparator === "<=" || r.comparator === "<";
          const hasBench = r.benchmark != null && r.value != null;
          const top = hasBench ? Math.max(Math.abs(r.value!), Math.abs(r.benchmark!)) * 1.25 || 1 : 1;
          const pos = (v: number) => `${Math.max(0, Math.min(100, (v / top) * 100))}%`;
          return <motion.article key={r.code} className={`ind-card${r.achieved ? " met" : ""}`} title={r.definition ?? r.name}
            initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i, duration: 0.4, ease }}>
            <header><span className="ind-code num">{r.code}</span><b>{r.name}</b>{compact && <small className="ind-year">{year} 年</small>}{r.achieved && <i className="ind-met" aria-label="达到引领值"><IconCheck size={13} /></i>}</header>
            <div className={compact && hasBench ? "ind-current-row" : "ind-current-block"}>
            <div className="ind-value"><strong className="num">{r.value != null ? fmt(r.value, digits(r.value)) : "—"}</strong>{r.unit && <small>{r.unit}</small>}{!compact && <span>{year} 年</span>}</div>
            {hasBench ? <div className="ind-scale" aria-label={`当前 ${fmt(r.value, 2)}，引领值 ${lower ? "≤" : "≥"} ${fmt(r.benchmark, 2)}`}>
              <div className="ind-track">
                <motion.i className="ind-fill" initial={reduce ? false : { width: 0 }} animate={{ width: pos(r.value!) }} transition={{ duration: 0.9, ease }} />
                <span className="ind-bench" style={{ left: pos(r.benchmark!) }}><em>引领值 {lower ? "≤" : "≥"} {fmt(r.benchmark, digits(r.benchmark!))}</em></span>
              </div>
            </div> : r.series.some((p) => p.value != null) ? <div className="ind-trend-wrap"><Trend series={r.series} large={large} unit={r.unit} compact={compact} /><small>{r.direction === "negative" ? "数值越低越好，" : r.direction === "positive" ? "数值越高越好，" : ""}近年变化</small></div>
              : <p className="ind-def">{r.definition || "按年度统计"}</p>}
            </div>
            {hasBench && showTrend && r.series.filter(p => p.year <= year && p.value != null).length >= 2 && <div className="ind-trend-wrap">
              <Trend series={r.series.filter(p => p.year <= year)} large={large} unit={r.unit} compact={compact} />{!compact && <small>截至 {year} 年的变化</small>}
            </div>}
          </motion.article>;
        })}
      </div>
    </section>)}
  </div>;
}
