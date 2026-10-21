import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
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
    tools: [...COMMON, "get_energy_summary", "get_carbon_summary", "get_indicators", "get_data_coverage", "get_weather_data"],
  },
  energy: {
    label: "能源管理",
    purpose: "综合能耗、能源品种、企业用能、强度、能效和能源因子",
    tools: [...COMMON, "get_energy_summary", "get_factors", "get_data_coverage", "get_weather_data"],
  },
  carbon: {
    label: "碳管理",
    purpose: "碳排放、排放来源、碳强度、碳因子、碳市场和产品碳足迹",
    tools: [...COMMON, "get_carbon_summary", "get_factors", "get_data_coverage"],
  },
  diagnosis: {
    label: "综合诊断",
    purpose: "绿色园区指标、未达标原因、预测、预警、目标和改进建议",
    tools: [...COMMON, "get_indicators", "explain_indicator", "get_energy_summary", "get_carbon_summary", "list_governance_issues", "get_data_coverage", "get_weather_data"],
  },
  enterprises: {
    label: "企业与项目名录",
    purpose: "企业识别、荣誉、企业排名及单个企业的能耗和排放",
    tools: [...COMMON, "get_energy_summary", "get_carbon_summary", "get_data_coverage"],
  },
  governance: {
    label: "数据治理",
    purpose: "数据覆盖、模拟值、来源、口径、语义目录和治理工单",
    tools: [...COMMON, "get_data_coverage", "get_weather_data", "list_governance_issues", "get_indicators", "explain_indicator"],
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

/** One Pi agent for each web/voice conversation; it selects and executes board tools itself. */
export async function createManagerAgent(cfg: AgentConfig, opts: ManagerOptions) {
  initPool(cfg.databaseUrl);
  const { models, model } = modelFor(cfg);
  const sessionId = await startSession(cfg.model, opts.userRef, opts.channel, "platform_manager");
  const getApiKey = async (provider: string) => provider === "deepseek" ? cfg.deepseekApiKey : undefined;
  let calls = 0;
  const started = new Map<string, number>();
  let managerRef: Agent | undefined;
  const toolCtx: ToolContext = {
    sessionId, sqlFailures: 0,
    getQuestion: () => {
      const last = [...(managerRef?.state.messages ?? [])].reverse().find((m: any) => m.role === "user") as any;
      return last ? textOf(last) : undefined;
    },
  };
  const tools = buildTools({ ...cfg, writeMode: "off" }, toolCtx);
  const boardGuide = Object.values(BOARDS)
    .map(({ label, purpose, tools }) => `${label}（${purpose}）：${tools.join("、")}`)
    .join("\n");

  const manager = new Agent({
    initialState: {
      model, thinkingLevel: cfg.thinking, tools,
      systemPrompt: "你是信阳经开区绿色园区能碳平台的总管 Agent，负责网页文字和小云语音的统一业务处理。"
        + "先判断用户任务属于哪些板块，再亲自选择并调用相应的数据库工具完成任务；不要转交其他 Agent。"
        + `板块及工具指引：\n${boardGuide}\n`
        + "跨板块问题由你直接调用多个板块相关工具并汇总。工具可能被多个板块共用，按问题所需选择。"
        + "业务数据回答前实际调用工具取证；能用标准工具时优先使用。写 SQL 前先检索语义目录，多表连接先规划。"
        + "不要把问题简单转述成未经核实的答案；不要编造工具结果。"
        + "用户要求改数据、导入、批准或重新计算时，说明当前总管只读，需走有权限的管理流程。"
        + "回答先给结论，再列必要数字、年份、单位及口径；数据为模拟值时明确提示。"
        + "引用出处时只说官方文件或公开来源的全称、发文机关和文号（如《工业和信息化部关于印发〈绿色工厂梯度培育及管理暂行办法〉的通知》工信部节〔2024〕13号 附件2），不提页码、本地文件名或路径（.pdf/.docx 等），也不说“用户上传”“本地资料”；数据库中的 source_page、source_file、文件路径等字段只供内部核查，不要复述。"
        + "没有查询可比年份时不得声称增长或下降，不能把单年数值当作趋势。"
        + "查不到时先检索目录，再说明缺失。不要假称已修改页面。全部使用中文。",
    },
    streamFn: models.streamSimple.bind(models), getApiKey, toolExecution: "sequential",
    beforeToolCall: async ({ toolCall, args }) => {
      calls++;
      if (calls > cfg.maxToolCallsPerPrompt) {
        await logToolCall(sessionId, { name: toolCall.name, args, durationMs: 0, status: "denied", error: "工具调用达到上限" });
        return { block: true, reason: "工具调用已达上限，请根据已有结果回答", terminate: true };
      }
      started.set(toolCall.id, performance.now());
      return undefined;
    },
    afterToolCall: async ({ toolCall, args, result, isError }) => {
      const durationMs = performance.now() - (started.get(toolCall.id) ?? performance.now());
      started.delete(toolCall.id);
      await logToolCall(sessionId, { name: toolCall.name, args, durationMs, status: isError ? "error" : "ok",
        error: isError ? result.content.map((part: any) => part.text ?? "").join(" ").slice(0, 2000) : undefined });
      return undefined;
    },
  });
  managerRef = manager;
  manager.subscribe((event) => { if (event.type === "agent_start") { calls = 0; toolCtx.sqlFailures = 0; } });
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
