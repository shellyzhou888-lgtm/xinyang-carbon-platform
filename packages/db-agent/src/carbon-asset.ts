import { readOnly } from "./db.js";

/**
 * 碳资产测算与产品碳足迹对照（只读）。
 *
 * 碳成本敞口：园区企业目前不在全国碳市场覆盖范围内，这里按“若全部排放都需以配额清缴”测算：
 *   年度碳成本 = 当年碳排放（GIP_2026 口径，范围一 + 范围二） × 当年 CEA 收盘价年均值
 *   CCER 抵销：按《碳排放权交易管理办法（试行）》第二十九条，抵销比例不超过应清缴配额的 5%；
 *   可节省 = 5% × 排放 × (CEA 年均价 − CCER 年度成交均价)
 * 未来年度（无实际排放）使用最新基准预测；当年价格为年初至今均价。
 *
 * 产品碳足迹对照：企业厂内碳强度 = 企业碳排放 / 产品产量（只含厂内能源消费，未含原料、运输），
 * 与 core.product_footprint_ref 中适用于该企业、功能单位相同的参考值对比；参考值多为“摇篮到大门”，边界更宽。
 */
export interface CarbonAssetRow {
  year: number; node_code: string; node_name: string; co2_t: number | null; co2_basis: "actual" | "forecast" | null;
  cea_price: number | null; ccer_price: number | null; cost_wan: number | null; ccer_offset_t: number | null; ccer_saving_wan: number | null;
  gross_output_wan: number | null; cost_share_of_output_pct: number | null; estimated_share: number | null;
}

export interface CarbonAsset {
  prices: { year: number; cea_avg_close: number | null; cea_days: number; ccer_vwap: number | null; ccer_days: number }[];
  rows: CarbonAssetRow[];
  assumptions: string[];
}

const CCER_OFFSET_CAP = 0.05;

export function getCarbonAsset(yearFrom = 2021, yearTo = new Date().getFullYear(), profile = "GIP_2026"): Promise<CarbonAsset> {
  return readOnly(async (c) => {
    const prices = (await c.query(`
      select y as year,
             round(avg(p.close_price) filter (where p.market_code = 'CEA'), 2)::float cea_avg_close,
             count(*) filter (where p.market_code = 'CEA' and p.close_price is not null)::int cea_days,
             round(sum(p.turnover_yuan) filter (where p.market_code = 'CCER') / nullif(sum(p.volume_t) filter (where p.market_code = 'CCER'), 0), 2)::float ccer_vwap,
             count(*) filter (where p.market_code = 'CCER')::int ccer_days
        from generate_series($1::int, $2::int) y
        left join fact.carbon_market_price p on p.is_current and extract(year from p.trade_date) = y
       group by y order by y`, [yearFrom, yearTo])).rows;

    const raw = (await c.query(`
      with nodes as (select node_id, code, name from core.org_node where code = 'XYEDZ' or (node_type = 'enterprise' and is_active)),
      latest as (select max(run_id) run_id from fact.forecast where scenario_code = 'baseline')
      select n.code node_code, n.name node_name, y as year,
             engine.metric_value('CO2_TOTAL', n.node_id, y, $3)::float co2_actual,
             (select sum(f.value)::float from fact.forecast f, latest l where f.run_id = l.run_id and f.node_id = n.node_id
                and f.target_kind = 'co2_t' and extract(year from f.period_month) = y) co2_forecast,
             engine.stat_value('ECO_GROSS_OUTPUT', n.node_id, y, '')::float output_wan,
             engine.inputs_estimated_share(array['CO2_TOTAL'], n.node_id, y, 0)::float est
        from nodes n cross join generate_series($1::int, $2::int) y
       order by (n.code = 'XYEDZ') desc, n.code, y`, [yearFrom, yearTo, profile])).rows;

    const price = new Map(prices.map((p) => [p.year, p]));
    const round = (v: number | null, d = 1) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
    const rows: CarbonAssetRow[] = raw.map((r) => {
      const co2 = r.co2_actual ?? r.co2_forecast ?? null;
      const p = price.get(r.year);
      const cost = co2 != null && p?.cea_avg_close != null ? (co2 * p.cea_avg_close) / 1e4 : null;
      const offset = co2 != null && p?.ccer_vwap != null ? co2 * CCER_OFFSET_CAP : null;
      const saving = offset != null && p?.cea_avg_close != null ? (offset * (p.cea_avg_close - p.ccer_vwap)) / 1e4 : null;
      return {
        year: r.year, node_code: r.node_code, node_name: r.node_name,
        co2_t: round(co2),
        co2_basis: (r.co2_actual != null ? "actual" : r.co2_forecast != null ? "forecast" : null) as CarbonAssetRow["co2_basis"],
        cea_price: p?.cea_avg_close ?? null, ccer_price: p?.ccer_vwap ?? null,
        cost_wan: round(cost), ccer_offset_t: round(offset), ccer_saving_wan: round(saving),
        gross_output_wan: r.output_wan, cost_share_of_output_pct: cost != null && r.output_wan ? round((cost / r.output_wan) * 100, 2) : null,
        estimated_share: r.co2_actual != null ? round(r.est, 3) : null,
      };
    }).filter((r) => r.co2_t != null);

    return {
      prices, rows,
      assumptions: [
        "园区企业目前未纳入全国碳市场，碳成本为“若全部排放以配额清缴”的敞口测算，不是实际支出",
        "碳排放为 GIP_2026 口径（范围一 + 范围二）；没有实际值的年份使用最新基准预测",
        "CEA 价格取全年每日收盘价平均；CCER 取全年成交额 ÷ 成交量；当年为年初至今",
        "CCER 抵销上限按应清缴配额的 5%（《碳排放权交易管理办法（试行）》第二十九条）",
        "当前碳排放与产值数据大部分为模拟值，仅供演示",
      ],
    };
  });
}

