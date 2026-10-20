"use client";

import { useRef, useState } from "react";
import Markdown from "./Markdown";

type Msg = { role: "user" | "assistant"; text: string; tools: string[]; error?: string };

const EXAMPLES = ["2025 年园区综合能耗和碳排放是多少？", "GIP_2026 有哪些指标已经达标？", "单位工业增加值能耗为什么没达标？", "哪些数据还是模拟的？"];

/** Text chat with the database agent. Reads the SSE stream from /api/agent and renders it incrementally. */
export default function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string>("");
  const logRef = useRef<HTMLDivElement>(null);

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
        body: JSON.stringify({ conversationId: conversationId.current, message }),
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
          else if (ev.type === "error") update((m) => ({ ...m, error: ev.message }));
        }
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
      }
    } catch (err) {
      update((m) => ({ ...m, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="chat-head">
        <b>数据库 Agent</b>
        <button onClick={() => { setMessages([]); conversationId.current = ""; }} disabled={busy}>新对话</button>
      </div>
      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && (
          <div className="hint">
            可以直接问园区能耗、碳排放、指标达标情况，Agent 会查询数据库后回答。也可以点击左下角的小云用语音提问。
            {EXAMPLES.map((q) => <button key={q} onClick={() => send(q)}>{q}</button>)}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.tools.length > 0 && <div className="tools">{m.tools.map((t, j) => <span key={j}>🔧 {t}</span>)}</div>}
            {m.role === "assistant" ? (m.text ? <Markdown text={m.text} /> : busy && i === messages.length - 1 ? "思考中…" : "") : m.text}
            {m.error && <div className="error">出错：{m.error}</div>}
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
        <button type="submit" disabled={busy || !input.trim()}>发送</button>
      </form>
    </>
  );
}
