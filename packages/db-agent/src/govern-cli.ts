import { loadConfig } from "./config.js";
import { closePool, initPool, readOnly } from "./db.js";
import { runGovernance, type GovernanceTrigger } from "./governance.js";

/**
 * npm run govern                         full governance run (detection rules + model-written ticket text + drafted descriptions)
 * npm run govern -- --no-model           detection only, no DeepSeek calls
 * npm run govern -- --docs 40            draft missing field descriptions for up to 40 tables in this run (default 8)
 * npm run govern -- --trigger import     record the run as triggered by an import / calc / schedule (default manual)
 * npm run govern -- --if-changed         skip unless there is something to process (used after scripted imports and syncs):
 *                                        unprocessed import / calc events, database objects missing from the catalog,
 *                                        or undocumented catalog columns with no governance run in the last 24 hours
 */
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const useModel = !process.argv.includes("--no-model");
const maxDocTables = arg("--docs") ? Number(arg("--docs")) || 8 : undefined;
const trigger = (["import", "calc", "manual", "schedule"].includes(arg("--trigger") ?? "") ? arg("--trigger") : "manual") as GovernanceTrigger;
const cfg = loadConfig({ requireModelKey: useModel });

async function hasWork() {
  initPool(cfg.databaseUrl);
  const row = await readOnly(async (c) => (await c.query(`
    select (select count(*) from semantic.publish_event where run_id is null)::int as pending_events,
           (select count(*) from pg_class k join pg_namespace n on n.oid = k.relnamespace
             where n.nspname in ('core','fact','mart') and k.relkind in ('r','v','m','p')
               and not exists (select 1 from semantic.table_doc t where t.object = n.nspname || '.' || k.relname))::int as unregistered,
           (select count(*) from semantic.column_doc d join semantic.table_doc t using (object)
             where t.queryable and coalesce(d.description, '') = '')::int as undocumented,
           (select max(started_at) from semantic.governance_run) as last_run`)).rows[0]);
  const stale = !row.last_run || Date.now() - new Date(row.last_run).getTime() > 24 * 3600_000;
  const go = row.pending_events > 0 || row.unregistered > 0 || (row.undocumented > 0 && stale);
  console.log(JSON.stringify({ check: "if-changed", ...row, run: go }));
  return go;
}

try {
  if (!process.argv.includes("--if-changed") || await hasWork()) {
    const r = await runGovernance(cfg, { trigger, useModel, maxDocTables, log: (m) => console.log(m) });
    console.log(JSON.stringify(r, null, 2));
  }
} finally {
  await closePool();
}
