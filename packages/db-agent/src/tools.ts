import { StringEnum, Type, type Static, type TSchema } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import pg from "pg";
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { loadEdges, loadVersioned, planJoins, searchCatalog } from "./catalog.js";
import { REPO_ROOT, type AgentConfig } from "./config.js";
import { readOnly, sandboxSql, write } from "./db.js";
import { triggerGovernance } from "./governance.js";
import { guardReadSql, guardWriteSql } from "./sql-guard.js";
import { normaliseSql, validateSql } from "./sql-validate.js";

const MAX_TEXT = 12000;

/** Tool results: JSON text for the model (truncated if large) plus structured details for logs/UI. */
function result(data: unknown, meta: Record<string, unknown> = {}) {
  let text = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + `…（结果过长已截断，共 ${text.length} 字符，请缩小查询范围）`;
  return { content: [{ type: "text" as const, text }], details: { ...meta, data } };
}

/** Whitelist lookup: group-by expressions are interpolated into SQL, so only known keys are accepted. */
function pick<M extends Record<string, string>>(map: M, key: string): string {
  if (!Object.prototype.hasOwnProperty.call(map, key)) throw new Error(`不支持的分组：${key}`);
  return map[key];
}

function tool<T extends TSchema>(def: Omit<AgentTool<T>, "execute"> & {
  execute: (params: Static<T>) => Promise<ReturnType<typeof result>>;
}): AgentTool<T> {
  return { ...def, execute: async (_id, params) => def.execute(params) } as AgentTool<T>;
}

const Year = (description: string) => Type.Integer({ minimum: 2000, maximum: 2100, description });
const NodeCode = Type.String({ description: "对象编码，园区为 XYEDZ；可先用 find_entities 查找企业编码，如 E_WANHUA" });
const Profile = StringEnum(["GIP_2026", "GIP_2025", "GIP_2024", "ZCP_2025"], {
  description: "口径/标准版本：GIP_2026 绿色工业园区2026版（主版本，电力用河南省因子）；ZCP_2025 零碳园区（电力用全国化石能源因子）",
});

// ---------------------------------------------------------------------------------------------
// 只读工具
// ---------------------------------------------------------------------------------------------

/** Per-agent state shared by the tools: the current question (for Q&A pairs) and the SQL repair budget. */
export interface ToolContext {
  getQuestion: () => string | undefined;
  sessionId?: string;
  sqlFailures: number;
}
const MAX_SQL_ATTEMPTS = 3;   // first try + two repairs

function searchCatalogTool(ctx: ToolContext) {
  return tool({
    name: "search_catalog",
    label: "检索语义目录",
    description: "在语义目录中检索与问题相关的表/视图（业务说明、粒度、口径陷阱、字段说明与取值剖析）、基础量定义、合规关联边、"
      + "已验证的问答示例和相关的未处理数据问题。写 SQL 之前必须先调用。",
    parameters: Type.Object({
      keywords: Type.Array(Type.String(), { description: "问题中的业务关键词，如 [\"用电量\",\"企业\",\"月度\"]；1–8 个", minItems: 1, maxItems: 8 }),
    }),
    execute: async ({ keywords }) => readOnly(async (c) => result(await searchCatalog(c, keywords, ctx.getQuestion()))),
  });
}

const planJoinsTool = tool({
  name: "plan_joins",
  label: "规划连接路径",
  description: "在已审核的关联图中查找从第一张表到其他表的最短连接路径，给出连接条件与基数，并提示先聚合再连接的陷阱。写多表 SQL 前调用。",
  parameters: Type.Object({
    objects: Type.Array(Type.String({ description: "schema.table，如 fact.energy_activity" }), { minItems: 2, maxItems: 5 }),
  }),
  execute: async ({ objects }) => readOnly(async (c) => result(planJoins(await loadEdges(c), objects))),
});

