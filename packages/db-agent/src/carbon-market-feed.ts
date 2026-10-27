/** Public exchange feeds. Intraday quotes are kept separate from published daily closing records. */
export type MarketCode = "CEA" | "CCER";
export type PriceKind = "intraday" | "close" | "average";
export interface MarketDay {
  date: string; price: number; open?: number; high?: number; low?: number; close?: number; average?: number; changePct?: number;
  volume?: number; turnover?: number; listedVolume?: number;
  sourceUrl: string; sourceTitle: string; retrievedAt: string; raw: unknown;
}
export interface MarketQuote {
  date: string; time: string | null; price: number; previous: number | null; changePct: number | null;
  kind: PriceKind; sourceUrl: string; sourceTitle: string; retrievedAt: string; reprinted: boolean;
}
export interface MarketFeed { market: MarketCode; daily: MarketDay[]; quote: MarketQuote | null; warning: string | null; }

export const MARKET_URLS = {
  ceaHistory: "https://shyx.cneeex.com/assets/json/hiskline.json",
  ceaDaily: "https://shyx.cneeex.com/assets/json/dailyov.json",
  ceaInfo: "https://shyx.cneeex.com/assets/json/prodinf.json",
  ceaTicks: "https://shyx.cneeex.com/assets/json/kline.json",
  ceaPage: "https://shyx.cneeex.com/quotshown.html",
  ccerDaily: "https://www.ccer.com.cn/wcm/ccer/html/2502lshq/index.html",
  ccerReprint: "https://www.ccn.ac.cn/cets",
} as const;

export function chinaDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function validDay(input: unknown, today = chinaDay()): string {
  if (typeof input !== "string") throw new Error("行情日期缺失");
  const date = /^\d{8}$/.test(input) ? `${input.slice(0, 4)}-${input.slice(4, 6)}-${input.slice(6)}` : input;
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date > today) throw new Error("行情日期无效或晚于当前日期");
  return date;
}

function number(input: unknown, positive = false): number {
  if ((typeof input !== "number" && typeof input !== "string") || String(input).trim() === "") throw new Error("行情数值缺失");
  const value = Number(String(input).replaceAll(",", ""));
  if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0)) throw new Error("行情数值无效");
  return value;
}

