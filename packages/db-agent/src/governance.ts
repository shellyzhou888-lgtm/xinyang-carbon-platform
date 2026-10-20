import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import type { AgentConfig } from "./config.js";
import { initPool, readOnly, write } from "./db.js";

/**
 * Data governance run (no chat, no human in the loop until approval):
 *   1. refresh the catalog (new tables/columns, foreign-key edges) and profile every queryable object
 *   2. run every enabled detection rule in semantic.check_def (plain SQL, read-only)
 *   3. open, update, reopen or auto-close tickets in semantic.governance_issue (one ticket per fingerprint)
 *   4. optionally let the model write the explanation and suggestion of new tickets, and draft missing field
 *      descriptions (stored as draft; an administrator approves them on the website)
 * Detection never depends on the model; the model only reads results and samples.
 */

export type GovernanceTrigger = "import" | "calc" | "manual" | "schedule";
export interface GovernanceOptions { trigger: GovernanceTrigger; useModel?: boolean; maxDocTables?: number; log?: (msg: string) => void }

interface Finding { subject: string; title: string; detail: unknown }

function action(kind: string | null, subject: string, detail: any) {
  if (kind === "comment_sync") return { kind, object: subject };
  if (kind === "run_calculation") return { kind, years: detail?.years ?? [] };
  if (kind === "draft_docs") return { kind, object: subject };
  return null;
}

async function complete(cfg: AgentConfig, system: string, user: string): Promise<string> {
  const models = createModels();
  models.setProvider(deepseekProvider());
  const model = models.getModel("deepseek", cfg.model);
  if (!model) throw new Error(`未找到模型 deepseek/${cfg.model}`);
  const msg = await models.completeSimple(model, { systemPrompt: system, messages: [{ role: "user", content: user, timestamp: Date.now() }] },
                                          { apiKey: cfg.deepseekApiKey } as any);
  if ((msg as any).errorMessage) throw new Error((msg as any).errorMessage);
  return msg.content.map((p: any) => (p.type === "text" ? p.text : "")).join("");
}

function parseJson(text: string): any {
  const body = text.replace(/^[\s\S]*?```(?:json)?\s*/i, "").replace(/```[\s\S]*$/, "");
  return JSON.parse(text.trim().startsWith("{") || text.trim().startsWith("[") ? text : body);
}

