import "server-only";
import { createDbAgent, getParkOverview, initPool, loadConfig, logMessage } from "@xinyang/db-agent";

/**
 * Server-side access to the database agent. Secrets (DATABASE_URL, DEEPSEEK_API_KEY) are read from the
 * repository .env on the server only; nothing here is sent to the browser.
 */
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
