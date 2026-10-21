import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Repository root: XINYANG_REPO_ROOT, or the first parent directory containing VERSION and database/.
 * Found by walking up so it works from src/, from the bundled dist/, and when loaded by the web app or Xiaoyun backend.
 * Bundlers (Next.js Turbopack) may leave import.meta.dirname undefined, so the working directory is tried as well.
 */
function findRepoRoot(): string {
  if (process.env.XINYANG_REPO_ROOT) return process.env.XINYANG_REPO_ROOT;
  for (const start of [import.meta.dirname, process.cwd()]) {
    let dir = start;
    for (let i = 0; dir && i < 8; i++) {
      if (existsSync(resolve(dir, "VERSION")) && existsSync(resolve(dir, "database"))) return dir;
      dir = resolve(dir, "..");
    }
  }
  throw new Error("找不到项目根目录，请设置 XINYANG_REPO_ROOT");
}
export const REPO_ROOT = findRepoRoot();

/** Reads KEY from the environment first, then from the repository .env (BOM-safe). Secrets never live in code. */
function setting(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const file = resolve(REPO_ROOT, ".env");
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim().replace(/^"|"$/g, "");
}

export type WriteMode = "auto" | "confirm" | "off";

export interface AgentConfig {
  databaseUrl: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  model: string;
  thinking: "off" | "low" | "medium" | "high";
  /** auto: write tools run directly; confirm: ask in the terminal first; off: write tools are not loaded. */
  writeMode: WriteMode;
  maxToolCallsPerPrompt: number;
  sqlRowLimit: number;
  sqlTimeoutMs: number;
}

/** requireModelKey = false for consumers that only use the database tools (e.g. the Xiaoyun voice backend). */
export function loadConfig(opts: { requireModelKey?: boolean } = {}): AgentConfig {
  const databaseUrl = setting("DATABASE_URL");
  const deepseekApiKey = setting("DEEPSEEK_API_KEY") ?? "";
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL（.env 或环境变量）");
  if (!deepseekApiKey && opts.requireModelKey !== false) throw new Error("缺少 DEEPSEEK_API_KEY：请在 .env 中添加一行 DEEPSEEK_API_KEY=sk-...（.env 不会提交 git）");
  return {
    databaseUrl,
    deepseekApiKey,
    deepseekBaseUrl: setting("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com",
    model: setting("DEEPSEEK_MODEL") ?? "deepseek-flash",
    thinking: (setting("AGENT_THINKING") as AgentConfig["thinking"]) ?? "off",
    writeMode: (setting("AGENT_WRITE_MODE") as WriteMode) ?? "auto",
    maxToolCallsPerPrompt: Number(setting("AGENT_MAX_TOOL_CALLS") ?? 20),
    sqlRowLimit: Number(setting("AGENT_SQL_ROW_LIMIT") ?? 200),
    sqlTimeoutMs: Number(setting("AGENT_SQL_TIMEOUT_MS") ?? 5000),
  };
}