async function get(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "XinyangCarbonPlatform/0.61 public-market-data" } });
  if (!response.ok) throw new Error(`上游 HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("行情响应过大");
  return text;
}

export function parseCeaHistory(raw: unknown, retrievedAt: string, today = chinaDay()): MarketDay[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error("CEA 历史行情为空");
  const rows = raw.map((r: unknown) => {
    if (!Array.isArray(r) || r.length < 6) throw new Error("CEA 历史行情格式变化");
    const date = validDay(r[0], today), open = number(r[1], true), close = number(r[2], true), low = number(r[3], true), high = number(r[4], true);
    if (low > high || close < low - .01 || close > high + .01 || open < low - .01 || open > high + .01) throw new Error("CEA 价格区间不一致");
    return { date, price: close, open, close, low, high, listedVolume: number(r[5]), sourceUrl: MARKET_URLS.ceaHistory,
      sourceTitle: "上海环境能源交易所：全国碳市场历史综合价格行情", retrievedAt, raw: r };
  });
  if (new Set(rows.map(r => r.date)).size !== rows.length) throw new Error("CEA 行情存在重复日期");
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export function parseCeaQuote(info: unknown, ticks: unknown, retrievedAt: string, today = chinaDay()): MarketQuote {
  const data = info as Record<string, unknown>;
  const date = validDay(data?.currDate, today);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(data.currTime)) || !Array.isArray(ticks)) throw new Error("CEA 分时格式变化");
  const latest = [...ticks].reverse().find(r => Array.isArray(r) && number(r[6]) > 0);
  if (!latest || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(latest[0]) || latest[0] > String(data.currTime)) throw new Error("CEA 分时尚无有效成交");
  const price = number(latest[1], true), previous = number(data.lastPrice, true);
  return { date, time: latest[0], price, previous, changePct: (price - previous) / previous * 100, kind: "intraday",
    sourceUrl: MARKET_URLS.ceaPage, sourceTitle: "上海环境能源交易所·公开分时行情", retrievedAt, reprinted: false };
}

function textOnly(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&(?:ldquo|rdquo|quot);/g, '"').replace(/\s+/g, " ");
}

export function parseCcerReprint(html: string, retrievedAt: string, today = chinaDay()): MarketDay {
  const block = html.match(/<h3[^>]*>全国温室气体自愿减排交易行情[\s\S]*?来源[：:]北京绿色交易所[\s\S]*?<\/p>/)?.[0];
  if (!block) throw new Error("CCER 转载行情结构变化或来源缺失");
  const dateParts = block.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
  if (!dateParts) throw new Error("CCER 转载行情日期缺失");
  const date = validDay(`${dateParts[1]}-${dateParts[2].padStart(2, "0")}-${dateParts[3].padStart(2, "0")}`, today);
  const body = block.slice(block.indexOf("</h3>") + 5);
  const values = [...textOnly(body).matchAll(/[+-]?\d[\d,]*(?:\.\d+)?/g)].map(m => m[0]);
  if (values.length !== 4) throw new Error("CCER 转载行情字段数变化");
  const volume = number(values[0]), turnover = number(values[1]), average = number(values[2], true), changePct = Number(values[3]);
  if (!Number.isFinite(changePct) || changePct <= -100) throw new Error("CCER 转载涨跌幅无效");
  if (!volume || Math.abs(turnover / volume - average) > .02) throw new Error("CCER 转载成交量、额与均价不一致");
  return { date, price: average, average, volume, turnover, changePct, sourceUrl: MARKET_URLS.ccerReprint,
    sourceTitle: "碳中和网转载北京绿色交易所·CCER 每日行情", retrievedAt, raw: { html: block } };
}

export function parseCcerOfficial(html: string, sourceUrl: string, retrievedAt: string, today = chinaDay()): MarketDay {
  const text = textOnly(html);
  const match = text.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日[，,]\s*核证自愿减排量成交量\s*([\d,]+)吨[，,]\s*成交额\s*([\d,.]+)元[，,]\s*成交均价\s*([\d.]+)元/);
  if (!match) throw new Error("CCER 官方日行情正文未匹配");
  const date = validDay(`${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`, today);
  const volume = number(match[4]), turnover = number(match[5]), average = number(match[6], true);
  if (!volume || Math.abs(turnover / volume - average) > .02) throw new Error("CCER 官方成交数据不一致");
  return { date, price: average, average, volume, turnover, sourceUrl, sourceTitle: "北京绿色交易所·CCER 每日行情", retrievedAt, raw: { text: match[0] } };
}

export async function fetchCeaFeed(): Promise<MarketFeed> {
  const retrievedAt = new Date().toISOString();
  const [history, info, ticks] = await Promise.allSettled([get(MARKET_URLS.ceaHistory), get(MARKET_URLS.ceaInfo), get(MARKET_URLS.ceaTicks)]);
  let daily: MarketDay[] = [], quote: MarketQuote | null = null, warning: string | null = null;
  try {
    if (history.status !== "fulfilled") throw new Error();
    const raw: unknown = JSON.parse(history.value);
    // Recent prices are sufficient for this screen and incremental sync. Leave older published anomalies untouched.
    daily = parseCeaHistory(Array.isArray(raw) ? raw.slice(-180) : raw, retrievedAt);
  } catch { warning = "公开历史行情暂未取得，保留库中历史记录"; }
  try {
    if (info.status !== "fulfilled" || ticks.status !== "fulfilled") throw new Error("分时源暂不可用");
    quote = parseCeaQuote(JSON.parse(info.value), JSON.parse(ticks.value), retrievedAt);
  } catch {
    const latest = daily.at(-1), previous = daily.at(-2)?.price ?? null;
    if (latest) quote = { date: latest.date, time: null, price: latest.price, previous, changePct: previous ? (latest.price - previous) / previous * 100 : null,
      kind: "close", sourceUrl: MARKET_URLS.ceaPage, sourceTitle: "上海环境能源交易所·每日收盘行情", retrievedAt, reprinted: false };
    warning = "分时源暂不可用，显示最近已发布收盘价";
  }
  if (!quote && !daily.length) throw new Error("CEA 行情源暂不可用");
  return { market: "CEA", daily, quote, warning };
}

export async function fetchCcerFeed(): Promise<MarketFeed> {
  const retrievedAt = new Date().toISOString();
  let row: MarketDay, warning: string | null = null, reprinted = false;
  try {
    const list = await get(MARKET_URLS.ccerDaily);
    const links = [...list.matchAll(/href=["']([^"']+\.shtml)["']/g)];
    const urls = links.map(m => new URL(m[1], MARKET_URLS.ccerDaily)).filter(u => u.origin === "https://www.ccer.com.cn" && /^\/wcm\/ccer\/html\/2502lshq\/20\d{6}\/\d+\.shtml$/.test(u.pathname)).sort((a, b) => b.pathname.localeCompare(a.pathname));
    if (!urls[0]) throw new Error("官方公告列表暂不可用");
    row = parseCcerOfficial(await get(urls[0].href), urls[0].href, retrievedAt);
  } catch {
    row = parseCcerReprint(await get(MARKET_URLS.ccerReprint), retrievedAt);
    reprinted = true;
    warning = "官方站暂不可达，当前为碳中和网转载的北京绿色交易所日行情";
  }
  return { market: "CCER", daily: [row], quote: { date: row.date, time: null, price: row.price, previous: null, changePct: row.changePct ?? null,
    kind: "average", sourceUrl: row.sourceUrl, sourceTitle: row.sourceTitle, retrievedAt, reprinted }, warning };
}
