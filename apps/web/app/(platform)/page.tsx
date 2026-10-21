import { charts, enterpriseMonthly, management, overview } from "@/lib/server";
import ParkSpatialOverview, { type MapEnterprise, type MapHonor } from "@/components/ParkSpatialOverview";
import { DataError } from "@/components/WorkspaceParts";
import { CarbonBrief, EmitterRanking, EnergyBrief, HonorShowcase, IndicatorBoard, type EmitterRow } from "@/components/OverviewBoards";
import { enterprises } from "@/lib/park-geography";
import { honorKind } from "@/lib/honors";
import { selectedYear } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/**
 * Full-screen park dashboard: the map fills the viewport; energy floats on the left (under the honour showcase)
 * and carbon on the right. Achieved indicators form a compact status marker over the map.
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ year?: string; enterprise?: string }> }) {
  const sp = await searchParams;
  // No year switch on the screen (latest year); ?year= still works for the voice assistant's switch_year.
  const year = selectedYear(sp.year);
  let data: Awaited<ReturnType<typeof overview>> | null = null;
  let chartData: Awaited<ReturnType<typeof charts>> | null = null;
  let detail: Awaited<ReturnType<typeof management>> | null = null;
  let error = "";
  let monthly: Awaited<ReturnType<typeof enterpriseMonthly>> = [], lastYear: Awaited<ReturnType<typeof enterpriseMonthly>> = [];
  try { [data, chartData, detail, monthly, lastYear] = await Promise.all([overview(year), charts(year), management(year), enterpriseMonthly(year), enterpriseMonthly(year - 1)]); }
  catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }

  const months = chartData?.monthly.filter((row) => row.month.startsWith(String(year))) || [];
  const annual = (y: number) => detail?.annual.find((row) => row.year === y);
  const intensity = (y: number) => { const row = annual(y); return row?.co2_t != null && row.value_added ? row.co2_t / row.value_added : null; };
  const co2 = new Map((detail?.carbonRanking || []).map((row) => [row.code, row.co2_t]));
  const metrics: MapEnterprise[] = (chartData?.ranking || []).map((row) => ({ code: row.code, name: row.name, tce: row.tce, co2_t: co2.get(row.code) ?? null }));
  const codeByName = new Map([...(chartData?.ranking || []), ...(detail?.carbonRanking || [])].map((row) => [row.name, row.code]));
  const honors: MapHonor[] = (data?.honors || []).flatMap((honor) => {
    const kind = honorKind(honor.title);
    return kind ? [{ code: codeByName.get(honor.node) ?? "", node: honor.node, title: honor.title, kind }] : [];
  });

  const sector = new Map(enterprises.map((feature) => [feature.properties.code, feature.properties.sector]));
  const emitters: EmitterRow[] = (detail?.carbonRanking || []).map((row) => ({
    code: row.code, name: row.name, sector: sector.get(row.code) ?? "", value: row.co2_t, intensity: row.intensity,
    previous: lastYear.filter((m) => m.code === row.code).reduce((sum, m) => sum + (m.co2_t ?? 0), 0) || null,
    monthly: Array.from({ length: 12 }, (_, i) => monthly.find((m) => m.code === row.code && Number(m.month.slice(5)) === i + 1)?.co2_t ?? null),
  }));

  const left = <>
    <div className="float-card"><HonorShowcase honors={honors} /></div>
    <div className="float-card"><EnergyBrief year={year} total={data?.tce} previous={annual(year - 1)?.tce} months={months.map((row) => row.tce)}
      structure={(chartData?.structure || []).map((row) => ({ name: row.name, value: row.tce }))}
      leaders={(chartData?.ranking || []).map((row) => ({ code: row.code, name: row.name, value: row.tce }))} /></div>
  </>;
  const right = <>
    <div className="float-card"><EmitterRanking year={year} total={data?.co2_t} rows={emitters} /></div>
    <div className="float-card"><CarbonBrief year={year} total={data?.co2_t} previous={annual(year - 1)?.co2_t} months={months.map((row) => row.co2_t)}
      intensity={intensity(year)} intensityPrev={intensity(year - 1)} perEnergy={data?.co2_t != null && data?.tce ? data.co2_t / data.tce : null}
      structure={(detail?.carbonStructure || []).map((row) => ({ name: row.name, value: row.co2_t }))} /></div>
  </>;

  return <div className="overview-screen">
    <DataError error={error} />
    <ParkSpatialOverview year={year} ranking={chartData?.ranking} metrics={metrics} honors={honors} initialEnterprise={sp.enterprise} left={left} right={right}
      assessment={data?.achieved.length ? <IndicatorBoard rows={data.achieved} year={year} /> : undefined} />
  </div>;
}
