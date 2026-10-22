import { readOnly } from "./db.js";

export interface ProductChainStage {
  seq: number; code: string; phase: string; name: string; enterprise: string | null; amount: number; unit: string;
  factor_kind: "tiangong" | "park_factor" | "park_enterprise"; factor_value: number | null; factor_unit: string | null; factor_basis: string | null;
  process_code: string | null; process_name: string | null; kgco2e: number; cumulative: number; note: string | null;
}
export interface ProductChain {
  code: string; name: string; industry: string | null; functional_unit: string; year: number; total: number;
  milestones: { after_stage: string; product: string; per: string; cumulative_kgco2e: number }[];
  factor_rule: string | null; stages: ProductChainStage[];
}
export interface LcaSummary {
  processes: number; complete: number; partial: number; none: number; china: number;
  used: { process_code: string; name: string; region: string | null; year: number | null; functional_unit: string | null; closure: string | null; brightway: number | null; strict: number | null }[];
}

/** Product carbon trajectories of the park's industry chains (lab.product_chain*, written by packages/lca). Read-only. */
export function getProductChains(): Promise<{ chains: ProductChain[]; lca: LcaSummary | null }> {
  return readOnly(async (c) => {
    const exists = (await c.query(`select to_regclass('lab.product_chain') is not null as ok`)).rows[0]?.ok;
    if (!exists) return { chains: [], lca: null };
    const chains = (await c.query(`
      select chain_code as code, name, industry, functional_unit, year, total_kgco2e::float as total, milestones, factor_rule
        from lab.product_chain where is_current order by chain_code desc`)).rows as Omit<ProductChain, "stages">[];
    const stages = (await c.query(`
      select chain_code, seq, stage_code as code, phase, name, enterprise_code as enterprise, amount::float, unit, factor_kind,
             factor_value::float, factor_unit, factor_basis, process_code, process_name, kgco2e::float, cumulative_kgco2e::float as cumulative, note
        from lab.product_chain_stage where is_current order by chain_code, seq`)).rows as (ProductChainStage & { chain_code: string })[];
    const lca = (await c.query(`
      select count(*)::int processes, count(*) filter (where closure = 'complete')::int complete, count(*) filter (where closure = 'partial')::int partial,
             count(*) filter (where closure = 'none')::int none, count(*) filter (where region_code like 'CN%')::int china
        from lab.lca_process where is_current`)).rows[0] as Omit<LcaSummary, "used">;
    const used = (await c.query(`
      select distinct on (p.process_code) p.process_code, p.name_zh as name, p.region_code as region, p.ref_year as year, p.functional_unit,
             p.closure, p.gwp_kgco2e::float as brightway, p.tiangong_strict_kgco2e::float as strict
        from lab.lca_process p join lab.product_chain_stage s on s.process_code = p.process_code and s.is_current
       where p.is_current order by p.process_code`)).rows as LcaSummary["used"];
    return {
      chains: chains.map((chain) => ({ ...chain, stages: stages.filter((s) => s.chain_code === chain.code).map(({ chain_code: _c, ...s }) => s) })),
      lca: { ...lca, used },
    };
  });
}
