import type pg from "pg";

/**
 * Plan-based checks for model-written SQL (step 5 “static check” and step 6 “trial run” of the semantic query flow).
 *
 * Instead of parsing SQL ourselves we ask PostgreSQL for the plan: EXPLAIN (VERBOSE, FORMAT JSON) already
 * resolves views, aliases, tables and columns (unknown names fail here), and shows every scan, join condition
 * and aggregate. The checks below read that plan:
 *   - versioned tables (with is_current) must be filtered to the current version
 *   - fact.carbon_emission must be restricted to one calculation profile (profile_code)
 *   - joins must follow approved edges of semantic.join_edge, unless a side was aggregated first
 *   - no sum/avg over the “one” side after joining it to a “many” side (fan-out)
 */

export interface Edge { from_object: string; from_columns: string[]; to_object: string; to_columns: string[]; cardinality: string }
export interface Issue { code: string; message: string; hint?: string }
export interface Validation { errors: Issue[]; warnings: Issue[]; objects: string[]; joins: string[]; estimated_rows?: number }

type PlanNode = Record<string, any>;
interface Scan { alias: string; object: string; conds: string; indexName?: string; ancestors: PlanNode[] }
interface JoinCond { text: string; at: PlanNode; scan?: Scan }

const COND_KEYS = ["Hash Cond", "Merge Cond", "Join Filter", "Index Cond", "Recheck Cond", "Filter", "TID Cond"];

function walk(node: PlanNode, ancestors: PlanNode[], scans: Scan[], conds: JoinCond[], aggOutputs: string[]) {
  let scan: Scan | undefined;
  if (node["Relation Name"]) {
    scan = { alias: node["Alias"] ?? node["Relation Name"], object: `${node["Schema"]}.${node["Relation Name"]}`,
             conds: COND_KEYS.map((k) => node[k] ?? "").join(" "), indexName: node["Index Name"], ancestors };
    scans.push(scan);
  }
  for (const k of ["Hash Cond", "Merge Cond", "Join Filter"]) if (node[k]) conds.push({ text: node[k], at: node });
  // An index condition of an inner scan is the join condition of its parent nested loop.
  if (node["Index Cond"] && scan) conds.push({ text: node["Index Cond"], at: ancestors[ancestors.length - 1] ?? node, scan });
  if (node["Node Type"] === "Aggregate" || node["Node Type"] === "WindowAgg") aggOutputs.push(...(node["Output"] ?? []));
  for (const child of node["Plans"] ?? []) walk(child, [...ancestors, node], scans, conds, aggOutputs);
}

/** Equality pairs alias.col = alias.col; in an index condition the unqualified side belongs to the scanned table. */
function equalityPairs(cond: JoinCond): [string, string, string, string][] {
  const t = cond.text.replace(/::[a-z ]+(\[\])?/g, "").replace(/[()]/g, " ");
  const out: [string, string, string, string][] = [];
  for (const m of t.matchAll(/([a-z_][\w]*)\.([a-z_]\w*)\s*=\s*([a-z_][\w]*)\.([a-z_]\w*)/g)) out.push([m[1], m[2], m[3], m[4]]);
  if (cond.scan) {
    for (const m of t.matchAll(/(?:^|\s)([a-z_]\w*)\s*=\s*([a-z_][\w]*)\.([a-z_]\w*)/g)) out.push([cond.scan.alias, m[1], m[2], m[3]]);
  }
  return out;
}

/** True when an aggregate sits between the join node and the scan, i.e. that side was aggregated before joining. */
function aggregatedBelow(scan: Scan, join: PlanNode): boolean {
  const i = scan.ancestors.indexOf(join);
  return i >= 0 && scan.ancestors.slice(i + 1).some((n) => n["Node Type"] === "Aggregate");
}

