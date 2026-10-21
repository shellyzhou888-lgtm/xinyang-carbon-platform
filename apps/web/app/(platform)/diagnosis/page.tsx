import Link from "next/link";
import { charts, management, overview, carbonManagement } from "@/lib/server";
import { selectedYear, formatNumber as fmt } from "@/lib/workspace";
import { DataError, Empty, MoreLink, PageHeading, Panel } from "@/components/WorkspaceParts";
import { LinkTabs, Reveal } from "@/components/MotionParts";
import DiagnosisSteps from "@/components/DiagnosisSteps";
import { TrendChart } from "@/components/EnergyCharts";
import MetricChart from "@/components/MetricChart";
import AlertEvidence from "@/components/AlertEvidence";
import { Roadmap } from "@/components/CarbonDataSections";
import { cleanSource } from "@/lib/source-text";
import { C } from "@/lib/chart-theme";

export const dynamic = "force-dynamic";
const CATEGORIES: Record<string, string> = { clean_energy: "清洁能源", green_power: "绿电交易", efficiency: "能效提升", waste_heat: "余热回收", electrification: "电气化", process: "工艺优化", management: "运行管理", offset: "抵消" };
const TABS = ["alerts", "causes", "strategies", "forecast"];

export default async function Diagnosis({ searchParams }: { searchParams: Promise<{ year?: string; tab?: string; status?: string }> }) {
  const sp = await searchParams, year = selectedYear(sp.year);
  const tab = TABS.includes(sp.tab || "") ? sp.tab! : "alerts";
  let data: Awaited<ReturnType<typeof overview>> | null = null, detail: Awaited<ReturnType<typeof management>> | null = null, chart: Awaited<ReturnType<typeof charts>> | null = null, error = "";
  let extended: Awaited<ReturnType<typeof carbonManagement>> | null = null;
  try { [data, detail, chart, extended] = await Promise.all([overview(year), management(year), charts(year), carbonManagement(year)]); } catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }
  const openAlerts = (detail?.alerts || []).filter((row) => row.status === "open");
  const visibleAlerts = sp.status === "all" ? detail?.alerts || [] : openAlerts;
  const top = detail?.carbonRanking[0]?.co2_t || 1;

  return <>
    <PageHeading eyebrow={`ENERGY & CARBON DIAGNOSIS · ${year} 年度`} title="能碳综合诊断" description="发现问题、追查贡献、选择策略，再用预测检验方向。" />
    <DataError error={error} />
    <DiagnosisSteps year={year} active={tab} counts={{ alerts: openAlerts.length, causes: detail?.carbonRanking.length ?? 0, strategies: extended?.plans.length ?? 0, forecast: chart?.forecast.length ?? 0 }} />

    {tab === "alerts" && <div className="stack">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <LinkTabs id="alert-status" label="预警状态" active={sp.status === "all" ? "all" : "open"} items={[{ key: "open", label: "待处理预警", href: `/diagnosis?year=${year}`, badge: openAlerts.length }, { key: "all", label: "全部与历史", href: `/diagnosis?year=${year}&status=all` }]} />
        <MoreLink href={`/admin?year=${year}`}>数据质量工单</MoreLink>
      </div>
      {visibleAlerts.length ? visibleAlerts.map((row, index) => <Reveal key={row.id} delay={Math.min(index, 6) * 0.04}><article className={`alert-card risk-${["critical", "high"].includes(row.severity) ? "high" : "medium"}`}>
        <header><b>{row.node}</b><span className={`tag ${row.status === "open" ? "risk-medium" : ""}`}>{row.status === "open" ? "处理中" : row.status === "resolved" ? "已解决" : "已确认"}</span></header>
        <p>{row.message}</p>
        <div className="figures"><span>观测值<b>{fmt(row.observed, 4)}</b></span><span>基线<b>{fmt(row.baseline, 4)}</b></span></div>
        <AlertEvidence value={row.root_cause} />
      </article></Reveal>) : <Empty title="本年度暂无已生成的诊断预警" action={<MoreLink href={`/diagnosis?year=${year}&tab=causes`}>查看企业排放贡献</MoreLink>}>这里显示诊断规则产生的预警记录。</Empty>}
    </div>}

    {tab === "causes" && <div className="grid-main-side" style={{ marginTop: 0 }}>
      <Reveal><Panel title="企业排放贡献分解" subtitle="贡献排序用于定位核查重点，不能直接认定因果关系">
        <MetricChart rows={(detail?.carbonRanking || []).map((row) => ({ name: row.name.replace(/（.*?）/g, ""), value: row.co2_t }))} unit="tCO₂" color={C.carbon} label="企业排放贡献" />
      </Panel></Reveal>
      <Reveal delay={0.06}><Panel title="溯源到企业" subtitle="排放量前五">
        {detail?.carbonRanking.slice(0, 5).map((row, index) => <div className="rank-row" key={row.code}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <div><b style={{ fontWeight: 500 }}>{row.name}</b><div className="rank-bar"><i style={{ width: `${row.co2_t / top * 100}%` }} /></div></div>
          <strong>{fmt(row.co2_t)}<small>tCO₂</small></strong>
        </div>)}
        <p className="panel-note">产线、设备层级需补充对应计量及分摊数据。</p>
      </Panel></Reveal>
    </div>}

    {tab === "strategies" && <div className="stack">
      <Reveal><Panel title="预警关联策略推荐" subtitle="节能量与减碳量按策略参数测算；不同策略可能重叠，不直接求和。">
        {extended?.plans.length ? <div className="table-scroll"><table><thead><tr><th>企业 / 对象</th><th>策略与关联预警</th><th className="num">预计节能 / tce</th><th className="num">预计减碳 / tCO₂</th></tr></thead>
          <tbody>{extended.plans.map((row, index) => <tr key={index}><td>{row.node}</td><td>{row.strategy}<small className="table-subtext">{row.alert}</small></td><td className="num">{fmt(row.tce_saving)}</td><td className="num">{fmt(row.co2_reduction_t)}</td></tr>)}</tbody></table></div>
          : <Empty title="本年度暂无预警关联策略" />}
      </Panel></Reveal>
      <Reveal><Panel title="减碳策略库" subtitle={`${detail?.strategies.length ?? 0} 项可选策略`}>
        <div className="strategy-grid">{detail?.strategies.map((row) => <article className="strategy-item" key={row.code}><span className="strategy-category">{CATEGORIES[row.category] || row.category}</span><h3>{row.name}</h3><p>{row.description || "按企业工况和适用条件进一步核查。"}</p>{cleanSource(row.reference) && <small>{cleanSource(row.reference)}</small>}</article>)}</div>
      </Panel></Reveal>
    </div>}

    {tab === "forecast" && <div className="stack">
      <Reveal><Panel title="月度能耗与碳排放预测" subtitle="最新成功批次；虚线为中位预测，阴影为 10%—90% 区间">
        {chart?.forecast.length ? <><TrendChart data={chart} /><div className="meta-row">{chart.forecast.map((row) => <span key={row.target}><b>{row.target === "energy_tce" ? "能耗" : "碳排放"}</b>{row.model || "基准模型"} · 批次 {row.run_id} · {row.points[0]?.month}—{row.points.at(-1)?.month}</span>)}</div></>
          : <Empty title="暂无已发布的预测批次" />}
      </Panel></Reveal>
      <Reveal><Roadmap data={extended} /></Reveal>
    </div>}
    <p className="panel-note" style={{ marginTop: 20 }}>诊断顺序：预警发现问题 → 根因溯源定位对象 → 策略库匹配对策 → 预测检验效果。<Link href={`/carbon?year=${year}`}>返回碳管理</Link></p>
  </>;
}
