import "server-only";
import { admin, createDbAgent, getChartData, getParkOverview, initPool, loadConfig, logMessage, triggerGovernance } from "@xinyang/db-agent";

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

export function overview(year: number) {
  const cfg = loadConfig({ requireModelKey: false });
  initPool(cfg.databaseUrl);
  return getParkOverview(year);
}

type Conversation = Awaited<ReturnType<typeof createDbAgent>>;
const g = globalThis as unknown as { __conversations?: Map<string, Conversation> };
const conversations = (g.__conversations ??= new Map());

/** One Pi agent per browser conversation, kept in memory (local single-user deployment). */
export async function conversation(id: string): Promise<Conversation> {
  let c = conversations.get(id);
  if (!c) {
    // Web has no confirmation dialog yet: writeMode "confirm" therefore refuses writes; "auto" runs them.
    c = await createDbAgent(loadConfig(), { channel: "web", userRef: `web:${id}` });
    conversations.set(id, c);
  }
  return c;
}

export { logMessage };
