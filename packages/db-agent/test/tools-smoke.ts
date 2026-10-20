/** Calls each tool directly (no LLM) to check results and guards. Read-only except nothing is written. */
import { loadConfig } from "../src/config.js";
import { closePool, initPool } from "../src/db.js";
import { guardReadSql, guardWriteSql } from "../src/sql-guard.js";
import { buildTools } from "../src/tools.js";

process.env.DEEPSEEK_API_KEY ??= "unused-for-tool-tests";
const cfg = loadConfig();
initPool(cfg.databaseUrl);
const tools = Object.fromEntries(buildTools(cfg).map((t) => [t.name, t]));
const run = async (name: string, args: any) => {
  try {
    const r = await tools[name].execute("t", args);
    const text = (r.content[0] as any).text as string;
    console.log(`✓ ${name}`, text.length > 300 ? text.slice(0, 300) + "…" : text);
  } catch (e) { console.log(`✗ ${name}`, (e as Error).message); }
};

await run("find_entities", { keyword: "万华" });
await run("get_energy_summary", { node_code: "XYEDZ", year_from: 2023, year_to: 2025, group_by: "year" });
await run("get_carbon_summary", { node_code: "XYEDZ", profile: "GIP_2026", year_from: 2025, year_to: 2025, group_by: "category" });
await run("get_indicators", { version: "GIP_2026", node_code: "XYEDZ", year: 2025, only_achieved: true });
await run("explain_indicator", { version: "GIP_2026", indicator_code: "I04", year: 2025 });
await run("get_factors", { energy_type: "ELEC_GRID", status: "approved" });
await run("get_data_coverage", {});
await run("query_sql", { sql: "select code, name from mart.v_org_node where node_type = 'zone'", purpose: "test" });

console.log("\n-- 以下都应被拒绝 --");
await run("query_sql", { sql: "select * from fact.energy_activity limit 1", purpose: "越权读 fact" });
await run("query_sql", { sql: "delete from core.unit", purpose: "写操作" });
await run("query_sql", { sql: "select 1; select 2", purpose: "多语句" });
for (const s of ["delete from fact.energy_activity", "drop table lab.x", "truncate raw.document",
                 "update core.formula set status = 'approved' where code = 'F_LEVEL2_SHARE'",
                 "alter table core.unit drop column name", "create table x (id int)", "grant select on core.unit to public"]) {
  try { guardWriteSql(s); console.log("✗ 未拦截:", s); } catch (e) { console.log("✓ 拦截:", s, "→", (e as Error).message); }
}
console.log("✓ 允许:", guardWriteSql("update fact.statistic_value set is_current = false where stat_id = -1").kind,
            guardWriteSql("create table lab.demo (id int)").kind, guardWriteSql("alter table lab.demo add column note text").kind);
console.log("✓ 包装后的只读 SQL:", guardReadSql("select 1", 200));
await closePool();
