import { readOnly, write } from "./db.js";

/**
 * Administrator operations behind the website “数据治理” page: reviewing tickets, catalog descriptions,
 * question–SQL pairs and join edges. Every decision records who decided and when.
 *
 * Approving a ticket runs its action only for the safe kinds:
 *   comment_sync     write approved descriptions back as database COMMENTs
 *   run_calculation  recalculate the primary standard version for the affected years
 * Everything else (changing data, metrics, views) stays a manual step; the ticket records the decision.
 */

export async function governanceSummary() {
  return readOnly(async (c) => {
    const issues = (await c.query(`select status, risk, count(*)::int n from semantic.governance_issue group by 1, 2`)).rows;
    const docs = (await c.query(`
      select 'table' kind, review_status, count(*)::int n from semantic.table_doc where queryable group by 2
      union all select 'column', c.review_status, count(*)::int from semantic.column_doc c join semantic.table_doc t using (object)
       where t.queryable and c.description is not null group by 2`)).rows;
    const qa = (await c.query(`select status, count(*)::int n from semantic.qa_pair group by 1`)).rows;
    const edges = (await c.query(`select review_status, count(*)::int n from semantic.join_edge group by 1`)).rows;
    const runs = (await c.query(`select run_id, trigger, status, started_at, finished_at, summary, error from semantic.governance_run order by run_id desc limit 5`)).rows;
    const pending = (await c.query(`select count(*)::int n from semantic.publish_event where run_id is null`)).rows[0].n;
    return { issues, docs, qa, edges, runs, pending_events: pending };
  });
}

export async function listIssues(status = "open", category?: string) {
  return readOnly(async (c) => (await c.query(`
    select g.*, d.name as rule_name from semantic.governance_issue g join semantic.check_def d on d.code = g.check_code
     where ($1 = 'all' or g.status = $1) and ($2::text is null or g.category = $2)
     order by case g.risk when 'high' then 0 when 'medium' then 1 else 2 end, g.category, g.issue_id desc limit 200`,
    [status, category ?? null])).rows);
}

export async function decideIssue(issueId: number, decision: "approve" | "reject" | "reopen", note: string, by: string) {
  return write("green_app", async (c) => {
    const issue = (await c.query(`select * from semantic.governance_issue where issue_id = $1 for update`, [issueId])).rows[0];
    if (!issue) throw new Error(`工单 ${issueId} 不存在`);
    if (decision === "reject" || decision === "reopen") {
      await c.query(`update semantic.governance_issue set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where issue_id = $1`,
                    [issueId, decision === "reject" ? "rejected" : "open", by, note || null]);
      return { status: decision === "reject" ? "rejected" : "open" };
    }
    let applied: unknown = null;
    const kind = issue.action?.kind;
    if (kind === "comment_sync") {
      applied = { comments_written: (await c.query(`select semantic.apply_comment_sync($1) as n`, [issue.action.object])).rows[0].n };
    } else if (kind === "run_calculation") {
      const version = (await c.query(`select code from core.standard_version where is_primary`)).rows[0]?.code ?? "GIP_2026";
      const years: number[] = (issue.action.years ?? []).filter((y: number) => y >= 2000);
      const runs = [];
      for (const y of years) {
        const r = (await c.query(`select engine.run_all($1, 'XYEDZ', $2, false) as r`, [version, y])).rows[0].r;
        runs.push({ year: y, indicators: r.indicators?.calculated });
      }
      applied = { version, runs };
    }
    const status = applied ? "applied" : "approved";
    await c.query(`update semantic.governance_issue set status = $2, decided_by = $3, decided_at = now(), decision_note = $4,
                          applied_at = case when $2 = 'applied' then now() end where issue_id = $1`, [issueId, status, by, note || null]);
    return { status, applied };
  });
}

export async function listCatalog(object?: string, status?: string) {
  return readOnly(async (c) => {
    const tables = (await c.query(`
      select t.*, (select count(*)::int from semantic.column_doc c where c.object = t.object and c.review_status = 'draft' and c.description is not null) as draft_columns,
             (select count(*)::int from semantic.column_doc c where c.object = t.object and c.description is null) as missing_columns
        from semantic.table_doc t where t.queryable order by t.topic_code nulls last, t.object`)).rows;
    const columns = object ? (await c.query(`
      select c.*, p.null_count, p.row_count, p.distinct_count, p.min_value, p.max_value, p.top_values
        from semantic.column_doc c left join semantic.column_profile p using (object, column_name)
       where c.object = $1 and ($2::text is null or c.review_status = $2) order by c.column_name`, [object, status ?? null])).rows : [];
    return { tables, columns };
  });
}

