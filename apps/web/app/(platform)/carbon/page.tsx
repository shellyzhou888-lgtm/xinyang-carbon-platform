import { charts, management, overview, carbonManagement } from "@/lib/server";
import { selectedYear } from "@/lib/workspace";
import { AchievedIndicators, DataError, Empty, MoreLink, PageHeading, Panel } from "@/components/WorkspaceParts";
import { LinkTabs, Reveal } from "@/components/MotionParts";
import { AnnualComboChart, ContributionList, KpiCard, ShareBreakdown, YearCompareChart } from "@/components/InsightParts";
import { BudgetComparison, CarbonReferences } from "@/components/CarbonDataSections";
import { C } from "@/lib/chart-theme";

export const dynamic = "force-dynamic";

export default async function Carbon({ searchParams }: { searchParams: Promise<{ year?: string; tab?: string }> }) {
  const sp = await searchParams, year = selectedYear(sp.year), tab = sp.tab === "flow" ? "flow" : "analysis";
  let data: Awaited<ReturnType<typeof overview>> | null = null, detail: Awaited<ReturnType<typeof management>> | null = null, extended: Awaited<ReturnType<typeof carbonManagement>> | null = null, error = "";
  let chart: Awaited<ReturnType<typeof charts>> | null = null;
  try { [data, detail, extended, chart] = await Promise.all([overview(year), management(year), carbonManagement(year), charts(year)]); } catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }
  const annual = detail?.annual || [];
  const row = (y: number) => annual.find((item) => item.year === y);
  const intensityOf = (y: number) => { const r = row(y); return r?.co2_t != null && r.value_added ? r.co2_t / r.value_added : null; };
  const perEnergyOf = (y: number) => { const r = row(y); return r?.co2_t != null && r.tce ? r.co2_t / r.tce : null; };
  const monthOf = (y: number) => (chart?.monthly || []).filter((item) => item.month.startsWith(String(y)));
  const monthly = monthOf(year), lastYear = monthOf(year - 1);
  const ranking = detail?.carbonRanking || [];
  const top3 = ranking.slice(0, 3).reduce((sum, item) => sum + item.co2_t, 0);
  const shortName = (name: string) => name.replace(/（[^）]*）/g, "");

  return <>
    <PageHeading eyebrow="CARBON MANAGEMENT" title="碳管理" description="以统一核算口径查看排放结构、企业贡献和碳强度。">
      <details className="rules"><summary>核算规则与边界</summary><div>
        <h3>园区能源活动核算</h3>
        <p>采用 GIP_2026 口径，按发改环资〔2025〕910号附件4计算；电力、热力按净受入处理，燃料以活动量及对应因子核算，原料用途与燃料用途分别处理。</p>
        <p>空间地图中的企业分布不作为核算边界；核算对象由数据库对象树和计入规则确定。自发可再生能源与外购绿电按已批准因子处理，不额外重复计入“抵消”。</p>
        <MoreLink href={`/admin/data?year=${year}`}>数据与因子库</MoreLink>
      </div></details>
    </PageHeading>
    <DataError error={error} />
    <div className="kpi-grid">
      <KpiCard label={`${year} 年二氧化碳排放`} value={data?.co2_t} unit="tCO₂" digits={0} tone="carbon" previous={row(year - 1)?.co2_t} spark={monthly.map((item) => item.co2_t)} foot="同比上年 · 月度走势" />
      <KpiCard label="单位工业增加值 CO₂" value={intensityOf(year)} unit="tCO₂/万元" digits={3} tone="carbon" previous={intensityOf(year - 1)} foot="碳强度持续下降为评价基本要求" delay={0.05} />
      <KpiCard label="单位综合能耗 CO₂" value={perEnergyOf(year)} unit="tCO₂/tce" digits={3} tone="info" previous={perEnergyOf(year - 1)} foot="反映用能结构的低碳程度" delay={0.1} />
      <KpiCard label="前三大排放企业占比" value={data?.co2_t ? top3 / data.co2_t * 100 : null} unit="%" digits={1} tone="accent" foot={ranking.slice(0, 3).map((item) => shortName(item.name)).join("、")} delay={0.15} />
    </div>
    <LinkTabs id="carbon" label="碳管理模块" active={tab} items={[{ key: "analysis", label: "碳排放分析", href: `/carbon?year=${year}` }, { key: "flow", label: "碳流分析", href: `/carbon?year=${year}&tab=flow` }]} />

    {tab === "analysis" ? <div className="stack">
      <div className="grid-main-side" style={{ marginTop: 0 }}>
        <Reveal><Panel title={`${year} 年月度碳排放`} subtitle={`柱为 ${year} 年，虚线为 ${year - 1} 年同期；悬停查看同比`}>
          {monthly.length ? <YearCompareChart months={monthly.map((item) => `${Number(item.month.slice(5))}月`)} current={monthly.map((item) => item.co2_t)} previous={monthly.map((item) => lastYear.find((prev) => prev.month.slice(5) === item.month.slice(5))?.co2_t ?? null)} year={year} unit="tCO₂" color={C.carbon} label="月度碳排放同比" /> : <Empty title="暂无月度数据" />}
        </Panel></Reveal>
        <Reveal delay={0.06}><Panel title={`${year} 年排放结构`} subtitle="按能源品种分解的排放量与占比">
          <ShareBreakdown rows={(detail?.carbonStructure || []).map((item) => ({ name: item.name, value: item.co2_t }))} unit="tCO₂" label="碳排放结构" centerLabel="tCO₂ 合计" />
        </Panel></Reveal>
      </div>
      <div className="grid-2">
        <Reveal><Panel className="panel-fill" title="近三年排放量与碳强度" subtitle="柱为二氧化碳排放量，折线为单位工业增加值 CO₂（两轴均从 0 起）">
          <AnnualComboChart years={annual.map((item) => item.year)} totals={annual.map((item) => item.co2_t)} intensity={annual.map((item) => intensityOf(item.year))}
            totalName="碳排放" totalUnit="tCO₂" intensityName="碳强度" intensityUnit="tCO₂/万元" color={C.carbon} label="近三年排放量与碳强度" />
        </Panel></Reveal>
        <Reveal delay={0.06}><Panel title="企业碳排放贡献" subtitle="按排放量排序；右列为单位产值 CO₂（tCO₂/万元）">
          <ContributionList rows={ranking.map((item) => ({ code: item.code, name: shortName(item.name), value: item.co2_t, intensity: item.intensity }))} total={data?.co2_t} unit="tCO₂" intensityUnit="tCO₂/万元产值" tone="carbon" />
        </Panel></Reveal>
      </div>
      <Reveal><BudgetComparison data={extended} kind="carbon" /></Reveal>
      <Reveal><CarbonReferences data={extended} /></Reveal>
      <AchievedIndicators data={data} codes={["I17", "I18", "I19"]} title="碳排放达标表现" />
    </div> : <Panel title="碳流与内部转供">
      <Empty title={detail?.transfers.length ? "内部转供尚未关联独立排放因子" : "尚无可闭合的碳流记录"} action={<MoreLink href={`/energy?year=${year}&tab=flow`}>查看能流数据</MoreLink>}>
        碳流需由对应能流、计量单位和因子逐项换算；现有排放结构可在“碳排放分析”查看。
      </Empty>
    </Panel>}
  </>;
}
