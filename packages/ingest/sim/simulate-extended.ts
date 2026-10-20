/**
 * 补齐“对照竞品还缺的功能”所需的模拟数据（迁移 0025 之后运行）。全部 data_source = estimated，可重复运行：
 * 重跑时先把本脚本上一批的当前记录置为失效，再写新记录（数据库禁止删除）。
 *
 *   1. 厂区 / 产线对象与分项计量（万华、谷麦、今上）：写入 fact.energy_transfer（企业 → 厂区 → 产线），供能流桑基图使用。
 *      分项量按比例分摊企业月度消费量，合计等于企业消费，不进入能耗核算（引擎不读 energy_transfer）。
 *   2. 园区目标与预算（fact.target）：年度用能 / 碳排放预算、能耗与碳排放强度目标、绿电与可再生能源占比、达峰上限。
 *   3. 储能充放电与充电桩充电量（园区公共设施，fact.statistic_value 月度）。
 *   4. 策略库参数（core.strategy.parameters）：节能率或减碳率，标记 simulated。
 *   5. 运行 engine.evaluate_alerts：生成 2023–2026 年预警、根因与策略推荐。
 *
 * 用法：cd packages/ingest && npx tsx sim/simulate-extended.ts
 */
import type pg from "pg";
import { connect } from "../src/db.js";

const SEED = 20261020;
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = rng(SEED);
const jitter = (pct: number) => 1 + (rand() * 2 - 1) * pct;

// ---- 1. 厂区与产线 ---------------------------------------------------------------------------
interface Line { code: string; name: string; elec: number; gas: number; heat: number; from?: string }
interface Site { code: string; name: string; from?: string; lines: Line[] }
const SITES: Record<string, Site[]> = {
  E_WANHUA: [
    { code: "S_WANHUA_A", name: "万华一期厂区", lines: [
      { code: "L_WANHUA_A1", name: "一期刨花板线", elec: 0.75, gas: 0.9, heat: 0.9 },
      { code: "L_WANHUA_A_AUX", name: "一期公辅系统", elec: 0.25, gas: 0.1, heat: 0.1 } ] },
    { code: "S_WANHUA_B", name: "万华二期无醛秸秆板厂区", from: "2023-01-01", lines: [
      { code: "L_WANHUA_B1", name: "二期秸秆板连续压机线", elec: 0.82, gas: 0.88, heat: 0.92 },
      { code: "L_WANHUA_B_AUX", name: "二期热能中心与公辅", elec: 0.18, gas: 0.12, heat: 0.08 } ] },
  ],
  E_GUMAI: [
    { code: "S_GUMAI", name: "谷麦金牛厂区", lines: [
      { code: "L_GUMAI_SMD", name: "SMD/CSP 封装线", elec: 0.45, gas: 0, heat: 0 },
      { code: "L_GUMAI_BLU", name: "背光模组线", elec: 0.35, gas: 0, heat: 0 },
      { code: "L_GUMAI_AUX", name: "洁净空调与公辅", elec: 0.20, gas: 1, heat: 0 } ] },
  ],
  E_JINSHANG: [
    { code: "S_JINSHANG", name: "今上信阳厂区", lines: [
      { code: "L_JINSHANG_FAB", name: "芯片制造线", elec: 0.55, gas: 0, heat: 0 },
      { code: "L_JINSHANG_PKG", name: "封装测试线", elec: 0.25, gas: 0, heat: 0 },
      { code: "L_JINSHANG_AUX", name: "动力站（纯水、空压、洁净）", elec: 0.20, gas: 1, heat: 0 } ] },
  ],
};
// 万华 2023 年起两个厂区的电、气、热分配
const WANHUA_SITE_SHARE = { A: { elec: 0.3, gas: 0.25, heat: 0.25 }, B: { elec: 0.7, gas: 0.75, heat: 0.75 } };

// ---- 2. 目标与预算 --------------------------------------------------------------------------
const BUDGET_GROWTH = 0.12;        // 年度预算 = 上一年实际 × 1.12（假设产值增长约 15%、能耗强度下降约 3%）
const BUDGET_GROWTH_2026 = 0.10;
const INTENSITY_CUT = 0.135;       // 参照“十四五”单位 GDP 能耗降低 13.5%
const CARBON_INTENSITY_CUT = 0.18; // 参照“十四五”单位 GDP 二氧化碳排放降低 18%

