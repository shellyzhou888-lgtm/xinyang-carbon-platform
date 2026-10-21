import Link from "next/link";
import { adminApi } from "@/lib/server";
import { AdminNavigation, PageHeading } from "@/components/WorkspaceParts";
import { selectedYear } from "@/lib/workspace";
import { cleanSource, documentTitle } from "@/lib/source-text";
import { approveAllColumns, decideIssue, reviewColumn, reviewEdge, reviewFootprint, reviewQa, reviewTable, runGovernanceNow } from "./actions";

export const dynamic = "force-dynamic";

const TABS = [["issues", "治理工单"], ["catalog", "语义目录"], ["qa", "问答对"], ["edges", "关联图"], ["footprint", "产品碳足迹"]] as const;
const RISK: Record<string, string> = { high: "高", medium: "中", low: "低" };
const CATEGORY: Record<string, string> = { dirty_data: "脏数据", ambiguity: "口径歧义", join_trap: "关联陷阱", coverage: "覆盖不足", catalog: "目录", insight: "洞察" };
const STATUS: Record<string, string> = { open: "待处理", approved: "已确认", applied: "已执行", rejected: "已驳回", auto_closed: "已消失",
                                         draft: "待审核", candidate: "候选", retired: "已停用" };
const BOUNDARY: Record<string, string> = { cradle_to_gate: "摇篮到大门", cradle_to_grave: "摇篮到坟墓", gate_to_gate: "大门到大门", other: "其他" };
const RUN: Record<string, string> = { running: "运行中", succeeded: "完成", failed: "失败" };
const ACTION: Record<string, string> = { comment_sync: "批准并回写数据库注释", run_calculation: "批准并重新计算", draft_docs: "已在语义目录起草说明" };

type Search = { tab?: string; status?: string; category?: string; object?: string; year?: string };

