/** Whole views reached by the original platform's buttons; never individual chart panels. */
export type DisplaySlide = {
  key: string; label: string; path: "/" | "/energy" | "/carbon" | "/diagnosis" | "/enterprises";
  tab?: string; pager?: string; zone?: string;
};
export type DisplayModule = { key: string; label: string; english: string; color: string; slides: DisplaySlide[] };
export const DISPLAY_MODULES: DisplayModule[] = [
  { key: "park", label: "园区总览与名录", english: "PARK & ENTERPRISES", color: "var(--accent)", slides: [
    { key: "overview", label: "园区全景", path: "/", zone: "园区全景" },
    { key: "green-home", label: "绿色家居", path: "/", zone: "绿色家居" },
    { key: "electronics", label: "电子信息", path: "/", zone: "电子信息" },
    { key: "research", label: "科创研发", path: "/", zone: "科创研发" },
    { key: "community", label: "科创部落", path: "/", zone: "科创部落" },
    { key: "directory", label: "企业与项目名录", path: "/enterprises" },
  ] },
  { key: "energy", label: "能源管理", english: "ENERGY MANAGEMENT", color: "var(--energy)", slides: [
    { key: "heat", label: "数字孪生", path: "/energy", tab: "heat" },
    { key: "consumption", label: "用能分析", path: "/energy", tab: "consumption" },
    { key: "flow", label: "能流网络", path: "/energy", tab: "flow" },
    { key: "renewable", label: "绿能利用", path: "/energy", tab: "renewable" },
    { key: "intensity", label: "能效对标", path: "/energy", tab: "intensity" },
  ] },
  { key: "carbon", label: "碳排管理", english: "CARBON MANAGEMENT", color: "var(--carbon)", slides: [
    { key: "analysis", label: "排放分析", path: "/carbon", tab: "analysis" },
    { key: "product", label: "产品碳足迹", path: "/carbon", tab: "product" },
    { key: "flow", label: "碳流网络", path: "/carbon", tab: "flow" },
    { key: "targets", label: "减排管理", path: "/carbon", tab: "targets" },
    { key: "asset", label: "碳资产", path: "/carbon", tab: "asset" },
  ] },
  { key: "diagnosis", label: "能碳综合诊断", english: "DIAGNOSIS & STRATEGY", color: "var(--violet)", slides: [
    { key: "matrix", label: "问题诊断 · 检查矩阵", path: "/diagnosis", tab: "diagnose", pager: "检查矩阵" },
    { key: "findings", label: "问题诊断 · 问题清单", path: "/diagnosis", tab: "diagnose", pager: "问题清单" },
    { key: "locate", label: "定位溯源", path: "/diagnosis", tab: "locate" },
    { key: "evaluate", label: "对标评价", path: "/diagnosis", tab: "evaluate" },
    { key: "strategy", label: "策略生成", path: "/diagnosis", tab: "strategy", pager: "策略生成" },
    { key: "library", label: "策略库", path: "/diagnosis", tab: "strategy", pager: "策略库" },
    { key: "effect", label: "效果预测 · 策略效果", path: "/diagnosis", tab: "effect", pager: "策略效果" },
    { key: "forecast", label: "效果预测 · 月度预测", path: "/diagnosis", tab: "effect", pager: "月度预测" },
    { key: "roadmap", label: "效果预测 · 减碳路线", path: "/diagnosis", tab: "effect", pager: "减碳路线" },
  ] },
];
export const DISPLAY_CHANNEL = "xy-multi-view-display-v2";
export const DISPLAY_SLIDE_COUNT = DISPLAY_MODULES.reduce((count, module) => count + module.slides.length, 0);
export function displayFrameHref(module: DisplayModule, slide: DisplaySlide, year: number) {
  return `/display/view?${new URLSearchParams({ module: module.key, slide: slide.key, year: String(year) })}`;
}
export function originalViewHref(slide: DisplaySlide, year: number) {
  const params = new URLSearchParams({ year: String(year) });
  if (slide.tab) params.set("tab", slide.tab);
  return `${slide.path}?${params}`;
}
