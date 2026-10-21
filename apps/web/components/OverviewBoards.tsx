"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ParkOverview } from "@xinyang/db-agent";
import { formatNumber as fmt } from "@/lib/workspace";
import { HONOR_KINDS, focusEnterprise, honorLevel } from "@/lib/honors";
import type { MapHonor } from "./ParkSpatialOverview";
import { CountUp } from "./MotionParts";
import { Sparkline } from "./EnergyCharts";
import { IconCheck, IconTrophy } from "./icons";
import { HonorIcon } from "./HonorIcons";

const ease = [0.22, 1, 0.36, 1] as const;
export const shortName = (name: string) => name.replace(/（[^）]*）/g, "").replace(/\(.*?\)/g, "");
const change = (value: number | null | undefined, previous: number | null | undefined) => value != null && previous ? (value - previous) / Math.abs(previous) * 100 : null;

function Delta({ value, lowerIsBetter = true }: { value: number | null; lowerIsBetter?: boolean }) {
  if (value == null) return null;
  const good = lowerIsBetter ? value <= 0 : value >= 0;
  return <em className={`kpi-delta ${good ? "good" : "bad"}`} title="与上年相比">{value > 0 ? "▲" : value < 0 ? "▼" : "■"} {fmt(Math.abs(value), 1)}%</em>;
}

/** Honours, one icon per category: the park title first, then each category with its enterprises (click flies the map there). */
export function HonorShowcase({ honors }: { honors: MapHonor[] }) {
  const reduce = useReducedMotion();
  const park = honors.find((honor) => honor.kind === "green_park");
  const groups = HONOR_KINDS.filter((kind) => kind.kind !== "green_park")
    .map((kind) => ({ ...kind, rows: honors.filter((honor) => honor.kind === kind.kind) }))
    .filter((group) => group.rows.length);
  return <section className="brief" aria-label="园区荣誉">
    <div className="float-head"><span className="eyebrow">荣誉认定</span><span className="count-pill">{honors.length} 项</span></div>
    {park && <div className="trophy-hero"><HonorIcon kind="green_park" size={40} /><div><b>{park.title.replace(/^\d{4}\s*年度\s*/, "")}</b><small>{park.title.match(/^\d{4}/)?.[0] ?? ""} 年度 · 河南省工业和信息化厅</small></div></div>}
    <ul className="trophy-list">
      {groups.map((group, index) => <motion.li key={group.kind} initial={reduce ? false : { opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + index * 0.05, duration: 0.45, ease }}>
        <HonorIcon kind={group.kind} size={22} />
        <div className="trophy-body">
          <span className="trophy-name">{group.label}<strong className="num" style={{ color: group.color }}>{group.rows.length}</strong></span>
          <span className="trophy-holders">{group.rows.map((honor, i) => <button key={i} type="button" disabled={!honor.code} onClick={() => focusEnterprise(honor.code)} title={honor.title}>
            {shortName(honor.node)}{honorLevel(honor.title) && <small>{honorLevel(honor.title)}</small>}
          </button>)}</span>
        </div>
      </motion.li>)}
    </ul>
  </section>;
}

type Row = { code: string; name: string; value: number };

