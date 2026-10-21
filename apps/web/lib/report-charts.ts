import "server-only";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";

/** Static vector images for the print report, using the same ECharts dependency as the dashboard. */
function image(option: EChartsOption, width = 680, height = 250) {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width, height });
  try {
    chart.setOption({ animation: false, backgroundColor: "#ffffff", textStyle: { fontFamily: "Microsoft YaHei, Noto Sans CJK SC, sans-serif", color: "#37544a" }, ...option });
    return `data:image/svg+xml;base64,${Buffer.from(chart.renderToSVGString()).toString("base64")}`;
  } finally { chart.dispose(); }
}

export function reportCharts(input: {
  annual: { year: number; tce: number | null; co2_t: number | null }[];
  alertCounts: { category: string; count: number }[];
  plans: { strategy: string; co2_reduction_t: number | null }[];
}) {
  const years = input.annual.map((row) => String(row.year));
  const trend = image({
    grid: { left: 70, right: 70, top: 35, bottom: 35 }, legend: { top: 2, data: ["综合能耗 (tce)", "碳排放 (tCO₂)"] },
    xAxis: { type: "category", data: years, axisLine: { lineStyle: { color: "#a8bdb0" } } },
    yAxis: [{ type: "value", name: "tce", splitLine: { lineStyle: { color: "#e9f0eb" } } }, { type: "value", name: "tCO₂", splitLine: { show: false } }],
    series: [
      { name: "综合能耗 (tce)", type: "line", smooth: true, symbolSize: 8, itemStyle: { color: "#1aa575" }, data: input.annual.map((row) => row.tce) },
      { name: "碳排放 (tCO₂)", type: "line", smooth: true, symbolSize: 8, yAxisIndex: 1, itemStyle: { color: "#eaa348" }, data: input.annual.map((row) => row.co2_t) },
    ],
  });
  const alerts = image({
    grid: { left: 80, right: 38, top: 20, bottom: 35 },
    xAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: "#e9f0eb" } } },
    yAxis: { type: "category", data: input.alertCounts.map((row) => row.category), axisLine: { show: false }, axisTick: { show: false } },
    series: [{ type: "bar", data: input.alertCounts.map((row, index) => ({ value: row.count, itemStyle: { color: ["#eaa348", "#ec8171", "#9885e0", "#6b9ee5"][index] } })), barWidth: 22, label: { show: true, position: "right" } }],
  }, 680, 215);
  const top = input.plans.filter((row) => row.co2_reduction_t != null && row.co2_reduction_t > 0).slice(0, 5);
  const strategies = top.length ? image({
    grid: { left: 70, right: 65, top: 18, bottom: 40 },
    xAxis: { type: "value", name: "tCO₂", splitLine: { lineStyle: { color: "#e9f0eb" } } },
    yAxis: { type: "category", data: top.map((row) => row.strategy.length > 11 ? `${row.strategy.slice(0, 10)}…` : row.strategy), axisLine: { show: false }, axisTick: { show: false } },
    series: [{ type: "bar", data: top.map((row) => row.co2_reduction_t), itemStyle: { color: "#24a47b" }, barWidth: 20, label: { show: true, position: "right", formatter: "{c}" } }],
  }, 680, 225) : null;
  return { trend, alerts, strategies };
}
