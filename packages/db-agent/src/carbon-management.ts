import { readOnly } from "./db.js";

/**
 * Data for the carbon-management features that need migration 0025 (targets, roadmap, carbon market, product
 * footprint, strategy recommendations, storage and EV charging). Read-only. Returns empty sections, not errors,
 * when 0025 has not been applied yet, so pages can show “暂无数据”.
 */
export interface CarbonManagementData {
  available: boolean;
  year: number;
  targets: { kind: string; year: number; value: number; unit: string; basis: string | null; estimated: boolean }[];
  budget: { kind: "energy" | "carbon"; annual_budget: number | null; months: { month: string; actual: number | null; cumulative: number | null;
            budget_cumulative: number | null }[] }[];
  roadmap: { run_id: number | null; scenarios: { code: string; label: string | null; peak_year: number | null; peak_co2_t: number | null;
             points: { year: number; tce: number; co2_t: number }[] }[]; actual: { year: number; tce: number; co2_t: number }[] };
  carbon_price: { market: string; name: string; latest: { date: string; price: number | null } | null;
                  monthly: { month: string; avg_price: number | null; volume_t: number | null }[] }[];
  footprint_refs: { product: string; functional_unit: string; value: number; unit: string; boundary: string | null; data_year: number | null;
                    nodes: string[]; source: string; url: string | null; status: string }[];
  plans: { alert: string; severity: string; node: string; strategy: string; category: string; tce_saving: number | null;
           co2_reduction_t: number | null; simulated: boolean }[];
  storage: { month: string; ev_charge_kwh: number | null; storage_charge_kwh: number | null; storage_discharge_kwh: number | null }[];
}

