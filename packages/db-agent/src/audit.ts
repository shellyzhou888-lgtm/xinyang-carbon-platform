import { logQuery } from "./db.js";

/**
 * Every conversation and tool call is written to agent.session / agent.message / agent.tool_call,
 * so any number the agent reported, and any change it made, can be traced afterwards.
 */
export async function startSession(model: string, userRef: string, channel: "system" | "web" | "voice" = "system",
                                   agentName = "db_agent"): Promise<string> {
  const r = await logQuery(
    `insert into agent.session (user_ref, channel, agent_name, model) values ($1, $2, $3, $4) returning session_id`,
    [userRef, channel, agentName, model],
  );
  return r.rows[0].session_id;
}

export async function logMessage(sessionId: string, role: "user" | "assistant", content: string) {
  if (!content.trim()) return;
  await logQuery(`insert into agent.message (session_id, role, content) values ($1, $2, $3)`, [sessionId, role, content]);
}

export async function logToolCall(sessionId: string, call: {
  name: string; args: unknown; dbRole?: string; rowCount?: number; durationMs: number; status: "ok" | "error" | "denied"; error?: string;
}) {
  await logQuery(
    `insert into agent.tool_call (session_id, tool_name, arguments, db_role, row_count, duration_ms, status, error)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [sessionId, call.name, JSON.stringify(call.args ?? {}), call.dbRole ?? null, call.rowCount ?? null,
     Math.round(call.durationMs), call.status, call.error ?? null],
  );
}

export async function endSession(sessionId: string) {
  await logQuery(`update agent.session set ended_at = now() where session_id = $1`, [sessionId]);
}
