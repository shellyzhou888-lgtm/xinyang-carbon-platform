import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import type pg from "pg";
import { REPO_ROOT } from "./db.js";
import { parseWorkbook } from "./parse.js";
import { loadTemplate } from "./template.js";

export interface IngestOptions {
  filePath: string;
  templateCode: string;
  sourceType?: "file_upload" | "form" | "api" | "estimated" | "system";
  note?: string;
  /** Run inside a transaction and roll back at the end; the file is not copied. */
  dryRun?: boolean;
  /** After loading, run engine.run_all for "VERSION:NODE_CODE:YEAR" (e.g. GIP_2026:XYEDZ:2023). */
  calc?: string;
  /** Allow draft formulas in the indicator step; results are returned but not written. */
  preview?: boolean;
  /** Marks the batch as AI/model estimates (placeholder data); blank 数据来源 cells then load as data_source = estimated. */
  estimated?: { method: string; inputs?: unknown; model?: string };
  /** The caller already opened a transaction (e.g. a multi-file test or an API route); do not begin/commit here. */
  externalTransaction?: boolean;
}

export interface IngestResult {
  dryRun: boolean;
  file: string;
  sha256: string;
  template: string;
  sheet: string;
  rowsRead: number;
  unknownHeaders: string[];
  documentId: number;
  batchId: number;
  load: unknown;
  calc?: unknown;
}

const STORAGE_DIR = join(REPO_ROOT, "storage", "uploads");

/**
 * Upload pipeline: parse Excel → keep the original file (storage/uploads) → raw.document /
 * raw.import_batch / raw.import_record (data lake) → engine.load_batch (warehouse).
 * Everything runs in one transaction; a failed parse leaves nothing behind.
 */
export async function ingestFile(client: pg.Client, opts: IngestOptions): Promise<IngestResult> {
  const template = await loadTemplate(client, opts.templateCode);
  const parsed = await parseWorkbook(opts.filePath, template);
  if (parsed.missingRequiredHeaders.length > 0) {
    throw new Error(`表头缺少必填列：${parsed.missingRequiredHeaders.join("、")}。请使用最新模板，不要修改表头。`);
  }
  if (parsed.rows.length === 0) throw new Error("没有读到任何数据行");

  const bytes = readFileSync(opts.filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ext = extname(opts.filePath).toLowerCase() || ".xlsx";
  // Original file is kept under storage/uploads/YYYY-MM/<sha256>.xlsx, copied only after the commit succeeds.
  const target = join(STORAGE_DIR, new Date().toISOString().slice(0, 7), `${sha256}${ext}`);
  const storageKey = opts.dryRun ? `dry-run://${basename(opts.filePath)}` : relative(REPO_ROOT, target).replaceAll("\\", "/");

  const own = !opts.externalTransaction;
  if (own) await client.query("begin");
  try {
    const doc = await client.query(
      `insert into raw.document (storage_key, original_name, mime_type, size_bytes, sha256, doc_kind, note)
       values ($1, $2, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', $3, $4, 'import_file', $5)
       returning document_id::int as document_id`,
      [storageKey, basename(opts.filePath), statSync(opts.filePath).size, sha256, opts.note ?? null],
    );
    const documentId: number = doc.rows[0].document_id;

    const notes = [opts.note, parsed.unknownHeaders.length ? `未识别的列（已原样入湖）：${parsed.unknownHeaders.join("、")}` : null]
      .filter(Boolean).join("；") || null;
    const batch = await client.query(
      `insert into raw.import_batch (source_type, source_name, document_id, template_id, note,
                                     estimation_method, estimation_inputs, model_name)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning batch_id::int as batch_id`,
      [opts.estimated ? "estimated" : opts.sourceType ?? "file_upload", basename(opts.filePath), documentId,
       template.template_id, notes, opts.estimated?.method ?? null,
       opts.estimated?.inputs === undefined ? null : JSON.stringify(opts.estimated.inputs), opts.estimated?.model ?? null],
    );
    const batchId: number = batch.rows[0].batch_id;

    await client.query(
      `insert into raw.import_record (batch_id, row_no, payload)
       select $1, (r ->> 'rowNo')::int, r -> 'payload' from jsonb_array_elements($2::jsonb) as r`,
      [batchId, JSON.stringify(parsed.rows)],
    );

    const load = (await client.query("select engine.load_batch($1) as r", [batchId])).rows[0].r;

    let calc: unknown;
    if (opts.calc) {
      const [version, node, year] = opts.calc.split(":");
      calc = (await client.query("select engine.run_all($1, $2, $3::int, $4) as r",
        [version, node, year, opts.preview ?? false])).rows[0].r;
    }

    if (own) await client.query(opts.dryRun ? "rollback" : "commit");
    if (own && !opts.dryRun) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(opts.filePath, target);
    }
    return {
      dryRun: !!opts.dryRun, file: opts.filePath, sha256, template: template.code, sheet: parsed.sheet,
      rowsRead: parsed.rows.length, unknownHeaders: parsed.unknownHeaders, documentId, batchId, load, calc,
    };
  } catch (err) {
    if (own) await client.query("rollback");
    throw err;
  }
}

/** Runs the calculation chain without importing anything. */
export async function runCalc(client: pg.Client, version: string, node: string, year: number,
                              preview: boolean, dryRun: boolean): Promise<unknown> {
  await client.query("begin");
  try {
    const r = (await client.query("select engine.run_all($1, $2, $3, $4) as r", [version, node, year, preview])).rows[0].r;
    await client.query(dryRun ? "rollback" : "commit");
    return r;
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}
