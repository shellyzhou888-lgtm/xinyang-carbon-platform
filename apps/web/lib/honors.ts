/** Groups the park's honour records into the categories shown on the overview screen and on map badges. */
export type HonorKind = "green_park" | "green_factory" | "zero_carbon" | "smart_factory" | "little_giant" | "high_tech" | "cluster";

export const HONOR_KINDS: { kind: HonorKind; label: string; short: string; color: string }[] = [
  { kind: "green_park", label: "绿色工业园区", short: "绿色园区", color: "#c5f05c" },
  { kind: "green_factory", label: "绿色工厂", short: "绿色工厂", color: "#3ee0a1" },
  { kind: "zero_carbon", label: "零碳工厂", short: "零碳工厂", color: "#5ce1e6" },
  { kind: "smart_factory", label: "5G 工厂", short: "5G工厂", color: "#5aa9ff" },
  { kind: "little_giant", label: "专精特新“小巨人”", short: "小巨人", color: "#f6b54a" },
  { kind: "high_tech", label: "高新技术企业", short: "高新技术", color: "#b79cff" },
  { kind: "cluster", label: "特色产业集群", short: "产业集群", color: "#e4a9db" },
];

export function honorKind(title: string): HonorKind | null {
  if (/绿色工业园区/.test(title)) return "green_park";
  if (/绿色工厂/.test(title)) return "green_factory";
  if (/零碳/.test(title)) return "zero_carbon";
  if (/5G\s*工厂|智能工厂/.test(title)) return "smart_factory";
  if (/小巨人|专精特新/.test(title)) return "little_giant";
  if (/高新技术企业/.test(title)) return "high_tech";
  if (/产业集群/.test(title)) return "cluster";
  return null;
}

export const honorLevel = (title: string) => /国家级|工业和信息化部/.test(title) ? "国家级" : /省级|河南省/.test(title) ? "省级" : "";

/** Window event used by overview panels to fly the map to an enterprise. */
export const FOCUS_EVENT = "park:focus-enterprise";
export function focusEnterprise(code: string) {
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: code }));
}
