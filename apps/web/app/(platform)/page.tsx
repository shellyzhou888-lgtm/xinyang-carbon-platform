import { charts, overview } from "@/lib/server";
import ParkSpatialOverview from "@/components/ParkSpatialOverview";
import { Sparkline, TrendChart } from "@/components/EnergyCharts";
import { AchievedIndicators, DataError, DataNotice, Empty, MoreLink, Panel } from "@/components/WorkspaceParts";
import { CountUp, Reveal, Stat } from "@/components/MotionParts";
import { IconAward } from "@/components/icons";
import { selectedYear } from "@/lib/workspace";
import { C } from "@/lib/chart-theme";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ year?: string; enterprise?: string }> }) {
  const sp = await searchParams;
  const year = selectedYear(sp.year);
  let data: Awaited<ReturnType<typeof overview>> | null = null;
  let chartData: Awaited<ReturnType<typeof charts>> | null = null;
  let error = "";
  try { [data, chartData] = await Promise.all([overview(year), charts(year)]); }
  catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }
  const indicator = (code: string) => data?.achieved.find((row) => row.code === code);
  const months = chartData?.monthly.filter((row) => row.month.startsWith(String(year))) || [];
  const co2Intensity = data?.co2_t != null && data?.value_added_wan ? data.co2_t / data.value_added_wan : null;

  const energy = <>
    <div className="float-card">
      <div className="float-head"><span className="eyebrow tone-energy">能源 · ENERGY</span><MoreLink href={`/energy?year=${year}`}>能源管理</MoreLink></div>
      <div className="hero-figure"><span>{year} 年综合能耗</span><strong><CountUp value={data?.tce} /><small>tce</small></strong></div>
      {months.length > 0 && <Sparkline values={months.map((row) => row.tce)} color={C.energy} label={`${year}年月度综合能耗走势`} />}
      <div className="mini-stats">
        {indicator("I04") && <Stat label="能源产出率" value={indicator("I04")?.value} unit={indicator("I04")?.unit || ""} digits={2} tone="energy" achieved />}
        {indicator("I05") && <Stat label="可再生能源使用比例" value={indicator("I05")?.value} unit="%" digits={2} tone="energy" achieved />}
      </div>
    </div>
    <div className="float-card scroll">
      <AchievedIndicators compact data={data} codes={["I01", "I02", "I03", "I07", "I08", "I09", "I10", "I11", "I12", "I13", "I14", "I15"]} title="绿色发展亮点" />
    </div>
  </>;

  const carbon = <>
    <div className="float-card">
      <div className="float-head"><span className="eyebrow tone-carbon">碳排放 · CARBON</span><MoreLink href={`/carbon?year=${year}`}>碳管理</MoreLink></div>
      <div className="hero-figure"><span>{year} 年二氧化碳排放</span><strong><CountUp value={data?.co2_t} /><small>tCO₂</small></strong></div>
      {months.length > 0 && <Sparkline values={months.map((row) => row.co2_t)} color={C.carbon} label={`${year}年月度碳排放走势`} />}
      <div className="mini-stats">
        <Stat label="工业增加值" value={data?.value_added_wan} unit="万元" tone="neutral" />
        <Stat label="单位增加值 CO₂" value={indicator("I17")?.value ?? co2Intensity} unit={indicator("I17")?.unit || "tCO₂/万元"} digits={3} tone="carbon" achieved={!!indicator("I17")} />
      </div>
    </div>
    <div className="float-card scroll">
      <div className="float-head"><span className="eyebrow">绿色认证与荣誉</span><span className="achieved-count">{data?.honors.length ?? 0} 项</span></div>
      <div className="honor-list">
        {(data?.honors || []).slice(0, 8).map((honor, index) => <div className="honor" key={index}><span className="honor-icon"><IconAward /></span><div><b>{honor.title}</b><small>{honor.node}</small></div></div>)}
        {!data?.honors.length && <p className="panel-note">暂无认证记录</p>}
      </div>
    </div>
  </>;

  return <div className="overview">
    <div className="overview-head">
      <div><span className="eyebrow">PARK OVERVIEW · {year}</span><h1>信阳经济技术开发区 · 园区运行总览</h1></div>
      <div className="overview-flags"><DataNotice data={data} year={year} /></div>
    </div>
    <DataError error={error} />
    <ParkSpatialOverview year={year} ranking={chartData?.ranking} initialEnterprise={sp.enterprise} left={energy} right={carbon} />
    <div className="grid-main-side">
      <Reveal><Panel title="近三年月度能耗与碳排放" subtitle="左轴综合能耗（tce），右轴二氧化碳排放（tCO₂）" action={<MoreLink href={`/diagnosis?year=${year}&tab=forecast`}>查看预测</MoreLink>}>
        {chartData ? <TrendChart data={chartData} forecast={false} recentYears /> : <Empty title="暂无月度数据" />}
      </Panel></Reveal>
      <Reveal delay={0.08}><Panel title="绿色工业园区达标" subtitle="GIP_2026 指标体系">
        <div className="big-count"><strong><CountUp value={data?.indicators.achieved} digits={0} /></strong><span>项指标<br />已达到引领水平</span></div>
        <div className="chip-cloud">{(data?.achieved || []).slice(0, 8).map((row) => <span key={row.code} className="chip ok">{row.name}</span>)}</div>
        <p className="panel-note">2024 年获评河南省省级绿色工业园区，达标结果同步呈现在能源与碳管理页面。</p>
        <MoreLink href={`/admin/indicators?year=${year}`}>查看指标体系</MoreLink>
      </Panel></Reveal>
    </div>
  </div>;
}
