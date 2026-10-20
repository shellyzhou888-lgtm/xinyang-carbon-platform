import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { logToolCall, startSession } from "./audit.js";
import type { AgentConfig } from "./config.js";
import { initPool } from "./db.js";
import { systemPrompt } from "./prompt.js";
import { normaliseSql } from "./sql-validate.js";
import { buildTools, WRITE_TOOLS, type ToolContext } from "./tools.js";
import { callKey, recordTrajectory } from "./trajectory.js";
import { createHash } from "node:crypto";

export interface DbAgentOptions {
  /** Channel recorded in agent.session: system (CLI), web, voice. */
  channel?: "system" | "web" | "voice";
  /** Called before a write tool when writeMode = "confirm"; return true to proceed. */
  confirmWrite?: (toolName: string, args: unknown) => Promise<boolean>;
  userRef?: string;
}

/**
 * Assembles the Pi agent:
 *   pi-ai          → DeepSeek model through the unified provider API
 *   pi-agent-core  → the loop: model ↔ tools until the answer is final
 *   hooks          → beforeToolCall (budget, confirmation) and afterToolCall (audit log)
 */
export async function createDbAgent(cfg: AgentConfig, opts: DbAgentOptions = {}) {
  initPool(cfg.databaseUrl);

  const models = createModels();
  models.setProvider(deepseekProvider());
  const model = models.getModel("deepseek", cfg.model);
  if (!model) throw new Error(`未找到模型 deepseek/${cfg.model}（可选：deepseek-flash、deepseek-v4-pro）`);

  const sessionId = await startSession(cfg.model, opts.userRef ?? "cli", opts.channel ?? "system", "db_agent");
  const started = new Map<string, number>();
  let callsThisPrompt = 0;
  // Per-question run state (repeated-call guard and trajectory log, after HarnessSQL arXiv 2610.12274)
  const run = { started: new Date().toISOString(), succeeded: new Map<string, number>(), blocked: 0, errors: 0, sqlHashes: [] as string[] };

  // Tool state: the question being answered (stored with candidate Q&A pairs) and the SQL repair budget per question.
  let agentRef: Agent | undefined;
  const toolCtx: ToolContext = {
    sessionId, sqlFailures: 0,
    getQuestion: () => {
      const last = [...(agentRef?.state.messages ?? [])].reverse().find((m: any) => m.role === "user") as any;
      if (!last) return undefined;
      return typeof last.content === "string" ? last.content : last.content.map((p: any) => p.text ?? "").join("");
    },
  };

  const agent = new Agent({
    initialState: {
      systemPrompt: systemPrompt(cfg),
      model,
      thinkingLevel: cfg.thinking,
      tools: buildTools(cfg, toolCtx),
    },
    streamFn: models.streamSimple.bind(models),
    getApiKey: async (provider) => (provider === "deepseek" ? cfg.deepseekApiKey : undefined),
    toolExecution: "parallel",

    beforeToolCall: async ({ toolCall, args }) => {
      callsThisPrompt += 1;
      if (callsThisPrompt > cfg.maxToolCallsPerPrompt) {
        await logToolCall(sessionId, { name: toolCall.name, args, durationMs: 0, status: "denied", error: "超过单次提问的工具调用上限" });
        return { block: true, reason: `本次提问的工具调用已达上限 ${cfg.maxToolCallsPerPrompt} 次，请根据已有结果回答`, terminate: true };
      }
      // An identical call that already succeeded in this question returns nothing new: remind instead of re-running.
      const prior = run.succeeded.get(callKey(toolCall.name, args));
      if (prior) {
        run.blocked += 1;
        await logToolCall(sessionId, { name: toolCall.name, args, durationMs: 0, status: "denied", error: "与本次提问中已成功的调用完全相同" });
        return { block: true, reason: `与本次提问第 ${prior} 次调用完全相同，结果已在上文，请直接使用；需要不同结果时请修改参数或换用其他工具` };
      }
      if (WRITE_TOOLS.has(toolCall.name) && cfg.writeMode === "confirm") {
        // No confirmation UI (e.g. web without a dialog) means the write is refused, never silently allowed.
        const ok = opts.confirmWrite ? await opts.confirmWrite(toolCall.name, args) : false;
        if (!ok) {
          await logToolCall(sessionId, { name: toolCall.name, args, durationMs: 0, status: "denied", error: "用户拒绝执行" });
          return { block: true, reason: "用户拒绝了这次写操作" };
        }
      }
      started.set(toolCall.id, performance.now());
      return undefined;
    },

    afterToolCall: async ({ toolCall, args, result, isError }) => {
      const t0 = started.get(toolCall.id) ?? performance.now();
      started.delete(toolCall.id);
      const details = (result.details ?? {}) as { db_role?: string; data?: any };
      const rows = Array.isArray(details.data) ? details.data.length
        : typeof details.data?.row_count === "number" ? details.data.row_count : undefined;
      const errorText = isError ? result.content.map((c: any) => c.text ?? "").join(" ").slice(0, 2000) : undefined;
      if (isError) run.errors += 1;
      else {
        run.succeeded.set(callKey(toolCall.name, args), callsThisPrompt);
        if (toolCall.name === "query_sql" && typeof (args as any)?.sql === "string") {
          run.sqlHashes.push(createHash("md5").update(normaliseSql((args as any).sql)).digest("hex"));
        }
      }
      await logToolCall(sessionId, {
        name: toolCall.name, args, dbRole: details.db_role ?? (WRITE_TOOLS.has(toolCall.name) ? undefined : "green_app(read only)"),
        rowCount: rows, durationMs: performance.now() - t0, status: isError ? "error" : "ok", error: errorText,
      });
      return undefined;
    },
  });

  agentRef = agent;
  agent.subscribe((event) => {
    if (event.type === "agent_start") {
      callsThisPrompt = 0; toolCtx.sqlFailures = 0;
      Object.assign(run, { started: new Date().toISOString(), succeeded: new Map(), blocked: 0, errors: 0, sqlHashes: [] });
    }
    if (event.type === "agent_end") {
      recordTrajectory({ session_id: sessionId, channel: opts.channel ?? "system", model: cfg.model, question: toolCtx.getQuestion(),
                         started_at: run.started, finished_at: new Date().toISOString(), tool_calls: callsThisPrompt,
                         tool_errors: run.errors, repeated_calls_blocked: run.blocked, sql_failures: toolCtx.sqlFailures,
                         sql_hashes: run.sqlHashes }, event.messages);
    }
  });

  return { agent, models, sessionId };
}