const queryMetric = tool({
  name: "query_metric",
  label: "按指标层取数",
  description: "按指标层的标准口径取基础量（如 ENG_TCE 综合能耗、CO2_TOTAL 碳排放、ECO_GROSS_OUTPUT 工业总产值、ECO_VA_CONST 工业增加值、"
    + "ECO_HIGHTECH_OUTPUT 高企产值、RES_FRESH_WATER 新鲜水量），自动处理汇总范围、版本、口径和年度资格，并给出模拟数据占比。"
    + "能用它回答的不要自己写 SQL。编码不确定时先 search_catalog。",
  parameters: Type.Object({
    metric_codes: Type.Array(Type.String(), { minItems: 1, maxItems: 10, description: "基础量编码" }),
    node_codes: Type.Array(Type.String(), { minItems: 1, maxItems: 20, description: "对象编码，园区 XYEDZ" }),
    years: Type.Array(Year("年份"), { minItems: 1, maxItems: 10 }),
    profile: Type.Optional(Profile),
    ratio_of: Type.Optional(Type.Array(Type.String(), { minItems: 2, maxItems: 2,
      description: "需要比值或排名时填 [分子编码, 分母编码]，如 [\"ENG_TCE\",\"ECO_GROSS_OUTPUT\"]；返回按比值从高到低排序的结果，不要自己心算排序" })),
  }),
  execute: async ({ metric_codes, node_codes, years, profile, ratio_of }) => readOnly(async (c) => {
    if (ratio_of) metric_codes = [...new Set([...metric_codes, ...ratio_of])];
    const { rows } = await c.query(`
      select m.code as metric, m.name, m.unit, n.code as node_code, n.name as node_name, y as year,
             round(engine.metric_value(m.code, n.node_id, y, $4)::numeric, 4) as value,
             round(engine.inputs_estimated_share(array[m.code], n.node_id, y, 0)::numeric, 3) as estimated_share
        from core.metric_def m cross join core.org_node n cross join unnest($3::int[]) as y
       where m.code = any ($1) and n.code = any ($2)
       order by m.code, n.code, y`, [metric_codes, node_codes, years, profile ?? "GIP_2026"]);
    const missing = metric_codes.filter((code) => !rows.some((r) => r.metric === code));
    let ratios;
    if (ratio_of) {
      const [num, den] = ratio_of;
      const val = (node: string, y: number, m: string) => rows.find((r) => r.node_code === node && r.year === y && r.metric === m);
      ratios = node_codes.flatMap((node) => years.map((y) => {
        const a = val(node, y, num), b = val(node, y, den);
        const ratio = a?.value != null && b?.value != null && Number(b.value) !== 0 ? Number(a.value) / Number(b.value) : null;
        return { node_code: node, node_name: a?.node_name ?? b?.node_name, year: y, numerator: a?.value ?? null, denominator: b?.value ?? null,
                 ratio: ratio == null ? null : Number(ratio.toPrecision(6)), unit: `${a?.unit ?? num}/${b?.unit ?? den}`,
                 estimated_share: Math.max(Number(a?.estimated_share ?? 0), Number(b?.estimated_share ?? 0)) };
      })).sort((x, y) => (y.ratio ?? -Infinity) - (x.ratio ?? -Infinity)).map((r, i) => ({ rank: r.ratio == null ? null : i + 1, ...r }));
    }
    return result({ profile: profile ?? "GIP_2026", ...(ratios ? { ratios_sorted_desc: ratios } : { rows }), unknown_metrics: missing });
  }),
});

