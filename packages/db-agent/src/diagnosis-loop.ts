import { readOnly } from "./db.js";
import { getEnterpriseEnergyMix } from "./spatial.js";
import { getIndicatorBoard, type IndicatorBoardRow } from "./indicator-board.js";

/**
 * Diagnosis closed loop, computed read-only from the platform data with explicit, documented rules:
 *
 *   01 诊断  every enterprise and the park are checked against fixed rules in four dimensions
 *            (总量 / 强度 / 结构 / 指标与数据); each check is pass or a finding with its evidence and threshold.
 *   02 定位  findings carry the object they concern (enterprise code or the park), for the map.
 *   03 评价  every evaluation indicator against its leading value (getIndicatorBoard).
 *   04 策略  each finding is mapped to strategy categories; strategies from core.strategy that fit the
 *            enterprise's industry are quantified with their parameters (saving_rate × energy, or
 *            carbon_reduction_rate × emissions) and valued at the year's national carbon price.
 *   05 效果  next year's baseline forecast minus the strategy reductions (capped per enterprise), and the
 *            resulting carbon intensity; implemented plans are re-checked when the next year's data arrive.
 */

export type Dimension = "total" | "intensity" | "structure" | "indicator";
export interface LoopCheck { code: string; dimension: Dimension; name: string; rule: string; scope: "park" | "enterprise" }
export interface LoopFinding {
  id: string; check: string; dimension: Dimension; object: string; objectName: string; objectType: "park" | "enterprise";
  title: string; evidence: string; value: number | null; reference: number | null; unit: string; severity: "high" | "warning" | "info";
  categories: string[];
}
export interface LoopStrategy {
  enterprise: string; enterpriseName: string; code: string; name: string; category: string; basis: string;
  findings: string[]; method: string; tceSaving: number | null; co2Reduction: number; valueWan: number | null;
}
export interface DiagnosisLoop {
  year: number;
  checks: LoopCheck[];
  matrix: { object: string; objectName: string; results: Record<string, "pass" | "finding" | "na"> }[];
  findings: LoopFinding[];
  indicators: IndicatorBoardRow[];
  strategies: LoopStrategy[];
  gaps: string[];
  effect: {
    co2: { year: number; actual: number | null }; nextYear: number;
    baselineCo2: number | null; withStrategiesCo2: number | null; reductionCo2: number;
    baselineTce: number | null; withStrategiesTce: number | null; savingTce: number;
    intensityNow: number | null; intensityBaseline: number | null; intensityWithStrategies: number | null;
    budgetNext: number | null; price: number | null;
    roadmap: { year: number; base: number | null; low: number | null }[];
  };
}

export const LOOP_CHECKS: LoopCheck[] = [
  { code: "BUDGET", dimension: "total", name: "排放与用能预算", scope: "park", rule: "园区全年碳排放或综合能耗高于当年预算" },
  { code: "YOY_RISE", dimension: "total", name: "排放同比", scope: "enterprise", rule: "企业全年碳排放同比上升超过 3%" },
  { code: "INTENSITY", dimension: "intensity", name: "单位产值能耗", scope: "enterprise", rule: "企业单位产值能耗高于园区平均 1.5 倍" },
  { code: "GRID_DEPENDENCE", dimension: "structure", name: "外购电依赖", scope: "enterprise", rule: "电网电力排放占企业排放 ≥60%，且绿电（交易 + 自发）占用电量 <30%（园区 2026 年绿电目标 20%，2028 年 30%）" },
  { code: "INDICATOR_GAP", dimension: "indicator", name: "评价指标提升空间", scope: "park", rule: "评价指标当前值未达到引领值" },
  { code: "DATA_GAP", dimension: "indicator", name: "评价指标数据缺口", scope: "park", rule: "评价指标当年没有统计值" },
];

/** Strategy categories that address each check (indicator gaps by indicator code). */
const CHECK_CATEGORIES: Record<string, string[]> = {
  BUDGET: ["efficiency", "waste_heat"], YOY_RISE: ["efficiency"], INTENSITY: ["efficiency", "waste_heat"],
  GRID_DEPENDENCE: ["green_power", "clean_energy"],
};
const INDICATOR_CATEGORIES: Record<string, string[]> = {
  I04: ["efficiency", "waste_heat"], I05: ["clean_energy", "green_power"], I06: ["efficiency"],
  I17: ["green_power", "clean_energy", "efficiency"], I18: ["green_power", "clean_energy"], I19: ["green_power", "efficiency"],
};
/** Industry codes of the electronics enterprises (others belong to the green-home cluster), for strategy applicability. */
const ELECTRONICS_INDUSTRY = new Set(["397", "C39"]);
/** A single enterprise's strategies are capped so overlapping measures do not claim more than this share of its emissions. */
const PER_ENTERPRISE_CAP = 0.35;

