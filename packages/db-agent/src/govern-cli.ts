import { loadConfig } from "./config.js";
import { closePool } from "./db.js";
import { runGovernance } from "./governance.js";

/**
 * npm run govern               full governance run (detection rules + model-written ticket text + drafted descriptions)
 * npm run govern -- --no-model detection only, no DeepSeek calls
 */
const useModel = !process.argv.includes("--no-model");
const cfg = loadConfig({ requireModelKey: useModel });
try {
  const r = await runGovernance(cfg, { trigger: "manual", useModel, log: (m) => console.log(m) });
  console.log(JSON.stringify(r, null, 2));
} finally {
  await closePool();
}