export async function runGovernance(cfg: AgentConfig, opts: GovernanceOptions) {
  const log = opts.log ?? (() => undefined);
  initPool(cfg.databaseUrl);
  const runId: number = await write("green_app", async (c) => {
    const r = await c.query(`insert into semantic.governance_run (trigger) values ($1) returning run_id`, [opts.trigger]);
    await c.query(`update semantic.publish_event set run_id = $1 where run_id is null`, [r.rows[0].run_id]);
    return r.rows[0].run_id;
  });
  const summary: Record<string, any> = { checks: 0, findings: 0, opened: 0, reopened: 0, auto_closed: 0, ai_written: 0, docs_drafted: 0, failed_checks: [] };
  try {
    // 1. catalog and profiles
    summary.catalog = await write("green_app", async (c) => (await c.query(`select semantic.refresh_catalog() as r`)).rows[0].r);
    summary.profiled = await write("green_app", async (c) => {
      const objs = (await c.query(`select object from semantic.table_doc where queryable and to_regclass(object) is not null order by object`)).rows;
      for (const o of objs) await c.query(`select semantic.profile_object($1)`, [o.object]);
      return objs.length;
    });
    log(`目录已刷新，剖析 ${summary.profiled} 个表/视图`);

    // 2. detection rules (each read-only, isolated so one failing rule does not stop the others)
    const checks = await readOnly(async (c) => (await c.query(`select * from semantic.check_def where enabled order by code`)).rows);
    const results: { check: any; findings: Finding[] }[] = [];
    for (const check of checks) {
      try {
        const findings = await readOnly(async (c) => {
          await c.query(`set local statement_timeout = 30000`);
          return (await c.query(check.check_sql)).rows as Finding[];
        });
        results.push({ check, findings });
        summary.checks += 1; summary.findings += findings.length;
      } catch (err) {
        summary.failed_checks.push({ code: check.code, error: (err as Error).message });
      }
    }
    log(`执行 ${summary.checks} 条检测规则，发现 ${summary.findings} 项`);

    // 3. tickets
    const newIssueIds: number[] = await write("green_app", async (c) => {
      const created: number[] = [];
      for (const { check, findings } of results) {
        const seen: string[] = [];
        for (const f of findings) {
          const fp = `${check.code}:${f.subject}`;
          seen.push(fp);
          const ex = (await c.query(`select issue_id, status from semantic.governance_issue where fingerprint = $1`, [fp])).rows[0];
          if (!ex) {
            const r = await c.query(`
              insert into semantic.governance_issue (check_code, fingerprint, subject, category, risk, title, evidence, description, action, first_run_id, last_run_id)
              values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) returning issue_id`,
              [check.code, fp, f.subject, check.category, check.risk, f.title, JSON.stringify(f.detail), check.description,
               JSON.stringify(action(check.action_kind, f.subject, f.detail)), runId]);
            created.push(r.rows[0].issue_id); summary.opened += 1;
          } else {
            const reopen = ex.status === "auto_closed" || ex.status === "applied";
            await c.query(`
              update semantic.governance_issue set title = $2, evidence = $3, action = coalesce($4, action), last_run_id = $5, last_seen_at = now(),
                     status = case when $6 then 'open' else status end
               where issue_id = $1`,
              [ex.issue_id, f.title, JSON.stringify(f.detail), JSON.stringify(action(check.action_kind, f.subject, f.detail)), runId, reopen]);
            if (reopen) summary.reopened += 1;
          }
        }
        const closed = await c.query(`
          update semantic.governance_issue set status = 'auto_closed', decision_note = coalesce(decision_note, '') || '复查时问题已消失（运行 ' || $3 || '）'
           where check_code = $1 and status in ('open','approved') and not (fingerprint = any ($2))`, [check.code, seen, runId]);
        summary.auto_closed += closed.rowCount ?? 0;
      }
      return created;
    });

    // 4. model writes explanations and drafts missing descriptions
    if (opts.useModel !== false && cfg.deepseekApiKey) {
      summary.ai_written = await writeIssueTexts(cfg, newIssueIds, log);
      summary.docs_drafted = await draftDocs(cfg, opts.maxDocTables ?? 8, log);
    }

    await write("green_app", (c) => c.query(`update semantic.governance_run set status = 'succeeded', finished_at = now(), summary = $2 where run_id = $1`,
                                            [runId, JSON.stringify(summary)]));
    return { run_id: runId, ...summary };
  } catch (err) {
    await write("green_app", (c) => c.query(`update semantic.governance_run set status = 'failed', finished_at = now(), error = $2, summary = $3 where run_id = $1`,
                                            [runId, (err as Error).message, JSON.stringify(summary)])).catch(() => undefined);
    throw err;
  }
}

const ISSUE_SYSTEM = `你是园区能碳数据库的数据治理助手。根据检测规则和检测结果，为每张治理工单写中文说明。
只依据给出的数据，不编造原因；不确定时写“可能”。输出 JSON 数组，每项 {"issue_id": 数字, "description": "问题是什么、证据（引用具体数值）", "impact": "影响哪些计算或指标", "suggestion": "建议的处理步骤（数据库禁止删除，修正用新增版本）"}，每项不超过 200 字。`;

