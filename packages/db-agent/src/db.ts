import pg from "pg";

/**
 * Three ways the agent touches the database. Each runs inside its own transaction and switches to the
 * smallest role that can do the job (SET LOCAL ROLE ends with the transaction).
 *
 *   readOnly()   fixed query tools   role green_app      + READ ONLY transaction → PostgreSQL rejects any write
 *   sandboxSql() model-written SQL   role green_agent_ro + READ ONLY + timeout   → only mart views and core dictionaries
 *   write()      write tools         role green_app (data) or green_ddl (CREATE/ALTER ADD) → no DELETE/DROP anywhere
 */

let pool: pg.Pool | undefined;
let poolUrl: string | undefined;

/** Creates the shared pool once; later calls reuse it (the web app creates one agent per conversation). */
export function initPool(connectionString: string) {
  poolUrl ??= connectionString;
  // The database is reached through an SSH tunnel that can drop. Without these limits a pooled socket left dead by a
  // dropped tunnel made the next query hang until the OS TCP timeout (minutes), stalling page renders:
  //   idleTimeoutMillis  close idle connections early so stale sockets are not reused;
  //   keepAlive          detect a silently dropped peer;
  //   connectionTimeout  fail fast when the tunnel is down; query_timeout  a hung query errors instead of blocking.
  if (!pool) {
    pool = new pg.Pool({ connectionString, max: 8, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 8_000,
      keepAlive: true, keepAliveInitialDelayMillis: 10_000, query_timeout: 60_000 });
    // A connection that dies while idle emits "error" on the pool; without a listener Node treats it as uncaught.
    pool.on("error", (err) => console.warn("[db] idle connection dropped:", err.message));
  }
  return pool;
}

function getPool(): pg.Pool {
  if (!pool) throw new Error("database pool not initialised");
  return pool;
}

/**
 * Health check for the web status indicator: one trivial round trip with its latency. Uses its own short-lived
 * connection so a pool busy with page queries is not misreported as "database down".
 */
export async function ping(): Promise<{ ok: true; ms: number }> {
  if (!poolUrl) throw new Error("database pool not initialised");
  const client = new pg.Client({ connectionString: poolUrl, connectionTimeoutMillis: 5000 });
  const started = Date.now();
  try {
    await client.connect();
    await client.query("SELECT 1");
    return { ok: true, ms: Date.now() - started };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function closePool() {
  await pool?.end();
  pool = undefined;
}

async function inTransaction<T>(begin: string, role: string, fn: (c: pg.PoolClient) => Promise<T>,
                                setup: string[] = [], commit = false): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query(begin);
    await client.query(`SET LOCAL ROLE ${role}`);
    for (const s of setup) await client.query(s);
    const result = await fn(client);
    await client.query(commit ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Fixed query tools: full read access to business tables, but the transaction cannot write. */
export function readOnly<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  return inTransaction("BEGIN READ ONLY", "green_app", fn);
}

/** Model-written SQL: green_agent_ro (mart + core only), read-only, statement timeout. */
export function sandboxSql<T>(timeoutMs: number, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  return inTransaction("BEGIN READ ONLY", "green_agent_ro", fn, [`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`]);
}

/** Write tools: committed transaction under green_app (DML) or green_ddl (CREATE / ALTER ... ADD). */
export function write<T>(role: "green_app" | "green_ddl", fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  return inTransaction("BEGIN", role, fn, [], true);
}

/** Agent logging uses its own short transactions so a failed tool never loses the audit trail. */
export async function logQuery(sql: string, params: unknown[]) {
  return getPool().query(sql, params);
}
