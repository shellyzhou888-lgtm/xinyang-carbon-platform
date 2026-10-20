import { readOnly } from "./db.js";

/**
 * Data for the dashboard charts (ECharts on the web page). Read-only, current versions only.
 *   monthly    park energy (tce, net = consumption + receive − send_out) and CO2 (one profile) per month
 *   forecast   latest forecast run per target (fact.forecast), with 10–90 % interval
 *   structure  energy use by energy type in the selected year (tce)
 *   ranking    enterprises by energy use in the selected year, with intensity (tce / 万元 output)
 */
export interface ChartData {
  year: number;
  profile: string;
  monthly: { month: string; tce: number; co2_t: number | null; estimated_share: number }[];
  forecast: { target: "energy_tce" | "co2_t"; model: string | null; run_id: number; created: string;
              points: { month: string; value: number; lower: number | null; upper: number | null }[] }[];
  structure: { name: string; tce: number }[];
  ranking: { code: string; name: string; tce: number; output_wan: number | null; intensity: number | null }[];
}

export function getChartData(year: number, profile = "GIP_2026", nodeCode = "XYEDZ"): Promise<ChartData> {
  return readOnly(async (c) => {
    const monthly = (await c.query(`
      with nodes as (select engine.accounting_nodes(node_id) as node_id from core.org_node where code = $1),
      e as (select a.period_month m,
                   sum(case a.flow when 'send_out' then -a.tce when 'consumption' then a.tce when 'receive' then a.tce else 0 end) tce,
                   coalesce(sum(a.tce) filter (where a.data_source in ('estimated','interpolated')), 0) / nullif(sum(a.tce), 0) est
              from fact.energy_activity a where a.is_current and a.node_id in (select node_id from nodes) group by 1),
      k as (select period_month m, sum(co2_t) co2 from fact.carbon_emission
             where is_current and profile_code = $2 and node_id in (select node_id from nodes) group by 1)
      select to_char(e.m, 'YYYY-MM') as month, round(e.tce, 2)::float as tce, round(k.co2, 2)::float as co2_t,
             round(coalesce(e.est, 0), 3)::float as estimated_share
        from e left join k using (m) order by e.m`, [nodeCode, profile])).rows;

    const runs = (await c.query(`
      select distinct on (f.target_kind) f.target_kind as target, f.run_id, r.params ->> 'model' as model, r.finished_at::text as created
        from fact.forecast f join fact.calc_run r using (run_id) join core.org_node n on n.node_id = f.node_id
       where n.code = $1 and f.scenario_code = 'baseline' and r.status = 'succeeded'
       order by f.target_kind, f.run_id desc`, [nodeCode])).rows;
    const forecast = [];
    for (const run of runs) {
      const points = (await c.query(`
        select to_char(f.period_month, 'YYYY-MM') as month, round(f.value, 2)::float as value,
               round(f.lower_bound, 2)::float as lower, round(f.upper_bound, 2)::float as upper
          from fact.forecast f join core.org_node n on n.node_id = f.node_id
         where f.run_id = $1 and n.code = $2 and f.target_kind = $3 and f.scenario_code = 'baseline' order by f.period_month`,
        [run.run_id, nodeCode, run.target])).rows;
      forecast.push({ ...run, run_id: Number(run.run_id), points });
    }

    const structure = (await c.query(`
      with nodes as (select engine.accounting_nodes(node_id) as node_id from core.org_node where code = $1)
      select t.name, round(sum(case a.flow when 'send_out' then -a.tce when 'consumption' then a.tce when 'receive' then a.tce else 0 end), 1)::float as tce
        from fact.energy_activity a join core.energy_type t on t.code = a.energy_type_code
       where a.is_current and a.node_id in (select node_id from nodes) and extract(year from a.period_month) = $2
       group by t.name having sum(a.tce) > 0 order by 2 desc`, [nodeCode, year])).rows;

    const ranking = (await c.query(`
      select n.code, n.name,
             round(engine.metric_value('ENG_TCE', n.node_id, $1, $2), 1)::float as tce,
             engine.stat_value('ECO_GROSS_OUTPUT', n.node_id, $1, '')::float as output_wan
        from core.org_node n where n.node_type = 'enterprise' and n.is_active`, [year, profile])).rows
      .filter((r) => r.tce != null && r.tce > 0)
      .map((r) => ({ ...r, intensity: r.output_wan ? Number((r.tce / r.output_wan).toFixed(4)) : null }))
      .sort((a, b) => b.tce - a.tce);

    return { year, profile, monthly, forecast, structure, ranking };
  });
}
