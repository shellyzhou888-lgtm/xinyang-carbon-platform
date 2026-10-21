import { charts, management, overview, carbonManagement } from "@/lib/server";
import { selectedYear, formatNumber as fmt } from "@/lib/workspace";
import { AchievedIndicators, DataError, DataNotice, Empty, Metric, MoreLink, PageHeading, Panel } from "@/components/WorkspaceParts";
import { LinkTabs, Reveal } from "@/components/MotionParts";
import { StructureChart, RankingChart } from "@/components/EnergyCharts";
import MetricChart from "@/components/MetricChart";
import Energy3DPanel from "@/components/Energy3DPanel";
import { BudgetComparison } from "@/components/CarbonDataSections";
import EnergyFlow from "@/components/EnergyFlow";
import { C } from "@/lib/chart-theme";

export const dynamic = "force-dynamic";

const TABS = [["consumption", "能源消费"], ["renewable", "可再生能源"], ["intensity", "能源强度"], ["flow", "能流网络"]] as const;

export default async function Energy({ searchParams }: { searchParams: Promise<{ year?: string; tab?: string }> }) {
  const sp = await searchParams, year = selectedYear(sp.year);
  const tab = TABS.some(([key]) => key === sp.tab) ? sp.tab! : "consumption";
  let data: Awaited<ReturnType<typeof overview>> | null = null, chart: Awaited<ReturnType<typeof charts>> | null = null, detail: Awaited<ReturnType<typeof management>> | null = null, error = "";
  let extended: Awaited<ReturnType<typeof carbonManagement>> | null = null;
  try { [data, chart, detail, extended] = await Promise.all([overview(year), charts(year), management(year), carbonManagement(year)]); } catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }
  const monthly = chart?.monthly.filter((row) => row.month.startsWith(String(year))) || [];
  const renewable = detail?.renewable.filter((row) => row.renewable).reduce((total, row) => total + row.tce, 0);
  const renewableShare = renewable != null && data?.tce ? renewable / data.tce * 100 : null;
  const indicator = (code: string) => data?.achieved.find((row) => row.code === code);

  return <>
    <PageHeading eyebrow="ENERGY MANAGEMENT" title="能源管理" description="从消费结构到企业强度，逐层查看园区用能。"><DataNotice data={data} year={year} /></PageHeading>
    <DataError error={error} />
    <div className="stats-row">
      <Metric label={`${year} 年综合能耗`} value={data?.tce} unit="tce" tone="energy" />
      <Metric label="可再生能源折标量" value={renewable} unit="tce" tone="accent" hint={renewableShare != null ? `占综合能耗 ${fmt(renewableShare, 1)}%` : undefined} delay={0.05} />
      {indicator("I04") && <Metric label="能源产出率" value={indicator("I04")?.value} unit={indicator("I04")?.unit || ""} digits={2} tone="info" achieved delay={0.1} />}
      <Metric label="能耗样本企业" value={chart?.ranking.length} unit="家" digits={0} delay={0.15} hint="已关联月度能耗台账" />
    </div>
    <LinkTabs id="energy" label="能源模块" active={tab} items={TABS.map(([key, label]) => ({ key, label, href: `/energy?year=${year}&tab=${key}` }))} />

    {tab === "consumption" && <div className="stack">
      <div className="grid-main-side" style={{ marginTop: 0 }}>
        <Reveal><Panel title={`${year} 年月度综合能耗`} subtitle="按月汇总园区核算边界内的净消费量">
          <MetricChart rows={monthly.map((row) => ({ name: `${Number(row.month.slice(5))}月`, value: row.tce }))} kind="line" unit="tce" label="月度综合能耗" />
        </Panel></Reveal>
        <Reveal delay={0.06}><Panel title="能源消费结构" subtitle="各品种折标准煤后的占比">{chart ? <StructureChart data={chart} /> : <Empty title="暂无数据" />}</Panel></Reveal>
      </div>
      <Reveal><BudgetComparison data={extended} kind="energy" /></Reveal>
      <Reveal><Panel title="企业能耗空间对比" subtitle="ECharts-GL 三维柱图，点击柱体查看企业"><Energy3DPanel year={year} ranking={chart?.ranking || []} /></Panel></Reveal>
      <AchievedIndicators data={data} codes={["I04", "I05", "I06"]} title="能源利用达标表现" />
    </div>}

    {tab === "renewable" && <div className="stack">
      <div className="grid-2">
        <Reveal><Panel title="各来源能源折标量" subtitle="按能源品种库的可再生属性与年度净消费量汇总">
          <MetricChart rows={(detail?.renewable || []).map((row) => ({ name: row.name, value: row.tce }))} unit="tce" label="各来源能源折标量" color={C.accent} />
        </Panel></Reveal>
        <Reveal delay={0.06}><Panel title="可再生属性与用能来源">
          <div className="list">{detail?.renewable.map((row) => <div className="list-row" key={row.name}>
            <div><b>{row.name}</b><small>{row.renewable ? "可再生能源" : "常规能源"}</small></div>
            <div className="list-figure"><span className="num">{fmt(row.tce)}</span><small>tce</small>{row.renewable && <em className="chip-ok">可再生</em>}</div>
          </div>)}</div>
        </Panel></Reveal>
      </div>
      {extended?.storage.length ? <Reveal><Panel title="储能与充电月度电量" subtitle="模拟数据，仅供演示">
        <div className="table-scroll"><table><thead><tr><th>月份</th><th className="num">储能充电 / kWh</th><th className="num">储能放电 / kWh</th><th className="num">充电桩电量 / kWh</th></tr></thead>
          <tbody>{extended.storage.map((row) => <tr key={row.month}><td>{row.month}</td><td className="num">{fmt(row.storage_charge_kwh)}</td><td className="num">{fmt(row.storage_discharge_kwh)}</td><td className="num">{fmt(row.ev_charge_kwh)}</td></tr>)}</tbody></table></div>
      </Panel></Reveal> : null}
      <AchievedIndicators data={data} codes={["I05"]} title="可再生能源达标表现" />
    </div>}

    {tab === "intensity" && <div className="stack">
      <Reveal><Panel title="企业综合能耗与单位产值能耗" subtitle="能耗单位 tce；单位产值能耗为 tce/万元产值。缺少产值的企业不填造强度。">{chart ? <RankingChart data={chart} /> : <Empty title="暂无数据" />}</Panel></Reveal>
      <AchievedIndicators data={data} codes={["I04", "I06"]} title="能源强度达标表现" />
    </div>}

    {tab === "flow" && <div className="stack">
      <Reveal><Panel title="企业 → 厂区 → 产线能流" subtitle="桑基图按能源品种与计量单位分别绘制">
        {detail?.transfers.length ? <EnergyFlow rows={detail.transfers} /> : <Empty title="尚无内部转供记录" action={<MoreLink href={`/admin/data?year=${year}`}>查看数据接入</MoreLink>}>录入来源、去向与计量单位后，可按能源品种建立能流网络。</Empty>}
      </Panel></Reveal>
      {!!detail?.transfers.length && <Reveal><Panel title="内部转供明细">
        <div className="table-scroll"><table><thead><tr><th>来源</th><th>去向</th><th>能源</th><th className="num">转供量</th></tr></thead>
          <tbody>{detail.transfers.map((row, index) => <tr key={index}><td>{row.source}</td><td>{row.target}</td><td>{row.energy}</td><td className="num">{fmt(row.quantity)} {row.unit}</td></tr>)}</tbody></table></div>
      </Panel></Reveal>}
    </div>}
  </>;
}
