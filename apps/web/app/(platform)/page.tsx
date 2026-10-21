import { charts, management, overview } from "@/lib/server";
import ParkSpatialOverview, { type FlowEnterprise, type MapHonor } from "@/components/ParkSpatialOverview";
import { Sparkline } from "@/components/EnergyCharts";
import { DataError, MoreLink } from "@/components/WorkspaceParts";
import { CountUp, Stat } from "@/components/MotionParts";
import { EnterpriseRanking, HonorBoard, IndicatorBoard } from "@/components/OverviewBoards";
import { honorKind } from "@/lib/honors";
import { C } from "@/lib/chart-theme";
import { selectedYear } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** Full-screen park dashboard: the map fills the viewport and the energy, carbon and achievement panels float over it. */
export default async function Home({ searchParams }: { searchParams: Promise<{ year?: string; enterprise?: string }> }) {
  const sp = await searchParams;
  // No year switch on the screen (latest year); ?year= still works for the voice assistant's switch_year.
  const year = selectedYear(sp.year);
  let data: Awaited<ReturnType<typeof overview>> | null = null;
  let chartData: Awaited<ReturnType<typeof charts>> | null = null;
  let detail: Awaited<ReturnType<typeof management>> | null = null;
  let error = "";
  try { [data, chartData, detail] = await Promise.all([overview(year), charts(year), management(year)]); }
  catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }

  const indicator = (code: string) => data?.achieved.find((row) => row.code === code);
  const months = chartData?.monthly.filter((row) => row.month.startsWith(String(year))) || [];
  const co2Intensity = data?.co2_t != null && data?.value_added_wan ? data.co2_t / data.value_added_wan : null;

  // Enterprise flows: energy from the ranking, CO2 from the carbon ranking (same org_node codes).
  const co2 = new Map((detail?.carbonRanking || []).map((row) => [row.code, row.co2_t]));
  const flows: FlowEnterprise[] = (chartData?.ranking || []).map((row) => ({ code: row.code, name: row.name, tce: row.tce, co2_t: co2.get(row.code) ?? null, output_wan: row.output_wan }));
  const codeByName = new Map([...(chartData?.ranking || []), ...(detail?.carbonRanking || [])].map((row) => [row.name, row.code]));
  const honors: MapHonor[] = (data?.honors || []).flatMap((honor) => {
    const kind = honorKind(honor.title);
    return kind ? [{ code: codeByName.get(honor.node) ?? "", node: honor.node, title: honor.title, kind }] : [];
  });

  const left = <>
    <div className="float-card">
      <div className="float-head"><span className="eyebrow">园区能碳总量 · {year}</span><MoreLink href={`/energy?year=${year}`}>详情</MoreLink></div>
      <div className="twin-figure">
        <div className="hero-figure tone-energy"><span>综合能耗</span><strong><CountUp value={data?.tce} digits={0} /><small>tce</small></strong>
          {months.length > 0 && <Sparkline values={months.map((row) => row.tce)} color={C.energy} label={`${year}年月度综合能耗走势`} />}</div>
        <div className="hero-figure tone-carbon"><span>二氧化碳排放</span><strong><CountUp value={data?.co2_t} digits={0} /><small>tCO₂</small></strong>
          {months.length > 0 && <Sparkline values={months.map((row) => row.co2_t)} color={C.carbon} label={`${year}年月度碳排放走势`} />}</div>
      </div>
      <div className="mini-stats two">
        <Stat label="工业增加值" value={data?.value_added_wan} unit="万元" digits={0} tone="neutral" />
        <Stat label="单位增加值 CO₂" value={indicator("I17")?.value ?? co2Intensity} unit="t/万元" digits={3} tone="carbon" />
      </div>
    </div>
    <div className="float-card scroll"><EnterpriseRanking rows={flows} /></div>
  </>;

  const right = <>
    <div className="float-card scroll"><IndicatorBoard rows={data?.achieved || []} year={year} /></div>
    <div className="float-card"><HonorBoard honors={honors} /></div>
  </>;

  return <div className="overview-screen">
    <DataError error={error} />
    <ParkSpatialOverview year={year} ranking={chartData?.ranking} flows={flows} honors={honors} parkTotal={{ tce: data?.tce ?? null, co2_t: data?.co2_t ?? null }} initialEnterprise={sp.enterprise} left={left} right={right} />
  </div>;
}
