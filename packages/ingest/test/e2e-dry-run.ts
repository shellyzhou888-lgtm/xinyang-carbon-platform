/**
 * End-to-end check in one transaction that is always rolled back:
 * Excel fixtures → raw → engine.load_batch → engine.run_all (preview).
 * Run `npm run test:fixture` first. Nothing is kept in the database or storage.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "../src/db.js";
import { ingestFile } from "../src/ingest.js";

const dir = join(tmpdir(), "xinyang-ingest-fixture");
const client = await connect();
try {
  await client.query("begin");
  const monthly = await ingestFile(client, { filePath: join(dir, "monthly.xlsx"), templateCode: "ENT_MONTHLY_ENERGY", dryRun: true, externalTransaction: true });
  const annual = await ingestFile(client, { filePath: join(dir, "annual.xlsx"), templateCode: "ENT_ANNUAL_ECONOMIC", dryRun: true, externalTransaction: true });
  const calc = (await client.query("select engine.run_all('GIP_2026', 'XYEDZ', 2023, true) as r")).rows[0].r;
  const totals = (await client.query(`select round(engine.metric_value('ENG_TCE', node_id, 2023, 'GIP_2026'), 4) as tce_2023,
                                             round(engine.metric_value('CO2_TOTAL', node_id, 2023, 'GIP_2026'), 4) as co2_2023
                                        from core.org_node where code = 'XYEDZ'`)).rows[0];
  console.log(JSON.stringify({
    monthly: { rowsRead: monthly.rowsRead, load: monthly.load },
    annual: { rowsRead: annual.rowsRead, load: annual.load },
    energy: calc.energy, carbon: { rows: calc.carbon.rows_calculated, fallback: calc.carbon.factor_year_fallback },
    totals,
    indicators: calc.indicators.items.filter((i: any) => i.value != null)
      .map((i: any) => ({ code: i.code, name: i.name, value: Number(Number(i.value).toFixed(4)), benchmark: i.benchmark, achieved: i.achieved })),
  }, null, 2));
} finally {
  await client.query("rollback");
  await client.end();
}
