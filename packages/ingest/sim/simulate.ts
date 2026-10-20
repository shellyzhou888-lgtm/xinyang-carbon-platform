/**
 * Placeholder data generator. Reads data/simulated/assumptions.json and fills the official import
 * templates so the simulated data goes through exactly the same import path as real data.
 * Output (committed, for traceability):
 *   data/simulated/monthly-energy_simulated.xlsx
 *   data/simulated/annual-economic_simulated.xlsx      (经济指标 + 产品产量)
 *   data/simulated/resource-environment_simulated.xlsx
 * The 数据来源 column is left blank; importing with --estimated marks every value as data_source = estimated.
 * Deterministic: a seeded PRNG gives the same numbers for the same assumptions.
 */
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..", "..");
const A = JSON.parse(readFileSync(join(root, "data", "simulated", "assumptions.json"), "utf8"));
const NOTE = "模拟数据（data/simulated/assumptions.json）";

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(A.seed);
const noise = (pct = A.noise_pct) => 1 + ((rand() * 2 - 1) * pct) / 100;
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Monthly shares for the active months, normalised so they sum to 1. */
function shares(profile: number[], activeFrom: number): number[] {
  const p = profile.map((v, i) => (i + 1 >= activeFrom ? v : 0));
  const s = p.reduce((a, b) => a + b, 0);
  return p.map((v) => v / s);
}

type Row = (string | number | null)[];
const monthly: Row[] = [];
const economic: Row[] = [];
const production: Row[] = [];
const vaByYear: Record<number, number> = {};

const ELEC = A.tce_per_unit.ELEC, GAS = A.tce_per_unit.NATURAL_GAS, HEAT = A.tce_per_unit.HEAT_FOSSIL, DSL = A.tce_per_unit.DIESEL;
const S = A.seasonality;

for (const e of A.enterprises) {
  const [startY, startM] = (e.start ?? "2000-01").split("-").map(Number);
  for (const y of A.years as number[]) {
    const ys = String(y);
    const gross: number | undefined = e.gross_output_wan[ys];
    const grossForEnergy: number | undefined = gross ?? e.gross_output_for_energy_wan?.[ys];
    if (y < startY) continue;
    const from = y === startY ? startM : 1;

    // Annual economic row (gross output may be absent when a real value is imported separately)
    const vaOnlyBase: number | undefined = e.va_only_wan?.[ys];
    if (gross !== undefined || vaOnlyBase !== undefined) {
      const va = round((gross ?? vaOnlyBase!) * e.va_rate * noise(1.5), 1);
      vaByYear[y] = (vaByYear[y] ?? 0) + va;
      const employees = gross !== undefined ? Math.round(gross / e.productivity_wan_per_person) : null;
      economic.push([e.credit, e.name, ys, gross ?? null, va, employees, null,
                     gross !== undefined ? e.above_scale : null, gross !== undefined ? e.high_tech : null, null, null,
                     vaOnlyBase !== undefined && gross === undefined ? `${NOTE}；只模拟增加值，产值为真实值` : NOTE]);
      if (e.product && gross !== undefined) {
        production.push([e.credit, e.name, ys, e.product.name, Math.round(gross / e.product.price_wan_per_unit), e.product.unit,
                         null, null, null, NOTE]);
      }
    }
    if (grossForEnergy === undefined) continue;

    // Annual energy → physical quantities
    const tce = grossForEnergy * e.intensity_tce_per_wan * (1 - A.intensity_decline_per_year) ** (y - 2021) * noise();
    const elecKwh = (tce * (e.mix.ELEC ?? 0)) / ELEC;
    const pv: number = e.pv_kwh_per_year?.[ys] ?? 0;
    const pvFeed = pv * (e.pv_feed_in_share ?? 0);
    const pvSelf = pv - pvFeed;
    const gridTotal = Math.max(elecKwh - pvSelf, 0);
    const green = gridTotal * (e.green_trade_share_of_grid?.[ys] ?? 0);
    const grid = gridTotal - green;
    const gasM3 = (tce * (e.mix.NATURAL_GAS ?? 0)) / GAS;
    const heatGj = (tce * (e.mix.HEAT_FOSSIL ?? 0)) / HEAT;
    const dieselT = (tce * (e.mix.DIESEL ?? 0)) / DSL;

    const base = shares(S[e.profile], from), gasS = shares(S.gas_heating, from), pvS = shares(S.pv, from);
    for (let m = from; m <= 12; m++) {
      const i = m - 1;
      const v = (x: number, sh: number[], d: number) => (x > 0 ? round(x * sh[i] * noise(2), d) : null);
      monthly.push([e.credit, e.name, `${y}-${String(m).padStart(2, "0")}`,
        v(grid, base, 0), v(green, base, 0), null, v(pvSelf, pvS, 0), v(pvFeed, pvS, 0),
        v(gasM3, gasS, 0), v(heatGj, gasS, 1), null, v(dieselT, base, 3), null, null, null, null, null, NOTE]);
    }
  }
}

