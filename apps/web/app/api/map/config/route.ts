export const runtime = "nodejs";

/** The public JS key may reach the browser; the security code must remain here. */
export async function GET(request: Request) {
  const key = process.env.AMAP_JS_KEY;
  if (!key || !process.env.AMAP_SECURITY_JS_CODE) {
    return Response.json({ error: "请配置 AMAP_JS_KEY 与 AMAP_SECURITY_JS_CODE" }, { status: 503 });
  }
  return Response.json({ key, version: "2.0", serviceHost: `${new URL(request.url).origin}/_AMapService`, coordinateSystem: "GCJ-02" },
    { headers: { "Cache-Control": "no-store" } });
}
