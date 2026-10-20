/**
 * Adapter: exposes the database tools to the Xiaoyun voice backend as project tools
 * (see xiaoyun-voice packages/server/src/project.ts: name, description, JSON Schema parameters, execute, formatResult).
 *
 * Voice gets the read-only tools plus run_calculation. import_excel and execute_write_sql are not exposed:
 * a misheard sentence must not be able to change the database, and file paths are not a voice task.
 * Xiaoyun reserves query_sql for its own SQLite tool, so ours is renamed park_query_sql.
 */
import { logToolCall, startSession } from "./audit.js";
import { loadConfig } from "./config.js";
import { initPool } from "./db.js";
import { getParkOverview, type ParkOverview } from "./overview.js";
import { buildTools, READ_TOOL_NAMES, type ToolContext } from "./tools.js";

type Json = Record<string, unknown>;
interface VoiceContext { signal: AbortSignal; taskId: string; originalQuestion?: string }

const RENAME: Record<string, string> = { query_sql: "park_query_sql" };
const VOICE_TOOLS = new Set([...READ_TOOL_NAMES, "run_calculation"]);

let sessionPromise: Promise<string> | undefined;
function voiceSession(model: string) {
  sessionPromise ??= startSession(model, "xiaoyun", "voice", "xiaoyun_voice");
  return sessionPromise;
}

/** JSON Schema without TypeBox's symbol metadata (Ajv in Xiaoyun validates plain JSON Schema). */
const plainSchema = (schema: unknown) => JSON.parse(JSON.stringify(schema));

const fmt = (n: number | null) => (n == null ? "暂无数据" : Math.round(n).toLocaleString("zh-CN"));

/** Spoken summary + Markdown card for the overview (shared shape with the web dashboard). */
export function formatOverview(value: ParkOverview) {
  const est = value.energy_estimated_share ?? 0;
  const summary = `${value.year}年园区综合能耗约${fmt(value.tce)}吨标准煤，碳排放约${fmt(value.co2_t)}吨。`
    + `按2026版评价要求，${value.indicators.total}项指标中${value.indicators.achieved}项达标，得${value.indicators.score}分。`
    + (est > 0 ? "注意，这些结果主要基于模拟数据，不代表园区实际情况。" : "");
  const rows = value.achieved
    .map((a) => `| ${a.code} | ${a.name} | ${a.value.toFixed(2)}${a.unit ?? ""} | ${a.comparator ?? ""}${a.benchmark ?? ""} |`)
    .join("\n");
  return {
    summary,
    data: { kind: "park_overview", ...value },
    markdown: `### ${value.year} 年园区能碳总览（${value.profile}）\n\n`
      + `- 综合能耗：${fmt(value.tce)} tce\n- 碳排放：${fmt(value.co2_t)} tCO₂\n- 工业增加值：${fmt(value.value_added_wan)} 万元\n`
      + `- 模拟数据占比（能耗）：${Math.round(est * 100)}%\n\n`
      + `**达标指标（${value.indicators.achieved} 项）**\n\n| 编码 | 指标 | 值 | 判定基准 |\n| --- | --- | --- | --- |\n${rows}`,
  };
}

export function createVoiceTools() {
  const cfg = loadConfig({ requireModelKey: false });
  initPool(cfg.databaseUrl);
  // Tool state follows the voice task: a new task resets the SQL repair budget and carries its own question.
  let task = { id: "", question: undefined as string | undefined };
  const toolCtx: ToolContext = { getQuestion: () => task.question, sqlFailures: 0 };
  const tools = buildTools({ ...cfg, writeMode: "auto" }, toolCtx).filter((t) => VOICE_TOOLS.has(t.name));

  const projectTools: Json[] = tools.map((t) => ({
    name: RENAME[t.name] ?? t.name,
    description: t.description,
    parameters: plainSchema(t.parameters),
    readOnly: t.name !== "run_calculation",
    execute: async (args: Json, ctx: VoiceContext) => {
      ctx.signal.throwIfAborted();
      if (ctx.taskId !== task.id) { task = { id: ctx.taskId, question: ctx.originalQuestion }; toolCtx.sqlFailures = 0; }
      const t0 = performance.now();
      const session = await voiceSession(cfg.model);
      try {
        const r = await t.execute(ctx.taskId, args as never);
        const details = (r.details ?? {}) as { db_role?: string; data?: unknown };
        await logToolCall(session, { name: t.name, args, dbRole: details.db_role ?? "green_app(read only)",
                                     durationMs: performance.now() - t0, status: "ok" });
        return details.data;
      } catch (err) {
        await logToolCall(session, { name: t.name, args, durationMs: performance.now() - t0, status: "error",
                                     error: (err as Error).message.slice(0, 2000) });
        throw err;
      }
    },
  }));

  // One direct tool: Qwen can answer “园区整体情况怎么样” at once, without starting a background task.
  projectTools.unshift({
    name: "park_overview",
    description: "直接读取园区某年的能碳总览：综合能耗、碳排放、工业增加值、达标指标数与得分、模拟数据占比。用户问园区整体情况、达标情况时使用。",
    parameters: { type: "object", properties: { year: { type: "integer", minimum: 2021, maximum: 2030, description: "数据年份，默认 2025" } },
                  additionalProperties: false },
    readOnly: true,
    voiceDirect: true,
    execute: async (args: Json, ctx: VoiceContext) => {
      ctx.signal.throwIfAborted();
      const session = await voiceSession(cfg.model);
      const t0 = performance.now();
      const r = await getParkOverview(Number(args.year ?? 2025));
      await logToolCall(session, { name: "park_overview", args, dbRole: "green_app(read only)", durationMs: performance.now() - t0, status: "ok" });
      return r;
    },
    formatResult: (value: ParkOverview) => formatOverview(value),
  });

  return projectTools;
}