const PARK = "XYEDZ";
const short = (name: string) => name.replace(/（[^）]*）/g, "");
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export async function getDiagnosisLoop(year: number, profile = "GIP_2026"): Promise<DiagnosisLoop> {
  const [base, mix, indicators] = await Promise.all([
    readOnly(async (c) => {
      const ents = (await c.query(`
        select code, name, industry_code,
               engine.metric_value('ENG_TCE', node_id, $1, $2)::float tce, engine.metric_value('CO2_TOTAL', node_id, $1, $2)::float co2,
               engine.metric_value('CO2_TOTAL', node_id, $1 - 1, $2)::float co2_prev,
               engine.stat_value('ECO_GROSS_OUTPUT', node_id, $1, '')::float output
          from core.org_node where node_type = 'enterprise' and is_active order by code`, [year, profile])).rows;
      const park = (await c.query(`
        select engine.metric_value('ENG_TCE', node_id, $1, $2)::float tce, engine.metric_value('CO2_TOTAL', node_id, $1, $2)::float co2,
               engine.metric_value('ECO_VA_CONST', node_id, $1, $2)::float va, engine.metric_value('ECO_VA_CONST', node_id, $1 - 1, $2)::float va_prev,
               engine.stat_value('ECO_GROSS_OUTPUT', node_id, $1, '')::float output
          from core.org_node where code = $3`, [year, profile, PARK])).rows[0] ?? {};
      const targets = (await c.query(`
        select target_kind, year, value::float value from fact.target t join core.org_node n using (node_id)
         where t.is_current and n.code = $2 and t.year in ($1, $1 + 1)`, [year, PARK])).rows as { target_kind: string; year: number; value: number }[];
      const strategies = (await c.query(`select code, name, category, coalesce(applicable_category::text, 'all') applicable, parameters from core.strategy order by code`)).rows;
      const forecast = (await c.query(`
        select extract(year from f.period_month)::int y, f.scenario_code, f.target_kind, sum(f.value)::float v
          from fact.forecast f join core.org_node n using (node_id)
         where n.code = $1 and f.run_id in (select max(run_id) from fact.forecast g where g.node_id = f.node_id group by g.scenario_code)
         group by 1, 2, 3`, [PARK])).rows as { y: number; scenario_code: string; target_kind: string; v: number }[];
      const price = (await c.query(`
        select avg(close_price)::float p from fact.carbon_market_price where is_current and market_code = 'CEA' and extract(year from trade_date) = $1`, [year])).rows[0]?.p ?? null;
      return { ents, park, targets, strategies, forecast, price };
    }),
    getEnterpriseEnergyMix(year, profile),
    getIndicatorBoard(year, profile),
  ]);

  const { ents, park, targets, strategies, forecast, price } = base;
  const findings: LoopFinding[] = [];
  const matrix: DiagnosisLoop["matrix"] = [];
  const parkIntensity = park.tce && park.output ? park.tce / park.output : null;
  const add = (f: Omit<LoopFinding, "id">) => { findings.push({ ...f, id: `${f.check}:${f.object}:${findings.length}` }); return "finding" as const; };

  // ---- 01 Park checks ----
  const target = (kind: string, y: number) => targets.find((t) => t.target_kind === kind && t.year === y)?.value ?? null;
  const parkRow: Record<string, "pass" | "finding" | "na"> = {};
  const co2Budget = target("carbon_budget_t", year), tceBudget = target("energy_budget_tce", year);
  if (co2Budget == null && tceBudget == null) parkRow.BUDGET = "na";
  else {
    const over = [co2Budget != null && park.co2 > co2Budget ? `碳排放 ${round(park.co2, 0)} t，超出预算 ${round((park.co2 / co2Budget - 1) * 100)}%` : null,
                  tceBudget != null && park.tce > tceBudget ? `综合能耗 ${round(park.tce, 0)} tce，超出预算 ${round((park.tce / tceBudget - 1) * 100)}%` : null].filter(Boolean);
    parkRow.BUDGET = over.length ? add({ check: "BUDGET", dimension: "total", object: PARK, objectName: "园区整体", objectType: "park", title: "全年排放或用能超出预算",
      evidence: over.join("；"), value: park.co2, reference: co2Budget, unit: "tCO₂", severity: "warning", categories: CHECK_CATEGORIES.BUDGET }) : "pass";
  }
  const gaps: string[] = [];
  let anyGap = false, anyData = false;
  for (const ind of indicators) {
    if (ind.value == null) {
      anyData = true;
      add({ check: "DATA_GAP", dimension: "indicator", object: PARK, objectName: "园区整体", objectType: "park", title: `${ind.code} ${ind.name}：当年无统计值`,
        evidence: ind.definition ? `需按“${ind.definition.slice(0, 40)}”补充统计` : "需补充统计数据", value: null, reference: ind.benchmark, unit: ind.unit ?? "", severity: "info", categories: [] });
      continue;
    }
    if (ind.benchmark == null || ind.achieved !== false) continue;
    anyGap = true;
    const cats = INDICATOR_CATEGORIES[ind.code] ?? [];
    if (!cats.length) gaps.push(`${ind.code} ${ind.name}：策略库暂无对应措施，需补充${/水/.test(ind.name) ? "节水与中水回用" : /土地/.test(ind.name) ? "用地集约与亩均效益提升" : "相应"}类策略`);
    const lower = ind.comparator === "<=" || ind.comparator === "<";
    add({ check: "INDICATOR_GAP", dimension: "indicator", object: PARK, objectName: "园区整体", objectType: "park", title: `${ind.code} ${ind.name}：距引领值仍有提升空间`,
      evidence: `当前 ${round(ind.value, 2)}${ind.unit ?? ""}，引领值 ${lower ? "≤" : "≥"} ${ind.benchmark}${ind.unit ?? ""}`, value: ind.value, reference: ind.benchmark,
      unit: ind.unit ?? "", severity: "warning", categories: cats });
  }
  parkRow.INDICATOR_GAP = anyGap ? "finding" : "pass";
  parkRow.DATA_GAP = anyData ? "finding" : "pass";
  matrix.push({ object: PARK, objectName: "园区整体", results: parkRow });

  // ---- 01 Enterprise checks ----
  const sites = ents.filter((e) => (e.co2 ?? 0) > 0);
  for (const e of sites) {
    const row: Record<string, "pass" | "finding" | "na"> = {};
    const base = { object: e.code, objectName: short(e.name), objectType: "enterprise" as const };
    // Emissions year on year
    if (e.co2_prev) {
      const yoy = (e.co2 - e.co2_prev) / e.co2_prev * 100;
      row.YOY_RISE = yoy > 3 ? add({ ...base, check: "YOY_RISE", dimension: "total", title: "全年碳排放同比上升", evidence: `${round(e.co2_prev, 0)} → ${round(e.co2, 0)} tCO₂，同比 +${round(yoy)}%`,
        value: yoy, reference: 3, unit: "%", severity: yoy > 10 ? "high" : "warning", categories: CHECK_CATEGORIES.YOY_RISE }) : "pass";
    } else row.YOY_RISE = "na";
    // Energy intensity
    const intensity = e.tce && e.output ? e.tce / e.output : null;
    if (intensity != null && parkIntensity) {
      const ratio = intensity / parkIntensity;
      row.INTENSITY = ratio > 1.5 ? add({ ...base, check: "INTENSITY", dimension: "intensity", title: "单位产值能耗偏高", evidence: `${round(intensity, 3)} tce/万元，为园区平均（${round(parkIntensity, 3)}）的 ${round(ratio, 1)} 倍`,
        value: intensity, reference: parkIntensity, unit: "tce/万元", severity: ratio > 2.5 ? "high" : "warning", categories: CHECK_CATEGORIES.INTENSITY }) : "pass";
    } else row.INTENSITY = "na";
    // Grid-electricity dependence
    const m = mix.filter((r) => r.code === e.code);
    const gridCo2 = m.filter((r) => r.carrier === "电网电力").reduce((a, r) => a + r.co2_t, 0);
    const gridTce = m.filter((r) => r.carrier === "电网电力").reduce((a, r) => a + r.tce, 0);
    const greenTce = m.filter((r) => r.carrier === "绿电").reduce((a, r) => a + r.tce, 0);
    const co2All = m.reduce((a, r) => a + r.co2_t, 0);
    if (co2All > 0 && gridTce + greenTce > 0) {
      const gridShare = gridCo2 / co2All, greenShare = greenTce / (gridTce + greenTce);
      row.GRID_DEPENDENCE = gridShare >= 0.6 && greenShare < 0.3 ? add({ ...base, check: "GRID_DEPENDENCE", dimension: "structure", title: "外购电依赖高、绿电比例低",
        evidence: `电网电力排放占 ${round(gridShare * 100)}%，绿电占用电量 ${round(greenShare * 100)}%`, value: greenShare * 100, reference: 30, unit: "%",
        severity: greenShare < 0.2 ? "warning" : "info", categories: CHECK_CATEGORIES.GRID_DEPENDENCE }) : "pass";
    } else row.GRID_DEPENDENCE = "na";
    matrix.push({ ...base, results: row });
  }

  // ---- 04 Strategy generation ----
  const sector = (industry: string | null) => ELECTRONICS_INDUSTRY.has(industry ?? "") ? "electronics" : "green_home";
  const plans = new Map<string, LoopStrategy>();
  const parkFindings = findings.filter((f) => f.objectType === "park" && f.categories.length);
  // Park-level findings are acted on at the three largest emitters (they drive the park totals).
  const lead = [...sites].sort((a, b) => b.co2 - a.co2).slice(0, 3);
  const targetsOf = (f: LoopFinding) => f.objectType === "enterprise" ? sites.filter((s) => s.code === f.object) : lead;
  for (const f of findings.filter((x) => x.categories.length)) {
    for (const e of targetsOf(f)) {
      for (const s of strategies.filter((st) => f.categories.includes(st.category) && (st.applicable === "all" || st.applicable === sector(e.industry_code)))) {
        const p = s.parameters ?? {};
        const key = `${e.code}:${s.code}`;
        const existing = plans.get(key);
        if (existing) { if (!existing.findings.includes(f.title)) existing.findings.push(f.title); continue; }
        let tce: number | null = null, co2 = 0, method = "";
        if (typeof p.saving_rate === "number") {
          tce = e.tce * p.saving_rate; co2 = e.tce ? tce * e.co2 / e.tce : 0;
          method = `综合能耗 ${round(e.tce, 0)} tce × 节能率 ${p.saving_rate * 100}% = ${round(tce, 0)} tce，折 ${round(co2, 0)} tCO₂`;
        } else if (typeof p.carbon_reduction_rate === "number") {
          co2 = e.co2 * p.carbon_reduction_rate;
          method = `碳排放 ${round(e.co2, 0)} t × 减碳率 ${p.carbon_reduction_rate * 100}% = ${round(co2, 0)} tCO₂`;
        } else continue;
        plans.set(key, { enterprise: e.code, enterpriseName: short(e.name), code: s.code, name: s.name, category: s.category, basis: p.basis ?? "",
          findings: [f.title], method, tceSaving: tce == null ? null : round(tce, 1), co2Reduction: round(co2, 1), valueWan: price ? round(co2 * price / 1e4, 1) : null });
      }
    }
  }
  // Overlap cap per enterprise: scale its strategies down if together they exceed the cap.
  const list = [...plans.values()];
  for (const e of sites) {
    const own = list.filter((p) => p.enterprise === e.code), sum = own.reduce((a, p) => a + p.co2Reduction, 0), cap = e.co2 * PER_ENTERPRISE_CAP;
    if (sum > cap && sum > 0) for (const p of own) {
      const k = cap / sum;
      p.co2Reduction = round(p.co2Reduction * k); p.tceSaving = p.tceSaving == null ? null : round(p.tceSaving * k);
      p.valueWan = price ? round(p.co2Reduction * price / 1e4, 1) : null; p.method += `（与同企业其他措施合计按排放 ${PER_ENTERPRISE_CAP * 100}% 封顶，折算 ${round(k * 100, 0)}%）`;
    }
  }
  list.sort((a, b) => b.co2Reduction - a.co2Reduction);
  void parkFindings;

  // ---- 05 Effect ----
  const nextYear = year + 1;
  const fc = (scenario: string, kind: string, y: number) => forecast.find((r) => r.scenario_code === scenario && r.target_kind === kind && r.y === y)?.v ?? null;
  const baselineCo2 = fc("baseline", "co2_t", nextYear), baselineTce = fc("baseline", "energy_tce", nextYear);
  const reductionCo2 = round(list.reduce((a, p) => a + p.co2Reduction, 0), 0), savingTce = round(list.reduce((a, p) => a + (p.tceSaving ?? 0), 0), 0);
  const vaGrowth = park.va && park.va_prev ? park.va / park.va_prev : null;
  const vaNext = park.va && vaGrowth ? park.va * vaGrowth : null;
  const years = [...new Set(forecast.filter((r) => r.scenario_code.startsWith("ROADMAP") && r.target_kind === "co2_t").map((r) => r.y))].sort();
  return {
    year, checks: LOOP_CHECKS, matrix, findings, indicators, strategies: list, gaps,
    effect: {
      co2: { year, actual: park.co2 ?? null }, nextYear,
      baselineCo2, withStrategiesCo2: baselineCo2 == null ? null : round(baselineCo2 - reductionCo2, 0), reductionCo2,
      baselineTce, withStrategiesTce: baselineTce == null ? null : round(baselineTce - savingTce, 0), savingTce,
      intensityNow: park.co2 && park.va ? round(park.co2 / park.va, 3) : null,
      intensityBaseline: baselineCo2 != null && vaNext ? round(baselineCo2 / vaNext, 3) : null,
      intensityWithStrategies: baselineCo2 != null && vaNext ? round((baselineCo2 - reductionCo2) / vaNext, 3) : null,
      budgetNext: target("carbon_budget_t", nextYear), price,
      roadmap: years.map((y) => ({ year: y, base: fc("ROADMAP_BASE", "co2_t", y), low: fc("ROADMAP_LOWCARBON", "co2_t", y) })),
    },
  };
}
