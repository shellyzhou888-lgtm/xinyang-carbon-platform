"use client";

import { useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Markdown from "./Markdown";
import { useHealth } from "./HealthContext";

type Msg = { role: "user" | "assistant"; text: string; tools: string[]; error?: string };

/** Turns configuration errors into an instruction instead of a raw stack message. */
const friendly = (message: string) =>
  /DEEPSEEK_API_KEY/.test(message) ? "AI 助手尚未配置模型密钥：请在项目根目录 .env 中添加 DEEPSEEK_API_KEY 后重启网站。"
  : /HTTP 401/.test(message) ? "登录已过期，请刷新页面重新登录。"
  : /ECONNREFUSED|database|数据库/.test(message) ? `数据库暂不可用：${message}` : message;

const EXAMPLES = ["2025 年园区综合能耗和碳排放是多少？", "能源与碳排两板块相比，主要问题是什么？", "单位工业增加值能耗为什么没达标？", "2025 年碳排放主要来自哪些企业？"];

/** Text chat with the database agent. Reads the SSE stream from /api/agent and renders it incrementally. */
export default function ChatPanel() {
  const page = usePathname();
  const params = useSearchParams();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string>("");
  const logRef = useRef<HTMLDivElement>(null);
  const { health } = useHealth();
  const unavailable = !health.loading && health.checkedAt && !health.agent.ok;

  const update = (fn: (m: Msg) => Msg) =>
    setMessages((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setMessages((all) => [...all, { role: "user", text: message, tools: [] }, { role: "assistant", text: "", tools: [] }]);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversationId.current, message, context: { page, year: Number(params.get("year") || 2025) } }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const ev = JSON.parse(part.slice(6));
          if (ev.type === "start") conversationId.current = ev.conversationId;
          else if (ev.type === "text") update((m) => ({ ...m, text: m.text + ev.delta }));
          else if (ev.type === "tool_start") update((m) => ({ ...m, tools: [...m.tools, ev.name] }));
          else if (ev.type === "error") update((m) => ({ ...m, error: friendly(ev.message) }));
        }
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
      }
    } catch (err) {
      update((m) => ({ ...m, error: friendly(err instanceof Error ? err.message : String(err)) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && (unavailable ? (
          <div className="chat-setup">
            <b>AI 助手暂不可用</b>
            <p>网站未读取到 DeepSeek 模型密钥。请在项目根目录的 <code>.env</code> 中加入一行 <code>DEEPSEEK_API_KEY=sk-…</code>，然后重启网站。</p>
            <p className="muted">页面上的能耗、碳排放等数据直接读取数据库，不受影响。</p>
          </div>
        ) : (
          <div className="chat-empty">
            <p>可以问总览、能源、碳排、诊断、企业名录和数据治理。总管会交给相应板块查询，也能合并多个板块的结果。</p>
            <div className="chat-examples">{EXAMPLES.map((q) => <button type="button" key={q} onClick={() => send(q)}>{q}</button>)}</div>
          </div>
        ))}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.tools.length > 0 && <div className="tools">{m.tools.map((t, j) => <span key={j}>{t}</span>)}</div>}
            {m.role === "assistant" ? (m.text ? <Markdown text={m.text} /> : busy && i === messages.length - 1 ? <span className="typing"><i /><i /><i /></span> : "") : m.text}
            {m.error && <div className="msg-error">{m.error}</div>}
          </div>
        ))}
      </div>
      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <textarea
          value={input}
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
        />
        <div className="chat-actions">
          <button type="button" className="btn-ghost small" onClick={() => { setMessages([]); conversationId.current = ""; }} disabled={busy || !messages.length}>新对话</button>
          <button type="submit" className="btn-primary small" disabled={busy || !input.trim()}>发送</button>
        </div>
      </form>
    </>
  );
}
