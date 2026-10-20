import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

/** Repository root (packages/ingest/src → ../../..). */
export const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");

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
