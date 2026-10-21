"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ParkOverview } from "@xinyang/db-agent";
import { formatNumber as fmt } from "@/lib/workspace";
import { HONOR_KINDS, focusEnterprise } from "@/lib/honors";
import type { MapHonor } from "./ParkSpatialOverview";
import { CountUp } from "./MotionParts";
import { Sparkline } from "./EnergyCharts";
import { IconCheck } from "./icons";
import { HonorIcon } from "./HonorIcons";

const ease = [0.22, 1, 0.36, 1] as const;
export const shortName = (name: string) => name.replace(/（[^）]*）/g, "").replace(/\(.*?\)/g, "");
const change = (value: number | null | undefined, previous: number | null | undefined) => value != null && previous ? (value - previous) / Math.abs(previous) * 100 : null;

function Delta({ value, lowerIsBetter = true }: { value: number | null; lowerIsBetter?: boolean }) {
  if (value == null) return null;
  const good = lowerIsBetter ? value <= 0 : value >= 0;
  return <em className={`kpi-delta ${good ? "good" : "bad"}`} title="与上年相比">{value > 0 ? "▲" : value < 0 ? "▼" : "■"} {fmt(Math.abs(value), 1)}%</em>;
}

const HONOR_PHRASES: Record<string, string> = {
  green_factory: "获评绿色工厂", zero_carbon: "获评零碳工厂", smart_factory: "入选5G工厂",
  little_giant: "入选专精特新小巨人", high_tech: "认定高新技术企业", cluster: "入选特色产业集群",
};

/** The park award leads; six concise achievement types follow in two columns. */
export function HonorShowcase({ honors, achieved = [], year }: { honors: MapHonor[]; achieved?: ParkOverview["achieved"]; year?: number }) {
  const reduce = useReducedMotion();
  const park = honors.find((honor) => honor.kind === "green_park");
  const groups = HONOR_KINDS.filter((kind) => kind.kind !== "green_park" && honors.some((honor) => honor.kind === kind.kind));
  return <section className="brief" aria-label="园区荣誉">
    {year != null && achieved.length > 0 && <IndicatorBoard rows={achieved} year={year} />}
    {park && <div className="trophy-hero"><HonorIcon kind="green_park" size={25} /><b>2024 年度获评河南省省级绿色工业园区</b></div>}
    <ul className="honor-rows">
      {groups.map((group, index) => {
        const holders = honors.filter((honor) => honor.kind === group.kind);
        return <motion.li key={group.kind} style={{ ["--honor" as string]: group.color }} title={holders.map((honor) => shortName(honor.node)).join("、")}
          initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + index * 0.04, duration: 0.4, ease }}>
          <span className="honor-badge"><HonorIcon kind={group.kind} size={16} /></span>
          <span className="honor-phrase">{HONOR_PHRASES[group.kind]}</span>
          <b className="honor-count num">{holders.length}<small>{group.kind === "cluster" ? "项" : "家"}</small></b>
        </motion.li>;
      })}
    </ul>
  </section>;
}

type Row = { code: string; name: string; value: number };

/** Energy brief: total with year-on-year change and monthly trend, the source mix and the largest consumers. */
export function EnergyBrief({ year, total, previous, months, structure, leaders }: { year: number; total: number | null | undefined; previous: number | null | undefined; months: (number | null)[]; structure: { name: string; value: number }[]; leaders: Row[] }) {
  const sum = structure.reduce((a, row) => a + row.value, 0);
  const top = leaders[0]?.value || 1;
  return <section className="brief tone-energy" aria-label="能源">
    <div className="float-head"><span className="brief-tag energy">能源</span><a className="more-link" href={`/energy?year=${year}`}>能源管理</a></div>
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
    <div className="float-head"><span className="brief-tag carbon">碳排</span><a className="more-link" href={`/carbon?year=${year}`}>碳排管理</a></div>
    <div className="brief-figure"><span>二氧化碳排放</span><strong><CountUp value={total} digits={0} /><small>tCO₂</small></strong><Delta value={change(total, previous)} /></div>
    {months.some((v) => v != null) && <Sparkline values={months} color="#ffab3d" label={`${year}年月度碳排放`} />}
    <div className="brief-pair">
      <div><span>单位增加值 CO₂</span><strong className="num">{fmt(intensity, 3)}<small>t/万元</small></strong><Delta value={change(intensity, intensityPrev)} /></div>
      <div><span>单位能耗 CO₂</span><strong className="num">{fmt(perEnergy, 2)}<small>t/tce</small></strong></div>
    </div>
    <div className="mini-bars carbon">{structure.slice(0, 3).map((row) => <div key={row.name}><span>{row.name}</span><b className="num">{fmt(sum ? row.value / sum * 100 : 0, 1)}%</b><i><em style={{ width: `${sum ? row.value / sum * 100 : 0}%` }} /></i></div>)}</div>
  </section>;
}

const INDICATOR_SHORT: Record<string, string> = {
  I03: "高新产值", I09: "固废利用", I10: "工业绿建", I11: "公共绿建", I15: "废水强度", I16: "污染弹性",
};

/** Compact overview marker: a large achieved count, with short names and values for quick scanning. */
export function IndicatorBoard({ rows, year }: { rows: ParkOverview["achieved"]; year: number }) {
  const reduce = useReducedMotion();
  if (!rows.length) return null;
  return <section className="indicator-board glass" aria-label={`${year} 年绿色工业园区评价达标指标`}>
    <div className="indicator-hero">
      <strong className="indicator-count"><CountUp value={rows.length} digits={0} /><small>项达到绿色工业园区<br />评价要求 2026 年指标</small></strong>
    </div>
    <ol className="indicator-summary-list">
      {rows.map((row, index) => <motion.li key={row.code} title={`${row.name} · 引领值 ${row.comparator === "<=" || row.comparator === "<" ? "≤" : "≥"} ${fmt(row.benchmark, 2)}${row.unit || ""}`}
        initial={reduce ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 + index * 0.04, duration: 0.35, ease }}>
        <IconCheck size={15} className="indicator-tick" /><span>{INDICATOR_SHORT[row.code] ?? (row.name.length > 8 ? `${row.name.slice(0, 8)}…` : row.name)}</span>
        <strong className="num">{fmt(row.value, 2)}<small>{row.unit || ""}</small></strong>
      </motion.li>)}
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
    <div className="float-head"><span className="brief-tag carbon">重点排放企业</span>{total ? <span className="count-pill carbon">前三占 {fmt(top3 / total * 100, 1)}%</span> : null}</div>
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
