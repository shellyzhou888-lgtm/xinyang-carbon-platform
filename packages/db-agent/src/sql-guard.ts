/**
 * Lexical checks before any model-written SQL reaches PostgreSQL. They are a first line of defence;
 * the database roles and read-only transactions are the real guarantee.
 */

/** Removes comments and string literals so keyword checks only see SQL structure. */
function stripLiterals(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\$\$[\s\S]*?\$\$/g, "''");
}

function singleStatement(sql: string): string {
  const s = sql.trim().replace(/;\s*$/, "");
  if (stripLiterals(s).includes(";")) throw new Error("一次只能执行一条 SQL 语句");
  return s;
}

/** Read-only query: one SELECT/WITH statement. Returns the statement wrapped with a row limit. */
export function guardReadSql(sql: string, rowLimit: number): string {
  const s = singleStatement(sql);
  const bare = stripLiterals(s).toLowerCase();
  if (!/^\s*(select|with)\b/.test(bare)) throw new Error("只允许 SELECT 或 WITH 查询");
  if (/\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do|set|reset|lock|vacuum|analyze|refresh)\b/.test(bare)) {
    throw new Error("查询中包含写操作或管理语句");
  }
  if (/\bpg_(sleep|read_file|ls_dir|terminate|cancel)|\bdblink|\blo_import/.test(bare)) throw new Error("不允许调用该系统函数");
  return `SELECT * FROM (${s}) AS agent_query LIMIT ${Math.trunc(rowLimit)}`;
}

export type WriteKind = "dml" | "ddl";

/**
 * Write statement for the auto-management tool. Allowed:
 *   INSERT / UPDATE                                   (role green_app)
 *   CREATE TABLE | CREATE VIEW | CREATE INDEX, ALTER TABLE ... ADD ... (role green_ddl, schemas lab/mart/raw/fact)
 * Never allowed: DELETE, TRUNCATE, DROP, GRANT/REVOKE, role or system changes, and approving factors/formulas
 * (approval stays with a human reviewer).
 */
export function guardWriteSql(sql: string): { sql: string; kind: WriteKind } {
  const s = singleStatement(sql);
  const bare = stripLiterals(s).toLowerCase();
  if (/\b(delete|truncate|drop|grant|revoke|copy|vacuum|cluster|reindex|security\s+definer)\b/.test(bare)
      || /\balter\s+(role|user|system|database|schema|default)\b/.test(bare)) {
    throw new Error("禁止的语句：删除、清空、授权、角色或系统级变更");
  }
  if (/\b(core\.factor|core\.formula)\b/.test(bare) && /\b(status|approved_by|approved_at|reviewed_by)\b/.test(bare)) {
    throw new Error("因子和公式的审核、批准必须由人工完成，Agent 不能修改审核状态");
  }
  if (/\b(audit|agent)\./.test(bare)) throw new Error("不能直接修改审计表和 Agent 日志表");
  if (/^\s*(insert|update)\b/.test(bare)) return { sql: s, kind: "dml" };
  if (/^\s*create\s+(table|view|or\s+replace\s+view|index|unique\s+index)\b/.test(bare)) {
    if (!/\b(lab|mart|raw|fact)\./.test(bare)) throw new Error("新建对象必须指定 schema（lab、mart、raw 或 fact），建议放在 lab");
    return { sql: s, kind: "ddl" };
  }
  if (/^\s*alter\s+table\b/.test(bare)) {
    if (!/\badd\b/.test(bare) || /\b(drop|rename|type|owner)\b/.test(bare)) throw new Error("ALTER TABLE 只允许 ADD（加列、加约束）");
    return { sql: s, kind: "ddl" };
  }
  throw new Error("只允许 INSERT、UPDATE、CREATE TABLE/VIEW/INDEX 和 ALTER TABLE ... ADD");
}
