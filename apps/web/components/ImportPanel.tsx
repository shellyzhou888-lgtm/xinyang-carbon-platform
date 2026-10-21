"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { IconSpreadsheet, IconUpload } from "./icons";

type Template = { code: string; name: string; note: string };
type Result = { ok?: boolean; error?: string; template?: string; file?: string; batchId?: number | null; rowsRead?: number; unknownHeaders?: string[]; load?: unknown; dryRun?: boolean };

/**
 * Upload a filled template: validate first (dry run, nothing saved), then import. A real import records a batch,
 * keeps the original file and starts the governance step (semantic catalog, drafted descriptions, detection rules).
 */
export default function ImportPanel({ templates }: { templates: Template[] }) {
  const [template, setTemplate] = useState(templates[0]?.code ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"check" | "import" | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [checked, setChecked] = useState(false);
  const spec = templates.find((row) => row.code === template);

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(dryRun ? "check" : "import");
    setResult(null);
    const body = new FormData();
    body.set("file", file); body.set("template", template); body.set("dryRun", dryRun ? "1" : "0");
    try {
      const res = await fetch("/api/admin/import", { method: "POST", body });
      const json = (await res.json()) as Result;
      setResult(json);
      setChecked(dryRun && !!json.ok);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  const load = result?.load as Record<string, unknown> | undefined;
  return <div className="import-panel">
    <div className="import-steps">
      <label className="import-field"><span>① 选择模板</span>
        <select value={template} onChange={(e) => { setTemplate(e.target.value); setChecked(false); setResult(null); }}>
          {templates.map((row) => <option key={row.code} value={row.code}>{row.name}</option>)}
        </select>
        <small>{spec?.note} · <a href={`/api/admin/templates/${template}`}>下载模板</a></small>
      </label>
      <label className="import-field import-drop"><span>② 上传文件</span>
        <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setChecked(false); setResult(null); }} />
        <span className="import-file"><IconSpreadsheet size={18} />{file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : "点击选择 .xlsx 文件"}</span>
      </label>
      <div className="import-field"><span>③ 校验与导入</span>
        <div className="import-actions">
          <button type="button" className="btn-ghost small" disabled={!file || !!busy} onClick={() => send(true)}>{busy === "check" ? "校验中…" : "校验（不入库）"}</button>
          <button type="button" className="btn-primary small" disabled={!file || !checked || !!busy} onClick={() => send(false)}><IconUpload size={16} />{busy === "import" ? "导入中…" : "确认导入"}</button>
        </div>
        <small>先校验，通过后才能导入；导入后自动更新语义目录并运行数据检测。</small>
      </div>
    </div>
    {result && <motion.div className={`import-result ${result.ok ? "ok" : "bad"}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      {result.ok ? <>
        <b>{result.dryRun ? "校验通过（未写入）" : `已导入，批次 #${result.batchId}`}</b>
        <span>{result.template} · 读取 {result.rowsRead} 行{load && typeof load === "object" ? ` · ${Object.entries(load).filter(([, v]) => typeof v === "number").map(([k, v]) => `${k} ${v}`).join("，")}` : ""}</span>
        {!!result.unknownHeaders?.length && <span>未识别的列（原样保存）：{result.unknownHeaders.join("、")}</span>}
        {!result.dryRun && <span>语义目录与数据检测已在后台运行，结果见“数据治理”页。</span>}
      </> : <><b>未通过</b><span>{result.error}</span></>}
    </motion.div>}
  </div>;
}