export default async function Admin({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "issues";
  const a = adminApi();
  let summary: Awaited<ReturnType<typeof a.governanceSummary>>;
  try {
    summary = await a.governanceSummary();
  } catch (err) {
    return (
      <div className="admin">
        <PageHeading eyebrow="DATA GOVERNANCE" title="数据治理 · 语义目录" />
        <AdminNavigation active="governance" year={selectedYear(sp.year)} />
        <div className="notice danger"><i aria-hidden="true" /><div><b>无法读取语义目录</b>：{err instanceof Error ? err.message : String(err)}。如果提示 semantic 不存在，请先执行数据库迁移 0021、0022（scripts/apply-migrations.ps1），并确认 SSH 隧道已打开。</div></div>
      </div>
    );
  }
  const count = (rows: any[], pred: (r: any) => boolean) => rows.filter(pred).reduce((n, r) => n + r.n, 0);
  const lastRun = summary.runs[0];

  return (
    <div className="admin">
      <PageHeading eyebrow="DATA GOVERNANCE" title="数据治理 · 语义目录" description="AI 在提问之前理解数据库、发现数据问题；所有说明、关联和工单由管理员在这里审核。">
        <form action={runGovernanceNow}><button className="btn">立即运行治理检测</button></form>
      </PageHeading>
      <AdminNavigation active="governance" year={selectedYear(sp.year)} />

      <div className="kpis">
        <div className="kpi"><div className="label">待处理工单（高 / 中 / 低）</div>
          <div className="value">{count(summary.issues, (r) => r.status === "open")}
            <span className="unit">{["high", "medium", "low"].map((k) => count(summary.issues, (r) => r.status === "open" && r.risk === k)).join(" / ")}</span></div></div>
        <div className="kpi"><div className="label">待审核说明（表 / 字段）</div>
          <div className="value">{count(summary.docs, (r) => r.review_status === "draft")}
            <span className="unit">{count(summary.docs, (r) => r.kind === "table" && r.review_status === "draft")} / {count(summary.docs, (r) => r.kind === "column" && r.review_status === "draft")}</span></div></div>
        <div className="kpi"><div className="label">候选问答对</div><div className="value">{count(summary.qa, (r) => r.status === "candidate")}</div></div>
        <div className="kpi"><div className="label">最近一次检测</div>
          <div className="value small">{lastRun ? `${RUN[lastRun.status] ?? lastRun.status} · ${new Date(lastRun.started_at).toLocaleString("zh-CN")}` : "尚未运行"}</div>
          <div className="label">未检测的发布事件 {summary.pending_events} 个</div></div>
      </div>

      <nav className="filters" aria-label="治理模块" style={{ marginBottom: 18 }}>
        {TABS.map(([k, label]) => <Link key={k} href={`/admin?tab=${k}`} className={k === tab ? "on" : ""}>{label}</Link>)}
      </nav>

      {tab === "issues" && <Issues status={sp.status ?? "open"} category={sp.category} />}
      {tab === "catalog" && <Catalog object={sp.object} />}
      {tab === "qa" && <QaPairs status={sp.status ?? "candidate"} />}
      {tab === "edges" && <Edges />}
      {tab === "footprint" && <Footprints status={sp.status ?? "draft"} />}
    </div>
  );
}

async function Issues({ status, category }: { status: string; category?: string }) {
  const issues = await adminApi().listIssues(status, category);
  return (
    <section>
      <div className="filters">
        {["open", "approved", "applied", "rejected", "auto_closed", "all"].map((st) => (
          <Link key={st} href={`/admin?tab=issues&status=${st}${category ? `&category=${category}` : ""}`} className={st === status ? "on" : ""}>{STATUS[st] ?? "全部"}</Link>
        ))}
        <span className="sep" />
        {Object.entries(CATEGORY).map(([k, v]) => (
          <Link key={k} href={`/admin?tab=issues&status=${status}${k === category ? "" : `&category=${k}`}`} className={k === category ? "on" : ""}>{v}</Link>
        ))}
      </div>
      {issues.length === 0 && <div className="hint">没有符合条件的工单。</div>}
      {issues.map((g: any) => (
        <div key={g.issue_id} className={`issue risk-${g.risk}`}>
          <div className="issue-head">
            <span className={`tag risk-${g.risk}`}>{RISK[g.risk]}风险</span>
            <span className="tag">{CATEGORY[g.category]}</span>
            <b>{g.title}</b>
            <span className="muted">#{g.issue_id} · {g.rule_name} · {STATUS[g.status]}{g.ai_written ? " · AI 撰写" : ""}</span>
          </div>
          {g.description && <p>{g.description}</p>}
          {g.impact && <p><span className="muted">影响：</span>{g.impact}</p>}
          {g.suggestion && <p><span className="muted">建议：</span>{g.suggestion}</p>}
          <details><summary>检测证据</summary><pre>{JSON.stringify(g.evidence, null, 2)}</pre></details>
          {g.decision_note && <p className="muted">处理记录：{g.decided_by ?? ""} {g.decision_note}</p>}
          <form action={decideIssue} className="decide">
            <input type="hidden" name="issue_id" value={g.issue_id} />
            <input name="note" placeholder="处理意见（可选）" />
            {g.status === "open" && <>
              <button name="decision" value="approve" className="btn">{ACTION[g.action?.kind] ?? "确认"}</button>
              <button name="decision" value="reject" className="btn ghost">驳回（不再提示）</button>
            </>}
            {g.status !== "open" && <button name="decision" value="reopen" className="btn ghost">重新打开</button>}
          </form>
        </div>
      ))}
    </section>
  );
}

async function Catalog({ object }: { object?: string }) {
  const { tables, columns } = await adminApi().listCatalog(object);
  const t = tables.find((x: any) => x.object === object);
  return (
    <section className="catalog">
      <div className="catalog-list">
        {tables.map((x: any) => (
          <Link key={x.object} href={`/admin?tab=catalog&object=${x.object}`} className={x.object === object ? "on" : ""}>
            <span className={`dot ${x.review_status}`} />{x.object}
            <span className="muted">{x.business_name}{x.draft_columns ? ` · ${x.draft_columns} 待审` : ""}{x.missing_columns ? ` · ${x.missing_columns} 缺` : ""}</span>
          </Link>
        ))}
      </div>
      <div className="catalog-detail">
        {!t && <div className="hint">选择左侧的表或视图，审核它的业务说明和字段说明。说明批准后，可在“治理工单”中回写为数据库注释。</div>}
        {t && <>
          <form action={reviewTable} className="doc-form">
            <input type="hidden" name="object" value={t.object} />
            <h2>{t.object} <span className="muted">{STATUS[t.review_status] ?? t.review_status} · 来源 {t.origin}</span></h2>
            <label>业务名称<input name="business_name" defaultValue={t.business_name ?? ""} /></label>
            <label>说明<textarea name="description" defaultValue={t.description ?? ""} rows={2} /></label>
            <label>粒度（一行代表）<input name="grain" defaultValue={t.grain ?? ""} /></label>
            <label>使用说明<textarea name="usage_notes" defaultValue={t.usage_notes ?? ""} rows={2} /></label>
            {t.caveats?.length > 0 && <ul className="caveats">{t.caveats.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>}
            <div className="decide">
              <button name="decision" value="approve" className="btn">保存并批准</button>
              <button name="decision" value="save" className="btn ghost">只保存</button>
              <button name="decision" value="reject" className="btn ghost">驳回</button>
            </div>
          </form>
          <form action={approveAllColumns} className="decide">
            <input type="hidden" name="object" value={t.object} />
            <button className="btn ghost">批准本表全部已起草的字段说明</button>
          </form>
          <table className="cols">
            <thead><tr><th>字段</th><th>业务名称 / 说明 / 单位</th><th>剖析</th><th>审核</th></tr></thead>
            <tbody>
              {columns.map((c: any) => (
                <tr key={c.column_name}>
                  <td><b>{c.column_name}</b><div className="muted">{c.data_type}</div>
                    <div className={`muted st-${c.review_status}`}>{STATUS[c.review_status] ?? c.review_status} · {c.origin === "ai_draft" ? "AI 起草" : c.origin === "human_seed" ? "人工初稿" : c.origin}</div></td>
                  <td colSpan={3}>
                    <form action={reviewColumn} className="col-form">
                      <input type="hidden" name="object" value={t.object} />
                      <input type="hidden" name="column" value={c.column_name} />
                      <div className="col-inputs">
                        <input name="business_name" defaultValue={c.business_name ?? ""} placeholder="业务名称" />
                        <input name="description" defaultValue={c.description ?? ""} placeholder="说明" className="wide" />
                        <input name="unit" defaultValue={c.unit ?? ""} placeholder="单位" />
                      </div>
                      <div className="col-meta">
                        <span className="muted">
                          {c.row_count != null ? `空值 ${c.null_count}/${c.row_count} · 唯一 ${c.distinct_count}` : "未剖析"}
                          {c.top_values ? ` · 常见：${c.top_values.slice(0, 4).map((v: any) => v.value).join("、")}` : c.min_value ? ` · ${c.min_value} ～ ${c.max_value}` : ""}
                        </span>
                        <span>
                          <button name="decision" value="approve" className="btn small">批准</button>
                          <button name="decision" value="save" className="btn small ghost">保存</button>
                          <button name="decision" value="reject" className="btn small ghost">驳回</button>
                        </span>
                      </div>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>}
      </div>
    </section>
  );
}

async function QaPairs({ status }: { status: string }) {
  const rows = await adminApi().listQa(status);
  return (
    <section>
      <div className="filters">
        {["candidate", "approved", "rejected", "all"].map((st) => (
          <Link key={st} href={`/admin?tab=qa&status=${st}`} className={st === status ? "on" : ""}>{STATUS[st] ?? (st === "all" ? "全部" : st)}</Link>
        ))}
      </div>
      <div className="hint">Agent 成功执行的 SQL 会自动成为候选。批准后，相似问题会把它作为示例，直接改参数复用。</div>
      {rows.length === 0 && <div className="hint">暂无。</div>}
      {rows.map((q: any) => (
        <form key={q.qa_id} action={reviewQa} className="issue">
          <input type="hidden" name="qa_id" value={q.qa_id} />
          <label>问题<input name="question" defaultValue={q.question} /></label>
          <pre>{q.sql}</pre>
          <div className="muted">涉及 {q.objects?.join("、")} · 使用 {q.hit_count + 1} 次 · {STATUS[q.status] ?? q.status}</div>
          <div className="decide">
            <input name="note" placeholder="审核意见（可选）" />
            <button name="decision" value="approve" className="btn">批准为示例</button>
            <button name="decision" value="reject" className="btn ghost">驳回</button>
          </div>
        </form>
      ))}
    </section>
  );
}

async function Edges() {
  const edges = await adminApi().listEdges("all");
  return (
    <section>
      <div className="hint">关联图决定 Agent 写的 SQL 能怎样连接表。外键自动登记为已批准；推断或新增的关联需要审核。</div>
      <table className="cols">
        <thead><tr><th>从</th><th>到</th><th>基数</th><th>来源</th><th>说明</th><th>状态</th></tr></thead>
        <tbody>
          {edges.map((e: any) => (
            <tr key={e.edge_id}>
              <td>{e.from_object}.{e.from_columns.join(",")}</td>
              <td>{e.to_object}.{e.to_columns.join(",")}</td>
              <td>{e.cardinality}</td><td>{e.origin}</td><td>{e.note ?? ""}</td>
              <td>
                {e.review_status === "draft" ? (
                  <form action={reviewEdge} className="decide">
                    <input type="hidden" name="edge_id" value={e.edge_id} />
                    <button name="decision" value="approve" className="btn small">批准</button>
                    <button name="decision" value="reject" className="btn small ghost">驳回</button>
                  </form>
                ) : STATUS[e.review_status] ?? (e.review_status === "approved" ? "已批准" : e.review_status)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

async function Footprints({ status }: { status: string }) {
  const rows = await adminApi().listFootprints(status);
  return (
    <section>
      <div className="filters">
        {["draft", "approved", "retired", "all"].map((st) => (
          <Link key={st} href={`/admin?tab=footprint&status=${st}`} className={st === status ? "on" : ""}>{st === "approved" ? "已批准" : STATUS[st] ?? "全部"}</Link>
        ))}
      </div>
      <div className="hint">公开数据库、EPD 与文献中的产品碳足迹参考值。核对功能单位、系统边界和来源后批准，批准后才作为与园区企业对照的正式参考；不适用的点“停用”（保留记录）。系统边界为空的可在这里补选。</div>
      {rows.length === 0 && <div className="hint">暂无。</div>}
      {rows.map((r: any) => (
        <form key={r.ref_id} action={reviewFootprint} className="issue">
          <input type="hidden" name="ref_id" value={r.ref_id} />
          <div className="issue-head">
            <b>{r.product_name}</b>
            <span className="tag">{Number(r.value).toLocaleString("zh-CN")} {r.unit}</span>
            <span className="muted">功能单位 {r.functional_unit} · {r.data_year ?? "年份未知"} 年 · {r.database_name ?? ""}
              {r.quality_stars ? ` · 质量 ${"★".repeat(r.quality_stars)}` : ""} · {STATUS[r.status] ?? (r.status === "approved" ? "已批准" : r.status)}</span>
          </div>
          <p className="muted">适用企业：{r.applicable_nodes?.length ? r.applicable_nodes.join("、") : "通用"}
            {r.product_category ? ` · 类别 ${r.product_category}` : ""}{r.region ? ` · 地域 ${r.region}` : ""}{r.method_standard ? ` · ${r.method_standard}` : ""}</p>
          <p className="muted">来源：{r.source_url ? <a href={r.source_url} target="_blank" rel="noreferrer">{documentTitle(r.source_title)}</a> : documentTitle(r.source_title)}</p>
          {cleanSource(r.note) && <p className="muted">备注：{cleanSource(r.note)}</p>}
          {r.reviewed_by && <p className="muted">审核：{r.reviewed_by} {r.reviewed_at ? new Date(r.reviewed_at).toLocaleString("zh-CN") : ""}</p>}
          <div className="decide">
            <select name="boundary" defaultValue={r.boundary ?? ""}>
              <option value="">系统边界{r.boundary ? "" : "（未标注）"}</option>
              {Object.entries(BOUNDARY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input name="note" placeholder="审核意见（可选，追加到备注）" />
            {r.status !== "approved" && <button name="decision" value="approve" className="btn">批准</button>}
            <button name="decision" value="save" className="btn ghost">只保存</button>
            {r.status !== "retired" && <button name="decision" value="reject" className="btn ghost">停用</button>}
          </div>
        </form>
      ))}
    </section>
  );
}
