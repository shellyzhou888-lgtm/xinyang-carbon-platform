/**
 * Placeholder data generator. Reads data/simulated/assumptions.json and fills the official import
 * templates so the simulated data goes through exactly the same import path as real data.
 * Output (committed, for traceability):
 *   data/simulated/monthly-energy_simulated.xlsx
 *   data/simulated/annual-economic_simulated.xlsx      (经济指标 + 产品产量)
 *   data/simulated/resource-environment_simulated.xlsx
 * The 数据来源 column is left blank; importing with --estimated marks every value as data_source = estimated.
 * Deterministic: a seeded PRNG gives the same numbers for the same assumptions.
 *
 * Scenario files: SIM_ASSUMPTIONS=data/simulated/assumptions-v2.json SIM_OUT=data/simulated/v2 npx tsx sim/simulate.ts
 * Optional keys (v2): intensity_factor_by_year, default_green_trade_share_of_grid, and per enterprise
 * intensity_factor_extra and mix_by_year.
 */
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..", "..");
const assumptionsPath = resolve(root, process.env.SIM_ASSUMPTIONS ?? join("data", "simulated", "assumptions.json"));
const outDir = resolve(root, process.env.SIM_OUT ?? join("data", "simulated"));
const A = JSON.parse(readFileSync(assumptionsPath, "utf8"));
const NOTE = `模拟数据（${relative(root, assumptionsPath).split("\\").join("/")}）`;

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
    const yearFactor: number = A.intensity_factor_by_year?.[ys] ?? (1 - A.intensity_decline_per_year) ** (y - 2021);
    const tce = grossForEnergy * e.intensity_tce_per_wan * yearFactor * (e.intensity_factor_extra?.[ys] ?? 1) * noise();
    const mix = e.mix_by_year?.[ys] ?? e.mix;
    const elecKwh = (tce * (mix.ELEC ?? 0)) / ELEC;
    const pv: number = e.pv_kwh_per_year?.[ys] ?? 0;
    const pvFeed = pv * (e.pv_feed_in_share ?? 0);
    const pvSelf = pv - pvFeed;
    const gridTotal = Math.max(elecKwh - pvSelf, 0);
    const green = gridTotal * (e.green_trade_share_of_grid?.[ys] ?? A.default_green_trade_share_of_grid?.[ys] ?? 0);
    const grid = gridTotal - green;
    const gasM3 = (tce * (mix.NATURAL_GAS ?? 0)) / GAS;
    const heatGj = (tce * (mix.HEAT_FOSSIL ?? 0)) / HEAT;
    const dieselT = (tce * (mix.DIESEL ?? 0)) / DSL;

    const base = shares(S[e.profile], from), gasS = shares(S.gas_heating, from), pvS = shares(S.pv, from);
    // Optional within-year improvement (v2): energy use per unit of output falls linearly from January to December by
    // `monthly_improvement_by_year`, and the green-power share ramps up through the year (`green_ramp`, ±); annual
    // totals are kept by renormalising the monthly weights.
    const imp: number = A.monthly_improvement_by_year?.[ys] ?? 0, ramp: number = A.green_ramp ?? 0;
    const step = (i: number) => (from === 12 ? 0 : (i - (from - 1)) / (12 - from));
    const effW = Array.from({ length: 12 }, (_, i) => (i + 1 >= from ? 1 + imp / 2 - imp * step(i) : 0));
    const tilt = (sh: number[]) => { const t = sh.map((x, i) => x * effW[i]); const s = t.reduce((a, b) => a + b, 0) || 1; return t.map((x) => x / s); };
    const baseE = tilt(base), gasE = tilt(gasS);
    const greenW = Array.from({ length: 12 }, (_, i) => (i + 1 >= from ? 1 - ramp + 2 * ramp * step(i) : 0));
    const elecTotal = grid + green;
    for (let m = from; m <= 12; m++) {
      const i = m - 1;
      const v = (x: number, sh: number[], d: number) => (x > 0 ? round(x * sh[i] * noise(2), d) : null);
      // Split each month's grid + green electricity with the ramped green share (annual green total preserved).
      const greenShareYear = elecTotal > 0 ? green / elecTotal : 0;
      const wsum = baseE.reduce((a, x, k) => a + x * greenW[k], 0) || 1;
      const gShare = Math.min(0.95, greenShareYear * greenW[i] / wsum);
      const monthElec = elecTotal * baseE[i];
      const g = (x: number, d: number) => (x > 0 ? round(x * noise(2), d) : null);
      monthly.push([e.credit, e.name, `${y}-${String(m).padStart(2, "0")}`,
        g(monthElec * (1 - gShare), 0), g(monthElec * gShare, 0), null, v(pvSelf, pvS, 0), v(pvFeed, pvS, 0),
        v(gasM3, gasE, 0), v(heatGj, gasE, 1), null, v(dieselT, baseE, 3), null, null, null, null, null, NOTE]);
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
  mkdirSync(outDir, { recursive: true });
  await wb.xlsx.writeFile(join(outDir, target));
  console.log(target, sheets.map(([n, r]) => `${n}:${r.length}行`).join(" "));
}

await fill("enterprise-monthly-energy_v1.xlsx", [["月度能耗", monthly]], "monthly-energy_simulated.xlsx");
await fill("enterprise-annual-economic_v1.xlsx", [["经济指标", economic], ["产品产量", production]], "annual-economic_simulated.xlsx");
await fill("park-annual-resource-environment_v1.xlsx", [["资源环境", resource]], "resource-environment_simulated.xlsx");
console.log("park VA by year (万元):", Object.fromEntries(Object.entries(vaByYear).map(([k, v]) => [k, Math.round(v)])));