export async function reviewTableDoc(object: string, fields: { business_name?: string; description?: string; grain?: string; usage_notes?: string },
                                     decision: "approve" | "reject" | "save", by: string) {
  return write("green_app", (c) => c.query(`
    update semantic.table_doc set business_name = coalesce($2, business_name), description = coalesce($3, description),
           grain = coalesce($4, grain), usage_notes = coalesce($5, usage_notes),
           origin = case when ($2 is not null and $2 is distinct from business_name) or ($3 is not null and $3 is distinct from description)
                       or ($4 is not null and $4 is distinct from grain) or ($5 is not null and $5 is distinct from usage_notes) then 'admin' else origin end,
           review_status = case $6 when 'approve' then 'approved' when 'reject' then 'rejected' else review_status end,
           reviewed_by = case when $6 <> 'save' then $7 else reviewed_by end, reviewed_at = case when $6 <> 'save' then now() else reviewed_at end,
           updated_at = now()
     where object = $1`, [object, fields.business_name ?? null, fields.description ?? null, fields.grain ?? null, fields.usage_notes ?? null, decision, by]));
}

export async function reviewColumnDoc(object: string, column: string, fields: { business_name?: string; description?: string; unit?: string },
                                      decision: "approve" | "reject" | "save", by: string) {
  return write("green_app", (c) => c.query(`
    update semantic.column_doc set business_name = coalesce($3, business_name), description = coalesce($4, description), unit = coalesce($5, unit),
           origin = case when ($3 is not null and $3 is distinct from business_name) or ($4 is not null and $4 is distinct from description)
                       or ($5 is not null and $5 is distinct from unit) then 'admin' else origin end,
           review_status = case $6 when 'approve' then 'approved' when 'reject' then 'rejected' else review_status end,
           reviewed_by = case when $6 <> 'save' then $7 else reviewed_by end, reviewed_at = case when $6 <> 'save' then now() else reviewed_at end,
           updated_at = now()
     where object = $1 and column_name = $2`, [object, column, fields.business_name ?? null, fields.description ?? null, fields.unit ?? null, decision, by]));
}

/** Approves every drafted (non-empty) column description of one table at once. */
export async function approveAllColumns(object: string, by: string) {
  return write("green_app", (c) => c.query(`
    update semantic.column_doc set review_status = 'approved', reviewed_by = $2, reviewed_at = now()
     where object = $1 and review_status = 'draft' and description is not null`, [object, by]));
}

export async function listQa(status = "candidate") {
  return readOnly(async (c) => (await c.query(`
    select * from semantic.qa_pair where ($1 = 'all' or status = $1) order by hit_count desc, qa_id desc limit 200`, [status])).rows);
}

export async function reviewQa(qaId: number, decision: "approve" | "reject", note: string, by: string, question?: string) {
  return write("green_app", (c) => c.query(`
    update semantic.qa_pair set status = $2, question = coalesce($5, question), review_note = $3, reviewed_by = $4, reviewed_at = now()
     where qa_id = $1`, [qaId, decision === "approve" ? "approved" : "rejected", note || null, by, question || null]));
}

export async function listEdges(status = "all") {
  return readOnly(async (c) => (await c.query(`
    select * from semantic.join_edge where ($1 = 'all' or review_status = $1)
     order by case review_status when 'draft' then 0 else 1 end, from_object, to_object`, [status])).rows);
}

export async function reviewEdge(edgeId: number, decision: "approve" | "reject", by: string) {
  return write("green_app", (c) => c.query(`
    update semantic.join_edge set review_status = $2, reviewed_by = $3, reviewed_at = now() where edge_id = $1`,
    [edgeId, decision === "approve" ? "approved" : "rejected", by]));
}

/** Product carbon footprint reference values (core.product_footprint_ref): human review before official use. */
export async function listFootprints(status = "draft") {
  return readOnly(async (c) => (await c.query(`
    select ref_id, product_name, product_category, functional_unit, value::float as value, unit, boundary, region, data_year,
           quality_stars, method_standard, database_name, source_title, source_url, source_page, applicable_nodes, status,
           reviewed_by, reviewed_at, note
      from core.product_footprint_ref
     where is_current and ($1 = 'all' or status = $1)
     order by array_to_string(applicable_nodes, ','), product_name, value`, [status])).rows);
}

/** approve → approved; reject → retired (kept, no longer used); save → only edits boundary / note. */
export async function reviewFootprint(refId: number, decision: "approve" | "reject" | "save",
                                      fields: { boundary?: string; note?: string }, by: string) {
  const boundary = fields.boundary && ["cradle_to_gate", "cradle_to_grave", "gate_to_gate", "other"].includes(fields.boundary) ? fields.boundary : null;
  return write("green_app", (c) => c.query(`
    update core.product_footprint_ref
       set boundary = coalesce($2, boundary),
           note = case when $3::text is null then note else coalesce(note || '；', '') || $3 end,
           status = case $4 when 'approve' then 'approved' when 'reject' then 'retired' else status end,
           reviewed_by = case when $4 <> 'save' then $5 else reviewed_by end,
           reviewed_at = case when $4 <> 'save' then now() else reviewed_at end
     where ref_id = $1 and is_current`, [refId, boundary, fields.note || null, decision, by]));
}
