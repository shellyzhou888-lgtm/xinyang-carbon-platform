import { charts, management, overview, carbonManagement, enterpriseEnergyMix, enterpriseMonthly } from "@/lib/server";
import { selectedYear } from "@/lib/workspace";
import { AchievedIndicators, DataError, Empty, MoreLink, PageHeading, Panel } from "@/components/WorkspaceParts";
import { LinkTabs } from "@/components/MotionParts";
import { AnnualComboChart, ContributionList, KpiCard, YearCompareChart } from "@/components/InsightParts";
import { BudgetProgress, CompositionCapsules, EnterpriseMatrix } from "@/components/ProgressViz";
import SectionPager from "@/components/SectionPager";
import { CarbonReferences } from "@/components/CarbonDataSections";
import FlowNetworkMap from "@/components/FlowNetworkMap";
import { C } from "@/lib/chart-theme";

export const dynamic = "force-dynamic";

export default async function Carbon({ searchParams }: { searchParams: Promise<{ year?: string; tab?: string }> }) {
  const sp = await searchParams, year = selectedYear(sp.year), tab = sp.tab === "flow" ? "flow" : "analysis";
  let data: Awaited<ReturnType<typeof overview>> | null = null, detail: Awaited<ReturnType<typeof management>> | null = null, extended: Awaited<ReturnType<typeof carbonManagement>> | null = null, error = "";
  let chart: Awaited<ReturnType<typeof charts>> | null = null;
  let mix: Awaited<ReturnType<typeof enterpriseEnergyMix>> = [];
  let entNow: Awaited<ReturnType<typeof enterpriseMonthly>> = [], entPrev: Awaited<ReturnType<typeof enterpriseMonthly>> = [];
  try { [data, detail, extended, chart, mix, entNow, entPrev] = await Promise.all([overview(year), management(year), carbonManagement(year), charts(year), tab === "flow" ? enterpriseEnergyMix(year) : Promise.resolve([]),
    tab === "flow" ? Promise.resolve([]) : enterpriseMonthly(year), tab === "flow" || year <= 2021 ? Promise.resolve([]) : enterpriseMonthly(year - 1)]); } catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }
  const annual = detail?.annual || [];
  const row = (y: number) => annual.find((item) => item.year === y);
  const intensityOf = (y: number) => { const r = row(y); return r?.co2_t != null && r.value_added ? r.co2_t / r.value_added : null; };
  const perEnergyOf = (y: number) => { const r = row(y); return r?.co2_t != null && r.tce ? r.co2_t / r.tce : null; };
  const monthOf = (y: number) => (chart?.monthly || []).filter((item) => item.month.startsWith(String(y)));
  const monthly = monthOf(year), lastYear = monthOf(year - 1);
  const ranking = detail?.carbonRanking || [];
  const top3 = ranking.slice(0, 3).reduce((sum, item) => sum + item.co2_t, 0);
  const shortName = (name: string) => name.replace(/（[^）]*）/g, "");

  const tabs = <LinkTabs id="carbon" label="碳排管理模块" active={tab} items={[{ key: "analysis", label: "碳排放分析", href: `/carbon?year=${year}` }, { key: "flow", label: "碳流网络", href: `/carbon?year=${year}&tab=flow` }]} />;
  const achievedAny = !!data?.achieved.some((item) => ["I17", "I18", "I19"].includes(item.code));

  return <div className="fit-screen">
    <PageHeading eyebrow={`CARBON MANAGEMENT · ${year} 年度`} title="碳排管理" description="以统一核算口径查看排放结构、企业贡献和碳强度。">
      <details className="rules"><summary>核算规则与边界</summary><div>
        <h3>园区能源活动核算</h3>
        <p>采用 GIP_2026 口径，按发改环资〔2025〕910号附件4计算；电力、热力按净受入处理，燃料以活动量及对应因子核算，原料用途与燃料用途分别处理。</p>
        <p>空间地图中的企业分布不作为核算边界；核算对象由数据库对象树和计入规则确定。自发可再生能源与外购绿电按已批准因子处理，不额外重复计入“抵消”。</p>
        <MoreLink href={`/admin/data?year=${year}`}>数据与因子库</MoreLink>
      </div></details>
    </PageHeading>
    <DataError error={error} />
    <div className="kpi-grid">
      <KpiCard featured label={`${year} 年二氧化碳排放`} value={data?.co2_t} unit="tCO₂" digits={0} tone="carbon" previous={row(year - 1)?.co2_t} spark={monthly.map((item) => item.co2_t)} foot="同比上年 · 月度走势" />
      <KpiCard label="单位工业增加值 CO₂" value={intensityOf(year)} unit="tCO₂/万元" digits={3} tone="carbon" previous={intensityOf(year - 1)} foot="碳强度持续下降为评价基本要求" delay={0.05} />
      <KpiCard label="单位综合能耗 CO₂" value={perEnergyOf(year)} unit="tCO₂/tce" digits={3} tone="info" previous={perEnergyOf(year - 1)} foot="反映用能结构的低碳程度" delay={0.1} />
      <KpiCard label="前三大排放企业占比" value={data?.co2_t ? top3 / data.co2_t * 100 : null} unit="%" digits={1} tone="accent" foot={ranking.slice(0, 3).map((item) => shortName(item.name)).join("、")} delay={0.15} />
    </div>

    {tab === "analysis" ? <SectionPager lead={tabs} labels={["月度与结构", "趋势与企业", "企业排放矩阵", "排放预算", "核算依据", ...(achievedAny ? ["达标表现"] : [])]}>
      <div className="view-split">
        <Panel title={`${year} 年月度碳排放`} subtitle={`柱为 ${year} 年，虚线为 ${year - 1} 年同期；悬停查看同比`}>
          {monthly.length ? <YearCompareChart months={monthly.map((item) => `${Number(item.month.slice(5))}月`)} current={monthly.map((item) => item.co2_t)} previous={monthly.map((item) => lastYear.find((prev) => prev.month.slice(5) === item.month.slice(5))?.co2_t ?? null)} year={year} unit="tCO₂" color={C.carbon} label="月度碳排放同比" /> : <Empty title="暂无月度数据" />}
        </Panel>
        <Panel title={`${year} 年排放结构`} subtitle="按能源品种分解的排放量与占比">
          <CompositionCapsules rows={(detail?.carbonStructure || []).map((item) => ({ name: item.name, value: item.co2_t }))} unit="tCO₂" tone="carbon" />
        </Panel>
      </div>
      <div className="view-split even">
        <Panel className="panel-fill" title="近年排放量与碳强度" subtitle="柱为二氧化碳排放量，折线为单位工业增加值 CO₂（两轴均从 0 起）">
          <AnnualComboChart years={annual.map((item) => item.year)} totals={annual.map((item) => item.co2_t)} intensity={annual.map((item) => intensityOf(item.year))}
            totalName="碳排放" totalUnit="tCO₂" intensityName="碳强度" intensityUnit="tCO₂/万元" color={C.carbon} label="近年排放量与碳强度" />
        </Panel>
        <Panel title="企业碳排放贡献" subtitle="按排放量排序；右列为单位产值 CO₂（tCO₂/万元）">
          <ContributionList rows={ranking.map((item) => ({ code: item.code, name: shortName(item.name), value: item.co2_t, intensity: item.intensity }))} total={data?.co2_t} unit="tCO₂" intensityUnit="tCO₂/万元产值" tone="carbon" />
        </Panel>
      </div>
      <Panel className="view-fill" title="企业月度排放体检矩阵" subtitle="每格为企业一个月的二氧化碳排放：可按同比上年或相对自身月均着色，悬停查看数值">
        <EnterpriseMatrix current={entNow} previous={entPrev} metric="co2_t" unit="tCO₂" year={year} />
      </Panel>
      <Panel className="view-fill" title="累计排放与预算" subtitle="年度排放预算按季度、按月等额分配，与实际排放对比">
        <BudgetProgress data={extended} kind="carbon" />
      </Panel>
      <CarbonReferences data={extended} />
      <AchievedIndicators data={data} codes={["I17", "I18", "I19"]} title="碳排放达标表现" />
    </SectionPager> : <SectionPager lead={tabs} labels={["碳流地图"]}>
      <Panel className="panel-flush view-fill" title="碳流网络互动地图" subtitle="企业 → 产业片区 → 园区的排放汇聚；卡片显示排放量、占比与单位产值 CO₂，红色光罩为存在未处理预警的企业"
        action={<MoreLink href={`/energy?year=${year}&tab=flow`}>能流网络</MoreLink>}>
        <FlowNetworkMap mode="carbon" year={year} parkTotal={data?.co2_t} mix={mix} nodes={ranking.map((item) => ({ code: item.code, name: item.name, value: item.co2_t, intensity: item.intensity }))}
          alerts={(detail?.alerts || []).filter((item) => item.status === "open").map((item) => item.node)} />
      </Panel>
    </SectionPager>}
  </div>;
}
