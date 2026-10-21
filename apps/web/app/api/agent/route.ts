import { randomUUID } from "node:crypto";
import { conversation, logMessage } from "@/lib/server";
import { managerPrompt } from "@xinyang/db-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { conversationId?, message } → Server-Sent Events:
 *   {type:"start", conversationId} | {type:"text", delta} | {type:"tool_start", name, args}
 *   {type:"tool_end", name, isError} | {type:"done"} | {type:"error", message}
 * Pi's event stream (message_update / tool_execution_*) is forwarded as it happens.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as { conversationId?: string; message?: string; context?: { page?: string; year?: number } };
  const message = (body.message ?? "").trim();
  if (!message) return Response.json({ error: "message is required" }, { status: 400 });
  const conversationId = body.conversationId || randomUUID();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      let unsubscribe: (() => void) | undefined;
      try {
        const { agent, sessionId } = await conversation(conversationId);
        send({ type: "start", conversationId });
        let answer = "";
        unsubscribe = agent.subscribe((event) => {
          if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            answer += event.assistantMessageEvent.delta;
            send({ type: "text", delta: event.assistantMessageEvent.delta });
          } else if (event.type === "tool_execution_start") {
            send({ type: "tool_start", name: event.toolName, args: event.args });
          } else if (event.type === "tool_execution_end") {
            send({ type: "tool_end", name: event.toolName, isError: event.isError });
          }
        });
        await logMessage(sessionId, "user", message);
        await agent.prompt(managerPrompt(message, body.context));
        const last: any = agent.state.messages.at(-1);
        if (last?.role === "assistant" && last.errorMessage) send({ type: "error", message: last.errorMessage });
        await logMessage(sessionId, "assistant", answer);
        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        unsubscribe?.();
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" } });
}