const listGovernanceIssues = tool({
  name: "list_governance_issues",
  label: "数据治理工单",
  description: "查看数据治理工单与洞察：脏数据、口径歧义、关联陷阱、覆盖不足、目录缺口和规律发现。回答数据质量、口径问题或解释异常时使用。",
  parameters: Type.Object({
    status: Type.Optional(StringEnum(["open", "approved", "rejected", "applied", "auto_closed"], { description: "默认 open" })),
    category: Type.Optional(StringEnum(["dirty_data", "ambiguity", "join_trap", "coverage", "catalog", "insight"], { description: "类别" })),
  }),
  execute: async ({ status, category }) => readOnly(async (c) => {
    const { rows } = await c.query(`
      select issue_id, category, risk, title, description, suggestion, evidence, status, last_seen_at::date as last_seen
        from semantic.governance_issue
       where status = coalesce($1, 'open') and ($2::text is null or category = $2)
       order by case risk when 'high' then 0 when 'medium' then 1 else 2 end, issue_id desc limit 30`, [status ?? null, category ?? null]);
    return result(rows);
  }),
});

const findEntities = tool({
  name: "find_entities",
  label: "查找园区对象和企业",
  description: "按关键字查找园区、片区、企业、公共设施，返回编码、类型、行业、信用代码、荣誉。用于把用户说的企业名换成编码。",
  parameters: Type.Object({
    keyword: Type.Optional(Type.String({ description: "名称关键字，如 万华、谷麦；不填返回全部" })),
  }),
  execute: async ({ keyword }) => readOnly(async (c) => {
    const { rows } = await c.query(`
      select n.code, n.name, n.node_type, n.industry_name, n.park_category, n.legal_name, n.credit_code,
             n.is_above_scale, n.is_high_tech,
             (select string_agg(h.title, '；') from core.honor h where h.node_id = n.node_id) as honors
        from mart.v_org_node n
       where $1::text is null or n.name ilike '%' || $1 || '%' or n.legal_name ilike '%' || $1 || '%' or n.code ilike '%' || $1 || '%'
       order by n.path`, [keyword ?? null]);
    return result(rows);
  }),
});

const energyGroup = { year: "extract(year from a.period_month)::int", month: "to_char(a.period_month, 'YYYY-MM')",
                      energy_type: "t.name", enterprise: "n.name" } as const;

const getEnergySummary = tool({
  name: "get_energy_summary",
  label: "能耗汇总",
  description: "按年/月/能源品种/企业汇总某对象（园区则汇总全部企业和公共区域）的能源消费：实物量与折标准煤（tce）。"
    + "只统计当前有效数据，并给出估值（模拟）数据占比。",
  parameters: Type.Object({
    node_code: NodeCode,
    year_from: Year("起始年份"),
    year_to: Year("结束年份"),
    group_by: StringEnum(["year", "month", "energy_type", "enterprise"], { description: "分组维度" }),
  }),
  execute: async ({ node_code, year_from, year_to, group_by }) => readOnly(async (c) => {
    const g = pick(energyGroup, group_by);
    const { rows } = await c.query(`
      with nodes as (select engine.accounting_nodes(node_id) as node_id from core.org_node where code = $1)
      select ${g} as grp,
             round(sum(case a.flow when 'send_out' then -a.tce when 'consumption' then a.tce when 'receive' then a.tce else 0 end), 3) as tce,
             ${group_by === "energy_type" ? "round(sum(a.quantity_std) filter (where a.flow = 'consumption'), 3) as consumption_qty, max(t.default_unit) as unit," : ""}
             round(coalesce(sum(a.tce) filter (where a.data_source in ('estimated','interpolated')), 0) / nullif(sum(a.tce), 0), 3) as estimated_share
        from fact.energy_activity a
        join core.energy_type t on t.code = a.energy_type_code
        join core.org_node n on n.node_id = a.node_id
       where a.is_current and a.node_id in (select node_id from nodes)
         and a.period_month between make_date($2, 1, 1) and make_date($3, 12, 1)
       group by 1 order by 1`, [node_code, year_from, year_to]);
    return result(rows, { unit_tce: "吨标准煤" });
  }),
});

const carbonGroup = { year: "extract(year from e.period_month)::int", month: "to_char(e.period_month, 'YYYY-MM')",
                      category: "e.category", energy_type: "e.energy_type_code", enterprise: "n.name" } as const;