async function writeIssueTexts(cfg: AgentConfig, ids: number[], log: (m: string) => void): Promise<number> {
  if (!ids.length) return 0;
  let written = 0;
  for (let i = 0; i < ids.length; i += 15) {
    const batch = await readOnly(async (c) => (await c.query(`
      select g.issue_id, g.title, g.category, g.risk, g.evidence, d.name as rule, d.description as rule_description
        from semantic.governance_issue g join semantic.check_def d on d.code = g.check_code
       where g.issue_id = any ($1) and g.category <> 'catalog'`, [ids.slice(i, i + 15)])).rows);
    if (!batch.length) continue;
    try {
      const items = parseJson(await complete(cfg, ISSUE_SYSTEM, JSON.stringify(batch)));
      await write("green_app", async (c) => {
        for (const it of Array.isArray(items) ? items : []) {
          if (!ids.includes(Number(it.issue_id))) continue;
          await c.query(`update semantic.governance_issue set description = $2, impact = $3, suggestion = $4, ai_written = true where issue_id = $1`,
                        [it.issue_id, String(it.description ?? "").slice(0, 1000), String(it.impact ?? "").slice(0, 600), String(it.suggestion ?? "").slice(0, 1000)]);
          written += 1;
        }
      });
    } catch (err) {
      log(`工单说明生成失败：${(err as Error).message}`);
    }
  }
  return written;
}

const DOC_SYSTEM = `你是数据库文档撰写助手。根据表说明、字段名、类型和剖析结果（空值数、唯一值数、最值、高频值），为缺少说明的字段起草中文业务说明。
只描述能从这些信息确定的内容；看不出含义时 description 写“含义待确认：”加你的推测。输出 JSON：
{"columns":[{"column_name":"…","business_name":"不超过 10 字","description":"不超过 60 字","unit":"有单位才填，否则 null"}]}`;

async function draftDocs(cfg: AgentConfig, maxTables: number, log: (m: string) => void): Promise<number> {
  const tables = await readOnly(async (c) => (await c.query(`
    select t.object, t.business_name, t.description, t.grain,
           json_agg(json_build_object('column_name', c.column_name, 'type', c.data_type, 'nulls', p.null_count, 'rows', p.row_count,
                                      'distinct', p.distinct_count, 'min', p.min_value, 'max', p.max_value, 'top', p.top_values)
                    order by c.column_name) as columns
      from semantic.table_doc t join semantic.column_doc c using (object) left join semantic.column_profile p using (object, column_name)
     where t.queryable and c.description is null
     group by t.object, t.business_name, t.description, t.grain
     order by (t.object like 'fact.%') desc, (t.object like 'mart.%') desc, t.object limit $1`, [maxTables])).rows);
  let drafted = 0;
  for (const t of tables) {
    try {
      const out = parseJson(await complete(cfg, DOC_SYSTEM, JSON.stringify(t)));
      await write("green_app", async (c) => {
        for (const col of out.columns ?? []) {
          const r = await c.query(`
            update semantic.column_doc set business_name = $3, description = $4, unit = $5, origin = 'ai_draft', review_status = 'draft', updated_at = now()
             where object = $1 and column_name = $2 and description is null`,
            [t.object, col.column_name, String(col.business_name ?? "").slice(0, 40), String(col.description ?? "").slice(0, 300), col.unit ?? null]);
          drafted += r.rowCount ?? 0;
        }
      });
    } catch (err) {
      log(`${t.object} 字段说明起草失败：${(err as Error).message}`);
    }
  }
  return drafted;
}

// After imports and calculations the tools start a run in the background; overlapping requests are merged.
let running: Promise<unknown> | undefined;
let again: GovernanceTrigger | undefined;

export function triggerGovernance(cfg: AgentConfig, trigger: GovernanceTrigger) {
  if (running) { again = trigger; return; }
  running = runGovernance(cfg, { trigger })
    .catch((err) => console.error("[governance]", (err as Error).message))
    .finally(() => {
      running = undefined;
      if (again) { const t = again; again = undefined; triggerGovernance(cfg, t); }
    });
}

/** Resolves when no background governance run is in progress (the one-shot CLI waits for it before exiting). */
export async function governanceIdle() {
  while (running) await running;
}
