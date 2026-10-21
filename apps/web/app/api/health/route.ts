import { health } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → { db: {ok, ms, error}, agent: {ok, error}, checkedAt }. Voice status is probed by the browser itself. */
export async function GET() {
  try {
    return Response.json({ ...(await health()), checkedAt: new Date().toISOString() });
  } catch (err) {
    return Response.json({ db: { ok: false, ms: 0, error: err instanceof Error ? err.message : String(err) }, agent: { ok: false, error: "" }, checkedAt: new Date().toISOString() });
  }
}