const getCarbonSummary = tool({
  name: "get_carbon_summary",
  label: "碳排放汇总",
  description: "按年/月/核算类别/能源品种/企业汇总碳排放（tCO2）。口径决定电力因子：GIP_2026 用河南省电力因子，ZCP_2025 用全国化石能源电力因子。"
    + "核算类别：fuel_combustion 燃料燃烧、indirect_electricity 电力间接、indirect_heat 热力间接。",
  parameters: Type.Object({
    node_code: NodeCode,
    profile: Profile,
    year_from: Year("起始年份"),
    year_to: Year("结束年份"),
    group_by: StringEnum(["year", "month", "category", "energy_type", "enterprise"], { description: "分组维度" }),
  }),
  execute: async ({ node_code, profile, year_from, year_to, group_by }) => readOnly(async (c) => {
    const { rows } = await c.query(`
      with nodes as (select engine.accounting_nodes(node_id) as node_id from core.org_node where code = $1)
      select ${pick(carbonGroup, group_by)} as grp, round(sum(e.co2_t), 3) as co2_t,
             round(sum(e.co2_t * e.estimated_share) / nullif(sum(e.co2_t), 0), 3) as estimated_share
        from fact.carbon_emission e join core.org_node n on n.node_id = e.node_id
       where e.is_current and e.profile_code = $2 and e.node_id in (select node_id from nodes)
         and e.period_month between make_date($3, 1, 1) and make_date($4, 12, 1)
       group by 1 order by 1`, [node_code, profile, year_from, year_to]);
    const runs = await c.query(`
      select r.run_id, r.finished_at, r.warnings from fact.calc_run r join core.standard_version v using (version_id)
       where r.run_type = 'carbon' and v.code = $1 order by r.run_id desc limit 1`, [profile]);
    return result({ rows, latest_run_warnings: runs.rows[0]?.warnings ?? [] });
  }),
});

const getIndicators = tool({
  name: "get_indicators",
  label: "指标结果",
  description: "查询某标准版本、某对象、某年的全部二级指标，每项给出明确状态：达标 / 未达标 / 已算出但无判定基准 / 公式待审核 / 缺少输入数据 / 录入类尚未录入，"
    + "以及值、判定基准、得分、估值数据占比和汇总计数。前台大屏只展示“达标”的指标。",
  parameters: Type.Object({
    version: Profile,
    node_code: NodeCode,
    year: Year("数据年份（2026 年度申报对应 2025 年数据）"),
    only_achieved: Type.Optional(Type.Boolean({ description: "只返回达标指标" })),
  }),
  execute: async ({ version, node_code, year, only_achieved }) => readOnly(async (c) => {
    const { rows } = await c.query(`
      with v as (
        select iv.* from fact.indicator_value iv join core.org_node n using (node_id)
         where iv.is_current and n.code = $2 and iv.period_start = make_date($3, 1, 1))
      select d.code, d.name, d.unit,
             case when v.value is not null and v.achieved then '达标'
                  when v.value is not null and v.achieved = false then '未达标'
                  when v.value is not null then '已算出但无判定基准'
                  when d.handling in ('manual', 'self_proof') then '录入/自证类，尚未录入'
                  when f.status is distinct from 'approved' then '公式待审核（' || coalesce(f.code, '无公式') || '）'
                  else '缺少输入数据' end as status,
             round(v.value, 4) as value, b.comparator, round(b.value, 4) as benchmark,
             (v.input_snapshot ->> 'benchmark_inherited')::boolean as benchmark_inherited,
             v.score, d.score as full_score, round(v.estimated_share, 3) as estimated_share,
             v.input_snapshot -> 'missing' as missing_inputs
        from core.indicator_def d
        join core.standard_version sv on sv.version_id = d.version_id
        left join core.formula f on f.formula_id = d.formula_id
        left join v on v.indicator_id = d.indicator_id
        left join core.indicator_benchmark b on b.benchmark_id = v.benchmark_id
       where sv.code = $1 and d.level = 2 and ($4::boolean is not true or v.achieved)
       order by d.seq`, [version, node_code, year, only_achieved ?? false]);
    const summary: Record<string, number> = {};
    for (const r of rows) {
      const k = String(r.status).startsWith("公式待审核") ? "公式待审核" : r.status;
      summary[k] = (summary[k] ?? 0) + 1;
    }
    const scored = rows.filter((r) => r.score != null).reduce((a, r) => a + Number(r.score), 0);
    const missingData = await c.query(`
      select r.warnings from fact.calc_run r join core.standard_version v using (version_id)
       where r.run_type = 'indicator' and v.code = $1 and r.period_from = make_date($2, 1, 1)
       order by r.run_id desc limit 1`, [version, year]);
    return result({ summary: { total: rows.length, ...summary, score_obtained: scored }, indicators: rows,
                    last_run_warnings: missingData.rows[0]?.warnings ?? "该年度尚未计算，可调用 run_calculation" });
  }),
});