// Public facilities
{
  const p = A.public_area;
  for (const y of A.years as number[]) {
    const sh = shares(S.public, 1);
    for (let m = 1; m <= 12; m++) {
      monthly.push([null, p.name, `${y}-${String(m).padStart(2, "0")}`,
        round(p.grid_kwh_per_year[String(y)] * sh[m - 1] * noise(2), 0), null, null, null, null, null, null, null,
        round((p.diesel_t_per_year / 12) * noise(5), 3), null, null, null, null, null, NOTE]);
    }
  }
}

// Park-level resource & environment (园区整体上报)
const resource: Row[] = [];
{
  const r = A.park_resource_env;
  for (const y of A.years as number[]) {
    const ys = String(y);
    const va = vaByYear[y];
    const fresh = Math.round((va * 10000) / r.water_productivity_yuan_per_m3[ys]);
    const reuseRate = r.water_reuse_rate[ys];
    const reused = Math.round((fresh * reuseRate) / (1 - reuseRate));
    const swGen = Math.round(va * r.solid_waste_t_per_wan_va * noise(2));
    const swUtil = Math.round(swGen * r.solid_waste_util_rate[ys]);
    const ww = Math.round(va * r.wastewater_t_per_wan_va[ys]);
    const k = (1 - r.pollutant_decline_per_year) ** (y - 2021);
    const pol = r.pollutants_t_2021;
    const ind = r.new_industrial_building_m2[ys], pub = r.new_public_building_m2[ys];
    resource.push([null, r.name, ys, fresh, reused, r.industrial_land_km2[ys], swGen, swUtil, 0, ww,
      round(pol.COD * k * noise(2), 2), round(pol.NH3N * k * noise(2), 3), round(pol.SO2 * k * noise(2), 2), round(pol.NOX * k * noise(2), 2),
      ind, Math.round(ind * r.new_industrial_green_share[ys]), pub, Math.round(pub * r.new_public_green_share[ys]),
      r.waste_heat_available_gj, Math.round(r.waste_heat_available_gj * r.waste_heat_recovery_rate[ys]), null, NOTE]);
  }
}

async function fill(template: string, sheets: [string, Row[]][], target: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(root, "templates", template));
  for (const [name, rows] of sheets) {
    const ws = wb.getWorksheet(name)!;
    rows.forEach((values, r) => values.forEach((v, c) => { if (v !== null && v !== undefined) ws.getRow(3 + r).getCell(c + 1).value = v; }));
  }
  await wb.xlsx.writeFile(join(root, "data", "simulated", target));
  console.log(target, sheets.map(([n, r]) => `${n}:${r.length}行`).join(" "));
}

await fill("enterprise-monthly-energy_v1.xlsx", [["月度能耗", monthly]], "monthly-energy_simulated.xlsx");
await fill("enterprise-annual-economic_v1.xlsx", [["经济指标", economic], ["产品产量", production]], "annual-economic_simulated.xlsx");
await fill("park-annual-resource-environment_v1.xlsx", [["资源环境", resource]], "resource-environment_simulated.xlsx");
console.log("park VA by year (万元):", Object.fromEntries(Object.entries(vaByYear).map(([k, v]) => [k, Math.round(v)])));
