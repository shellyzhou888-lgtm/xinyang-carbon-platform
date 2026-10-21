import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type pg from "pg";
import { governAfterLoad } from "./governance-hook.js";
import { connect, REPO_ROOT } from "./db.js";

const NASA_PARAMETERS = [
  "ALLSKY_SFC_SW_DWN", "ALLSKY_SFC_SW_DNI", "ALLSKY_SFC_SW_DIFF", "CLRSKY_SFC_SW_DWN",
  "CLOUD_AMT", "T2M", "T2M_MAX", "T2M_MIN", "RH2M", "WS10M", "CDD18_3", "HDD18_3",
] as const;
const NASA_HOURLY_PARAMETERS = [
  "ALLSKY_SFC_SW_DWN", "ALLSKY_SFC_SW_DNI", "ALLSKY_SFC_SW_DIFF", "CLOUD_AMT",
  "T2M", "RH2M", "WS10M", "PRECTOTCORR",
] as const;
const NASA_LOCATION = "WGS84:114.12,32.22";
const AMAP_ADCODE = "411503";
const LOCK_KEY = "xinyang-weather-sync";
type SourceCode = "AMAP_WEATHER" | "NASA_POWER_DAILY" | "NASA_POWER_HOURLY";
type JsonObject = Record<string, any>;
type DailyRow = { day: string; code: string; value: number; unit: string; quality_flag: string; derivation: "api_daily" | "hourly_sum" };
type HourlyRow = { at: string; code: string; value: number; unit: string; quality_flag: "ok" | "suspect" };

function chinaDay(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function compactDay(day: string): string { return day.replaceAll("-", ""); }

function amapKey(): string {
  if (process.env.AMAP_WEB_SERVICE_KEY) return process.env.AMAP_WEB_SERVICE_KEY;
  const path = resolve(REPO_ROOT, "apps/web/.env.local");
  if (!existsSync(path)) throw new Error("缺少 AMAP_WEB_SERVICE_KEY：请配置 apps/web/.env.local 或环境变量");
  const line = readFileSync(path, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)
    .find((item) => item.startsWith("AMAP_WEB_SERVICE_KEY="));
  const key = line?.slice("AMAP_WEB_SERVICE_KEY=".length).trim().replace(/^"|"$/g, "");
  if (!key) throw new Error("AMAP_WEB_SERVICE_KEY 未配置");
  return key;
}

async function fetchJson(url: URL): Promise<JsonObject> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(45_000), headers: { "User-Agent": "XinyangCarbonPlatform/0.30 weather-sync" } });
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < 3) {
          await new Promise((done) => setTimeout(done, attempt * 2_000));
          continue;
        }
        throw new Error(`上游 HTTP ${response.status}`);
      }
      return await response.json() as JsonObject;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((done) => setTimeout(done, attempt * 2_000));
    }
  }
  throw new Error("上游请求失败");
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nasaQuality(code: string, value: number): "ok" | "suspect" {
  if (code.startsWith("ALLSKY_") || code === "CLRSKY_SFC_SW_DWN") return value >= 0 && value <= 16 ? "ok" : "suspect";
  if (code === "CLOUD_AMT" || code === "RH2M") return value >= 0 && value <= 100 ? "ok" : "suspect";
  if (code.startsWith("T2M")) return value >= -90 && value <= 65 ? "ok" : "suspect";
  if (code === "WS10M") return value >= 0 && value <= 100 ? "ok" : "suspect";
  return value >= 0 && value <= 500 ? "ok" : "suspect";
}

function nasaHourlyQuality(code: string, value: number): "ok" | "suspect" {
  if (code.startsWith("ALLSKY_")) return value >= 0 && value <= 2000 ? "ok" : "suspect";
  if (code === "PRECTOTCORR") return value >= 0 && value <= 100 ? "ok" : "suspect";
  return nasaQuality(code, value);
}

function amapQuality(...numbers: Array<number | null>): "ok" | "suspect" {
  const [temperature, humidity, secondTemperature] = numbers;
  return (temperature !== null && (temperature < -90 || temperature > 65))
    || (humidity !== null && (humidity < 0 || humidity > 100))
    || (secondTemperature !== null && (secondTemperature < -90 || secondTemperature > 65)) ? "suspect" : "ok";
}

function chinaTimestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    throw new Error("高德 reporttime 格式异常");
  }
  const timestamp = `${value.replace(" ", "T")}+08:00`;
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("高德 reporttime 无效");
  return timestamp;
}

async function sourceId(client: pg.Client, code: SourceCode): Promise<number> {
  const { rows } = await client.query("select source_id::int as source_id from raw.api_source where code=$1", [code]);
  if (!rows[0]) throw new Error(`缺少数据源 ${code}，请先应用天气数据迁移`);
  return rows[0].source_id;
}

function hash(payload: unknown): string { return createHash("sha256").update(JSON.stringify(payload)).digest("hex"); }

async function saveResponse(client: pg.Client, source: SourceCode, segment: string, raw: JsonObject,
                            normalized: unknown, rowCount: number, processRows: (sourceId: number, batchId: number) => Promise<number>) {
  const id = await sourceId(client, source);
  const sha = hash(normalized);
  await client.query("BEGIN");
  try {
    const prior = await client.query("select payload_sha256 from raw.api_sync_state where source_id=$1 and segment_key=$2 for update", [id, segment]);
    let changed = 0;
    let batchId: number | null = null;
    if (prior.rows[0]?.payload_sha256 !== sha) {
      const batch = await client.query(
        `insert into raw.import_batch(source_type,source_name,status,row_count,error_count,note)
         values('api',$1,'loaded',$2,0,$3) returning batch_id::int as batch_id`,
        [source, rowCount, `weather-sync ${segment}; 原始响应留存在 raw.import_record`],
      );
      const createdBatchId: number = batch.rows[0].batch_id;
      batchId = createdBatchId;
      await client.query("insert into raw.import_record(batch_id,row_no,payload,parse_status) values($1,1,$2::jsonb,'ok')", [createdBatchId, JSON.stringify(raw)]);
      changed = await processRows(id, createdBatchId);
    }
    await client.query(
      `insert into raw.api_sync_state(source_id,segment_key,payload_sha256,last_checked_at,last_success_at,last_batch_id,last_error)
       values($1,$2,$3,now(),now(),$4,null)
       on conflict(source_id,segment_key) do update set payload_sha256=excluded.payload_sha256,
         last_checked_at=now(),last_success_at=now(),last_batch_id=coalesce(excluded.last_batch_id,raw.api_sync_state.last_batch_id),last_error=null`,
      [id, segment, sha, batchId],
    );
    await client.query("update raw.api_source set last_run_at=now() where source_id=$1", [id]);
    await client.query("COMMIT");
    console.log(JSON.stringify({ source, segment, rows: rowCount, changed, batchId, unchanged: batchId === null }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function markError(client: pg.Client, source: SourceCode, segment: string, error: unknown) {
  const id = await sourceId(client, source);
  const message = error instanceof Error ? error.message : String(error);
  await client.query(
    `insert into raw.api_sync_state(source_id,segment_key,last_checked_at,last_error) values($1,$2,now(),$3)
     on conflict(source_id,segment_key) do update set last_checked_at=now(),last_error=excluded.last_error`,
    [id, segment, message.slice(0, 500)],
  );
}

async function upsertDailyRows(client: pg.Client, sourceId: number, batchId: number, rows: DailyRow[]): Promise<number> {
  const r = await client.query(
    `insert into fact.weather_daily(source_id,location_code,period_date,parameter_code,value,unit,quality_flag,batch_id,derivation)
     select $1,$2,to_date(x.day,'YYYYMMDD'),x.code,x.value,x.unit,x.quality_flag,$3,x.derivation
       from jsonb_to_recordset($4::jsonb) as x(day text,code text,value numeric,unit text,quality_flag text,derivation text)
     on conflict(source_id,location_code,period_date,parameter_code) do update
       set value=excluded.value,unit=excluded.unit,quality_flag=excluded.quality_flag,
           batch_id=excluded.batch_id,derivation=excluded.derivation,updated_at=now()
     where (fact.weather_daily.value,fact.weather_daily.unit,fact.weather_daily.quality_flag,fact.weather_daily.derivation)
           is distinct from (excluded.value,excluded.unit,excluded.quality_flag,excluded.derivation)`,
    [sourceId, NASA_LOCATION, batchId, JSON.stringify(rows)],
  );
  return r.rowCount ?? 0;
}

async function syncNasaRange(client: pg.Client, start: string, end: string, segment: string) {
  try {
    const url = new URL("https://power.larc.nasa.gov/api/temporal/daily/point");
    url.search = new URLSearchParams({ parameters: NASA_PARAMETERS.join(","), community: "RE", longitude: "114.12", latitude: "32.22",
      start: compactDay(start), end: compactDay(end), format: "JSON" }).toString();
    const raw = await fetchJson(url);
    if (raw.header?.fill_value === undefined || !raw.properties?.parameter || !raw.parameters) throw new Error("NASA POWER 响应结构异常");
    const fill = Number(raw.header.fill_value);
    const rows: DailyRow[] = [];
    for (const code of NASA_PARAMETERS) {
      const series = raw.properties.parameter[code];
      const unit = raw.parameters[code]?.units;
      if (!series || typeof unit !== "string") throw new Error(`NASA POWER 缺少字段 ${code}`);
      for (const [day, rawValue] of Object.entries(series)) {
        const value = numberOrNull(rawValue);
        if (!/^\d{8}$/.test(day) || value === null || value === fill) continue;
        rows.push({ day, code, value, unit, quality_flag: nasaQuality(code, value), derivation: "api_daily" });
      }
    }
    if (rows.length === 0) throw new Error("NASA POWER 当前区间没有有效值");
    rows.sort((a, b) => a.code.localeCompare(b.code) || a.day.localeCompare(b.day));
    await saveResponse(client, "NASA_POWER_DAILY", segment, raw, rows, rows.length,
      (id, batchId) => upsertDailyRows(client, id, batchId, rows));
  } catch (error) {
    await markError(client, "NASA_POWER_DAILY", segment, error);
    throw error;
  }
}

function shiftMonth(month: string, count: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date.toISOString().slice(0, 7);
}

async function syncNasaPrecipMonth(client: pg.Client, month: string, today: string) {
  const segment = `precip-${month}`;
  try {
    const start = `${month}-01`;
    const end = month === today.slice(0, 7)
      ? today : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
    const url = new URL("https://power.larc.nasa.gov/api/temporal/hourly/point");
    url.search = new URLSearchParams({ parameters: "PRECTOTCORR", community: "RE", longitude: "114.12", latitude: "32.22",
      start: compactDay(start), end: compactDay(end), format: "JSON" }).toString();
    const raw = await fetchJson(url);
    if (raw.parameters?.PRECTOTCORR?.units !== "mm/hour" || !raw.properties?.parameter?.PRECTOTCORR) {
      throw new Error("NASA POWER 小时降水响应或单位异常");
    }
    const fill = Number(raw.header?.fill_value ?? -999);
    const perDay = new Map<string, Map<string, number>>();
    for (const [hourKey, rawValue] of Object.entries(raw.properties.parameter.PRECTOTCORR)) {
      const value = numberOrNull(rawValue);
      if (!/^\d{10}$/.test(hourKey) || value === null || value === fill) continue;
      const day = hourKey.slice(0, 8);
      const hours = perDay.get(day) ?? new Map<string, number>();
      hours.set(hourKey.slice(8), value);
      perDay.set(day, hours);
    }
    const rows: DailyRow[] = [...perDay.entries()].filter(([, hours]) => hours.size === 24).map(([day, hours]): DailyRow => {
      const value = Number([...hours.values()].reduce((sum, hour) => sum + hour, 0).toFixed(3));
      const quality_flag = [...hours.values()].some((hour) => hour < 0 || hour > 100) ? "suspect" : nasaQuality("PRECTOTCORR", value);
      return { day, code: "PRECTOTCORR", value, unit: "mm/day", quality_flag, derivation: "hourly_sum" };
    }).sort((a, b) => a.day.localeCompare(b.day));
    if (rows.length === 0) throw new Error("NASA POWER 小时降水没有完整的 24 小时日值");
    const archive: JsonObject = { hourly: raw, daily_fallback: {} };
    for (const row of rows.filter((item) => item.quality_flag === "suspect")) {
      try {
        const fallbackUrl = new URL("https://power.larc.nasa.gov/api/temporal/daily/point");
        fallbackUrl.search = new URLSearchParams({ parameters: "PRECTOTCORR", community: "RE", longitude: "114.12", latitude: "32.22",
          start: row.day, end: row.day, format: "JSON" }).toString();
        const fallback = await fetchJson(fallbackUrl);
        archive.daily_fallback[row.day] = fallback;
        const value = numberOrNull(fallback.properties?.parameter?.PRECTOTCORR?.[row.day]);
        if (value !== null && value !== Number(fallback.header?.fill_value ?? -999) && nasaQuality("PRECTOTCORR", value) === "ok") {
          row.value = value;
          row.quality_flag = "ok";
          row.derivation = "api_daily";
        }
      } catch {
        // Keep the suspect hourly value visible for review if the single-day fallback is unavailable.
      }
    }
    await saveResponse(client, "NASA_POWER_DAILY", segment, archive, rows, rows.length,
      (id, batchId) => upsertDailyRows(client, id, batchId, rows));
  } catch (error) {
    await markError(client, "NASA_POWER_DAILY", segment, error);
    throw error;
  }
}

async function syncNasaHourlyMonth(client: pg.Client, month: string, today: string) {
  const segment = `hourly-${month}`;
  try {
    const start = `${month}-01`;
    const end = month === today.slice(0, 7)
      ? today : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
    const url = new URL("https://power.larc.nasa.gov/api/temporal/hourly/point");
    url.search = new URLSearchParams({ parameters: NASA_HOURLY_PARAMETERS.join(","), community: "RE",
      longitude: "114.12", latitude: "32.22", start: compactDay(start), end: compactDay(end),
      format: "JSON", "time-standard": "UTC" }).toString();
    const raw = await fetchJson(url);
    if (raw.header?.fill_value === undefined || !raw.properties?.parameter || !raw.parameters) {
      throw new Error("NASA POWER 小时响应结构异常");
    }
    const fill = Number(raw.header.fill_value);
    const rows: HourlyRow[] = [];
    for (const code of NASA_HOURLY_PARAMETERS) {
      const series = raw.properties.parameter[code];
      const unit = raw.parameters[code]?.units;
      if (!series || typeof unit !== "string") throw new Error(`NASA POWER 小时值缺少字段 ${code}`);
      for (const [hour, rawValue] of Object.entries(series)) {
        const value = numberOrNull(rawValue);
        if (!/^\d{8}(?:[01]\d|2[0-3])$/.test(hour) || value === null || value === fill) continue;
        const at = `${hour.slice(0, 4)}-${hour.slice(4, 6)}-${hour.slice(6, 8)}T${hour.slice(8)}:00:00Z`;
        if (!Number.isFinite(Date.parse(at))) continue;
        rows.push({ at, code, value, unit, quality_flag: nasaHourlyQuality(code, value) });
      }
    }
    if (rows.length === 0) throw new Error("NASA POWER 当前月份没有有效小时值");
    rows.sort((a, b) => a.code.localeCompare(b.code) || a.at.localeCompare(b.at));
    await saveResponse(client, "NASA_POWER_HOURLY", segment, raw, rows, rows.length, async (id, batchId) => {
      const result = await client.query(
        `insert into fact.weather_hourly(source_id,location_code,period_at,parameter_code,value,unit,quality_flag,batch_id)
         select $1,$2,x.at::timestamptz,x.code,x.value,x.unit,x.quality_flag,$3
           from jsonb_to_recordset($4::jsonb) as x(at text,code text,value numeric,unit text,quality_flag text)
         on conflict(source_id,location_code,period_at,parameter_code) do update
           set value=excluded.value,unit=excluded.unit,quality_flag=excluded.quality_flag,
               batch_id=excluded.batch_id,updated_at=now()
         where (fact.weather_hourly.value,fact.weather_hourly.unit,fact.weather_hourly.quality_flag)
               is distinct from (excluded.value,excluded.unit,excluded.quality_flag)`,
        [id, NASA_LOCATION, batchId, JSON.stringify(rows)],
      );
      return result.rowCount ?? 0;
    });
  } catch (error) {
    await markError(client, "NASA_POWER_HOURLY", segment, error);
    throw error;
  }
}

async function syncAmap(client: pg.Client, extension: "base" | "all") {
  const segment = extension === "base" ? "live" : "forecast";
  try {
    const url = new URL("https://restapi.amap.com/v3/weather/weatherInfo");
    url.search = new URLSearchParams({ key: amapKey(), city: AMAP_ADCODE, extensions: extension, output: "JSON" }).toString();
    const raw = await fetchJson(url);
    if (raw.status !== "1" || raw.infocode !== "10000") throw new Error(`高德天气接口失败（${String(raw.infocode ?? "unknown")}）`);
    if (extension === "base") {
      const live = raw.lives?.[0];
      if (!live || live.adcode !== AMAP_ADCODE) throw new Error("高德实况缺少平桥区记录");
      const normalized = {
        adcode: live.adcode, report_at: chinaTimestamp(live.reporttime), province: live.province ?? null, city: live.city ?? null,
        weather: live.weather ?? null, temperature_c: numberOrNull(live.temperature), humidity_pct: numberOrNull(live.humidity),
        wind_direction: live.winddirection ?? null, wind_power: live.windpower ?? null,
      };
      const quality = amapQuality(normalized.temperature_c, normalized.humidity_pct);
      await saveResponse(client, "AMAP_WEATHER", segment, raw, normalized, 1, async (id, batchId) => {
        const r = await client.query(
          `insert into fact.weather_live(source_id,adcode,report_at,province,city,weather,temperature_c,humidity_pct,
                                         wind_direction,wind_power,quality_flag,batch_id)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           on conflict(source_id,adcode,report_at) do nothing`,
          [id, normalized.adcode, normalized.report_at, normalized.province, normalized.city, normalized.weather,
            normalized.temperature_c, normalized.humidity_pct, normalized.wind_direction, normalized.wind_power, quality, batchId],
        );
        return r.rowCount ?? 0;
      });
    } else {
      const forecast = raw.forecasts?.[0];
      if (!forecast || forecast.adcode !== AMAP_ADCODE || !Array.isArray(forecast.casts) || forecast.casts.length === 0) {
        throw new Error("高德预报缺少平桥区日期记录");
      }
      const issued = chinaTimestamp(forecast.reporttime);
      const rows = forecast.casts.map((cast: JsonObject) => {
        if (typeof cast.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(cast.date)) throw new Error("高德预报日期无效");
        const dayTemp = numberOrNull(cast.daytemp), nightTemp = numberOrNull(cast.nighttemp);
        return { adcode: AMAP_ADCODE, issued_at: issued, forecast_date: cast.date,
          day_weather: cast.dayweather ?? null, night_weather: cast.nightweather ?? null,
          day_temp_c: dayTemp, night_temp_c: nightTemp, day_wind: cast.daywind ?? null, night_wind: cast.nightwind ?? null,
          day_wind_power: cast.daypower ?? null, night_wind_power: cast.nightpower ?? null,
          quality_flag: amapQuality(dayTemp, null, nightTemp) };
      });
      await saveResponse(client, "AMAP_WEATHER", segment, raw, rows, rows.length, async (id, batchId) => {
        const r = await client.query(
          `insert into fact.weather_forecast(source_id,adcode,issued_at,forecast_date,day_weather,night_weather,
             day_temp_c,night_temp_c,day_wind,night_wind,day_wind_power,night_wind_power,quality_flag,batch_id)
           select $1,x.adcode,x.issued_at::timestamptz,x.forecast_date::date,x.day_weather,x.night_weather,
                  x.day_temp_c,x.night_temp_c,x.day_wind,x.night_wind,x.day_wind_power,x.night_wind_power,x.quality_flag,$2
             from jsonb_to_recordset($3::jsonb) as x(adcode text,issued_at text,forecast_date text,
               day_weather text,night_weather text,day_temp_c numeric,night_temp_c numeric,day_wind text,
               night_wind text,day_wind_power text,night_wind_power text,quality_flag text)
           on conflict(source_id,adcode,issued_at,forecast_date) do nothing`,
          [id, batchId, JSON.stringify(rows)],
        );
        return r.rowCount ?? 0;
      });
    }
  } catch (error) {
    await markError(client, "AMAP_WEATHER", segment, error);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const source = args.find((arg) => arg.startsWith("--source="))?.split("=")[1] ?? "all";
  if (!["all", "amap", "nasa"].includes(source)) throw new Error("--source 只支持 all、amap、nasa");
  const backfill = args.includes("--backfill");
  const hourlyOnly = args.includes("--hourly-only");
  if (hourlyOnly && source === "amap") throw new Error("--hourly-only 仅适用于 NASA 来源");
  const precipitationFrom = args.find((arg) => arg.startsWith("--precip-from="))?.split("=")[1];
  if (precipitationFrom && !/^20\d{2}-(0[1-9]|1[0-2])$/.test(precipitationFrom)) {
    throw new Error("--precip-from 应为 YYYY-MM");
  }
  const hourlyFrom = args.find((arg) => arg.startsWith("--hourly-from="))?.split("=")[1];
  if (hourlyFrom && !/^20\d{2}-(0[1-9]|1[0-2])$/.test(hourlyFrom)) {
    throw new Error("--hourly-from 应为 YYYY-MM");
  }
  const client = await connect();
  try {
    const lock = await client.query("select pg_try_advisory_lock(hashtext($1)) as acquired", [LOCK_KEY]);
    if (!lock.rows[0]?.acquired) throw new Error("已有气象同步任务正在运行");
    try {
      if (source === "all" || source === "amap") {
        if (!hourlyOnly) {
          await syncAmap(client, "base");
          await syncAmap(client, "all");
        }
      }
      if (source === "all" || source === "nasa") {
        const today = chinaDay();
        const year = Number(today.slice(0, 4));
        if (backfill && !hourlyOnly) {
          for (let y = 2021; y <= year; y++) {
            const start = `${y}-01-01`;
            const end = y === year ? today : `${y}-12-31`;
            await syncNasaRange(client, start, end, String(y));
          }
        } else if (!hourlyOnly) {
          if (today.slice(5) < "05-01" && year > 2021) {
            await syncNasaRange(client, `${year - 1}-01-01`, `${year - 1}-12-31`, String(year - 1));
          }
          await syncNasaRange(client, `${year}-01-01`, today, String(year));
        }
        // The Daily API can scale PRECTOTCORR by 24 for long/recent ranges. Sum complete
        // 24-hour sets from the Hourly API instead, preserving the exact hourly response.
        if (!hourlyOnly) {
          const firstMonth = precipitationFrom ?? (backfill ? "2021-01" : shiftMonth(today.slice(0, 7), -5));
          for (let month = firstMonth; month <= today.slice(0, 7); month = shiftMonth(month, 1)) {
            await syncNasaPrecipMonth(client, month, today);
          }
        }
        const solarLatest = await client.query(
          `select min(to_char(latest_at at time zone 'UTC','YYYY-MM')) as oldest_solar_month
             from mart.weather_hourly_parameter_latest
            where parameter_code in ('ALLSKY_SFC_SW_DWN','ALLSKY_SFC_SW_DNI','ALLSKY_SFC_SW_DIFF','CLOUD_AMT')`,
        );
        const recentStart = shiftMonth(today.slice(0, 7), -5);
        const delayedSolarStart = solarLatest.rows[0]?.oldest_solar_month
          ? shiftMonth(solarLatest.rows[0].oldest_solar_month, -1) : recentStart;
        const firstHourlyMonth = hourlyFrom ?? (backfill ? "2021-01" :
          (delayedSolarStart < recentStart ? delayedSolarStart : recentStart));
        for (let month = firstHourlyMonth; month <= today.slice(0, 7); month = shiftMonth(month, 1)) {
          await syncNasaHourlyMonth(client, month, today);
        }
      }
    } finally {
      await client.query("select pg_advisory_unlock(hashtext($1))", [LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
  // New batches leave import events; govern --if-changed registers / documents them and does nothing otherwise.
  governAfterLoad("schedule");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
