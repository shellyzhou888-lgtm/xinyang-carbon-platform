import test from "node:test";
import assert from "node:assert/strict";
import { chinaDay, validDay, parseCeaHistory, parseCeaQuote, parseCcerReprint, parseCcerOfficial } from "../../db-agent/src/carbon-market-feed.js";

const at = "2026-10-27T12:00:00.000Z", today = "2026-10-27";
const cea = [["2026-10-26", "96.79", "95.08", "94.50", "96.79", "1477652"], ["2026-10-27", "94.50", "94.92", "94.50", "95.10", "1478869"]];

test("China trading date uses Shanghai midnight independently of host timezone", () => {
  assert.equal(chinaDay(new Date("2026-10-26T16:01:00Z")), today);
  assert.equal(validDay("20261027", today), today);
  assert.throws(() => validDay("2026-02-30", today));
  assert.throws(() => validDay("2026-10-28", today));
});
test("CEA official array positions distinguish closing price and listed volume from total volume", () => {
  const rows = parseCeaHistory(cea, at, today);
  assert.equal(rows[1].price, 94.92);
  assert.equal(rows[1].listedVolume, 1478869);
  assert.equal(rows[1].volume, undefined);
  assert.equal(rows[1].close, 94.92);
});
test("CEA rejects malformed values, contradictory ranges and duplicate trading dates", () => {
  assert.throws(() => parseCeaHistory([[today, "", 94, 90, 95, 10]], at, today));
  assert.throws(() => parseCeaHistory([[today, 94, 98, 90, 95, 10]], at, today));
  assert.throws(() => parseCeaHistory([cea[0], cea[0]], at, today));
});
test("CEA published quote time and previous close drive the change; clock is never substituted", () => {
  const quote = parseCeaQuote({ currDate: "20261027", currTime: "15:00", lastPrice: "95.08" },
    [["09:30", "95.08", "0", "0", "0", "0", "0"], ["15:00", "94.92", "94.50", "95.10", "94.50", "0", "1,478,869"]], at, today);
  assert.equal(quote.kind, "intraday");
  assert.equal(quote.time, "15:00");
  assert.equal(quote.previous, 95.08);
  assert.ok(Math.abs(quote.changePct! - (-0.1682793437)) < .0001);
});
test("No-trade, invalid time and future ticks do not manufacture a current quote", () => {
  assert.throws(() => parseCeaQuote({ currDate: "20261027", currTime: "09:30", lastPrice: 95 }, [["09:30", 0, 0, 0, 0, 0, 0]], at, today));
  assert.throws(() => parseCeaQuote({ currDate: "20261027", currTime: "99:99", lastPrice: 95 }, [], at, today));
  assert.throws(() => parseCeaQuote({ currDate: "20261027", currTime: "09:30", lastPrice: 95 }, [["15:00", 94, 0, 0, 0, 0, 1]], at, today));
});
test("CCER official daily announcement keeps the volume, turnover, average and provenance", () => {
  const row = parseCcerOfficial("<p>2026年10月27日，核证自愿减排量成交量60,005吨，成交额5,604,477.50元，成交均价93.40元/吨。</p>", "https://www.ccer.com.cn/example", at, today);
  assert.equal(row.price, 93.4);
  assert.equal(row.close, undefined);
  assert.equal(row.volume, 60005);
});
function reprint(price = "93.40", source = "北京绿色交易所") {
  return `<h3>全国温室气体自愿减排交易行情<sub>（2026年10月27日）</sub></h3><div><p>成交量（吨）</p><p>成交额（元）</p><p>均价（元/吨）</p><p>涨跌幅（%）</p><p>60005</p><p>5604477.50</p><p>${price}</p><p>-1.91</p></div><p>来源：${source}</p>`;
}
test("CCER public reprint is explicitly identified and its published change is preserved", () => {
  const row = parseCcerReprint(reprint(), at, today);
  assert.equal(row.price, 93.4);
  assert.equal(row.changePct, -1.91);
  assert.match(row.sourceTitle, /转载/);
  assert.match(row.sourceUrl, /ccn\.ac\.cn/);
});
test("CCER reprint with a missing attribution or inconsistent arithmetic is rejected", () => {
  assert.throws(() => parseCcerReprint(reprint("99"), at, today));
  assert.throws(() => parseCcerReprint(reprint("93.40", "未知来源"), at, today));
});
