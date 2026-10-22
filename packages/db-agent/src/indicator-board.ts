import { readOnly } from "./db.js";

export interface IndicatorBoardRow {
  code: string; name: string; unit: string | null; direction: string | null; group: string | null; definition: string | null;
  benchmark: number | null; comparator: string | null; achieved: boolean | null; value: number | null;
  series: { year: number; value: number | null }[];
}

/**
 * Every level-2 indicator of a standard with its value in `year`, the leading value it is compared with and the
 * values of earlier years (from 2021), for the evaluation views. Read-only.
 */
export function getIndicatorBoard(year: number, profile = "GIP_2026", nodeCode = "XYEDZ"): Promise<IndicatorBoardRow[]> {
  return readOnly(async (c) => {
    const rows = (await c.query(`
      with defs as (
        select d.indicator_id, d.code, d.name, d.unit, d.direction, d.definition, d.seq, p.name as grp
          from core.indicator_def d join core.standard_version sv on sv.version_id = d.version_id
          left join core.indicator_def p on p.indicator_id = d.parent_id
         where sv.code = $2 and d.level = 2),
      vals as (
        select iv.indicator_id, extract(year from iv.period_start)::int as y, iv.value::float as value, iv.achieved, iv.benchmark_id
          from fact.indicator_value iv join core.org_node n using (node_id)
         where iv.is_current and n.code = $3 and iv.period_type = 'year' and extract(year from iv.period_start) between 2021 and $1)
      select d.code, d.name, d.unit, d.direction, d.grp as "group", d.definition,
             coalesce(b.value, b2.value)::float as benchmark, coalesce(b.comparator, b2.comparator) as comparator,
             cur.achieved, cur.value,
             coalesce((select json_agg(json_build_object('year', v.y, 'value', v.value) order by v.y) from vals v where v.indicator_id = d.indicator_id), '[]'::json) as series
        from defs d
        left join vals cur on cur.indicator_id = d.indicator_id and cur.y = $1
        left join core.indicator_benchmark b on b.benchmark_id = cur.benchmark_id
        left join lateral (select value, comparator from core.indicator_benchmark x where x.indicator_id = d.indicator_id order by benchmark_id limit 1) b2 on true
       order by d.seq`, [year, profile, nodeCode])).rows;
    return rows as IndicatorBoardRow[];
  });
}