/** Energy brief: total with year-on-year change and monthly trend, the source mix and the largest consumers. */
export function EnergyBrief({ year, total, previous, months, structure, leaders }: { year: number; total: number | null | undefined; previous: number | null | undefined; months: (number | null)[]; structure: { name: string; value: number }[]; leaders: Row[] }) {
  const sum = structure.reduce((a, row) => a + row.value, 0);
  const top = leaders[0]?.value || 1;
  return <section className="brief tone-energy" aria-label="能源">
    <div className="float-head"><span className="eyebrow tone-energy">能源 · {year}</span><a className="more-link" href={`/energy?year=${year}`}>能源管理</a></div>
    <div className="brief-figure"><span>综合能耗</span><strong><CountUp value={total} digits={0} /><small>tce</small></strong><Delta value={change(total, previous)} /></div>
    {months.some((v) => v != null) && <Sparkline values={months} color="#2ee8a5" label={`${year}年月度综合能耗`} />}
    <div className="mini-bars">{structure.slice(0, 3).map((row) => <div key={row.name}><span>{row.name}</span><b className="num">{fmt(sum ? row.value / sum * 100 : 0, 1)}%</b><i><em style={{ width: `${sum ? row.value / sum * 100 : 0}%` }} /></i></div>)}</div>
    <ol className="leader-list">{leaders.slice(0, 3).map((row, index) => <li key={row.code}><button type="button" onClick={() => focusEnterprise(row.code)}>
      <span className="num">{index + 1}</span><span>{shortName(row.name)}</span><b className="num">{fmt(row.value, 0)}<small>tce</small></b><i><em style={{ width: `${row.value / top * 100}%` }} /></i>
    </button></li>)}</ol>
  </section>;
}

/** Carbon headline: emissions with year-on-year change and trend, intensity and emissions per unit of energy. */
export function CarbonBrief({ year, total, previous, months, intensity, intensityPrev, perEnergy, structure }: { year: number; total: number | null | undefined; previous: number | null | undefined; months: (number | null)[]; intensity: number | null; intensityPrev: number | null; perEnergy: number | null; structure: { name: string; value: number }[] }) {
  const sum = structure.reduce((a, row) => a + row.value, 0);
  return <section className="brief tone-carbon" aria-label="碳排放">
    <div className="float-head"><span className="eyebrow tone-carbon">碳排 · {year}</span><a className="more-link" href={`/carbon?year=${year}`}>碳排管理</a></div>
    <div className="brief-figure"><span>二氧化碳排放</span><strong><CountUp value={total} digits={0} /><small>tCO₂</small></strong><Delta value={change(total, previous)} /></div>
    {months.some((v) => v != null) && <Sparkline values={months} color="#ffab3d" label={`${year}年月度碳排放`} />}
    <div className="brief-pair">
      <div><span>单位增加值 CO₂</span><strong className="num">{fmt(intensity, 3)}<small>t/万元</small></strong><Delta value={change(intensity, intensityPrev)} /></div>
      <div><span>单位能耗 CO₂</span><strong className="num">{fmt(perEnergy, 2)}<small>t/tce</small></strong></div>
    </div>
    <div className="mini-bars carbon">{structure.slice(0, 3).map((row) => <div key={row.name}><span>{row.name}</span><b className="num">{fmt(sum ? row.value / sum * 100 : 0, 1)}%</b><i><em style={{ width: `${sum ? row.value / sum * 100 : 0}%` }} /></i></div>)}</div>
  </section>;
}

/** Achieved GIP_2026 indicators, each with its value against the leading benchmark (shown on the energy page). */
export function IndicatorBoard({ rows, year }: { rows: ParkOverview["achieved"]; year: number }) {
  const reduce = useReducedMotion();
  if (!rows.length) return null;
  return <section className="indicator-board" aria-label="绿色工业园区达标指标">
    <div className="indicator-headline"><IconTrophy size={34} className="trophy" /><strong className="num">{rows.length}</strong><span>项 GIP_2026 评价指标达到引领值 · {year}</span></div>
    <ol className="indicator-list">
      {rows.map((row, index) => {
        const lower = row.comparator === "<=" || row.comparator === "<";
        const bench = row.benchmark ?? 0;
        // Bar scale: the larger of value and benchmark plus headroom; the tick marks the benchmark.
        const top = Math.max(Math.abs(row.value), Math.abs(bench)) * 1.18 || 1;
        const fill = Math.max(0.04, Math.min(1, Math.max(row.value, 0) / top));
        const tick = Math.min(1, Math.abs(bench) / top);
        return <motion.li key={row.code} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + index * 0.05, duration: 0.45, ease }}>
          <span className="indicator-check"><IconCheck /></span>
          <div className="indicator-body">
            <div className="indicator-row"><span className="indicator-name">{row.name}</span><strong className="num">{fmt(row.value, 2)}<small>{row.unit || ""}</small></strong></div>
            <div className="indicator-bar" aria-hidden="true">
              <motion.i initial={reduce ? false : { scaleX: 0 }} animate={{ scaleX: fill }} transition={{ delay: 0.25 + index * 0.05, duration: 0.9, ease }} />
              <b style={{ left: `${tick * 100}%` }} />
            </div>
            <small className="indicator-bench">引领值 {lower ? "≤" : "≥"} {fmt(bench, 2)}{row.unit || ""}</small>
          </div>
        </motion.li>;
      })}
    </ol>
  </section>;
}

