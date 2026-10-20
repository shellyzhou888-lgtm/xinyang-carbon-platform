import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Repository root (packages/db-agent/src → ../../..). */
export const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");

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
  model: string;
  thinking: "off" | "low" | "medium" | "high";
  /** auto: write tools run directly; confirm: ask in the terminal first; off: write tools are not loaded. */
  writeMode: WriteMode;
  maxToolCallsPerPrompt: number;
  sqlRowLimit: number;
  sqlTimeoutMs: number;
}

export function loadConfig(): AgentConfig {
  const databaseUrl = setting("DATABASE_URL");
  const deepseekApiKey = setting("DEEPSEEK_API_KEY");
  if (!databaseUrl) throw new Error("缺少 DATABASE_URL（.env 或环境变量）");
  if (!deepseekApiKey) throw new Error("缺少 DEEPSEEK_API_KEY：请在 .env 中添加一行 DEEPSEEK_API_KEY=sk-...（.env 不会提交 git）");
  return {
    databaseUrl,
    deepseekApiKey,
    model: setting("DEEPSEEK_MODEL") ?? "deepseek-flash",
    thinking: (setting("AGENT_THINKING") as AgentConfig["thinking"]) ?? "off",
    writeMode: (setting("AGENT_WRITE_MODE") as WriteMode) ?? "auto",
    maxToolCallsPerPrompt: Number(setting("AGENT_MAX_TOOL_CALLS") ?? 20),
    sqlRowLimit: Number(setting("AGENT_SQL_ROW_LIMIT") ?? 200),
    sqlTimeoutMs: Number(setting("AGENT_SQL_TIMEOUT_MS") ?? 5000),
  };
}
