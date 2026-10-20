import type pg from "pg";
import type { Edge } from "./sql-validate.js";

/**
 * Reads the semantic catalog (schema semantic). The model gets a small, relevant slice of the persistent
 * description of the database instead of re-reading raw table structure on every question.
 */

export async function loadEdges(c: pg.ClientBase): Promise<Edge[]> {
  return (await c.query(`select from_object, from_columns, to_object, to_columns, cardinality
                           from semantic.join_edge where review_status = 'approved'`)).rows;
}

export async function loadVersioned(c: pg.ClientBase): Promise<Set<string>> {
  const r = await c.query(`select object from semantic.column_doc where column_name = 'is_current'`);
  return new Set(r.rows.map((x) => x.object));
}

/** Relevant tables (with columns and profiles), metrics, join edges, approved Q&A examples and open data issues. */
export async function searchCatalog(c: pg.ClientBase, keywords: string[], question: string | undefined) {
  const kw = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 8);
  const pattern = kw.length ? kw : [question ?? ""];

  const tables = (await c.query(`
    with k as (select unnest($1::text[]) as w),
    col_hits as (
      select c.object, count(*) as hits from semantic.column_doc c, k
       where c.column_name ilike '%' || k.w || '%' or c.business_name ilike '%' || k.w || '%'
          or c.description ilike '%' || k.w || '%' or exists (select 1 from unnest(c.synonyms) s where s ilike '%' || k.w || '%')
       group by c.object)
    select t.object, t.business_name, t.description, t.grain, t.usage_notes, t.caveats, t.review_status,
           (select sum(case when t.business_name ilike '%' || k.w || '%' then 3 else 0 end
                     + case when exists (select 1 from unnest(t.synonyms) s where s ilike '%' || k.w || '%') then 3 else 0 end
                     + case when t.object ilike '%' || k.w || '%' then 2 else 0 end
                     + case when t.description ilike '%' || k.w || '%' then 1 else 0 end) from k)
             + coalesce(ch.hits, 0) as score
      from semantic.table_doc t left join col_hits ch using (object)
     where t.queryable and t.review_status <> 'rejected'
     order by score desc, (t.layer = 'derived') desc, t.object
     limit 6`, [pattern])).rows.filter((t) => Number(t.score) > 0);

  const objects = tables.map((t) => t.object);
  const columns = objects.length ? (await c.query(`
    select c.object, c.column_name, c.data_type, c.business_name, c.description, c.unit, c.value_notes, c.caveats, c.review_status,
           p.null_count, p.distinct_count, p.row_count, p.min_value, p.max_value, p.top_values
      from semantic.column_doc c left join semantic.column_profile p using (object, column_name)
     where c.object = any ($1) and c.review_status <> 'rejected'
     order by c.object, c.column_name`, [objects])).rows : [];

  const metrics = (await c.query(`
    select m.code, m.name, m.unit, m.aggregation, m.source, m.used_by_formulas
      from semantic.v_metric m, unnest($1::text[]) k(w)
     where m.name ilike '%' || k.w || '%' or m.code ilike '%' || k.w || '%' or m.description ilike '%' || k.w || '%'
     group by m.code, m.name, m.unit, m.aggregation, m.source, m.used_by_formulas limit 10`, [pattern])).rows;

  const edges = objects.length ? (await c.query(`
    select from_object || '.' || array_to_string(from_columns, ',') || ' → ' || to_object || '.' || array_to_string(to_columns, ',')
             || ' (' || cardinality || ')' || coalesce('：' || note, '') as edge
      from semantic.join_edge
     where review_status = 'approved' and (from_object = any ($1) or to_object = any ($1))`, [objects])).rows.map((r) => r.edge) : [];

  const examples = question ? (await c.query(`
    select qa_id, question, sql, answer_note, round(similarity(question, $1)::numeric, 2) as similarity
      from semantic.qa_pair where status = 'approved' and similarity(question, $1) > 0.15
     order by similarity(question, $1) desc limit 3`, [question])).rows : [];

  const issues = objects.length ? (await c.query(`
    select issue_id, category, risk, title, suggestion from semantic.governance_issue
     where status in ('open','approved') and category in ('ambiguity','join_trap','dirty_data','coverage')
       and exists (select 1 from unnest($1::text[]) o where evidence::text ilike '%' || o || '%' or title ilike '%' || o || '%'
                                                         or (o like 'fact.%' and category = 'coverage'))
     order by case risk when 'high' then 0 when 'medium' then 1 else 2 end limit 6`, [objects])).rows : [];

  const byObject = new Map<string, any[]>();
  for (const col of columns) {
    const nullRate = col.row_count ? Math.round((Number(col.null_count) / Number(col.row_count)) * 100) : null;
    const entry: Record<string, unknown> = { column: col.column_name, type: col.data_type };
    for (const k of ["business_name", "description", "unit", "value_notes", "caveats"]) if (col[k]) entry[k] = col[k];
    if (col.review_status !== "approved") entry.draft = true;
    if (col.row_count != null) entry.profile = { null_pct: nullRate, distinct: Number(col.distinct_count), min: col.min_value, max: col.max_value,
                                                 ...(col.top_values ? { top: col.top_values } : {}) };
    byObject.set(col.object, [...(byObject.get(col.object) ?? []), entry]);
  }
  return {
    tables: tables.map((t) => ({ object: t.object, business_name: t.business_name, description: t.description, grain: t.grain,
                                 usage_notes: t.usage_notes, caveats: t.caveats, draft: t.review_status !== "approved",
                                 columns: byObject.get(t.object) ?? [] })),
    metrics, join_edges: edges, verified_examples: examples, known_issues: issues,
    note: "draft=true 的说明尚未经管理员审核，仅供参考；涉及基础量优先用 query_metric；写 SQL 前用 plan_joins 确认连接路径。",
  };
}

