import Link from "next/link";
import { charts, overview } from "@/lib/server";
import ParkSpatialOverview from "@/components/ParkSpatialOverview";
import { TrendChart } from "@/components/EnergyCharts";
import { AchievedIndicators, DataError, DataNotice, Metric, PageHeading } from "@/components/WorkspaceParts";
import { selectedYear, formatNumber as fmt } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ year?: string; enterprise?: string }> }) {
  const sp=await searchParams;
  const year = selectedYear(sp.year);
  let data: Awaited<ReturnType<typeof overview>> | null = null;
  let chartData: Awaited<ReturnType<typeof charts>> | null = null;
  let error = "";
  try { [data, chartData] = await Promise.all([overview(year), charts(year)]); }
  catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }
  const indicator = (code: string) => data?.achieved.find(row => row.code === code);
  return <>
    <PageHeading eyebrow="PARK OVERVIEW" title="园区运行总览" description="以园区空间为中心，查看能源、碳排放与绿色发展态势。" />
    <DataNotice data={data} year={year} /><DataError error={error} />
    <AchievedIndicators data={data} codes={["I01","I02","I03","I07","I08","I09","I10","I11","I12","I13","I14","I15"]} title="绿色发展亮点" />
    <div className="overview-map-grid">
      <section className="overview-side energy-side"><div className="side-section-label">能源 / ENERGY</div>
        <Metric label="综合能耗" value={data?.tce} unit="tce" />
        {indicator("I04") && <Metric label="能源产出率 ✓" value={indicator("I04")?.value} unit={indicator("I04")?.unit || ""} />}
        {indicator("I05") && <Metric label="可再生能源利用率 ✓" value={indicator("I05")?.value} unit="%" />}
        <Link className="workspace-more" href={`/energy?year=${year}`}>进入能源管理 ↗</Link>
      </section>
      <ParkSpatialOverview year={year} ranking={chartData?.ranking} compact initialEnterprise={sp.enterprise} />
      <section className="overview-side carbon-side"><div className="side-section-label">碳 / CARBON</div>
        <Metric label="二氧化碳排放" value={data?.co2_t} unit="tCO₂" />
        <Metric label="工业增加值" value={data?.value_added_wan} unit="万元" />
        {indicator("I17") && <Metric label="单位增加值CO₂ ✓" value={indicator("I17")?.value} unit={indicator("I17")?.unit || ""} />}
        <Link className="workspace-more" href={`/carbon?year=${year}`}>进入碳管理 ↗</Link>
      </section>
    </div>
    <div className="overview-lower"><section className="section"><div className="section-heading"><h2>近三年月度能耗与碳排放</h2><Link href={`/diagnosis?year=${year}&tab=forecast`}>查看预测 ↗</Link></div>
      {chartData ? <TrendChart data={chartData} forecast={false} recentYears /> : <p className="hint">暂无月度数据</p>}</section>
      <section className="section overview-honors"><h2>绿色认证与荣誉</h2><p className="section-subtitle">园区与企业公开认证记录</p>
        {(data?.honors || []).slice(0,6).map((honor,index) => <div className="honor-line" key={index}><span>✦</span><div><b>{honor.node}</b><small>{honor.title}</small></div></div>)}
        {!data?.honors.length && <p className="hint">暂无认证记录</p>}
        <span className="overview-achieved">已达标指标 <b>{fmt(data?.indicators.achieved,0)}</b> / {fmt(data?.indicators.total,0)}</span>
      </section></div>
  </>;
}