export function getCarbonManagementData(year: number, profile = "GIP_2026", nodeCode = "XYEDZ"): Promise<CarbonManagementData> {
  return readOnly(async (c) => {
    const empty: CarbonManagementData = { available: false, year, targets: [], budget: [], roadmap: { run_id: null, scenarios: [], actual: [] },
                                          carbon_price: [], footprint_refs: [], plans: [], storage: [] };
    const ok = (await c.query(`select to_regclass('fact.target') is not null and to_regclass('fact.carbon_market_price') is not null as ok`)).rows[0].ok;
    if (!ok) return empty;

    const targets = (await c.query(`
      select t.target_kind kind, t.year, t.value::float value, t.unit, t.basis, t.data_source = 'estimated' estimated
        from fact.target t join core.org_node n using (node_id)
       where n.code = $1 and t.is_current and t.scenario_code = 'plan' order by t.target_kind, t.year`, [nodeCode])).rows;

    const budget = [];
    for (const [kind, metric, target] of [["energy", "ENG_TCE", "energy_budget_tce"], ["carbon", "CO2_TOTAL", "carbon_budget_t"]] as const) {
      const annual = targets.find((t) => t.kind === target && t.year === year)?.value ?? null;
      const months = (await c.query(`
        select to_char(m, 'YYYY-MM') as month, round(engine.energy_metric($1, n.node_id, m::date, m::date, $2), 1)::float as actual
          from core.org_node n, generate_series(make_date($3, 1, 1), make_date($3, 12, 1), interval '1 month') m
         where n.code = $4 order by m`, [metric, profile, year, nodeCode])).rows;
      let cum = 0;
      budget.push({ kind, annual_budget: annual, months: months.map((r, i) => {
        cum = r.actual == null ? cum : cum + r.actual;
        return { month: r.month, actual: r.actual, cumulative: r.actual == null ? null : Math.round(cum * 10) / 10,
                 budget_cumulative: annual == null ? null : Math.round(annual * (i + 1) / 12 * 10) / 10 };
      }) });
    }

    const run = (await c.query(`
      select r.run_id, r.params from fact.calc_run r
       where r.run_type = 'forecast' and r.status = 'succeeded' and r.params ->> 'model' = 'scenario-roadmap'
       order by r.run_id desc limit 1`)).rows[0];
    const scenarios = [];
    if (run) {
      const pts = (await c.query(`
        select f.scenario_code code, extract(year from f.period_month)::int as year,
               max(f.value) filter (where f.target_kind = 'energy_tce')::float tce, max(f.value) filter (where f.target_kind = 'co2_t')::float co2_t
          from fact.forecast f where f.run_id = $1 group by 1, 2 order by 1, 2`, [run.run_id])).rows;
      for (const code of [...new Set(pts.map((p) => p.code))]) {
        const s = run.params?.scenarios?.[code] ?? {};
        scenarios.push({ code, label: s.label ?? null, peak_year: s.peak_year ?? null, peak_co2_t: s.peak_co2_t ?? null,
                         points: pts.filter((p) => p.code === code).map(({ year, tce, co2_t }) => ({ year, tce, co2_t })) });
      }
    }
    const actual = (await c.query(`
      select y as year, round(engine.metric_value('ENG_TCE', n.node_id, y, $2), 1)::float tce, round(engine.metric_value('CO2_TOTAL', n.node_id, y, $2), 1)::float co2_t
        from core.org_node n cross join generate_series(2021, $3::int) y where n.code = $1 order by y`, [nodeCode, profile, year])).rows
      .filter((r) => r.tce != null);

    const carbon_price = [];
    for (const m of (await c.query(`select code, name from core.carbon_market order by code`)).rows) {
      const latest = (await c.query(`
        select trade_date::text date, coalesce(close_price, avg_price)::float price from fact.carbon_market_price
         where market_code = $1 and is_current order by trade_date desc limit 1`, [m.code])).rows[0] ?? null;
      const monthly = (await c.query(`
        select to_char(trade_date, 'YYYY-MM') as month,
               round(coalesce(sum(turnover_yuan) / nullif(sum(volume_t), 0), avg(coalesce(close_price, avg_price))), 2)::float avg_price,
               sum(volume_t)::float volume_t
          from fact.carbon_market_price where market_code = $1 and is_current group by 1 order by 1`, [m.code])).rows;
      carbon_price.push({ market: m.code, name: m.name, latest, monthly });
    }

    const footprint_refs = (await c.query(`
      select product_name product, functional_unit, value::float, unit, boundary, data_year, applicable_nodes nodes,
             source_title source, source_url url, status
        from core.product_footprint_ref where is_current and status <> 'retired' order by product_name, value`)).rows;

    const plans = (await c.query(`
      select a.message alert, a.severity, n.name node, s.name strategy, s.category, p.expected_tce_saving::float tce_saving,
             (p.params ->> 'expected_co2_reduction_t')::float co2_reduction_t, coalesce((p.params ->> 'simulated_parameters')::boolean, false) simulated
        from fact.strategy_plan p join fact.alert_event a using (alert_id) join core.strategy s using (strategy_id)
        join core.org_node n on n.node_id = p.node_id
       where a.status = 'open' and extract(year from a.period_start) = $1
       order by coalesce((p.params ->> 'expected_co2_reduction_t')::float, 0) desc limit 30`, [year])).rows;

    const storage = (await c.query(`
      select to_char(s.period_start, 'YYYY-MM') as month,
             max(s.value) filter (where s.metric_code = 'ENG_EV_CHARGE')::float ev_charge_kwh,
             max(s.value) filter (where s.metric_code = 'ENG_STORAGE_CHARGE')::float storage_charge_kwh,
             max(s.value) filter (where s.metric_code = 'ENG_STORAGE_DISCHARGE')::float storage_discharge_kwh
        from fact.statistic_value s
       where s.is_current and s.period_type = 'month' and extract(year from s.period_start) = $1
         and s.metric_code in ('ENG_EV_CHARGE','ENG_STORAGE_CHARGE','ENG_STORAGE_DISCHARGE')
       group by 1 order by 1`, [year])).rows;

    return { available: true, year, targets, budget, roadmap: { run_id: run?.run_id ? Number(run.run_id) : null, scenarios, actual },
             carbon_price, footprint_refs, plans, storage };
  });
}
