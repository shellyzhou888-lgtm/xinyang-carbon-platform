"use client";

import { useEffect, useState } from "react";
import type { CarbonMarketSnapshot } from "@xinyang/db-agent";
import ComparisonChart from "./ComparisonChart";
import { Panel } from "./WorkspaceParts";
import { C } from "@/lib/chart-theme";
import { formatNumber as fmt } from "@/lib/workspace";

export default function LiveCarbonMarket({ initial }: { initial: CarbonMarketSnapshot | null }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true, controller: AbortController | null = null;
    const refresh = async () => {
      if (document.hidden || controller) return;
      controller = new AbortController();
      try {
        const res = await fetch("/api/carbon-market", { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error();
        const next = await res.json() as CarbonMarketSnapshot;
        if (!Array.isArray(next.markets) || !next.checkedAt) throw new Error();
        if (active) { setData(next); setError(""); }
      } catch {
        if (active) setError("刷新未成功，保留上次行情");
      } finally { controller = null; }
    };
    const timer = window.setInterval(refresh, 60_000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    if (!initial) void refresh();
    return () => { active = false; window.clearInterval(timer); controller?.abort(); document.removeEventListener("visibilitychange", visible); };
  }, [initial]);
  const markets = data?.markets || [];
  const dates = [...new Set(markets.flatMap(m => m.daily.map(p => p.date)))].sort().slice(-90);
  const checked = data?.checkedAt ? new Date(data.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "尚未取得";
  return <>
    <Panel className="screen-market-trend" title="碳市场价格趋势" subtitle="最近交易日：CEA 收盘价、CCER 成交均价；不受核算年份切换影响">
      <ComparisonChart labels={dates} unit="元/t" label="CEA与CCER每日价格趋势" series={markets.map((m, i) => ({ name: m.code === "CEA" ? "CEA 收盘价" : "CCER 成交均价",
        values: dates.map(date => m.daily.find(p => p.date === date)?.price ?? null), color: i ? C.info : C.accent }))} />
    </Panel>
    <Panel className="screen-market-quotes" title="碳市场最新行情" subtitle="每 60 秒自动检查；分时与日行情分别标注">
      <div className="live-quotes">{markets.map(m => <article key={m.code} className="live-quote">
        <header><b>{m.code} · {m.name}</b><span>{m.status === "cached" ? "缓存日行情" : m.quote?.kind === "intraday" ? "分时行情" : m.status === "reprint" ? "转载日行情" : "日行情"}</span></header>
        <div className="live-price"><strong className="num">{fmt(m.quote?.price, 2)}<small>元/t</small></strong>
          {m.quote?.changePct != null && <em className={m.quote.changePct >= 0 ? "up" : "down"}>{m.quote.changePct >= 0 ? "+" : ""}{fmt(m.quote.changePct, 2)}%</em>}</div>
        <p>行情时间：{m.quote?.date || "暂无"}{m.quote?.time ? ` ${m.quote.time}` : ""}{m.quote?.kind === "average" ? " · 成交均价" : m.quote?.kind === "close" ? " · 收盘价" : ""}</p>
        {m.quote?.sourceUrl && <a href={m.quote.sourceUrl} target="_blank" rel="noreferrer">{m.quote.sourceTitle}</a>}
        {m.warning && <p className="market-warning">{m.warning}</p>}
      </article>)}</div>
      <p className="market-checked" role="status">检查时间（北京时间）：{checked}{error ? ` · ${error}` : ""}</p>
    </Panel>
  </>;
}
