export const runtime = "nodejs";

/** Same-origin security-code proxy, restricted to map styling and SDK initialization. */
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const key = process.env.AMAP_JS_KEY;
  const securityCode = process.env.AMAP_SECURITY_JS_CODE;
  if (!key || !securityCode) return Response.json({ error: "高德地图尚未配置" }, { status: 503 });
  const path = (await context.params).path.join("/");
  if (!/^v4\/map\/styles(?:\/[\w.-]+)?$/.test(path) && path !== "v3/log/init") {
    return Response.json({ error: "不支持的地图服务路径" }, { status: 404 });
  }
  const incoming = new URL(request.url);
  const callback = incoming.searchParams.get("callback");
  if (callback !== null && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(callback)) {
    return Response.json({ error: "无效的地图回调名称" }, { status: 400 });
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      if (new URL(referer).origin !== incoming.origin) return Response.json({ error: "不允许跨站访问地图代理" }, { status: 403 });
    } catch {
      return Response.json({ error: "无效的请求来源" }, { status: 400 });
    }
  }
  const target = new URL(`${path.startsWith("v4/map/styles") ? "https://webapi.amap.com" : "https://restapi.amap.com"}/${path}`);
  incoming.searchParams.forEach((value, name) => {
    if (name !== "key" && name !== "jscode") target.searchParams.append(name, value);
  });
  target.searchParams.set("key", key);
  target.searchParams.set("jscode", securityCode);
  try {
    const upstream = await fetch(target, { signal: AbortSignal.timeout(15_000) });
    return new Response(upstream.body, { status: upstream.status, headers: {
      "Content-Type": incoming.searchParams.has("callback") ? "application/javascript; charset=utf-8" : upstream.headers.get("content-type") || "application/json",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return Response.json({ error: "高德样式服务暂不可用，请稍后重试" }, { status: 502 });
  }
}
