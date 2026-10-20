import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { endSession, logMessage } from "./audit.js";
import { createDbAgent } from "./agent.js";
import { loadConfig } from "./config.js";
import { closePool } from "./db.js";
import { governanceIdle } from "./governance.js";

/**
 * Terminal chat.
 *   npm run chat                      interactive
 *   npm run chat -- "2025年园区碳排放多少？"   one question, then exit
 * Commands in interactive mode: /model flash|pro, /reset, /exit
 */
const cfg = loadConfig();
const rl = createInterface({ input: stdin, output: stdout });

const { agent, models, sessionId } = await createDbAgent(cfg, {
  confirmWrite: async (name, args) => {
    const answer = await rl.question(`\n⚠️  将执行写操作 ${name}：${JSON.stringify(args)}\n   确认执行？(y/N) `);
    return answer.trim().toLowerCase() === "y";
  },
});

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    stdout.write(event.assistantMessageEvent.delta);
  } else if (event.type === "tool_execution_start") {
    stdout.write(dim(`\n  → ${event.toolName} ${JSON.stringify(event.args)}\n`));
  } else if (event.type === "tool_execution_end") {
    stdout.write(dim(`  ${event.isError ? "✗ 失败" : "✓ 完成"} ${event.toolName}\n`));
  }
});

function lastAssistantText(): string {
  const msgs = agent.state.messages;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m: any = msgs[i];
    if (m.role === "assistant") {
      if (m.errorMessage) return `【错误】${m.errorMessage}`;
      return (m.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    }
  }
  return "";
}

async function ask(question: string) {
  await logMessage(sessionId, "user", question);
  await agent.prompt(question);
  const text = lastAssistantText();
  if (text.startsWith("【错误】")) stdout.write(`\n${text}`);
  await logMessage(sessionId, "assistant", text);
  stdout.write("\n");
}

const oneShot = process.argv.slice(2).join(" ").trim();
try {
  console.log(dim(`数据库 Agent｜模型 deepseek/${cfg.model}｜写模式 ${cfg.writeMode}｜会话 ${sessionId}`));
  if (oneShot) {
    await ask(oneShot);
  } else {
    console.log(dim("输入问题开始对话；/model flash|pro 切换模型，/reset 清空上下文，/exit 退出"));
    for (;;) {
      const q = (await rl.question("\n你：")).trim();
      if (!q) continue;
      if (q === "/exit") break;
      if (q === "/reset") { agent.reset(); console.log(dim("已清空对话上下文")); continue; }
      if (q.startsWith("/model")) {
        const id = q.includes("pro") ? "deepseek-v4-pro" : "deepseek-flash";
        const m = models.getModel("deepseek", id);
        if (m) { agent.state.model = m; console.log(dim(`已切换到 ${id}`)); }
        continue;
      }
      stdout.write("\nAgent：");
      await ask(q);
    }
  }
} finally {
  rl.close();
  await endSession(sessionId).catch(() => undefined);
  await governanceIdle();   // let a background governance run started by a write tool finish
  await closePool();
}