const explainIndicator = tool({
  name: "explain_indicator",
  label: "解释指标",
  description: "解释一个指标：定义、计算公式与出处页码、公式审核状态、判定基准与来源、跨版本对照，以及最近一次计算用到的输入数据。",
  parameters: Type.Object({
    version: Profile,
    indicator_code: Type.String({ description: "指标编码，如 I04（2026版能源产出率）；不确定时可用 query_sql 查 core.indicator_def" }),
    node_code: Type.Optional(NodeCode),
    year: Type.Optional(Year("查看哪一年的计算输入")),
  }),
  execute: async ({ version, indicator_code, node_code, year }) => readOnly(async (c) => {
    const def = await c.query(`
      select d.indicator_id, d.code, d.name, d.unit, d.direction, d.indicator_type, d.score, d.handling, d.definition,
             f.code as formula_code, f.expression, f.description as formula_source, f.status as formula_status,
             (select json_agg(json_build_object('type', b.benchmark_type, 'comparator', b.comparator, 'value', b.value,
                      'text', b.value_text, 'source', b.source_doc, 'page', b.source_page, 'applies_when', b.applies_when))
                from core.indicator_benchmark b where b.indicator_id = d.indicator_id) as benchmarks,
             (select json_agg(json_build_object('from', fv.code || ':' || fd.code || ' ' || fd.name, 'relation', m.relation, 'note', m.note))
                from core.indicator_mapping m join core.indicator_def fd on fd.indicator_id = m.from_indicator_id
                join core.standard_version fv on fv.version_id = fd.version_id where m.to_indicator_id = d.indicator_id) as mapped_from
        from core.indicator_def d join core.standard_version v using (version_id)
        left join core.formula f on f.formula_id = d.formula_id
       where v.code = $1 and d.code = $2`, [version, indicator_code]);
    if (def.rowCount === 0) throw new Error(`未找到指标 ${version}:${indicator_code}`);
    const snap = await c.query(`
      select extract(year from v.period_start)::int as year, v.value, v.achieved, v.input_snapshot
        from fact.indicator_value v join core.org_node n using (node_id)
       where v.indicator_id = $1 and v.is_current and n.code = $2 and ($3::int is null or v.period_start = make_date($3, 1, 1))
       order by v.period_start desc limit 1`, [def.rows[0].indicator_id, node_code ?? "XYEDZ", year ?? null]);
    return result({ definition: def.rows[0], latest_calculation: snap.rows[0] ?? null });
  }),
});

