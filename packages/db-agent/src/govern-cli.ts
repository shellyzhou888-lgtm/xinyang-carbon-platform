import { loadConfig } from "./config.js";
import { closePool } from "./db.js";
import { runGovernance } from "./governance.js";

/**
 * npm run govern               full governance run (detection rules + model-written ticket text + drafted descriptions)
 * npm run govern -- --no-model detection only, no DeepSeek calls
 * npm run govern -- --docs 40  draft missing field descriptions for up to 40 tables in this run (default 8)
 */
const useModel = !process.argv.includes("--no-model");
const docsIdx = process.argv.indexOf("--docs");
const maxDocTables = docsIdx > 0 ? Number(process.argv[docsIdx + 1]) || 8 : undefined;
const cfg = loadConfig({ requireModelKey: useModel });
try {
  const r = await runGovernance(cfg, { trigger: "manual", useModel, maxDocTables, log: (m) => console.log(m) });
  console.log(JSON.stringify(r, null, 2));
} finally {
  await closePool();
}
