import { readOnly } from "./db.js";

/** Monthly energy (tce) and CO2 (t) per enterprise; drives the spatial heat map and flow map. Read-only. */
export interface EnterpriseMonthly { code: string; name: string; month: string; tce: number | null; co2_t: number | null }

export function getEnterpriseMonthly(year: number, profile = "GIP_2026"): Promise<EnterpriseMonthly[]> {
  return readOnly(async (c) => (await c.query(`
    with ent as (select node_id, code, name from core.org_node where node_type = 'enterprise' and is_active),
    nodes as (select e.code, e.name, engine.accounting_nodes(e.node_id) as node_id from ent e),
    en as (select n.code, n.name, a.period_month m,
                  sum(case a.flow when 'send_out' then -a.tce when 'consumption' then a.tce when 'receive' then a.tce else 0 end) tce
             from fact.energy_activity a join nodes n on n.node_id = a.node_id
            where a.is_current and extract(year from a.period_month) = $1 group by 1, 2, 3),
    co as (select n.code, n.name, k.period_month m, sum(k.co2_t) co2
             from fact.carbon_emission k join nodes n on n.node_id = k.node_id
            where k.is_current and k.profile_code = $2 and extract(year from k.period_month) = $1 group by 1, 2, 3)
    select coalesce(en.code, co.code) code, coalesce(en.name, co.name) name, to_char(coalesce(en.m, co.m), 'YYYY-MM') as "month",
           round(en.tce::numeric, 1)::float tce, round(co.co2::numeric, 1)::float co2_t
      from en full join co on co.code = en.code and co.m = en.m
     order by 1, 3`, [year, profile])).rows);
}