const getFactors = tool({
  name: "get_factors",
  label: "排放因子",
  description: "查询折标准煤系数、低位发热量、排放因子：数值、单位、口径（variant）、年份、出处、审核/批准状态。",
  parameters: Type.Object({
    energy_type: Type.Optional(Type.String({ description: "能源品种编码，如 ELEC_GRID、NATURAL_GAS、DIESEL" })),
    status: Type.Optional(StringEnum(["approved", "draft", "retired"], { description: "按状态筛选" })),
  }),
  execute: async ({ energy_type, status }) => readOnly(async (c) => {
    const { rows } = await c.query(`
      select f.energy_type_code, t.name as energy_name, f.factor_kind, f.variant, f.value, f.value_low, f.value_high, f.unit,
             to_char(f.valid_from, 'YYYY') as from_year, to_char(f.valid_to, 'YYYY') as to_year, f.status,
             s.title as source, s.doc_no, f.source_page, f.note, f.review_note
        from core.factor f join core.factor_source s using (source_id) join core.energy_type t on t.code = f.energy_type_code
       where ($1::text is null or f.energy_type_code = $1) and ($2::text is null or f.status = $2)
       order by f.energy_type_code, f.factor_kind, f.variant, f.valid_from`, [energy_type ?? null, status ?? null]);
    return result(rows);
  }),
});

const getDataCoverage = tool({
  name: "get_data_coverage",
  label: "数据覆盖与来源",
  description: "数据底账：各类事实数据的条数、期间范围、真实与估值（模拟）数据占比，以及最近的导入批次。回答“哪些数据是真实的/模拟的”时使用。",
  parameters: Type.Object({}),
  execute: async () => readOnly(async (c) => {
    const energy = await c.query(`select data_source, count(*)::int as rows, min(period_month)::text as first, max(period_month)::text as last
                                    from fact.energy_activity where is_current group by 1`);
    const stats = await c.query(`select data_source, count(*)::int as rows, min(period_start)::text as first, max(period_start)::text as last
                                   from fact.statistic_value where is_current group by 1`);
    const batches = await c.query(`select batch_id, source_type, source_name, status, row_count, error_count, submitted_at::date as date,
                                          left(estimation_method, 80) as estimation_method
                                     from raw.import_batch order by batch_id desc limit 10`);
    return result({ energy_activity: energy.rows, statistic_value: stats.rows, recent_batches: batches.rows,
                    note: "data_source: measured/manual 为真实数据，estimated 为模拟估值，interpolated 为插值" });
  }),
});

/**
 * Model-written SQL goes through the semantic query flow: guard → plan check (current versions, one carbon profile,
 * approved joins, no fan-out sums) → trial run with row limit → result. Structured errors go back to the model,
 * which may repair the query at most twice. Successful queries become candidate question–SQL pairs for review.
 */
function querySql(cfg: AgentConfig, ctx: ToolContext) {
  return tool({
    name: "query_sql",
    label: "受限 SQL 查询",
    description: "固定工具和 query_metric 无法回答时使用。只能写一条 SELECT/WITH 只读查询，可访问 mart 视图、fact 事实表、core 字典和 semantic 目录。"
      + "先 search_catalog，多表时先 plan_joins；跨表或归因类问题先拆成子问题，用 WITH 分步计算（先聚合再连接）。"
      + `执行前会按执行计划校验，未通过时返回原因，最多修复两次；自动限制 ${cfg.sqlRowLimit} 行、超时 ${cfg.sqlTimeoutMs / 1000} 秒。`,
    parameters: Type.Object({
      sql: Type.String({ description: "一条 SELECT 或 WITH 语句" }),
      purpose: Type.String({ description: "这条查询要回答什么问题" }),
    }),
    execute: async ({ sql }) => {
      if (ctx.sqlFailures >= MAX_SQL_ATTEMPTS) {
        throw new Error(`本次提问已有 ${MAX_SQL_ATTEMPTS} 条 SQL 未通过校验。不要再写 SQL：向用户说明缺少什么数据或口径，或请用户澄清问题。`);
      }
      const guarded = guardReadSql(sql, cfg.sqlRowLimit);
      let out;
      try {
        out = await sandboxSql(cfg.sqlTimeoutMs, async (c) => {
          const edges = await loadEdges(c);
          const versioned = await loadVersioned(c);
          const v = await validateSql(c, guarded, sql, edges, versioned);
          if (v.errors.length) return { v, r: undefined };
          return { v, r: await c.query(guarded) };
        });
      } catch (err) {
        ctx.sqlFailures += 1;
        throw new Error(`SQL 无法执行：${(err as Error).message}（剩余修复次数 ${Math.max(0, MAX_SQL_ATTEMPTS - ctx.sqlFailures)}）`);
      }
      if (!out.r) {
        ctx.sqlFailures += 1;
        throw new Error(JSON.stringify({ 校验未通过: out.v.errors, 剩余修复次数: Math.max(0, MAX_SQL_ATTEMPTS - ctx.sqlFailures) }));
      }
      const warnings = [...out.v.warnings];
      if (out.r.rowCount === 0) warnings.push({ code: "EMPTY", message: "结果为空：检查编码、年份和筛选条件是否正确，不要据此断言“没有”" });
      if (!warnings.length) await saveQaCandidate(sql, out.v.objects, ctx).catch(() => undefined);
      return result({ row_count: out.r.rowCount, rows: out.r.rows, validation: { objects: out.v.objects, joins: out.v.joins, warnings } },
                    { db_role: "green_agent_ro" });
    },
  });
}

