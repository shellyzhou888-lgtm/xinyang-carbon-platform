import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, Type } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { logToolCall, startSession } from "./audit.js";
import type { AgentConfig } from "./config.js";
import { initPool } from "./db.js";
import { buildTools, type ToolContext } from "./tools.js";

export type Board = "overview" | "energy" | "carbon" | "diagnosis" | "enterprises" | "governance";
export interface ManagerContext { page?: string; year?: number }
export interface ManagerOptions {
  channel: "web" | "voice";
  userRef: string;
}

const COMMON = ["search_catalog", "plan_joins", "query_metric", "query_sql", "find_entities"];
const BOARDS: Record<Board, { label: string; purpose: string; tools: string[] }> = {
  overview: {
    label: "园区总览",
    purpose: "跨板块汇总、园区总体表现、年度比较和达标概览",
    tools: [...COMMON, "get_energy_summary", "get_carbon_summary", "get_indicators", "get_data_coverage"],
  },
  energy: {
    label: "能源管理",
    purpose: "综合能耗、能源品种、企业用能、强度、能效和能源因子",
    tools: [...COMMON, "get_energy_summary", "get_factors", "get_data_coverage"],
  },
  carbon: {
    label: "碳管理",
    purpose: "碳排放、排放来源、碳强度、碳因子、碳市场和产品碳足迹",
    tools: [...COMMON, "get_carbon_summary", "get_factors", "get_data_coverage"],
  },
  diagnosis: {
    label: "综合诊断",
    purpose: "绿色园区指标、未达标原因、预测、预警、目标和改进建议",
    tools: [...COMMON, "get_indicators", "explain_indicator", "get_energy_summary", "get_carbon_summary", "list_governance_issues", "get_data_coverage"],
  },
  enterprises: {
    label: "企业与项目名录",
    purpose: "企业识别、荣誉、企业排名及单个企业的能耗和排放",
    tools: [...COMMON, "get_energy_summary", "get_carbon_summary", "get_data_coverage"],
  },
  governance: {
    label: "数据治理",
    purpose: "数据覆盖、模拟值、来源、口径、语义目录和治理工单",
    tools: [...COMMON, "get_data_coverage", "list_governance_issues", "get_indicators", "explain_indicator"],
  },
};

const textOf = (message: any): string => typeof message?.content === "string" ? message.content
  : Array.isArray(message?.content) ? message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("") : "";

function modelFor(cfg: AgentConfig) {
  const models = createModels();
  models.setProvider(deepseekProvider());
  const found = models.getModel("deepseek", cfg.model);
  if (!found) throw new Error(`未找到 DeepSeek 模型 ${cfg.model}`);
  return { models, model: { ...found, baseUrl: cfg.deepseekBaseUrl } };
}

