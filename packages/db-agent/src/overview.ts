import { readOnly } from "./db.js";

export interface ParkOverview {
  year: number;
  profile: string;
  tce: number | null;
  co2_t: number | null;
  value_added_wan: number | null;
  energy_estimated_share: number | null;
  indicators: { total: number; achieved: number; not_achieved: number; no_benchmark: number; pending: number; score: number };
  achieved: { code: string; name: string; unit: string | null; value: number; benchmark: number | null; comparator: string | null; estimated_share: number }[];
  honors: { node: string; title: string }[];
}

/** Headline numbers for the dashboard and the voice “直达” tool. Read-only. */
export function getParkOverview(year: number, profile = "GIP_2026", nodeCode = "XYEDZ"): Promise<ParkOverview> {
  return readOnly(async (c) => {
    const totals = (await c.query(`
      select round(engine.metric_value('ENG_TCE', node_id, $1, $2), 1)::float as tce,
             round(engine.metric_value('CO2_TOTAL', node_id, $1, $2), 1)::float as co2_t,
             round(engine.metric_value('ECO_VA_CONST', node_id, $1, $2), 1)::float as value_added_wan,
             round(engine.inputs_estimated_share(array['ENG_TCE'], node_id, $1, 0), 3)::float as energy_estimated_share
        from core.org_node where code = $3`, [year, profile, nodeCode])).rows[0] ?? {};
    const ind = (await c.query(`
      select d.code, d.name, d.unit, v.value::float as value, b.value::float as benchmark, b.comparator,
             v.achieved, v.score::float as score, v.estimated_share::float as estimated_share
        from core.indicator_def d
        join core.standard_version sv on sv.version_id = d.version_id
        left join (select iv.* from fact.indicator_value iv join core.org_node n using (node_id)
                    where iv.is_current and n.code = $3 and iv.period_start = make_date($1, 1, 1)) v on v.indicator_id = d.indicator_id
        left join core.indicator_benchmark b on b.benchmark_id = v.benchmark_id
       where sv.code = $2 and d.level = 2 order by d.seq`, [year, profile, nodeCode])).rows;
    const honors = (await c.query(`select node_name as node, title from mart.v_screen_honor order by year desc nulls last`)).rows;
    const achieved = ind.filter((r) => r.achieved === true);
    return {
      year, profile,
      tce: totals.tce ?? null, co2_t: totals.co2_t ?? null, value_added_wan: totals.value_added_wan ?? null,
      energy_estimated_share: totals.energy_estimated_share ?? null,
      indicators: {
        total: ind.length, achieved: achieved.length,
        not_achieved: ind.filter((r) => r.achieved === false).length,
        no_benchmark: ind.filter((r) => r.value != null && r.achieved == null).length,
        pending: ind.filter((r) => r.value == null).length,
        score: achieved.reduce((a, r) => a + (r.score ?? 0), 0),
      },
      achieved: achieved.map((r) => ({ code: r.code, name: r.name, unit: r.unit, value: r.value, benchmark: r.benchmark,
                                       comparator: r.comparator, estimated_share: r.estimated_share ?? 0 })),
      honors,
    };
  });
}
