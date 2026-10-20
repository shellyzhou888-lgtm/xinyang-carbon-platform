import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

/** Repository root: XINYANG_REPO_ROOT, or the first parent directory containing VERSION and database/ (works when bundled). */
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

/** Reads DATABASE_URL from the environment or the repository's .env (BOM-safe). */
export function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const text = readFileSync(resolve(REPO_ROOT, ".env"), "utf8").replace(/^﻿/, "");
  const line = text.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found in environment or .env");
  return line.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
}

export async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  return client;
}