// ---- 4. 策略参数（行业常见范围内取值的模拟参数，需按企业节能诊断核实） --------------------------------
const STRATEGY_PARAMS: Record<string, Record<string, unknown>> = {
  PV_EXPANSION:         { carbon_reduction_rate: 0.05, annual_hours: 1050, basis: "屋顶分布式光伏，年利用约 1050 小时" },
  GREEN_POWER_TRADE:    { carbon_reduction_rate: 0.15, basis: "约 25% 外购电改为绿电交易" },
  DRYING_HEAT_RECOVERY: { saving_rate: 0.04, basis: "干燥、热压工序烟气余热回收" },
  HOT_AIR_OPTIMIZE:     { saving_rate: 0.03, basis: "热风炉燃烧与风量优化" },
  DUST_FAN_VFD:         { saving_rate: 0.015, basis: "除尘风机变频" },
  GAS_BOILER_EFF:       { saving_rate: 0.02, basis: "锅炉烟气冷凝回收与燃烧调整" },
  CLEANROOM_HVAC:       { saving_rate: 0.08, basis: "洁净空调群控与风量优化" },
  AIR_COMPRESSOR_HR:    { saving_rate: 0.02, basis: "空压机余热回收用于纯水或生活热水" },
  TOU_SCHEDULING:       { cost_saving_rate: 0.08, basis: "峰谷调度只降电费，不减能耗" },
  TRANSFORMER_ECON:     { saving_rate: 0.01, basis: "变压器负载率优化" },
};

async function ensureNodes(c: pg.Client) {
  for (const [ent, sites] of Object.entries(SITES)) {
    for (const s of sites) {
      await c.query(`
        insert into core.org_node (parent_id, node_type, code, name, industry_code, valid_from, attributes)
        select p.node_id, 'site', $2, $3, p.industry_code, $4::date, '{"simulated": true}'::jsonb from core.org_node p where p.code = $1
        on conflict (code) do nothing`, [ent, s.code, s.name, s.from ?? null]);
      for (const l of s.lines) {
        await c.query(`
          insert into core.org_node (parent_id, node_type, code, name, industry_code, valid_from, attributes)
          select p.node_id, 'line', $2, $3, p.industry_code, $4::date, '{"simulated": true}'::jsonb from core.org_node p where p.code = $1
          on conflict (code) do nothing`, [s.code, l.code, l.name, s.from ?? null]);
      }
    }
  }
}

async function transfers(c: pg.Client, batch: number) {
  await c.query(`update fact.energy_transfer set is_current = false where is_current and allocation_rule like '模拟分项%'`);
  const kinds: [string, keyof Line & ("elec" | "gas" | "heat")][] = [["ELEC_GRID", "elec"], ["NATURAL_GAS", "gas"], ["HEAT_FOSSIL", "heat"]];
  let n = 0;
  for (const [ent, sites] of Object.entries(SITES)) {
    const rows = (await c.query(`
      select a.period_month::text m, a.energy_type_code e, sum(a.quantity_std)::float q, t.default_unit unit
        from fact.energy_activity a join core.org_node n using (node_id) join core.energy_type t on t.code = a.energy_type_code
       where n.code = $1 and a.is_current and a.flow = 'consumption' and a.energy_type_code in ('ELEC_GRID','NATURAL_GAS','HEAT_FOSSIL')
       group by 1, 2, 4 order by 1`, [ent])).rows;
    for (const r of rows) {
      const kind = kinds.find(([code]) => code === r.e)![1];
      const active = sites.filter((s) => !s.from || r.m >= s.from);
      // 厂区份额：万华 2023 年起按两厂区分配，其余企业只有一个厂区
      const siteShares = active.map((s) => ent === "E_WANHUA" && active.length === 2 ? WANHUA_SITE_SHARE[s.code.endsWith("_A") ? "A" : "B"][kind] : 1 / active.length);
      const noisy = siteShares.map((v) => v * jitter(0.03));
      const total = noisy.reduce((a, b) => a + b, 0);
      for (const [i, s] of active.entries()) {
        const siteQ = r.q * noisy[i] / total;
        if (siteQ <= 0) continue;
        await insertTransfer(c, ent, s.code, r.m, r.e, siteQ, r.unit, batch); n++;
        const lineShares = s.lines.map((l) => l[kind]);
        if (lineShares.every((v) => v === 0)) continue;
        const ln = lineShares.map((v) => v * (v > 0 ? jitter(0.04) : 0));
        const lt = ln.reduce((a, b) => a + b, 0);
        for (const [j, l] of s.lines.entries()) {
          if (ln[j] <= 0) continue;
          await insertTransfer(c, s.code, l.code, r.m, r.e, siteQ * ln[j] / lt, r.unit, batch); n++;
        }
      }
    }
  }
  return n;
}

