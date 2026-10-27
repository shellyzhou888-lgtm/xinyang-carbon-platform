import { pathToFileURL } from "node:url";
import { connect } from "./db.js";
import { governAfterLoad } from "./governance-hook.js";
import { chinaDay, fetchCeaFeed, fetchCcerFeed, type MarketDay, type MarketCode } from "../../db-agent/src/carbon-market-feed.js";

const FIELDS = ["open_price", "high_price", "low_price", "close_price", "avg_price", "volume_t", "turnover_yuan", "volume_listed_t", "turnover_listed_yuan", "volume_block_t", "turnover_block_yuan"] as const;
type Changes = { market: MarketCode; row: MarketDay; old: Record<string, any> | undefined; values: (number | null)[] };

/** Daily facts only: public intraday ticks are never saved as a final daily close. */
export async function syncCarbonMarket(dryRun = false) {
  const fetched = await Promise.allSettled([fetchCeaFeed(), fetchCcerFeed()]);
  const failures = fetched.flatMap((r, i) => r.status === "rejected" ? [{ market: i ? "CCER" : "CEA", error: String(r.reason) }] : []);
  const feeds = fetched.flatMap(r => r.status === "fulfilled" ? [r.value] : []);
  if (!feeds.length) throw new Error("所有碳价源暂不可用，未修改数据库");
  const client = await connect();
  let changed = 0, batchId: number | null = null;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('xinyang-carbon-market-sync'))");
    const changes: Changes[] = [];
    for (const feed of feeds) {
      const current = (await client.query('select *,trade_date::text as "day" from fact.carbon_market_price where market_code=$1 and is_current order by trade_date', [feed.market])).rows;
      const existing = new Map(current.map(r => [r.day, r]));
      const newest = current.at(-1)?.day;
      const lookback = newest ? new Date(Date.parse(`${newest}T00:00:00Z`) - 7 * 86400_000).toISOString().slice(0, 10) : chinaDay();
      const chinaHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
      for (const row of feed.daily.filter(r => r.date >= lookback && (r.date < chinaDay() || chinaHour >= 16))) {
        const old = existing.get(row.date);
        // An unverified reprint cannot correct an already-official record.
        if (old && row.sourceUrl.includes("ccn.ac.cn") && /(?:ccer|cbgex)\.com\.cn/.test(old.source_url || "")) continue;
        const provided = [row.open, row.high, row.low, row.close, row.average, row.volume, row.turnover, row.listedVolume, undefined, undefined, undefined];
        const values = provided.map((v, i) => v ?? (old?.[FIELDS[i]] != null ? Number(old[FIELDS[i]]) : null));
        const different = !old || provided.some((v, i) => v != null && (old[FIELDS[i]] == null || Math.abs(Number(old[FIELDS[i]]) - v) > .0001));
        const upgradedSource = old?.source_url?.includes("ccn.ac.cn") && !row.sourceUrl.includes("ccn.ac.cn");
        if (different || upgradedSource) changes.push({ market: feed.market, row, old, values });
      }
    }
    changed = changes.length;
    if (!dryRun && changed) {
      batchId = Number((await client.query(`insert into raw.import_batch(source_type,source_name,status,row_count,error_count,note)
        values('api','官方碳价与明确标注的公开转载自动同步',$1,$2,$3,$4) returning batch_id`,
      [failures.length ? "partially_loaded" : "loaded", changed, failures.length, JSON.stringify({ failures, warnings: feeds.map(f => ({ market: f.market, warning: f.warning })), intradayNotPersisted: true })])).rows[0].batch_id);
      for (const [index, change] of changes.entries()) {
        const { row, old, values, market } = change;
        if (old) await client.query("update fact.carbon_market_price set is_current=false where price_id=$1", [old.price_id]);
        const columns = ["market_code", "trade_date", ...FIELDS, "source_title", "source_url", "retrieved_at", "data_source", "batch_id", "note"];
        const args = [market, row.date, ...values, row.sourceTitle, row.sourceUrl, row.retrievedAt, "manual", batchId,
          row.sourceUrl.includes("ccn.ac.cn") ? "官方站不可达时的公开转载；来源明确标注，未声称为官方直连或盘中行情" : "公开发布的每日行情；不使用分时数据代替日收盘记录"];
        const id = (await client.query(`insert into fact.carbon_market_price(${columns.join(",")}) values(${args.map((_, i) => `$${i + 1}`).join(",")}) returning price_id`, args)).rows[0].price_id;
        if (old) await client.query("update fact.carbon_market_price set superseded_by=$1 where price_id=$2", [id, old.price_id]);
        await client.query(`insert into raw.import_record(batch_id,row_no,payload,parse_status,target_table,target_id)
          values($1,$2,$3::jsonb,'ok','fact.carbon_market_price',$4)`, [batchId, index + 1, JSON.stringify({ market, date: row.date, source_url: row.sourceUrl, retrieved_at: row.retrievedAt, response: row.raw }), id]);
      }
    }
    await client.query(dryRun ? "rollback" : "commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { await client.end(); }
  if (!dryRun && changed) governAfterLoad("import");
  return { dryRun, changed, batchId, failures, sources: feeds.map(f => ({ market: f.market, quoteDate: f.quote?.date, kind: f.quote?.kind, warning: f.warning })) };
}

async function main() {
  const watch = process.argv.includes("--watch"), dryRun = process.argv.includes("--dry-run");
  if (watch && dryRun) throw new Error("--watch 与 --dry-run 不能同时使用");
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...(await syncCarbonMarket(dryRun)) })); }
    catch (error) { console.error(error instanceof Error ? error.message : String(error)); if (!watch) process.exitCode = 1; }
    finally { busy = false; }
  };
  await run();
  if (watch) setInterval(() => { void run(); }, 5 * 60_000);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