/** Shortest approved join path between the first object and each other object (breadth-first, edges undirected). */
export function planJoins(edges: Edge[], objects: string[]) {
  const adj = new Map<string, { to: string; edge: Edge; forward: boolean }[]>();
  for (const e of edges) {
    adj.set(e.from_object, [...(adj.get(e.from_object) ?? []), { to: e.to_object, edge: e, forward: true }]);
    adj.set(e.to_object, [...(adj.get(e.to_object) ?? []), { to: e.from_object, edge: e, forward: false }]);
  }
  const [start, ...targets] = objects;
  const paths = targets.map((target) => {
    const prev = new Map<string, { from: string; edge: Edge; forward: boolean }>();
    const queue = [start]; const seen = new Set([start]);
    while (queue.length && !seen.has(target)) {
      const cur = queue.shift()!;
      for (const n of adj.get(cur) ?? []) {
        if (seen.has(n.to)) continue;
        seen.add(n.to); prev.set(n.to, { from: cur, edge: n.edge, forward: n.forward }); queue.push(n.to);
      }
    }
    if (!seen.has(target)) return { target, found: false, message: `关联图中没有从 ${start} 到 ${target} 的已审核路径` };
    const steps: { join: string; cardinality: string }[] = [];
    let node = target; let manyToOneThenOneToMany = false; let lastForward: boolean | undefined;
    const chain: { edge: Edge; forward: boolean }[] = [];
    while (node !== start) { const p = prev.get(node)!; chain.unshift({ edge: p.edge, forward: p.forward }); node = p.from; }
    for (const { edge: e, forward } of chain) {
      steps.push({ join: `${e.from_object}.${e.from_columns.join(",")} = ${e.to_object}.${e.to_columns.join(",")}`,
                   cardinality: forward ? e.cardinality : e.cardinality.split(":").reverse().join(":") });
      if (lastForward === true && forward === false && e.cardinality === "N:1") manyToOneThenOneToMany = true;
      lastForward = forward;
    }
    return { target, found: true, steps,
             warning: manyToOneThenOneToMany ? "路径先多对一再一对多（两张事实表经同一维表相连）：必须先把两边分别聚合到该维度，再连接" : undefined };
  });
  return { start, paths };
}
