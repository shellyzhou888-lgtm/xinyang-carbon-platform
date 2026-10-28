import { LOOP_STEPS } from "./diagnosis-loop";

/** Explicit allowlist: administrative and write interfaces never enter the tour. */
export const PRESENTATION_MODULES = [
  { key: "overview", label: "园区总览", path: "/", views: [{ key: "overview", label: "园区空间与运行概况" }] },
  { key: "energy", label: "能源管理", path: "/energy", views: [
    { key: "heat", label: "数字孪生" }, { key: "consumption", label: "用能分析" },
    { key: "flow", label: "能流网络" }, { key: "renewable", label: "绿能利用" }, { key: "intensity", label: "能效对标" },
  ] },
  { key: "carbon", label: "碳排管理", path: "/carbon", views: [
    { key: "analysis", label: "排放分析" }, { key: "product", label: "产品碳足迹" },
    { key: "flow", label: "碳流网络" }, { key: "targets", label: "减排管理" }, { key: "asset", label: "碳资产" },
  ] },
  { key: "diagnosis", label: "综合诊断", path: "/diagnosis", views: LOOP_STEPS.map(({ key, label }) => ({ key, label })) },
  { key: "enterprises", label: "企业名录", path: "/enterprises", views: [{ key: "directory", label: "企业与项目名录" }] },
] as const;

export const PRESENTATION_VIEWS = PRESENTATION_MODULES.flatMap(module => module.views.map(view => ({
  id: `${module.key}:${view.key}`, module: module.key, moduleLabel: module.label,
  path: module.path, tab: view.key, label: view.label,
})));

export type PresentationBlock = { id: string; title: string };
export const PRESENTATION_CHANNEL = "xy-presentation-v1";
export function presentationHref(index: number, year: number, embed = false) {
  const view = PRESENTATION_VIEWS[index];
  const params = new URLSearchParams({ year: String(year) });
  if (view.path !== "/" && view.path !== "/enterprises") params.set("tab", view.tab);
  if (embed) params.set("present", "1");
  return `${view.path}?${params}`;
}
export function isPresentationPath(path: string) { return PRESENTATION_MODULES.some(module => module.path === path); }
