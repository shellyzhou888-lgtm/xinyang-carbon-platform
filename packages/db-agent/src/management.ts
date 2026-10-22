import { readOnly } from "./db.js";

export interface ManagementData {
  carbonStructure: { name: string; co2_t: number }[];
  carbonRanking: { code: string; name: string; co2_t: number; output_wan: number | null; intensity: number | null }[];
  annual: { year: number; tce: number | null; co2_t: number | null; value_added: number | null }[];
  renewable: { name: string; tce: number; renewable: boolean }[];
  transfers: { source: string; target: string; energy: string; quantity: number; unit: string }[];
  alerts: { id: number; rule_code: string; rule_name: string; node: string; node_code: string; node_type: string; period: string; message: string; severity: string; status: string; observed: number | null; baseline: number | null; root_cause: unknown }[];
  strategies: { code: string; name: string; category: string; description: string | null; reference: string | null }[];
}

/** Fixed read-only queries for the separate energy, carbon and diagnosis workspaces. */
export function getManagementData(year: number): Promise<ManagementData> {
  return readOnly(async (c) => {
    const carbonStructure = (await c.query(`
      select coalesce(t.name, a.category) name, round(sum(a.co2_t),2)::float co2_t
      from fact.carbon_emission a left join core.energy_type t on t.code=a.energy_type_code
      where a.is_current and a.profile_code='GIP_2026' and extract(year from a.period_month)=$1
        and a.node_id in (select engine.accounting_nodes(node_id) from core.org_node where code='XYEDZ')
      group by 1 order by 2 desc`, [year])).rows;
    const carbonRanking = (await c.query(`
      select n.code,n.name,engine.metric_value('CO2_TOTAL',n.node_id,$1,'GIP_2026')::float co2_t,
        engine.stat_value('ECO_GROSS_OUTPUT',n.node_id,$1,'')::float output_wan
      from core.org_node n where n.node_type='enterprise' and n.is_active`, [year])).rows
      .filter(r => r.co2_t != null).map(r => ({ ...r, intensity: r.output_wan > 0 ? r.co2_t / r.output_wan : null })).sort((a,b) => b.co2_t-a.co2_t);
    const annual = (await c.query(`
      select y as year, engine.metric_value('ENG_TCE',node_id,y,'GIP_2026')::float tce,
        engine.metric_value('CO2_TOTAL',node_id,y,'GIP_2026')::float co2_t,
        engine.metric_value('ECO_VA_CONST',node_id,y,'GIP_2026')::float value_added
      from core.org_node cross join generate_series($1::int-2,$1::int) y where code='XYEDZ' order by y`, [year])).rows;
    const renewable = (await c.query(`
      select t.name,t.is_renewable renewable,
        round(sum(case when a.flow='send_out' then -a.tce else a.tce end),2)::float tce
      from fact.energy_activity a join core.energy_type t on t.code=a.energy_type_code
      where a.is_current and a.flow in ('consumption','receive','send_out') and extract(year from a.period_month)=$1
        and a.node_id in (select engine.accounting_nodes(node_id) from core.org_node where code='XYEDZ')
      group by t.name,t.is_renewable order by 3 desc`, [year])).rows;
    const transfers = (await c.query(`
      select s.name source,t.name target,e.name energy,sum(a.quantity)::float quantity,a.unit
      from fact.energy_transfer a join core.org_node s on s.node_id=a.from_node_id
      join core.org_node t on t.node_id=a.to_node_id join core.energy_type e on e.code=a.energy_type_code
      where a.is_current and extract(year from a.period_month)=$1 group by 1,2,3,5 order by 4 desc limit 100`, [year])).rows;
    const alerts = (await c.query(`
      select a.alert_id::int id,r.code rule_code,r.name rule_name,n.name node,n.code node_code,n.node_type,to_char(a.period_start,'YYYY-MM') period,a.message,a.severity,a.status,a.observed_value::float observed,
        a.baseline_value::float baseline,a.root_cause from fact.alert_event a join core.org_node n using(node_id)
        join core.alert_rule r using(rule_id)
      where extract(year from a.period_start)=$1
        -- only the latest evaluation run of the year: earlier runs were superseded by re-imported data and are all resolved
        and a.run_id is not distinct from (select max(x.run_id) from fact.alert_event x where extract(year from x.period_start)=$1)
      order by a.detected_at desc limit 60`, [year])).rows;
    const strategies = (await c.query(`select code,name,category,description,reference_source reference from core.strategy order by category,code`)).rows;
    return { carbonStructure, carbonRanking, annual, renewable, transfers, alerts, strategies };
  });
}

export function getDataInventory() {
  return readOnly(async c => ({
    sources: (await c.query(`select data_source source,count(*)::int records,to_char(min(period_month),'YYYY-MM') first_month,
      to_char(max(period_month),'YYYY-MM') last_month from fact.energy_activity where is_current group by data_source order by 1`)).rows as {source:string;records:number;first_month:string;last_month:string}[],
    standards: (await c.query(`select v.code,v.name,count(d.indicator_id)::int indicators from core.standard_version v
      left join core.indicator_def d on d.version_id=v.version_id and d.level=2 group by v.version_id order by v.code`)).rows as {code:string;name:string;indicators:number}[],
    factors: (await c.query(`select factor_kind kind,count(*)::int records from core.factor group by factor_kind order by 1`)).rows as {kind:string;records:number}[],
  }));
}

export function getIndicatorConfiguration(version: string, year: number) {
  return readOnly(async c => (await c.query(`select d.code,d.name,d.unit,d.handling,d.score::float score,
    d.display_enabled,d.display_position,f.code formula,f.status formula_status,d.definition,
    iv.value::float value, iv.achieved, b.value::float benchmark, b.comparator
    from core.indicator_def d join core.standard_version v using(version_id)
    left join core.formula f using(formula_id)
    left join fact.indicator_value iv on iv.indicator_id=d.indicator_id and iv.is_current
      and iv.period_start=make_date($2,1,1) and iv.node_id=(select node_id from core.org_node where code='XYEDZ')
    left join core.indicator_benchmark b on b.benchmark_id=iv.benchmark_id
    where v.code=$1 and d.level=2 order by d.seq`,[version,year])).rows as {
      code:string;name:string;unit:string|null;handling:string;score:number|null;display_enabled:boolean;
      display_position:string|null;formula:string|null;formula_status:string|null;definition:string|null;
      value:number|null;achieved:boolean|null;benchmark:number|null;comparator:string|null;
    }[]);
}
