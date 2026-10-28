export const runtime = "nodejs";

/** The public JS key may reach the browser; the security code must remain here. */
export async function GET(request: Request) {
  const key = process.env.AMAP_JS_KEY;
  if (!key || !process.env.AMAP_SECURITY_JS_CODE) {
    return Response.json({ error: "请配置 AMAP_JS_KEY 与 AMAP_SECURITY_JS_CODE" }, { status: 503 });
  }
  // Preserve the browser's origin behind the production HTTPS proxy; the server
  // itself listens on HTTP 0.0.0.0, which must not become the SDK service address.
  const host = request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto === "https" || forwardedProto === "http"
    ? forwardedProto : new URL(request.url).protocol.replace(":", "");
  const origin = host ? `${protocol}://${host}` : new URL(request.url).origin;
  return Response.json({ key, version: "2.0", serviceHost: `${origin}/_AMapService`, coordinateSystem: "GCJ-02" },
    { headers: { "Cache-Control": "no-store" } });
}
