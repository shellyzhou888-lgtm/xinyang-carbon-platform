import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "./config.js";

/**
 * Harness-native trajectory log (after HarnessSQL, arXiv 2610.12274): every answered question is stored with its
 * complete interaction — model turns, tool calls and the tool observations the model actually saw — in the same
 * form the agent runs in. These records are the raw material for fine-tuning a small model later; a trajectory
 * counts as verified when one of its executed SQL statements becomes an approved question–SQL pair
 * (semantic.qa_pair), see trajectory-export.ts.
 *
 * Written to storage/trajectories/YYYY-MM-DD.jsonl (git-ignored). Set AGENT_TRAJECTORY_LOG=off to disable.
 */
export interface TrajectoryMeta {
  session_id: string;
  channel: string;
  model: string;
  question: string | undefined;
  started_at: string;
  finished_at: string;
  tool_calls: number;
  tool_errors: number;
  repeated_calls_blocked: number;
  sql_failures: number;
  sql_hashes: string[];          // md5 of normalised SQL that executed successfully (joins to semantic.qa_pair.sql_hash)
}

export function recordTrajectory(meta: TrajectoryMeta, messages: unknown[]) {
  if ((process.env.AGENT_TRAJECTORY_LOG ?? "").toLowerCase() === "off") return;
  try {
    const dir = resolve(REPO_ROOT, "storage", "trajectories");
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ...meta, messages }, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
    appendFileSync(resolve(dir, `${meta.finished_at.slice(0, 10)}.jsonl`), line + "\n", "utf8");
  } catch (err) {
    console.error("[trajectory]", (err as Error).message);   // logging must never break an answer
  }
}

/** Stable key of a tool call: same tool and same arguments regardless of key order. */
export function callKey(name: string, args: unknown): string {
  const norm = (v: unknown): unknown => Array.isArray(v) ? v.map(norm)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as any)[k])]))
    : typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v;
  return `${name}:${JSON.stringify(norm(args))}`;
}
