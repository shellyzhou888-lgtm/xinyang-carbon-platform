"use client";

import { useEffect, useRef, useState } from "react";
import type { ECharts, EChartsOption } from "echarts";
import type { ChartData } from "@xinyang/db-agent";
import { enterprises } from "@/lib/park-geography";

export default function EnterpriseEnergy3D({ ranking, year, selected, onSelect }: {
  ranking: ChartData["ranking"]; year: number; selected: string; onSelect: (code: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const [error, setError] = useState("");
  const select = useRef(onSelect);
  select.current = onSelect;
  const rows = ranking.filter((row) => Number.isFinite(row.tce));

  useEffect(() => {
    if (!container.current || !rows.length) return;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    setError("");
    (async () => {
      const probe = document.createElement("canvas");
      const context = probe.getContext("webgl2") || probe.getContext("webgl");
      if (!context) throw new Error("当前浏览器不支持 WebGL，可在企业列表查看能耗数值。");
      context.getExtension("WEBGL_lose_context")?.loseContext();
      const echarts = await import("echarts");
      await import("echarts-gl");
      if (disposed || !container.current) return;
      const instance = echarts.init(container.current);
      chart.current = instance;
      const names = rows.map((row) => enterprises.find((feature) => feature.properties.code === row.code)?.properties.name || row.name);
      instance.setOption({
        backgroundColor: "transparent",
        tooltip: { renderMode: "richText", formatter: (value: unknown) => {
          const item = value as { data: { value: number[] }; name: string };
          return `${item.name}\n综合能耗：${item.data.value[2].toLocaleString("zh-CN")} tce\n${year} 年 · 当前数据库口径`;
        } },
        xAxis3D: { type: "category", data: names, axisLabel: { color: "#8fa29b", interval: 0, fontSize: 10 }, name: "企业", nameTextStyle: { color: "#8fa29b" } },
        yAxis3D: { type: "category", data: ["综合能耗"], name: "", axisLabel: { show: false } },
        zAxis3D: { type: "value", name: "tce", axisLabel: { color: "#8fa29b", fontSize: 10 }, nameTextStyle: { color: "#8fa29b" } },
        grid3D: {
          boxWidth: 160, boxDepth: 26, boxHeight: 65,
          axisLine: { lineStyle: { color: "rgba(255,255,255,0.12)" } }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } },
          viewControl: { distance: 190, alpha: 22, beta: 12, autoRotate: false },
          light: { main: { intensity: 1.1, shadow: false }, ambient: { intensity: 0.7 } },
          environment: "transparent",
        },
        series: [{ type: "bar3D", shading: "lambert", bevelSize: 0.05, barSize: 8,
          data: rows.map((row, index) => ({ name: names[index], code: row.code, value: [index, 0, row.tce],
            itemStyle: { color: row.code === selected ? "#c5f05c" : enterprises.find((feature) => feature.properties.code === row.code)?.properties.color || "#3ee0a1" } })),
          emphasis: { label: { show: true, formatter: "{b}", color: "#ffffff", fontSize: 12 } },
        }],
      } as unknown as EChartsOption);
      instance.on("click", (event) => {
        const data = event.data as { code?: string };
        if (data?.code) select.current(data.code);
      });
      observer = new ResizeObserver(() => instance.resize());
      observer.observe(container.current);
    })().catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : "3D图表暂不可用"); });
    return () => { disposed = true; observer?.disconnect(); chart.current?.dispose(); chart.current = null; };
    // Selected state only changes bar colors, without resetting the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranking, year]);

  useEffect(() => {
    chart.current?.setOption({ series: [{ data: rows.map((row, index) => ({
      name: enterprises.find((feature) => feature.properties.code === row.code)?.properties.name || row.name,
      code: row.code, value: [index, 0, row.tce], itemStyle: { color: row.code === selected ? "#c5f05c" : enterprises.find((feature) => feature.properties.code === row.code)?.properties.color || "#3ee0a1" },
    })) }] });
  }, [selected, ranking]);

  if (!rows.length) return <div className="empty">暂无企业能耗数据，地图点位仍可查看。连接数据库后可显示企业 3D 能耗对比。</div>;
  return <div className="energy-3d-wrap">
    <div ref={container} className="energy-3d" role="img" aria-label={`${year}年企业综合能耗3D柱状图`} />
    {error ? <div className="notice danger" role="status">{error}</div> : <div className="chart-help">拖动旋转 · 滚轮缩放 · 点击柱体查看企业</div>}
  </div>;
}
