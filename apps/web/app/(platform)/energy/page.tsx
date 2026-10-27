import { charts, management, overview, carbonManagement, enterpriseEnergyMix, enterpriseMonthly, indicatorBoard } from "@/lib/server";
import { selectedYear, formatNumber as fmt } from "@/lib/workspace";
import { DataError, Empty, MoreLink, PageHeading, Panel } from "@/components/WorkspaceParts";
import BusinessNavigation from "@/components/BusinessNavigation";
import { RankingChart } from "@/components/EnergyCharts";
import { ContributionList, KpiCard, YearCompareChart } from "@/components/InsightParts";
import MetricChart from "@/components/MetricChart";
import EnergyHeatTwin from "@/components/EnergyHeatTwin";
import FlowNetworkMap from "@/components/FlowNetworkMap";
import EnergyFlow from "@/components/EnergyFlow";
import { BudgetProgress, CompositionCapsules, EnterpriseMatrix } from "@/components/ProgressViz";
import { IndicatorScales } from "@/components/IndicatorScales";
import { C } from "@/lib/chart-theme";

export const dynamic = "force-dynamic";

const TABS = [["heat", "数字孪生"], ["consumption", "用能分析"], ["flow", "能流网络"], ["renewable", "绿能利用"], ["intensity", "能效对标"]] as const;

