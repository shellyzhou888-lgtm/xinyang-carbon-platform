export const ALERT_GROUPS = [
  { key: "target", label: "预算与目标", hint: "预算超限、年度指标偏离", color: "#f3b34c" },
  { key: "deviation", label: "同比异常", hint: "能耗与碳排变化超过阈值", color: "#ee8171" },
  { key: "efficiency", label: "企业能效", hint: "重点企业单位产值能耗或排放", color: "#9c88f2" },
  { key: "quality", label: "数据与其他", hint: "缺报、口径及其他规则", color: "#70a9ef" },
] as const;

export type AlertGroupKey = typeof ALERT_GROUPS[number]["key"];

export function alertGroup(ruleCode: string): AlertGroupKey {
  if (/BUDGET|INDICATOR|TARGET/.test(ruleCode)) return "target";
  if (/DEVIATION|YOY|CHANGE/.test(ruleCode)) return "deviation";
  if (/INTENSITY|EFFICIENCY/.test(ruleCode)) return "efficiency";
  return "quality";
}

export function alertSeverity(severity: string) {
  return severity === "critical" ? "紧急" : severity === "high" ? "高风险" : ["medium", "warning"].includes(severity) ? "需关注" : "提示";
}

export function alertDeviation(observed: number | null, baseline: number | null) {
  return observed != null && baseline != null && baseline > 0 ? (observed - baseline) / baseline * 100 : null;
}