async function saveQaCandidate(sql: string, objects: string[], ctx: ToolContext) {
  const question = ctx.getQuestion();
  if (!question) return;
  const hash = createHash("md5").update(normaliseSql(sql)).digest("hex");
  await write("green_app", (c) => c.query(`
    insert into semantic.qa_pair (question, sql, sql_hash, objects, origin, session_id)
    values ($1, $2, $3, $4, 'agent_log', $5)
    on conflict (sql_hash) do update set hit_count = semantic.qa_pair.hit_count + 1, last_used_at = now()`,
    [question.slice(0, 1000), sql, hash, objects, ctx.sessionId ?? null]));
}

// ---------------------------------------------------------------------------------------------
// 写工具（全自动管理）
// ---------------------------------------------------------------------------------------------

const runCalculation = (cfg: AgentConfig) => tool({
  name: "run_calculation",
  label: "执行计算",
  description: "执行折标→碳核算→指标计算并写入结果（只使用已批准的公式）。preview=true 时可试用草稿公式，结果只返回、不写入。"
    + "导入新数据或用户要求重算时使用。",
  parameters: Type.Object({
    version: Profile,
    node_code: NodeCode,
    year: Year("数据年份"),
    preview: Type.Optional(Type.Boolean({ description: "预览模式，不写入指标结果" })),
  }),
  executionMode: "sequential",
  execute: async ({ version, node_code, year, preview }) => {
    const out = await write("green_app", async (c) => {
      const r = (await c.query("select engine.run_all($1, $2, $3, $4) as r", [version, node_code, year, preview ?? false])).rows[0].r;
      const items = (r.indicators.items as any[]).filter((i) => i.value != null)
        .map((i) => ({ code: i.code, name: i.name, value: i.value, benchmark: i.benchmark, achieved: i.achieved, estimated_share: i.estimated_share }));
      return result({ energy: r.energy, carbon: { rows: r.carbon.rows_calculated, factor_year_fallback: r.carbon.factor_year_fallback },
                      indicators: { calculated: r.indicators.calculated, skipped: r.indicators.skipped, warnings: r.indicators.warnings, items },
                      governance: preview ? undefined : "已在后台启动数据治理检测" },
                    { db_role: "green_app", wrote: !(preview ?? false) });
    });
    if (!preview) triggerGovernance(cfg, "calc");
    return out;
  },
});

