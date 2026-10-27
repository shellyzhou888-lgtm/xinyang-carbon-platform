import { carbonMarket } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await carbonMarket(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "行情暂不可用，请稍后刷新" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
