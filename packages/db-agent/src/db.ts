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

export function initPool(connectionString: string) {
  pool = new pg.Pool({ connectionString, max: 4 });
  return pool;
}

function getPool(): pg.Pool {
  if (!pool) throw new Error("database pool not initialised");
  return pool;
}

export async function closePool() {
  await pool?.end();
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
