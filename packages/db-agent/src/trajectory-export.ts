import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, REPO_ROOT } from "./config.js";
import { closePool, initPool, readOnly } from "./db.js";

/**
 * npm run trajectories
 *
 * Reads storage/trajectories/*.jsonl and
 *   1. prints interaction statistics (after HarnessSQL's behaviour analysis): calls per question, tool errors,
 *      repeated calls blocked, SQL repairs;
 *   2. writes storage/trajectories/verified.jsonl: trajectories in which at least one executed SQL statement is an
 *      approved question–SQL pair (semantic.qa_pair, status = approved). These are the harness-native, execution-
 *      verified examples to use if a small model is fine-tuned later.
 */
const dir = resolve(REPO_ROOT, "storage", "trajectories");
let files: string[] = [];
try { files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort(); } catch { /* none yet */ }
const rows = files.flatMap((f) => readFileSync(resolve(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));

initPool(loadConfig({ requireModelKey: false }).databaseUrl);
try {
  const approved = new Set(await readOnly(async (c) =>
    (await c.query(`select sql_hash from semantic.qa_pair where status = 'approved'`)).rows.map((r) => r.sql_hash as string)));
  const verified = rows.filter((r) => (r.sql_hashes ?? []).some((h: string) => approved.has(h)));
  writeFileSync(resolve(dir, "verified.jsonl"), verified.map((r) => JSON.stringify(r)).join("\n") + (verified.length ? "\n" : ""), "utf8");

  const n = rows.length || 1;
  const pct = (k: (r: any) => boolean) => `${Math.round((rows.filter(k).length / n) * 100)}%`;
  console.log(JSON.stringify({
    trajectories: rows.length,
    by_channel: rows.reduce((a: Record<string, number>, r) => ({ ...a, [r.channel]: (a[r.channel] ?? 0) + 1 }), {}),
    avg_tool_calls: Math.round((rows.reduce((a, r) => a + (r.tool_calls ?? 0), 0) / n) * 10) / 10,
    with_tool_error: pct((r) => r.tool_errors > 0),
    with_repeated_call_blocked: pct((r) => r.repeated_calls_blocked > 0),
    with_sql_repair: pct((r) => r.sql_failures > 0),
    with_executed_sql: pct((r) => (r.sql_hashes ?? []).length > 0),
    verified: verified.length,
    output: "storage/trajectories/verified.jsonl",
  }, null, 2));
} finally {
  await closePool();
}
