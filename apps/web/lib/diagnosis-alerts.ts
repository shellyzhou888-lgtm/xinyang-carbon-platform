/** The four diagnosis dimensions (same as the closed-loop check rules). */
export const ALERT_GROUPS = [
  { key: "total", label: "总量", hint: "预算、同比变化", color: "#f3b34c" },
  { key: "intensity", label: "强度", hint: "单位产值能耗", color: "#ee8171" },
  { key: "structure", label: "结构", hint: "外购电依赖、绿电比例", color: "#70a9ef" },
  { key: "indicator", label: "指标与数据", hint: "评价指标提升空间与数据缺口", color: "#9c88f2" },
] as const;

export type AlertGroupKey = typeof ALERT_GROUPS[number]["key"];

export function alertGroup(ruleCode: string): AlertGroupKey {
  if (/BUDGET|DEVIATION|YOY|CHANGE/.test(ruleCode)) return "total";
  if (/INTENSITY|EFFICIENCY/.test(ruleCode)) return "intensity";
  if (/GRID|STRUCTURE|GREEN/.test(ruleCode)) return "structure";
  return "indicator";
}

export function alertSeverity(severity: string) {
  return severity === "critical" ? "紧急" : severity === "high" ? "高风险" : ["medium", "warning"].includes(severity) ? "需关注" : "提示";
}

export function alertDeviation(observed: number | null, baseline: number | null) {
  return observed != null && baseline != null && baseline > 0 ? (observed - baseline) / baseline * 100 : null;
}