export default async function Energy({ searchParams }: { searchParams: Promise<{ year?: string; tab?: string }> }) {
  const sp = await searchParams, year = selectedYear(sp.year);
  const tab = TABS.some(([key]) => key === sp.tab) ? sp.tab! : "heat";
  let data: Awaited<ReturnType<typeof overview>> | null = null, chart: Awaited<ReturnType<typeof charts>> | null = null, detail: Awaited<ReturnType<typeof management>> | null = null, error = "";
  let extended: Awaited<ReturnType<typeof carbonManagement>> | null = null;
  // Heat twin: every year with enterprise monthly data (2021 onwards), switchable inside the map.
  const twinYears = [2021, 2022, 2023, 2024, 2025].filter((y) => y <= year);
  let monthlyByYear: Awaited<ReturnType<typeof enterpriseMonthly>>[] = [];
  let mix: Awaited<ReturnType<typeof enterpriseEnergyMix>> = [];
  let board: Awaited<ReturnType<typeof indicatorBoard>> = [];
  try { [data, chart, detail, extended, monthlyByYear, mix, board] = await Promise.all([overview(year), charts(year), management(year), carbonManagement(year), Promise.all(twinYears.map((y) => enterpriseMonthly(y))), tab === "flow" ? enterpriseEnergyMix(year) : Promise.resolve([]), indicatorBoard(year)]); } catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }
  const monthly = chart?.monthly.filter((row) => row.month.startsWith(String(year))) || [];
  const renewable = detail?.renewable.filter((row) => row.renewable).reduce((total, row) => total + row.tce, 0);
  const renewableShare = renewable != null && data?.tce ? renewable / data.tce * 100 : null;
  const indicator = (code: string) => data?.achieved.find((row) => row.code === code);
  const monthOf = (y: number) => (chart?.monthly || []).filter((row) => row.month.startsWith(String(y)));
  const lastYear = monthOf(year - 1);
  const months = monthly.map((row) => `${Number(row.month.slice(5))}月`);
  const annual = (y: number) => detail?.annual.find((row) => row.year === y);
  const intensity = (y: number) => { const row = annual(y); return row?.tce != null && row.value_added ? row.tce / row.value_added : null; };
  const leader = chart?.ranking[0];

  const prevMonthly = monthlyByYear[twinYears.indexOf(year - 1)] ?? [];
  const link = ([key, label]: readonly [string, string]) => ({ key, label, href: `/energy?year=${year}&tab=${key}` });
  const tabs = <BusinessNavigation id="energy" active={tab} items={TABS.map(link)} />;

  return <div className="analysis-workspace tone-energy">
    <PageHeading eyebrow={`ENERGY MANAGEMENT · ${year} 年度`} title="能源管理" description="总量与趋势、企业用能、预算与能效，在同一视野下逐层分析。" />
    <DataError error={error} />
    <div className="kpi-grid">
      <KpiCard featured label={`${year} 年综合能耗`} value={data?.tce} unit="tce" digits={0} tone="energy" previous={annual(year - 1)?.tce} spark={monthly.map((row) => row.tce)} foot="同比上年 · 月度走势" />
      <KpiCard label="单位工业增加值能耗" value={intensity(year)} unit="tce/万元" digits={3} tone="info" previous={intensity(year - 1)} foot={indicator("I04") ? `能源产出率 ${fmt(indicator("I04")?.value, 2)} ${indicator("I04")?.unit || ""}` : "按可比价工业增加值计算"} delay={0.05} />
      <KpiCard label="可再生能源折标量" value={renewable} unit="tce" tone="accent" lowerIsBetter={false} foot={renewableShare != null ? `占综合能耗 ${fmt(renewableShare, 1)}%` : undefined} delay={0.1} />
      <KpiCard label="重点用能企业" value={chart?.ranking.length} unit="家" digits={0} tone="energy" foot={leader && data?.tce ? `${leader.name.replace(/（[^）]*）/g, "")} 占园区 ${fmt(leader.tce / data.tce * 100, 1)}%` : undefined} delay={0.15} />
    </div>

    {tabs}

    {tab === "consumption" && <>
      <div className="analysis-grid">
        <Panel className="analysis-main" title={`${year} 年月度综合能耗`} subtitle={`柱为 ${year} 年，虚线为 ${year - 1} 年同期；悬停查看同比`}>
          {monthly.length ? <YearCompareChart months={months} current={monthly.map((row) => row.tce)} previous={monthly.map((row) => lastYear.find((prev) => prev.month.slice(5) === row.month.slice(5))?.tce ?? null)} year={year} unit="tce" color={C.energy} label="月度综合能耗同比" /> : <Empty title="暂无月度数据" />}
        </Panel>
        <Panel className="analysis-side" title="能源消费结构" subtitle="各品种折标准煤后的量与占比">
          <CompositionCapsules rows={(chart?.structure || []).map((row) => ({ name: row.name, value: row.tce }))} unit="tce" />
        </Panel>
        <Panel className="analysis-main analysis-matrix" title="企业月度用能体检矩阵" subtitle="每格为企业一个月的综合能耗：可按同比上年或相对自身月均着色，悬停查看数值">
          <EnterpriseMatrix current={monthlyByYear[twinYears.indexOf(year)] ?? []} previous={prevMonthly} metric="tce" unit="tce" year={year} />
        </Panel>
        <Panel className="analysis-side analysis-ranking" title="重点用能企业" subtitle="能耗、园区占比与单位产值能耗（tce/万元）" action={<MoreLink href={`/energy?year=${year}&tab=intensity`}>能效对标</MoreLink>}>
          <ContributionList rows={(chart?.ranking || []).map((row) => ({ code: row.code, name: row.name.replace(/（[^）]*）/g, ""), value: row.tce, intensity: row.intensity }))} total={data?.tce} unit="tce" intensityUnit="tce/万元产值" tone="energy" />
        </Panel>
        <Panel className="analysis-wide" title="累计能耗与预算" subtitle="年度预算按季度、按月等额分配，与实际用量对比">
          <BudgetProgress data={extended} kind="energy" />
        </Panel>
        <Panel className="analysis-wide" title="能源利用指标" subtitle="《绿色工业园区评价要求》能源利用类指标：当前值与引领值">
          <IndicatorScales rows={board.filter((row) => ["I04", "I05", "I06"].includes(row.code))} year={year} columns={3} />
        </Panel>
      </div>
    </>}

    {tab === "renewable" && <div className="analysis-stack">
      <div className="analysis-grid balanced">
        <Panel title="各来源能源折标量" subtitle="按能源品种库的可再生属性与年度净消费量汇总">
          <MetricChart rows={(detail?.renewable || []).map((row) => ({ name: row.name, value: row.tce }))} unit="tce" label="各来源能源折标量" color={C.accent} />
        </Panel>
        <Panel className="view-fill" title="可再生能源指标" subtitle="可再生能源利用率：当前值与引领值，以及 2021 年以来的变化">
          <IndicatorScales rows={board.filter((row) => row.code === "I05")} year={year} columns={1} />
        </Panel>
      </div>
      <div className="analysis-grid balanced">
        <Panel title="可再生属性与用能来源">
          <div className="list">{detail?.renewable.map((row) => <div className="list-row" key={row.name}>
            <div><b>{row.name}</b><small>{row.renewable ? "可再生能源" : "常规能源"}</small></div>
            <div className="list-figure"><span className="num">{fmt(row.tce)}</span><small>tce</small>{row.renewable && <em className="chip-ok">可再生</em>}</div>
          </div>)}</div>
        </Panel>
        {extended?.storage.length ? <Panel className="view-fill" title="储能与充电月度电量">
          <div className="table-scroll"><table><thead><tr><th>月份</th><th className="num">储能充电 / kWh</th><th className="num">储能放电 / kWh</th><th className="num">充电桩电量 / kWh</th></tr></thead>
            <tbody>{extended.storage.map((row) => <tr key={row.month}><td>{row.month}</td><td className="num">{fmt(row.storage_charge_kwh)}</td><td className="num">{fmt(row.storage_discharge_kwh)}</td><td className="num">{fmt(row.ev_charge_kwh)}</td></tr>)}</tbody></table></div>
        </Panel> : null}
      </div>

    </div>}

    {tab === "intensity" && <div className="analysis-grid">
      <Panel className="analysis-main" title="企业综合能耗与单位产值能耗" subtitle="能耗单位 tce；单位产值能耗为 tce/万元产值。缺少产值的企业不填造强度。">{chart ? <RankingChart data={chart} /> : <Empty title="暂无数据" />}</Panel>
      <Panel className="analysis-side" title="能源强度指标" subtitle="能源产出率与单位产品能耗达标企业占比">
        <IndicatorScales rows={board.filter((row) => ["I04", "I06"].includes(row.code))} year={year} columns={1} />
      </Panel>
    </div>}

    {tab === "heat" && <div className="analysis-stack">
      <Panel className="panel-flush view-fill" title="园区能耗热力孪生" subtitle="点阵按各企业当月综合能耗与位置扩散建模，颜色越暖能耗越高；底部时间轴可逐月播放">
        {monthlyByYear.some((rows) => rows.length) ? <EnergyHeatTwin year={year} rowsByYear={Object.fromEntries(twinYears.map((y, i) => [y, monthlyByYear[i] ?? []]))} /> : <Empty title="暂无企业逐月能耗" />}
      </Panel>
    </div>}

    {tab === "flow" && <div className="analysis-stack">
      <Panel className="panel-flush view-fill" title="能流网络互动地图" subtitle="园区 → 产业片区 → 企业的供能关系；卡片显示能耗、占比与单位产值能耗，红色光罩为存在未处理预警的企业">
        <FlowNetworkMap mode="energy" year={year} parkTotal={data?.tce} mix={mix} nodes={(chart?.ranking || []).map((row) => ({ code: row.code, name: row.name, value: row.tce, intensity: row.intensity }))}
          alerts={(detail?.alerts || []).filter((row) => row.status === "open").map((row) => row.node)} />
      </Panel>
      <Panel className="view-fill" title="企业 → 厂区 → 产线能流" subtitle="桑基图按能源品种与计量单位分别绘制">
        {detail?.transfers.length ? <EnergyFlow rows={detail.transfers} /> : <Empty title="尚无内部转供记录" action={<MoreLink href={`/admin/data?year=${year}`}>查看数据接入</MoreLink>}>录入来源、去向与计量单位后，可按能源品种建立能流网络。</Empty>}
      </Panel>
      {!!detail?.transfers.length && <Panel className="view-fill" title="内部转供明细">
        <div className="table-scroll"><table><thead><tr><th>来源</th><th>去向</th><th>能源</th><th className="num">转供量</th></tr></thead>
          <tbody>{detail.transfers.map((row, index) => <tr key={index}><td>{row.source}</td><td>{row.target}</td><td>{row.energy}</td><td className="num">{fmt(row.quantity)} {row.unit}</td></tr>)}</tbody></table></div>
      </Panel>}
    </div>}
  </div>;
}
