/** One palette and axis style for every ECharts view, matching the CSS tokens in globals.css. */
export const C = {
  text: "#eef4f1",
  muted: "#8fa29b",
  faint: "rgba(255,255,255,0.06)",
  energy: "#3ee0a1",
  carbon: "#f6b54a",
  accent: "#c5f05c",
  info: "#5aa9ff",
  danger: "#ff6b6b",
  band: "rgba(62,224,161,0.14)",
  bandCo2: "rgba(246,181,74,0.14)",
};

export const SERIES = ["#3ee0a1", "#5aa9ff", "#f6b54a", "#c5f05c", "#b892ff", "#ff8f7a", "#7ad7e0", "#e2e8e5"];

export const axis = {
  axisLine: { show: false },
  axisTick: { show: false },
  axisLabel: { color: C.muted, fontSize: 11 },
  splitLine: { lineStyle: { color: C.faint } },
};

export const tooltip = (trigger: "axis" | "item" = "axis") => ({
  trigger,
  backgroundColor: "rgba(14,20,18,0.92)",
  borderWidth: 0,
  padding: [10, 12],
  textStyle: { color: C.text, fontSize: 12 },
  extraCssText: "border-radius:12px;box-shadow:0 18px 40px -12px rgba(0,0,0,.6);backdrop-filter:blur(12px);",
  axisPointer: { type: "line" as const, lineStyle: { color: "rgba(197,240,92,0.35)", type: "dashed" as const } },
});

export const legend = (extra: Record<string, unknown> = {}) => ({ icon: "roundRect", itemWidth: 10, itemHeight: 4, itemGap: 16, textStyle: { color: C.muted, fontSize: 11 }, ...extra });

/** Vertical fade from the series colour to transparent for line-area fills. */
export const fade = (hex: string, top = 0.32) => ({
  type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1,
  colorStops: [{ offset: 0, color: hexA(hex, top) }, { offset: 1, color: hexA(hex, 0) }],
});

export const barFade = (hex: string, horizontal = false) => ({
  type: "linear" as const, x: 0, y: horizontal ? 0 : 1, x2: horizontal ? 1 : 0, y2: 0,
  colorStops: [{ offset: 0, color: hexA(hex, 0.35) }, { offset: 1, color: hex }],
});

export function hexA(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