/** One shared Pi supervisor for both entrances. Specialist agents are created only when delegated to. */
export async function createManagerAgent(cfg: AgentConfig, opts: ManagerOptions) {
  initPool(cfg.databaseUrl);
  const { models, model } = modelFor(cfg);
  const sessionId = await startSession(cfg.model, opts.userRef, opts.channel, "platform_manager");
  const getApiKey = async (provider: string) => provider === "deepseek" ? cfg.deepseekApiKey : undefined;
  let managerCalls = 0;
  const managerStarted = new Map<string, number>();

  async function consult(board: Board, question: string) {
    const spec = BOARDS[board];
    const toolCtx: ToolContext = { getQuestion: () => question, sqlFailures: 0, sessionId };
    const allowed = new Set(spec.tools);
    const tools = buildTools({ ...cfg, writeMode: "off" }, toolCtx).filter((tool) => allowed.has(tool.name));
    let calls = 0;
    const started = new Map<string, number>();
    const expert = new Agent({
      initialState: {
        model, thinkingLevel: cfg.thinking, tools,
        systemPrompt: `你是信阳经开区能碳平台的「${spec.label}」板块专家。职责：${spec.purpose}。\n`
          + "只使用已提供的只读工具查询真实数据。数字不得编造；标注年份、单位、评价口径及模拟数据占比。没有查询可比年份时不得声称增长或下降。"
          + "能用标准工具时优先使用；写 SQL 前先检索语义目录，多表连接先规划。"
          + "查不到时先检索目录，再说明缺失。不要执行数据库写入，也不要假称已修改页面。"
          + "只回答交给你的板块问题，跨板块结论交给总管汇总。",
      },
      streamFn: models.streamSimple.bind(models), getApiKey, toolExecution: "sequential",
      beforeToolCall: async ({ toolCall, args }) => {
        calls++;
        if (calls > Math.min(cfg.maxToolCallsPerPrompt, 12)) {
          await logToolCall(sessionId, { name: `${board}.${toolCall.name}`, args, durationMs: 0, status: "denied", error: "板块工具调用达到上限" });
          return { block: true, reason: "本板块工具调用已达上限，请根据已有查询结果作答", terminate: true };
        }
        started.set(toolCall.id, performance.now());
        return undefined;
      },
      afterToolCall: async ({ toolCall, args, result, isError }) => {
        const durationMs = performance.now() - (started.get(toolCall.id) ?? performance.now());
        started.delete(toolCall.id);
        await logToolCall(sessionId, { name: `${board}.${toolCall.name}`, args, durationMs, status: isError ? "error" : "ok",
          error: isError ? result.content.map((part: any) => part.text ?? "").join(" ").slice(0, 2000) : undefined });
        return undefined;
      },
    });
    await expert.prompt(question);
    const last = expert.state.messages.at(-1) as any;
    if (last?.errorMessage) throw new Error(last.errorMessage);
    return textOf(last).trim() || `${spec.label}未获得可用结果`;
  }

  const delegates = (Object.keys(BOARDS) as Board[]).map((board) => ({
    name: `consult_${board}`,
    label: `咨询${BOARDS[board].label}`,
    description: `将问题交给「${BOARDS[board].label}」板块 Pi Agent。适用：${BOARDS[board].purpose}。它会自行选择并调用该板块只读工具，返回有依据的结论。`,
    parameters: Type.Object({ question: Type.String({ minLength: 2, description: "完整的板块问题，保留用户指定的年份、对象和口径" }) }),
    execute: async (_id: string, params: unknown) => {
      const { question } = params as { question: string };
      const answer = await consult(board, question);
      return { content: [{ type: "text" as const, text: answer }], details: { board, answer } };
    },
  }));

  const manager = new Agent({
    initialState: {
      model, thinkingLevel: cfg.thinking, tools: delegates,
      systemPrompt: "你是信阳经开区绿色园区能碳平台的总管 Agent，负责网页文字和小云语音的统一调度。"
        + "判断用户问题属于总览、能源、碳管理、综合诊断、企业名录或数据治理哪几个板块；"
        + "必须调用相应 consult_* 工具取证，跨板块问题可调用多个工具并综合回答。"
        + "不要把问题简单转述成未经核实的答案；不要编造工具结果。"
        + "用户要求改数据、导入、批准或重新计算时，说明当前总管只读，需走有权限的管理流程。"
        + "回答先给结论，再列必要数字及口径；数据为模拟值时明确提示。"
        + "没有查询可比年份时不得声称增长或下降，不能把单年数值当作趋势。"
        + "除简短无法查询的说明外，回答业务数据前须实际咨询板块 Agent。全部使用中文。",
    },
    streamFn: models.streamSimple.bind(models), getApiKey, toolExecution: "sequential",
    beforeToolCall: async ({ toolCall, args }) => {
      managerCalls++;
      if (managerCalls > 6) {
        await logToolCall(sessionId, { name: toolCall.name, args, durationMs: 0, status: "denied", error: "板块咨询达到上限" });
        return { block: true, reason: "板块咨询已达上限，请根据已有结果回答", terminate: true };
      }
      managerStarted.set(toolCall.id, performance.now());
      return undefined;
    },
    afterToolCall: async ({ toolCall, args, result, isError }) => {
      const durationMs = performance.now() - (managerStarted.get(toolCall.id) ?? performance.now());
      managerStarted.delete(toolCall.id);
      await logToolCall(sessionId, { name: toolCall.name, args, durationMs, status: isError ? "error" : "ok",
        error: isError ? result.content.map((part: any) => part.text ?? "").join(" ").slice(0, 2000) : undefined });
      return undefined;
    },
  });
  manager.subscribe((event) => { if (event.type === "agent_start") managerCalls = 0; });
  return { agent: manager, sessionId };
}

export function managerPrompt(question: string, context: ManagerContext = {}) {
  const page = /^\/(energy|carbon|diagnosis|enterprises|admin(?:\/[^?]*)?)?$/.test(context.page ?? "") ? context.page : undefined;
  const year = Number.isInteger(context.year) && context.year! >= 2000 && context.year! <= 2100 ? context.year : undefined;
  return `${question}\n\n[网页上下文：${page ?? "未指定页面"}，统计年份：${year ?? "未指定"}。上下文仅用于理解“本页/今年”等指代，用户明确指定优先。]`;
}

export async function askManager(cfg: AgentConfig, question: string, opts: ManagerOptions, context: ManagerContext = {}) {
  const { agent } = await createManagerAgent(cfg, opts);
  await agent.prompt(managerPrompt(question, context));
  const last = agent.state.messages.at(-1) as any;
  if (last?.errorMessage) throw new Error(last.errorMessage);
  const answer = textOf(last).trim();
  if (!answer) throw new Error("总管 Agent 没有返回答案");
  return answer;
}

export const MANAGER_BOARDS = BOARDS;
