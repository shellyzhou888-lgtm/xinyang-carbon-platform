import "server-only";
import { admin, createManagerAgent, getChartData, getParkOverview, getManagementData, getDataInventory, getIndicatorConfiguration, getCarbonManagementData, getCarbonAsset, getFootprintComparison, getEnterpriseEnergyMix, getEnterpriseMonthly, importWorkbook, initPool, loadConfig, logMessage, ping, triggerGovernance } from "@xinyang/db-agent";

/** Administrator operations (governance page). Local single-user deployment: no login yet, the reviewer name comes from ADMIN_NAME. */
export function adminApi() {
  const cfg = loadConfig({ requireModelKey: false });
  initPool(cfg.databaseUrl);
  return { ...admin, reviewer: process.env.ADMIN_NAME || "管理员", runGovernance: () => triggerGovernance(loadConfig({ requireModelKey: false }), "manual") };
}

/**
 * Server-side access to the database agent. Secrets (DATABASE_URL, DEEPSEEK_API_KEY) are read from the
 * repository .env on the server only; nothing here is sent to the browser.
 */
export function charts(year: number) {
  initPool(loadConfig({ requireModelKey: false }).databaseUrl);
  return getChartData(year);
}

export function management(year: number) {
  initPool(loadConfig({ requireModelKey: false }).databaseUrl);
  return getManagementData(year);
}

export function carbonManagement(year: number) {
  initPool(loadConfig({ requireModelKey: false }).databaseUrl);
  return getCarbonManagementData(year);
}

/** Carbon-cost exposure per year and enterprise, with CEA / CCER prices (carbon asset tab). */
export function carbonAsset(yearFrom: number, yearTo: number) {
  initPool(loadConfig({ requireModelKey: false }).databaseUrl);
  return getCarbonAsset(yearFrom, yearTo);
}

/** Gate-to-gate product carbon intensity against reference footprints (carbon asset tab). */
export function footprintComparison(year: number) {
  initPool(loadConfig({ requireModelKey: false }).databaseUrl);
  return getFootprintComparison(year);
}

/** Monthly energy and CO2 per enterprise (spatial heat map and flow map). */
export function enterpriseMonthly(year: number) {
  initPool(loadConfig({ requireModelKey: false }).databaseUrl);
  return getEnterpriseMonthly(year);
}

/** Energy and CO2 per enterprise and energy carrier (flow network map). */
export function enterpriseEnergyMix(year: number) {
  initPool(loadConfig({ requireModelKey: false }).databaseUrl);
  return getEnterpriseEnergyMix(year);
}

/** Workbook import from the admin page; governance runs in the background after a real import. */
export function importData(request: Parameters<typeof importWorkbook>[1]) {
  return importWorkbook(loadConfig({ requireModelKey: false }), request);
}

export function inventory() {
  initPool(loadConfig({ requireModelKey: false }).databaseUrl);
  return getDataInventory();
}
export function indicatorConfiguration(version: string, year: number) {
  initPool(loadConfig({ requireModelKey: false }).databaseUrl);
  return getIndicatorConfiguration(version, year);
}

/** Connection status for the top-bar indicator. Never returns secrets, only whether each piece is usable. */
export async function health() {
  const cfg = loadConfig({ requireModelKey: false });
  initPool(cfg.databaseUrl);
  const db = await Promise.race([
    ping().then((r) => ({ ok: true as const, ms: r.ms, error: "" })),
    new Promise<{ ok: false; ms: number; error: string }>((resolve) => setTimeout(() => resolve({ ok: false, ms: 6000, error: "连接超时：请确认 SSH 隧道（本机 15432 端口）已打开" }), 6000)),
  ]).catch((err: unknown) => ({ ok: false as const, ms: 0, error: describeDbError(err) }));
  return { db, agent: { ok: Boolean(cfg.deepseekApiKey), error: cfg.deepseekApiKey ? "" : "未配置 DEEPSEEK_API_KEY" } };
}

function describeDbError(err: unknown) {
  const e = err as { code?: string; message?: string };
  if (e?.code === "ECONNREFUSED") return "数据库连接被拒绝：SSH 隧道未建立（scripts/start-db-tunnel.ps1）";
  if (e?.code === "28P01") return "数据库账号或密码错误：请检查 .env 中的 DATABASE_URL";
  if (e?.code === "3D000") return "数据库不存在：请检查 DATABASE_URL 中的库名";
  return e?.message || String(err);
}

export function overview(year: number) {
  const cfg = loadConfig({ requireModelKey: false });
  initPool(cfg.databaseUrl);
  return getParkOverview(year);
}

type Conversation = Awaited<ReturnType<typeof createManagerAgent>>;
const g = globalThis as unknown as { __conversations?: Map<string, Conversation> };
const conversations = (g.__conversations ??= new Map());

/** One Pi supervisor per browser conversation, kept in memory (local single-user deployment). */
export async function conversation(id: string): Promise<Conversation> {
  let c = conversations.get(id);
  if (!c) {
    c = await createManagerAgent(loadConfig(), { channel: "web", userRef: `web:${id}` });
    conversations.set(id, c);
  }
  return c;
}

export { logMessage };
