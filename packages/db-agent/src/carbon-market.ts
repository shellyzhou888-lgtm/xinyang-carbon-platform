import { readOnly } from "./db.js";
import { fetchCeaFeed, fetchCcerFeed, type MarketCode, type MarketFeed, type MarketQuote } from "./carbon-market-feed.js";

export interface CarbonMarketSnapshot {
  checkedAt: string; refreshSeconds: number;
  markets: { code: MarketCode; name: string; quote: MarketQuote | null; status: "live" | "reprint" | "cached" | "unavailable";
    warning: string | null; daily: { date: string; price: number }[] }[];
}
type Stored = { market: MarketCode; date: string; price: number; sourceUrl: string | null; sourceTitle: string | null; retrievedAt: string | null };
const state: { at: number; data: CarbonMarketSnapshot | null; pending: Promise<CarbonMarketSnapshot> | null } = { at: 0, data: null, pending: null };

/** The latest market date is independent of the accounting year selected on the dashboard. No database writes here. */
async function snapshot(): Promise<CarbonMarketSnapshot> {
  const stored = readOnly(async c => (await c.query(`
    select market_code market, trade_date::text date, coalesce(close_price,avg_price)::float price,
           source_url as "sourceUrl", source_title as "sourceTitle", retrieved_at::text as "retrievedAt"
      from (select *, row_number() over (partition by market_code order by trade_date desc) rank
              from fact.carbon_market_price where is_current and market_code in ('CEA','CCER') and coalesce(close_price,avg_price)>0) x
     where rank<=120 order by market_code,trade_date`)).rows as Stored[]).catch(() => []);
  const [history, feeds] = await Promise.all([stored, Promise.allSettled([fetchCeaFeed(), fetchCcerFeed()])]);
  const markets = (["CEA", "CCER"] as const).map((code, index) => {
    const result = feeds[index];
    const feed: MarketFeed | null = result.status === "fulfilled" ? result.value : null;
    const old = history.filter(r => r.market === code);
    const merged = new Map(old.map(r => [r.date, { date: r.date, price: r.price }]));
    for (const r of feed?.daily || []) merged.set(r.date, { date: r.date, price: r.price });
    const daily = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
    let quote = feed?.quote ? { ...feed.quote } : null;
    const last = old.at(-1);
    // Never replace a newer published record with an older response from an upstream cache.
    if (last && (!quote || last.date > quote.date)) {
      const prior = old.filter(r => r.date < last.date).at(-1);
      const previous = prior && Date.parse(last.date) - Date.parse(prior.date) <= 4 * 86400_000 ? prior.price : null;
      quote = { date: last.date, time: null, price: last.price, previous, changePct: previous ? (last.price - previous) / previous * 100 : null,
        kind: code === "CEA" ? "close" : "average", sourceUrl: last.sourceUrl || "", sourceTitle: last.sourceTitle || "已入库日行情",
        retrievedAt: last.retrievedAt || "", reprinted: /转载/.test(last.sourceTitle || "") };
      return { code, name: code === "CEA" ? "全国碳配额" : "自愿减排量", quote, status: "cached" as const,
        warning: "上游暂未取得更新数据，保留最近入库行情", daily };
    }
    if (quote && quote.previous == null && quote.changePct == null) {
      const previous = daily.filter(r => r.date < quote!.date).at(-1);
      quote.previous = previous && Date.parse(quote.date) - Date.parse(previous.date) <= 4 * 86400_000 ? previous.price : null;
      quote.changePct = quote.previous ? (quote.price - quote.previous) / quote.previous * 100 : null;
    }
    return { code, name: code === "CEA" ? "全国碳配额" : "自愿减排量", quote,
      status: !quote ? "unavailable" as const : quote.reprinted ? "reprint" as const : "live" as const,
      warning: feed?.warning ?? (!quote ? "行情源暂不可用" : null), daily };
  });
  return { checkedAt: new Date().toISOString(), refreshSeconds: 60, markets };
}

/** Coalesce simultaneous requests and limit public-source polling to once per minute per server process. */
export function getCarbonMarketSnapshot(): Promise<CarbonMarketSnapshot> {
  if (state.data && Date.now() - state.at < 60_000) return Promise.resolve(state.data);
  if (state.pending) return state.pending;
  state.pending = snapshot().then(data => { state.data = data; state.at = Date.now(); return data; }).finally(() => { state.pending = null; });
  return state.pending;
}