export async function validateSql(c: pg.ClientBase, wrappedSql: string, rawSql: string, edges: Edge[], versioned: Set<string>): Promise<Validation> {
  const v: Validation = { errors: [], warnings: [], objects: [], joins: [] };
  const plan = (await c.query(`EXPLAIN (VERBOSE, FORMAT JSON) ${wrappedSql}`)).rows[0]["QUERY PLAN"][0].Plan;
  v.estimated_rows = plan["Plan Rows"];
  const scans: Scan[] = []; const conds: JoinCond[] = []; const aggs: string[] = [];
  walk(plan, [], scans, conds, aggs);
  v.objects = [...new Set(scans.map((s) => s.object))];
  const lower = rawSql.toLowerCase();

  // 1. current versions only
  for (const s of scans) {
    if (versioned.has(s.object) && !/is_current/.test(s.conds) && !s.indexName && !/\bis_current\b/.test(lower)) {
      v.errors.push({ code: "NOT_CURRENT", message: `${s.object} 有历史版本，查询没有筛选 is_current = true，会重复计入`,
                      hint: `加上 ${s.alias}.is_current 条件，或改用已筛选的 mart 视图` });
    }
  }
  // 2. one carbon profile
  if (scans.some((s) => s.object === "fact.carbon_emission") && !/\bprofile_code\b/.test(lower)) {
    v.errors.push({ code: "NO_PROFILE", message: "碳排放同时保存多个计算口径，查询没有限定或分组 profile_code，会重复相加",
                    hint: "加 profile_code = 'GIP_2026'（默认口径）或按 profile_code 分组" });
  }
  // 3. joins along approved edges
  const scanFor = (alias: string, join: PlanNode) =>
    scans.find((s) => s.alias === alias && s.ancestors.includes(join)) ?? scans.find((s) => s.alias === alias);
  const direct = (a: string, ac: string, b: string, bc: string) =>
    edges.find((e) => e.from_object === a && e.from_columns.length === 1 && e.from_columns[0] === ac && e.to_object === b && e.to_columns[0] === bc);
  const oneSide = new Set<string>();
  for (const cond of conds) {
    for (const [a1, c1, a2, c2] of equalityPairs(cond)) {
      const s1 = scanFor(a1, cond.at), s2 = scanFor(a2, cond.at);
      if (!s1 || !s2 || s1 === s2) continue;          // CTE / subquery outputs, or a filter within one table
      const o1 = s1.object, o2 = s2.object;
      const label = `${o1}.${c1} = ${o2}.${c2}`;
      if (v.joins.includes(label)) continue;
      v.joins.push(label);
      if (aggregatedBelow(s1, cond.at) || aggregatedBelow(s2, cond.at)) continue;   // aggregated first: the safe pattern
      const e = direct(o1, c1, o2, c2) ?? direct(o2, c2, o1, c1);
      if (e) {
        if (e.cardinality === "N:1") oneSide.add(e.to_object === o1 ? a1 : a2);
        continue;
      }
      // Both sides reference the same key: allowed when one side is a 1:1 extension of it (e.g. enterprise_profile).
      const t1 = edges.find((x) => x.from_object === o1 && x.from_columns[0] === c1);
      const t2 = edges.find((x) => x.from_object === o2 && x.from_columns[0] === c2);
      if (t1 && t2 && t1.to_object === t2.to_object && t1.to_columns[0] === t2.to_columns[0]
          && (t1.cardinality === "1:1" || t2.cardinality === "1:1")) {
        if (t1.cardinality === "1:1" && t2.cardinality !== "1:1") oneSide.add(a1);
        if (t2.cardinality === "1:1" && t1.cardinality !== "1:1") oneSide.add(a2);
        continue;
      }
      if (t1 && t2 && t1.to_object === t2.to_object) {
        v.errors.push({ code: "FAN_JOIN", message: `${label}：两张表都以多对一关联到 ${t1.to_object}，直接连接是多对多，会把数值成倍放大`,
                        hint: "先在 CTE 中把每张表分别聚合到对象/年份，再连接聚合结果" });
      } else {
        v.errors.push({ code: "UNLISTED_JOIN", message: `${label} 不在已审核的关联图中`,
                        hint: "用 plan_joins 查合规的连接路径；确需新关联时请管理员在关联图中审核" });
      }
    }
  }
  // 4. aggregating the one side after a 1:N join multiplies it
  for (const out of aggs) {
    for (const m of out.matchAll(/\b(sum|avg)\((?:DISTINCT )?([a-z_]\w*)\.(\w+)/g)) {
      if (oneSide.has(m[2])) {
        v.errors.push({ code: "FAN_OUT_SUM", message: `${m[1]}(${m[2]}.${m[3]})：${scanFor(m[2], plan)?.object} 是一对多连接中“一”的一侧，连接后求和会重复计算`,
                        hint: "先聚合再连接，或对该表单独求和" });
      }
    }
  }
  if ((v.estimated_rows ?? 0) > 100000) {
    v.warnings.push({ code: "LARGE", message: `预计返回约 ${v.estimated_rows} 行，请增加筛选或先聚合` });
  }
  return v;
}

/** Normalised SQL used to de-duplicate question–SQL pairs. */
export function normaliseSql(sql: string): string {
  return sql.trim().replace(/;\s*$/, "").replace(/\s+/g, " ").toLowerCase();
}