export interface FootprintComparison {
  node_code: string; node_name: string; product: string; unit: string; year: number;
  output: number; co2_t: number; gate_intensity_kg: number; output_estimated: boolean;
  references: { ref_id: number; product: string; value: number; unit: string; boundary: string | null; status: string;
                comparable_unit: boolean; ratio_pct: number | null; source: string }[];
}

/** Gate-to-gate product carbon intensity of enterprises that report product output, against reference footprints. */
export function getFootprintComparison(year: number, profile = "GIP_2026") {
  return readOnly(async (c) => {
    const out = (await c.query(`
      select n.code, n.name, s.dim_code product, s.unit, s.value::float output, s.data_source = 'estimated' est,
             engine.metric_value('CO2_TOTAL', n.node_id, $1, $2)::float co2,
             (select count(distinct s2.dim_code) from fact.statistic_value s2
               where s2.is_current and s2.node_id = n.node_id and s2.metric_code = 'PROD_OUTPUT' and s2.period_start = s.period_start)::int products
        from fact.statistic_value s join core.org_node n using (node_id)
       where s.is_current and s.metric_code = 'PROD_OUTPUT' and s.period_start = make_date($1, 1, 1)`, [year, profile])).rows;
    const refs = (await c.query(`
      select ref_id, product_name, value::float value, unit, boundary, status, applicable_nodes, source_title
        from core.product_footprint_ref where is_current and status <> 'retired'`)).rows;
    const denom = (u: string) => u.replace(/^.*\//, "").replace("³", "3").replace(/\s/g, "").toLowerCase();
    const comparisons: FootprintComparison[] = [];
    const without: { node_code: string; node_name: string; reason: string }[] = [];
    for (const r of out) {
      if (r.co2 == null || !r.output) continue;
      if (r.products > 1) { without.push({ node_code: r.code, node_name: r.name, reason: "多个产品，需按产品分摊排放后再比较" }); continue; }
      const gate = (r.co2 * 1000) / r.output;
      comparisons.push({
        node_code: r.code, node_name: r.name, product: r.product, unit: r.unit, year, output: r.output, co2_t: Math.round(r.co2 * 10) / 10,
        gate_intensity_kg: Math.round(gate * 10) / 10, output_estimated: r.est,
        references: refs.filter((f) => (f.applicable_nodes ?? []).includes(r.code)).map((f) => {
          const comparable = denom(f.unit) === denom(r.unit);
          return { ref_id: Number(f.ref_id), product: f.product_name, value: f.value, unit: f.unit, boundary: f.boundary, status: f.status,
                   comparable_unit: comparable, ratio_pct: comparable ? Math.round((gate / f.value) * 1000) / 10 : null, source: f.source_title };
        }),
      });
    }
    const covered = new Set([...comparisons.map((x) => x.node_code), ...without.map((x) => x.node_code)]);
    const enterprises = (await c.query(`select code, name from core.org_node where node_type = 'enterprise' and is_active order by code`)).rows;
    for (const e of enterprises) if (!covered.has(e.code)) without.push({ node_code: e.code, node_name: e.name, reason: "缺少产品产量（PROD_OUTPUT）" });
    return {
      year, comparisons, without,
      notes: [
        "厂内碳强度 = 企业碳排放（范围一 + 范围二）÷ 产品产量，只含厂内能源消费；参考值多为“摇篮到大门”，还含原料、胶黏剂、运输等，边界更宽，两者不能直接判优劣",
        "只与功能单位相同的参考值计算比例；status 为 draft 的参考值尚未审核",
        "产品产量与排放当前为模拟值，仅供演示",
      ],
    };
  });
}