export interface EmitterRow { code: string; name: string; sector: string; value: number; previous: number | null; monthly: (number | null)[]; intensity: number | null }

/** 12-point trend as an inline SVG (no chart instance per row). */
function MiniTrend({ values, color }: { values: (number | null)[]; color: string }) {
  const points = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null);
  if (points.length < 2) return <svg className="mini-trend" viewBox="0 0 72 20" aria-hidden="true" />;
  const min = Math.min(...points.map((p) => p[1])), max = Math.max(...points.map((p) => p[1]));
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * 70 + 1;
  const y = (v: number) => 18 - (max === min ? 8 : ((v - min) / (max - min)) * 16);
  const line = points.map(([i, v]) => `${x(i)},${y(v)}`).join(" ");
  return <svg className="mini-trend" viewBox="0 0 72 20" aria-hidden="true">
    <polyline points={`${x(points[0][0])},20 ${line} ${x(points[points.length - 1][0])},20`} fill={color} fillOpacity={0.16} stroke="none" />
    <polyline points={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
  </svg>;
}

/** Largest emitters: rank medal, zone, emissions and share, monthly trend, year-on-year change and intensity. */
export function EmitterRanking({ total, rows, year }: { total: number | null | undefined; rows: EmitterRow[]; year: number }) {
  const reduce = useReducedMotion();
  const top3 = rows.slice(0, 3).reduce((a, row) => a + row.value, 0);
  return <section className="brief tone-carbon" aria-label="重点排放企业排名">
    <div className="float-head"><span className="eyebrow tone-carbon">重点排放企业 · {year}</span>{total ? <span className="count-pill carbon">前三占 {fmt(top3 / total * 100, 1)}%</span> : null}</div>
    <ol className="emitter-list">{rows.slice(0, 5).map((row, index) => {
      const yoy = change(row.value, row.previous);
      const share = total ? row.value / total * 100 : 0;
      return <motion.li key={row.code} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 + index * 0.05, duration: 0.4, ease }}>
        <button type="button" onClick={() => focusEnterprise(row.code)}>
          <span className={`rank-medal r${index + 1}`}>{index + 1}</span>
          <span className="emitter-title"><b>{shortName(row.name)}</b>{row.sector && <em>{row.sector}</em>}</span>
          <strong className="emitter-value num">{fmt(row.value, 0)}<small>tCO₂</small></strong>
          <span className="emitter-meta">
            <MiniTrend values={row.monthly} color={index < 3 ? "#ffab3d" : "#9b87ff"} />
            <small title="占园区碳排放">占 {fmt(share, 1)}%</small>
            {yoy != null && <small className={yoy <= 0 ? "good" : "bad"} title="与上年相比">{yoy > 0 ? "▲" : "▼"}{fmt(Math.abs(yoy), 1)}%</small>}
            {row.intensity != null && <small className="muted" title="单位产值 CO₂">{fmt(row.intensity, 3)} t/万元</small>}
          </span>
        </button>
      </motion.li>;
    })}</ol>
  </section>;
}
