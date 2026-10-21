"use client";

import { useState } from "react";

export default function StrategyReportButton({ year }: { year: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function exportReport() {
    if (busy) return;
    const tab = window.open("", "_blank");
    if (!tab) { setError("浏览器拦截了报告窗口，请允许此站点打开新窗口后重试。"); return; }
    tab.document.write("<!doctype html><meta charset='utf-8'><title>正在生成报告</title><p style='font:18px sans-serif;padding:40px'>正在生成减碳策略报告，请稍候…</p>");
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/diagnosis/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year }) });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "报告生成失败，请稍后重试");
      }
      const html = await response.text();
      tab.document.open();
      tab.document.write(html);
      tab.document.close();
      tab.focus();
      await tab.document.fonts.ready;
      await Promise.all(Array.from(tab.document.images, (img) => img.decode().catch(() => undefined)));
      tab.print();
    } catch (reason) {
      tab.close();
      setError(reason instanceof Error ? reason.message : "报告生成失败，请稍后重试");
    } finally { setBusy(false); }
  }

  return <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
    <button type="button" className="btn-primary strategy-export" onClick={exportReport} disabled={busy} aria-busy={busy}>{busy ? "正在生成报告…" : "↓ DeepSeek 减碳报告 · PDF"}</button>
    {error && <small role="alert" style={{ color: "#f2a493" }}>{error}</small>}
  </span>;
}
