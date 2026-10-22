import Link from "next/link";
import { charts, management, overview, carbonManagement, indicatorBoard, enterpriseMonthly } from "@/lib/server";
import { selectedYear, formatNumber as fmt } from "@/lib/workspace";
import { DataError, Empty, PageHeading, Panel } from "@/components/WorkspaceParts";
import DiagnosisSteps from "@/components/DiagnosisSteps";
import SpatialDiagnosis from "@/components/SpatialDiagnosis";
import { TrendChart } from "@/components/EnergyCharts";
import StrategyReportButton from "@/components/StrategyReportButton";
import { Roadmap } from "@/components/CarbonDataSections";
import { cleanSource } from "@/lib/source-text";
import SectionPager from "@/components/SectionPager";
import { IndicatorScales } from "@/components/IndicatorScales";

export const dynamic = "force-dynamic";
const CATEGORIES: Record<string, string> = { clean_energy: "清洁能源", green_power: "绿电交易", efficiency: "能效提升", waste_heat: "余热回收", electrification: "电气化", process: "工艺优化", management: "运行管理", offset: "抵消" };
const TABS = ["spatial", "evaluation", "strategies"];

export default async function Diagnosis({ searchParams }: { searchParams: Promise<{ year?: string; tab?: string; status?: string }> }) {
  const sp = await searchParams, year = selectedYear(sp.year);
  // Old links: "forecast" opens optimisation; "alerts" and "causes" open the merged spatial diagnosis.
  const tab = sp.tab === "forecast" ? "strategies" : TABS.includes(sp.tab || "") ? sp.tab! : "spatial";
  let data: Awaited<ReturnType<typeof overview>> | null = null, detail: Awaited<ReturnType<typeof management>> | null = null, chart: Awaited<ReturnType<typeof charts>> | null = null, error = "";
  let extended: Awaited<ReturnType<typeof carbonManagement>> | null = null;
  let board: Awaited<ReturnType<typeof indicatorBoard>> = [];
  let entNow: Awaited<ReturnType<typeof enterpriseMonthly>> = [], entPrev: Awaited<ReturnType<typeof enterpriseMonthly>> = [];
  try { [data, detail, chart, extended, board, entNow, entPrev] = await Promise.all([overview(year), management(year), charts(year), carbonManagement(year), tab === "evaluation" ? indicatorBoard(year) : Promise.resolve([]),
    tab === "spatial" ? enterpriseMonthly(year) : Promise.resolve([]), tab === "spatial" && year > 2021 ? enterpriseMonthly(year - 1) : Promise.resolve([])]); } catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }
  const openAlerts = (detail?.alerts || []).filter((row) => row.status === "open");

  return <div className="fit-screen">
    <PageHeading eyebrow={`ENERGY & CARBON DIAGNOSIS · ${year} 年度`} title="能碳综合诊断" description="在园区实景上定位问题与贡献，对照指标，再选择策略并检验效果。" />
    <DataError error={error} />
    <DiagnosisSteps year={year} active={tab} counts={{ spatial: openAlerts.length, evaluation: 19, strategies: extended?.plans.length ?? 0 }} />

    {tab === "spatial" && <div className="fit-body">
      <SpatialDiagnosis year={year} alerts={detail?.alerts ?? []} ranking={detail?.carbonRanking ?? []} monthly={entNow} previous={entPrev} plans={extended?.plans ?? []} parkCo2={data?.co2_t} />
    </div>}

    {tab === "evaluation" && <SectionPager labels={["评价指标"]}>
      <Panel className="view-fill" title="绿色工业园区评价指标" subtitle={`《绿色工业园区评价要求》（GIP_2026）全部 ${board.length} 项二级指标：当前值、引领值与 2021 年以来的变化`}>
        <IndicatorScales rows={board} year={year} columns={3} grouped />
      </Panel>
    </SectionPager>}

    {tab === "strategies" && <SectionPager labels={["预警关联策略", "策略库", "月度预测", "减碳路线"]}>
      <Panel className="view-fill" title="预警关联策略推荐" subtitle="节能量与减碳量按策略参数测算；不同策略可能重叠，不直接求和。" action={<StrategyReportButton year={year} />}>
        {extended?.plans.length ? <div className="table-scroll"><table><thead><tr><th>企业 / 对象</th><th>策略与关联预警</th><th className="num">预计节能 / tce</th><th className="num">预计减碳 / tCO₂</th></tr></thead>
          <tbody>{extended.plans.map((row, index) => <tr key={index}><td>{row.node}</td><td>{row.strategy}<small className="table-subtext">{row.alert}</small></td><td className="num">{fmt(row.tce_saving)}</td><td className="num">{fmt(row.co2_reduction_t)}</td></tr>)}</tbody></table></div>
          : <Empty title="本年度暂无预警关联策略" />}
      </Panel>
      <Panel className="view-fill" title="减碳策略库" subtitle={`${detail?.strategies.length ?? 0} 项可选策略`}>
        <div className="strategy-grid">{detail?.strategies.map((row) => <article className="strategy-item" key={row.code}><span className="strategy-category">{CATEGORIES[row.category] || row.category}</span><h3>{row.name}</h3><p>{row.description || "按企业工况和适用条件进一步核查。"}</p>{cleanSource(row.reference) && <small>{cleanSource(row.reference)}</small>}</article>)}</div>
      </Panel>
      <Panel className="view-fill" title="月度能耗与碳排放预测" subtitle="最新成功批次；虚线为中位预测，阴影为 10%—90% 区间">
        {chart?.forecast.length ? <><TrendChart data={chart} /><div className="meta-row">{chart.forecast.map((row) => <span key={row.target}><b>{row.target === "energy_tce" ? "能耗" : "碳排放"}</b>{row.model || "基准模型"} · 批次 {row.run_id} · {row.points[0]?.month}—{row.points.at(-1)?.month}</span>)}</div></>
          : <Empty title="暂无已发布的预测批次" />}
      </Panel>
      <Roadmap data={extended} />
    </SectionPager>}

    <p className="panel-note fit-foot">诊断顺序：实景诊断在地图上定位问题与贡献 → 碳评价对照指标 → 能耗优化匹配策略并以预测检验效果。<Link href={`/carbon?year=${year}`}>返回碳管理</Link></p>
  </div>;
}