function importExcel(cfg: AgentConfig) {
  return tool({
    name: "import_excel",
    label: "导入 Excel",
    description: "导入一个按模板填写的 Excel 文件（原件保存、入湖、解析入库）。模板编码：ENT_MONTHLY_ENERGY 企业月度能耗、"
      + "ENT_ANNUAL_ECONOMIC 年度经济、ENT_ANNUAL_PRODUCTION 产品产量、PARK_ANNUAL_RESOURCE_ENV 资源环境。"
      + "模拟或估算数据必须填写 estimated_method，导入后标记为估值。",
    parameters: Type.Object({
      file_path: Type.String({ description: "文件路径（相对仓库根目录或绝对路径）" }),
      template_code: StringEnum(["ENT_MONTHLY_ENERGY", "ENT_ANNUAL_ECONOMIC", "ENT_ANNUAL_PRODUCTION", "PARK_ANNUAL_RESOURCE_ENV"], { description: "导入模板" }),
      estimated_method: Type.Optional(Type.String({ description: "仅当文件是模拟/估算数据时填写估值方法说明" })),
      dry_run: Type.Optional(Type.Boolean({ description: "只校验不落库" })),
    }),
    executionMode: "sequential",
    execute: async ({ file_path, template_code, estimated_method, dry_run }) => {
      const client = new pg.Client({ connectionString: cfg.databaseUrl });
      await client.connect();
      try {
        await client.query("SET ROLE green_app");
        // Loaded on demand so consumers that never import files (web page, voice) do not load the Excel parser.
        const { ingestFile } = await import("../../ingest/src/ingest.js");
        const r = await ingestFile(client, {
          filePath: isAbsolute(file_path) ? file_path : resolve(REPO_ROOT, file_path), templateCode: template_code,
          dryRun: dry_run ?? false, note: "由数据库 Agent 导入",
          estimated: estimated_method ? { method: estimated_method, model: "db-agent" } : undefined,
        });
        if (!r.dryRun) triggerGovernance(cfg, "import");
        return result({ batch_id: r.batchId, rows_read: r.rowsRead, unknown_headers: r.unknownHeaders, load: r.load, dry_run: r.dryRun,
                        governance: r.dryRun ? undefined : "已在后台启动数据治理检测" },
                      { db_role: "green_app", wrote: !r.dryRun });
      } finally {
        await client.end();
      }
    },
  });
}

const executeWriteSql = tool({
  name: "execute_write_sql",
  label: "执行写操作 SQL",
  description: "执行一条写操作：INSERT/UPDATE（补录、修正数据）或 CREATE TABLE/VIEW/INDEX、ALTER TABLE ... ADD（新建表和视图建议放 lab schema）。"
    + "数据库禁止 DELETE/TRUNCATE/DROP；修正数据优先新增一行并把旧行 is_current 置为 false。因子、公式的审核批准只能由人工完成。",
  parameters: Type.Object({
    sql: Type.String({ description: "一条写操作语句" }),
    purpose: Type.String({ description: "为什么要做这个修改（会写入审计日志）" }),
  }),
  executionMode: "sequential",
  execute: async ({ sql }) => {
    const { sql: s, kind } = guardWriteSql(sql);
    const role = kind === "ddl" ? "green_ddl" : "green_app";
    return write(role, async (c) => {
      const r = await c.query(s);
      return result({ command: r.command, row_count: r.rowCount, rows: r.rows?.slice(0, 50) }, { db_role: role, wrote: true });
    });
  },
});

export const READ_TOOL_NAMES = ["search_catalog", "plan_joins", "query_metric", "find_entities", "get_energy_summary",
  "get_carbon_summary", "get_indicators", "explain_indicator", "get_factors", "get_data_coverage", "list_governance_issues", "query_sql"];
export const WRITE_TOOLS = new Set(["run_calculation", "import_excel", "execute_write_sql"]);

export function buildTools(cfg: AgentConfig, ctx: ToolContext = { getQuestion: () => undefined, sqlFailures: 0 }): AgentTool<any>[] {
  const read = [searchCatalogTool(ctx), planJoinsTool, queryMetric, findEntities, getEnergySummary, getCarbonSummary, getIndicators,
                explainIndicator, getFactors, getDataCoverage, listGovernanceIssues, querySql(cfg, ctx)];
  if (cfg.writeMode === "off") return read;
  return [...read, runCalculation(cfg), importExcel(cfg), executeWriteSql];
}
