import { charts, management, overview, carbonManagement, carbonAsset, enterpriseEnergyMix, footprintComparison } from "@/lib/server";
import { selectedYear } from "@/lib/workspace";
import { AchievedIndicators, DataError, MoreLink, PageHeading, Panel } from "@/components/WorkspaceParts";
import { LinkTabs } from "@/components/MotionParts";
import { AnnualComboChart, ContributionList, KpiCard } from "@/components/InsightParts";
import SectionPager from "@/components/SectionPager";
import { CarbonMarket, FootprintRefs, Roadmap } from "@/components/CarbonDataSections";
import { CarbonBudgetGauge, ChangeWaterfall, EmitterQuadrant, ExposureView, FootprintView, ReductionValue, ScopeSplit } from "@/components/CarbonViews";
import FlowNetworkMap from "@/components/FlowNetworkMap";
import { C } from "@/lib/chart-theme";

export const dynamic = "force-dynamic";

const TABS = [["analysis", "碳排放分析"], ["flow", "碳流网络"], ["asset", "碳资产"]] as const;
type Tab = (typeof TABS)[number][0];

export default async function Carbon({ searchParams }: { searchParams: Promise<{ year?: string; tab?: string }> }) {
  const sp = await searchParams, year = selectedYear(sp.year);
  const tab: Tab = TABS.some(([key]) => key === sp.tab) ? sp.tab as Tab : "analysis";
  let data: Awaited<ReturnType<typeof overview>> | null = null, detail: Awaited<ReturnType<typeof management>> | null = null, extended: Awaited<ReturnType<typeof carbonManagement>> | null = null, error = "";
  let previous: Awaited<ReturnType<typeof management>> | null = null;
  let mix: Awaited<ReturnType<typeof enterpriseEnergyMix>> = [];
  let asset: Awaited<ReturnType<typeof carbonAsset>> | null = null, footprint: Awaited<ReturnType<typeof footprintComparison>> | null = null;
  let chart: Awaited<ReturnType<typeof charts>> | null = null;
  try {
    [data, detail, extended, chart, previous, mix, asset, footprint] = await Promise.all([overview(year), management(year), carbonManagement(year), charts(year),
      tab === "analysis" && year > 2021 ? management(year - 1) : Promise.resolve(null),
      tab === "flow" ? enterpriseEnergyMix(year) : Promise.resolve([]),
      tab === "asset" ? carbonAsset(2021, year + 1) : Promise.resolve(null),
      tab === "asset" ? footprintComparison(year) : Promise.resolve(null)]);
  } catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }
  const annual = detail?.annual || [];
  const row = (y: number) => annual.find((item) => item.year === y);
  const intensityOf = (y: number) => { const r = row(y); return r?.co2_t != null && r.value_added ? r.co2_t / r.value_added : null; };
  const perEnergyOf = (y: number) => { const r = row(y); return r?.co2_t != null && r.tce ? r.co2_t / r.tce : null; };
  const monthly = (chart?.monthly || []).filter((item) => item.month.startsWith(String(year)));
  const ranking = detail?.carbonRanking || [];
  const top3 = ranking.slice(0, 3).reduce((sum, item) => sum + item.co2_t, 0);
  const shortName = (name: string) => name.replace(/（[^）]*）/g, "");
  const structure = (list: typeof detail) => (list?.carbonStructure || []).map((item) => ({ name: item.name, value: item.co2_t }));
  const parkAsset = asset?.rows.find((item) => item.node_code === "XYEDZ" && item.year === year);
  const achievedAny = !!data?.achieved.some((item) => ["I17", "I18", "I19"].includes(item.code));
  const tabs = <LinkTabs id="carbon" label="碳排管理模块" active={tab} items={TABS.map(([key, label]) => ({ key, label, href: `/carbon?year=${year}${key === "analysis" ? "" : `&tab=${key}`}` }))} />;

  return <div className="fit-screen">
    <PageHeading eyebrow={`CARBON MANAGEMENT · ${year} 年度`} title="碳排管理" description="以统一核算口径查看排放构成、变化原因和碳资产价值。">
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

    {tab === "analysis" && <SectionPager lead={tabs} labels={["排放与范围", "变化归因", "企业定位", "预算与达峰", ...(achievedAny ? ["达标表现"] : [])]}>
      <div className="view-split">
        <Panel className="panel-fill" title="近年排放量与碳强度" subtitle="柱为二氧化碳排放量，折线为单位工业增加值 CO₂（两轴均从 0 起）">
          <AnnualComboChart years={annual.map((item) => item.year)} totals={annual.map((item) => item.co2_t)} intensity={annual.map((item) => intensityOf(item.year))}
            totalName="碳排放" totalUnit="tCO₂" intensityName="碳强度" intensityUnit="tCO₂/万元" color={C.carbon} label="近年排放量与碳强度" />
        </Panel>
        <Panel title={`${year} 年范围一与范围二`} subtitle="厂内燃料燃烧为直接排放，外购电力、热力为间接排放">
          <ScopeSplit rows={structure(detail)} />
        </Panel>
      </div>
      <Panel className="view-fill" title={`${year - 1} → ${year} 年排放变化归因`} subtitle="从上年总量出发，逐项列出各能源品种带来的增减，落到本年总量">
        <ChangeWaterfall previous={structure(previous)} current={structure(detail)} year={year} />
      </Panel>
      <div className="view-split">
        <Panel title="企业排放与碳强度四象限" subtitle="横轴为排放量（对数），纵轴为单位产值 CO₂；虚线为中位数，气泡越大排放越多">
          <EmitterQuadrant rows={ranking.map((item) => ({ code: item.code, name: item.name, value: item.co2_t, intensity: item.intensity }))} total={data?.co2_t} />
        </Panel>
        <Panel title="企业碳排放贡献" subtitle="按排放量排序；右列为单位产值 CO₂（tCO₂/万元）">
          <ContributionList rows={ranking.map((item) => ({ code: item.code, name: shortName(item.name), value: item.co2_t, intensity: item.intensity }))} total={data?.co2_t} unit="tCO₂" intensityUnit="tCO₂/万元产值" tone="carbon" />
        </Panel>
      </div>
      <div className="view-split even">
        <Panel title={`${year} 年排放预算使用`} subtitle="累计排放占年度排放预算的比例">
          <CarbonBudgetGauge data={extended} />
        </Panel>
        <Roadmap data={extended} />
      </div>
      <AchievedIndicators data={data} codes={["I17", "I18", "I19"]} title="碳排放达标表现" />
    </SectionPager>}

    {tab === "flow" && <SectionPager lead={tabs} labels={["碳流地图"]}>
      <Panel className="panel-flush view-fill" title="碳流网络互动地图" subtitle="企业 → 产业片区 → 园区的排放汇聚；卡片显示排放量、占比与单位产值 CO₂，红色光罩为存在未处理预警的企业"
        action={<MoreLink href={`/energy?year=${year}&tab=flow`}>能流网络</MoreLink>}>
        <FlowNetworkMap mode="carbon" year={year} parkTotal={data?.co2_t} mix={mix} nodes={ranking.map((item) => ({ code: item.code, name: item.name, value: item.co2_t, intensity: item.intensity }))}
          alerts={(detail?.alerts || []).filter((item) => item.status === "open").map((item) => item.node)} />
      </Panel>
    </SectionPager>}

    {tab === "asset" && <SectionPager lead={tabs} labels={["碳成本敞口", "减排资产化", "碳市场行情", "产品碳足迹"]}>
      <Panel className="view-fill" title="碳成本敞口" subtitle="按全国碳市场年均价折算的园区碳排放价值；虚框柱为基准预测排放">
        <ExposureView asset={asset} year={year} />
      </Panel>
      <Panel className="view-fill" title="减排措施的碳资产价值" subtitle="诊断页关联策略的年减排量 × 当年碳价，按减排量排序">
        <ReductionValue plans={extended?.plans || []} price={parkAsset?.cea_price} exposure={parkAsset?.cost_wan} />
      </Panel>
      <CarbonMarket data={extended} />
      <div className="view-split">
        <Panel title="企业产品碳强度对标" subtitle="厂内碳强度 ÷ 功能单位相同的参考足迹；超过 100% 的条目标为橙色">
          <FootprintView comparison={footprint} />
        </Panel>
        <FootprintRefs data={extended} />
      </div>
    </SectionPager>}
  </div>;
}
