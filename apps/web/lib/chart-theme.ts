/**
 * One palette and axis style for every ECharts / map view. Colours are read from the CSS tokens in globals.css
 * when an option is built, so charts follow the dark / light theme (the page remounts on a theme switch).
 * On the server (no document) the dark-theme values are used.
 */
const css = (name: string, fallback: string) => {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
};
const ink = (alpha: number) => `rgb(${css("--ink", "255 255 255")} / ${alpha})`;

export const isLightTheme = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "light";

export const C = {
  get text() { return css("--text", "#f4f6f2"); },
  get muted() { return css("--text-3", "#7f8781"); },
  get faint() { return ink(0.07); },
  get energy() { return css("--energy", "#2ee8a5"); },
  get carbon() { return css("--carbon", "#ffab3d"); },
  get accent() { return css("--accent", "#d4f75c"); },
  get info() { return css("--info", "#4cb4ff"); },
  get violet() { return css("--violet", "#9b87ff"); },
  get danger() { return css("--danger", "#ff6b81"); },
  get band() { return hexA(this.energy, 0.16); },
  get bandCo2() { return hexA(this.carbon, 0.16); },
  get surface() { return css("--surface-solid", "#1b1c21"); },
};

/** Categorical series: saturated mid-tones that read on both charcoal and white. */
export const SERIES = ["#2ee8a5", "#9b87ff", "#ffab3d", "#4cb4ff", "#d4f75c", "#ff6b9a", "#22d3ee", "#f59e7b"];

export const axis = {
  axisLine: { show: false },
  axisTick: { show: false },
  get axisLabel() { return { color: C.muted, fontSize: 12 }; },
  get splitLine() { return { lineStyle: { color: C.faint } }; },
};

export const tooltip = (trigger: "axis" | "item" = "axis") => ({
  trigger,
  backgroundColor: hexA(C.surface, 0.95),
  borderWidth: 0,
  padding: [10, 12],
  textStyle: { color: C.text, fontSize: 14 },
  extraCssText: "border-radius:14px;box-shadow:0 18px 40px -12px rgba(0,0,0,.45);backdrop-filter:blur(12px);",
  axisPointer: { type: "line" as const, lineStyle: { color: hexA(C.accent, 0.5), type: "dashed" as const } },
});

export const legend = (extra: Record<string, unknown> = {}) => ({ icon: "roundRect", itemWidth: 10, itemHeight: 4, itemGap: 16, textStyle: { color: C.muted, fontSize: 12 }, ...extra });

/** Vertical fade from the series colour to transparent for line-area fills. */
export const fade = (hex: string, top = 0.32) => ({
  type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1,
  colorStops: [{ offset: 0, color: hexA(hex, top) }, { offset: 1, color: hexA(hex, 0) }],
});

export const barFade = (hex: string, horizontal = false) => ({
  type: "linear" as const, x: 0, y: horizontal ? 0 : 1, x2: horizontal ? 1 : 0, y2: 0,
  colorStops: [{ offset: 0, color: hexA(hex, 0.45) }, { offset: 1, color: hex }],
});

export function hexA(hex: string, alpha: number) {
  const value = hex.trim();
  if (!value.startsWith("#")) return value;
  const full = value.length === 4 ? "#" + [...value.slice(1)].map((c) => c + c).join("") : value;
  const n = parseInt(full.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Resolves "var(--token)" colours (allowed in props from server components) to a concrete colour for canvas charts. */
export function resolveColor(color: string) {
  const match = color.match(/^var\((--[\w-]+)\)$/);
  return match ? css(match[1], "#7f8781") : color;
}