async function insertTransfer(c: pg.Client, from: string, to: string, month: string, energy: string, q: number, unit: string, batch: number) {
  await c.query(`
    insert into fact.energy_transfer (from_node_id, to_node_id, period_month, energy_type_code, quantity, unit, allocation_rule, data_source, batch_id)
    select f.node_id, t.node_id, $3::date, $4, round($5::numeric, 3), $6, '模拟分项计量比例（企业月度消费量按厂区、产线分摊）', 'estimated', $7
      from core.org_node f, core.org_node t where f.code = $1 and t.code = $2`, [from, to, month, energy, q, unit, batch]);
}

async function targets(c: pg.Client, batch: number) {
  await c.query(`update fact.target set is_current = false where is_current and data_source = 'estimated'
                   and node_id = (select node_id from core.org_node where code = 'XYEDZ')`);
  const m = async (code: string, y: number) =>
    Number((await c.query(`select engine.metric_value($1, node_id, $2, 'GIP_2026') v from core.org_node where code = 'XYEDZ'`, [code, y])).rows[0].v);
  const rows: [string, number, number, string, string][] = [];
  for (const y of [2022, 2023, 2024, 2025, 2026]) {
    const g = y === 2026 ? BUDGET_GROWTH_2026 : BUDGET_GROWTH;
    rows.push(["energy_budget_tce", y, (await m("ENG_TCE", y - 1)) * (1 + g), "tce", `模拟：${y - 1} 年实际综合能耗 × ${1 + g}（产值增长约 15%、能耗强度下降约 3%）`]);
    rows.push(["carbon_budget_t", y, (await m("CO2_TOTAL", y - 1)) * (1 + g), "tCO2", `模拟：${y - 1} 年实际碳排放 × ${1 + g}`]);
  }
  const ei2021 = (await m("ENG_TCE", 2021)) / (await m("ECO_VA_CONST", 2021));
  const ci2021 = (await m("CO2_TOTAL", 2021)) / (await m("ECO_VA_CONST", 2021));
  rows.push(["energy_intensity", 2025, ei2021 * (1 - INTENSITY_CUT), "tce/万元", "模拟：以 2021 年为基期，参照“十四五”单位 GDP 能耗降低 13.5%"]);
  rows.push(["energy_intensity", 2030, ei2021 * (1 - INTENSITY_CUT) ** 2, "tce/万元", "模拟：“十五五”按同幅度再降 13.5%"]);
  rows.push(["carbon_intensity", 2025, ci2021 * (1 - CARBON_INTENSITY_CUT), "tCO2/万元", "模拟：以 2021 年为基期，参照“十四五”单位 GDP 二氧化碳排放降低 18%"]);
  rows.push(["carbon_intensity", 2030, ci2021 * (1 - CARBON_INTENSITY_CUT) ** 2, "tCO2/万元", "模拟：“十五五”按同幅度再降 18%"]);
  for (const [y, v] of [[2025, 15], [2026, 20], [2028, 30], [2030, 40]]) rows.push(["green_power_share", y, v, "%", "模拟：绿电（交易 + 自发）占用电量比例目标"]);
  rows.push(["renewable_share", 2030, 15, "%", "模拟：取 2024 版绿色工业园区可再生能源使用比例引领值 15%"]);
  rows.push(["carbon_peak_t", 2028, (await m("CO2_TOTAL", 2025)) * 1.25, "tCO2", "模拟：2028 年前达峰，峰值不超过 2025 年排放的 1.25 倍"]);
  for (const [kind, y, v, unit, basis] of rows) {
    await c.query(`insert into fact.target (node_id, target_kind, year, value, unit, scenario_code, basis, data_source, batch_id)
                   select node_id, $1, $2, round($3::numeric, 6), $4, 'plan', $5, 'estimated', $6 from core.org_node where code = 'XYEDZ'`,
                  [kind, y, v, unit, basis, batch]);
  }
  return rows.length;
}

