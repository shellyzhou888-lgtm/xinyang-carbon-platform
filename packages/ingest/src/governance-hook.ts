import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Runs the catalog / governance step after a scripted load, the same step the agent's import tools trigger:
 * new objects are registered in the semantic catalog, detection rules run and missing field descriptions are drafted.
 * Uses `govern --if-changed`, so a sync that loaded nothing new does not start a run. A governance failure never
 * fails the import itself; it is reported and can be re-run with `npm run govern` in packages/db-agent.
 */
export function governAfterLoad(trigger: "import" | "calc" | "schedule") {
  if (process.env.SKIP_GOVERNANCE === "1") return;
  const agentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db-agent");
  const tsx = path.join(agentDir, "node_modules/tsx/dist/cli.mjs");
  if (!existsSync(tsx)) { console.warn("[governance] 未找到 packages/db-agent 依赖，跳过语义目录治理"); return; }
  const result = spawnSync(process.execPath, [tsx, "src/govern-cli.ts", "--if-changed", "--trigger", trigger, "--docs", "12"],
    { cwd: agentDir, stdio: "inherit", env: process.env });
  if (result.status !== 0) console.warn(`[governance] 治理步骤未完成（退出码 ${result.status}），可稍后在 packages/db-agent 运行 npm run govern`);
}
