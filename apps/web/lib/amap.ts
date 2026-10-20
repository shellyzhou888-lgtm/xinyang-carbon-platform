"use client";

// AMap 2.0 and L7 expose imperative browser objects; keep that boundary in one module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AmapApi = any;
let loading: Promise<AmapApi> | null = null;

export function loadAmap(): Promise<AmapApi> {
  const browser = window as unknown as { AMap?: AmapApi; _AMapSecurityConfig?: { serviceHost: string } };
  if (browser.AMap) return Promise.resolve(browser.AMap);
  if (loading) return loading;
  loading = (async () => {
    const response = await fetch("/api/map/config");
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || "地图配置读取失败");
    browser._AMapSecurityConfig = { serviceHost: config.serviceHost };
    return new Promise<AmapApi>((resolve, reject) => {
      const script = document.createElement("script");
      const timer = window.setTimeout(() => fail("地图加载超时，请检查网络后重试"), 20_000);
      const fail = (message: string) => {
        clearTimeout(timer);
        script.remove();
        reject(new Error(message));
      };
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.key)}&plugin=AMap.Scale,AMap.ToolBar`;
      script.async = true;
      script.onload = () => {
        clearTimeout(timer);
        if (browser.AMap) resolve(browser.AMap);
        else fail("高德地图脚本未就绪");
      };
      script.onerror = () => fail("高德地图加载失败，请检查网络后重试");
      document.head.appendChild(script);
    });
  })().catch((error) => { loading = null; throw error; });
  return loading;
}