async function storageAndCharging(c: pg.Client, batch: number) {
  const months: string[] = [];
  for (let y = 2023; y <= 2025; y++) for (let mo = 1; mo <= 12; mo++) months.push(`${y}-${String(mo).padStart(2, "0")}-01`);
  let n = 0, ev = 12000;
  for (const m of months) {
    ev *= 1.035 * jitter(0.02);
    const season = [0.9, 0.8, 0.95, 1, 1.05, 1.1, 1.15, 1.15, 1.05, 1, 0.95, 0.9][Number(m.slice(5, 7)) - 1];
    const rows: [string, number][] = [["ENG_EV_CHARGE", ev * season]];
    if (m >= "2024-07-01") {
      const charge = 2000 * 0.9 * 26 * jitter(0.05);   // 2 MWh 储能，放电深度 90%，每月约 26 个循环
      rows.push(["ENG_STORAGE_CHARGE", charge], ["ENG_STORAGE_DISCHARGE", charge * 0.88 * jitter(0.01)]);
    }
    for (const [metric, v] of rows) {
      await c.query(`select engine.upsert_stat(node_id, 'month', $1::date, $2, '', round($3::numeric, 1), 'kWh', 'estimated', $4, null,
                                               '{"simulated": true}'::jsonb) from core.org_node where code = 'P_PUBLIC'`, [m, metric, v, batch]);
      n++;
    }
  }
  return n;
}

async function strategies(c: pg.Client) {
  for (const [code, p] of Object.entries(STRATEGY_PARAMS)) {
    await c.query(`update core.strategy set parameters = parameters || $2::jsonb where code = $1`,
                  [code, JSON.stringify({ ...p, simulated: true })]);
  }
  return Object.keys(STRATEGY_PARAMS).length;
}

/** 在调用方给定的事务中写入全部模拟数据并运行预警（测试时可在回滚事务中调用）。 */
export async function simulateExtended(c: pg.Client, alertFn = "engine.evaluate_alerts") {
  await c.query("SET LOCAL ROLE green_app");
  const batch: number = (await c.query(`
    insert into raw.import_batch (source_type, source_name, status, estimation_method, estimation_inputs)
    values ('estimated', 'simulate-extended', 'received', $1, $2) returning batch_id`,
    ["模拟补齐：厂区/产线分项、目标与预算、储能与充电、策略参数（packages/ingest/sim/simulate-extended.ts，固定随机种子）",
     JSON.stringify({ seed: SEED, budget_growth: BUDGET_GROWTH, budget_growth_2026: BUDGET_GROWTH_2026, intensity_cut: INTENSITY_CUT,
                      carbon_intensity_cut: CARBON_INTENSITY_CUT, wanhua_site_share: WANHUA_SITE_SHARE, strategy_params: STRATEGY_PARAMS })])).rows[0].batch_id;
  await ensureNodes(c);
  const summary: Record<string, unknown> = { batch };
  summary.transfers = await transfers(c, batch);
  summary.targets = await targets(c, batch);
  summary.storage_and_ev = await storageAndCharging(c, batch);
  summary.strategies = await strategies(c);
  await c.query(`update raw.import_batch set status = 'loaded', row_count = $2 where batch_id = $1`,
                [batch, Number(summary.transfers) + Number(summary.targets) + Number(summary.storage_and_ev)]);
  const alerts = [];
  for (const y of [2023, 2024, 2025, 2026]) alerts.push({ year: y, ...(await c.query(`select ${alertFn}($1) r`, [y])).rows[0].r });
  summary.alerts = alerts;
  return summary;
}

async function main() {
  const c = await connect();
  try {
    await c.query("BEGIN");
    const summary = await simulateExtended(c);
    await c.query("COMMIT");
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    await c.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("simulate-extended.ts")) main();
