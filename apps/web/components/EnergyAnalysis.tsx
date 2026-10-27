"use client";

import { useMemo } from "react";
import { useChart } from "./EnergyCharts";
import { axis, barFade, C, SERIES, tooltip } from "@/lib/chart-theme";
import { formatNumber as fmt } from "@/lib/workspace";

export function RenewableMix({ rows }: { rows: { name: string; tce: number; renewable: boolean }[] }) {
  const total = rows.reduce((n, r) => n + Math.max(0, r.tce), 0);
  const renewable = rows.filter(r => r.renewable).reduce((n, r) => n + Math.max(0, r.tce), 0);
  const items = rows.filter(r => r.tce > 0).map((r, i) => ({ ...r, color: SERIES[i % SERIES.length] }));
  const option = useMemo(() => ({
    backgroundColor: "transparent", tooltip: { ...tooltip("item"), formatter: "{b}<br/>{c} tce · {d}%" },
    series: [{ type: "pie", radius: ["61%", "84%"], center: ["50%", "50%"], padAngle: 2,
      itemStyle: { borderRadius: 5 }, label: { show: false },
      data: items.map(r => ({ name: r.name, value: r.tce, itemStyle: { color: r.color } })) }],
  }), [items]);
  const ref = useChart(option);
  if (!total) return <div className="empty"><b>暂无用能来源数据</b></div>;
  return <div className="renewable-mix">
    <div className="renewable-donut"><div ref={ref} className="chart" role="img" aria-label="可再生属性与用能来源环形图" />
      <div className="renewable-center"><strong className="num">{fmt(renewable / total * 100, 1)}<small>%</small></strong><span>可再生能源占比</span></div>
    </div>
    <ul className="renewable-legend">{items.map(r => <li key={r.name}>
      <i style={{ background: r.color }} /><div><b>{r.name}</b><small>{r.renewable ? "可再生能源" : "常规能源"} · {fmt(r.tce, 1)} tce</small></div><strong className="num">{fmt(r.tce / total * 100, 1)}%</strong>
    </li>)}</ul>
  </div>;
}

export function IntensityRanking({ rows }: { rows: { name: string; intensity: number | null }[] }) {
  const items = rows.filter((r): r is { name: string; intensity: number } => r.intensity != null && Number.isFinite(r.intensity))
    .sort((a, b) => b.intensity - a.intensity);
  const option = useMemo(() => ({
    backgroundColor: "transparent", tooltip: tooltip(),
    grid: { left: 8, right: 55, top: 30, bottom: 8, containLabel: true },
    xAxis: { type: "value", name: "tce/万元", nameTextStyle: { color: C.muted, align: "right" }, ...axis },
    yAxis: { type: "category", data: items.map(r => r.name.replace(/（.*?）/g, "")), ...axis, axisLabel: { color: C.text, fontSize: 12 } },
    series: [{ name: "单位产值能耗", type: "bar", data: items.map(r => r.intensity), barMaxWidth: 20,
      itemStyle: { color: barFade(C.energy, true), borderRadius: [0, 5, 5, 0] },
      label: { show: true, position: "right", color: C.text, formatter: ({ value }: { value: number }) => fmt(value, 3) } }],
  }), [items]);
  const ref = useChart(option);
  return items.length ? <div ref={ref} className="chart" role="img" aria-label="企业单位产值能耗比较" /> : <div className="empty"><b>暂无企业产值与能耗数据</b></div>;
}
