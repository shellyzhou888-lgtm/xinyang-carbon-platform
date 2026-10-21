import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDbAgent } from "./agent.js";
import { createManagerAgent, managerPrompt } from "./manager.js";
import { loadConfig, REPO_ROOT } from "./config.js";
import { closePool, initPool, readOnly } from "./db.js";

/**
 * Regression test set for the database agent (execution-verified, after HarnessSQL's hidden-oracle evaluation).
 *
 *   npm run eval                 all cases in eval/cases.json
 *   npm run eval -- E01 E05      selected cases
 *
 * For each case: the oracle SQL runs against the live database (so expectations follow the data), a fresh read-only
 * agent answers the question, and the case passes when every oracle number appears in the answer — rounding, thousands
 * separators and 万 / % scaling are tolerated — and every expect_text string is present. Protocol statistics (tool calls,
 * errors, repeated calls blocked, SQL repairs) come from the agent's own messages. Report: storage/eval/<time>.json.
 */
interface Case { id: string; question: string; oracle_sql: string; expect_text?: string[]; numbers?: boolean; tolerance?: number }

const cases: Case[] = JSON.parse(readFileSync(resolve(REPO_ROOT, "packages/db-agent/eval/cases.json"), "utf8"));
const only = process.argv.slice(2).filter((a) => /^E\d+$/i.test(a)).map((a) => a.toUpperCase());
const useManager = process.argv.includes("--manager");
const selected = only.length ? cases.filter((c) => only.includes(c.id)) : cases;

const numbersIn = (text: string) =>
  [...text.replace(/(\d),(?=\d{3})/g, "$1").matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

/** Matches within a relative tolerance, or when the answer and the oracle agree after rounding to the coarser of the two. */
function containsNumber(text: string, expected: number, tol: number) {
  const scales = [1, 1e4, 1e-4, 1e8, 100, 0.01];
  const decimals = (v: number) => (String(v).split(".")[1] ?? "").length;
  const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
  return numbersIn(text).some((x) => scales.some((s) => {
    const y = x * s;
    if (Math.abs(y - expected) <= Math.max(Math.abs(expected) * tol, 1e-9)) return true;
    const d = Math.min(decimals(roundTo(y, 6)), decimals(expected));
    return roundTo(y, d) === roundTo(expected, d);
  }));
}

function textOf(m: any): string {
  return typeof m.content === "string" ? m.content : (m.content ?? []).map((p: any) => p.text ?? "").join("");
}

const cfg = { ...loadConfig(), writeMode: "off" as const };
initPool(cfg.databaseUrl);
const results = [];
try {
  for (const k of selected) {
    const oracle = await readOnly(async (c) => (await c.query(k.oracle_sql)).rows[0] ?? {});
    const expected = Object.values(oracle).map(Number).filter((v) => Number.isFinite(v));
    // --manager evaluates the platform manager (the agent behind web chat and Xiaoyun) instead of the database agent.
    const { agent } = useManager ? await createManagerAgent(cfg, { channel: "web", userRef: "eval" }) : await createDbAgent(cfg, { channel: "system", userRef: "eval" });
    const t0 = Date.now();
    let error: string | undefined;
    try { await agent.prompt(useManager ? managerPrompt(k.question) : k.question); } catch (err) { error = (err as Error).message; }
    const msgs: any[] = agent.state.messages;
    const lastAssistant: any = [...msgs].reverse().find((m) => m.role === "assistant");
    if (!error && lastAssistant?.errorMessage) error = String(lastAssistant.errorMessage);
    const answer = textOf([...msgs].reverse().find((m) => m.role === "assistant") ?? {});
    const toolCalls = msgs.filter((m) => m.role === "assistant").flatMap((m) => (m.content ?? []).filter((p: any) => p.type === "toolCall"));
    const toolResults = msgs.filter((m) => m.role === "toolResult");
    const tol = k.tolerance ?? 0.006;
    const numberOk = k.numbers === false || expected.every((v) => containsNumber(answer, v, tol));
    const textOk = (k.expect_text ?? []).every((s) => answer.includes(s));
    const row = {
      id: k.id, question: k.question, pass: !error && numberOk && textOk, expected, number_ok: numberOk, text_ok: textOk,
      tool_calls: toolCalls.length, tool_errors: toolResults.filter((r) => r.isError).length,
      repeated_blocked: toolResults.filter((r) => textOf(r).includes("完全相同")).length,
      sql_calls: toolCalls.filter((t: any) => t.name === "query_sql").length,
      tools: toolCalls.map((t: any) => t.name), seconds: Math.round((Date.now() - t0) / 100) / 10, error,
      answer: answer.slice(0, 600),
    };
    results.push(row);
    console.log(`${row.pass ? "✓" : "✗"} ${k.id} ${k.question}  [${row.tools.join(" → ")}] ${row.seconds}s`
                + (row.pass ? "" : `  期望 ${expected.join(", ")}${(k.expect_text ?? []).length ? " / " + k.expect_text!.join("、") : ""}`));
  }
} finally {
  await closePool();
}

const n = results.length || 1;
const summary = {
  model: cfg.model, cases: results.length, passed: results.filter((r) => r.pass).length,
  accuracy_pct: Math.round((results.filter((r) => r.pass).length / n) * 1000) / 10,
  avg_tool_calls: Math.round((results.reduce((a, r) => a + r.tool_calls, 0) / n) * 10) / 10,
  with_tool_error_pct: Math.round((results.filter((r) => r.tool_errors > 0).length / n) * 100),
  with_repeated_blocked_pct: Math.round((results.filter((r) => r.repeated_blocked > 0).length / n) * 100),
  used_sql_pct: Math.round((results.filter((r) => r.sql_calls > 0).length / n) * 100),
  avg_seconds: Math.round((results.reduce((a, r) => a + r.seconds, 0) / n) * 10) / 10,
};
const dir = resolve(REPO_ROOT, "storage", "eval");
mkdirSync(dir, { recursive: true });
const file = resolve(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ summary, results }, null, 2), "utf8");
console.log(JSON.stringify(summary, null, 2), "\n报告：", file);
