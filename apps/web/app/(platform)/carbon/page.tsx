import { management, overview, carbonManagement } from "@/lib/server";
import { selectedYear, formatNumber as fmt } from "@/lib/workspace";
import { AchievedIndicators, DataError, DataNotice, Empty, Metric, MoreLink, PageHeading, Panel } from "@/components/WorkspaceParts";
import { LinkTabs, Reveal } from "@/components/MotionParts";
import MetricChart from "@/components/MetricChart";
import { BudgetComparison, CarbonReferences } from "@/components/CarbonDataSections";
import { C } from "@/lib/chart-theme";

export const dynamic = "force-dynamic";

export default async function Carbon({ searchParams }: { searchParams: Promise<{ year?: string; tab?: string }> }) {
  const sp = await searchParams, year = selectedYear(sp.year), tab = sp.tab === "flow" ? "flow" : "analysis";
  let data: Awaited<ReturnType<typeof overview>> | null = null, detail: Awaited<ReturnType<typeof management>> | null = null, extended: Awaited<ReturnType<typeof carbonManagement>> | null = null, error = "";
  try { [data, detail, extended] = await Promise.all([overview(year), management(year), carbonManagement(year)]); } catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }
  const intensity = data?.co2_t != null && data?.value_added_wan ? data.co2_t / data.value_added_wan : null;
  const perEnergy = data?.co2_t != null && data?.tce ? data.co2_t / data.tce : null;
  const top = detail?.carbonRanking[0]?.co2_t || 1;

  return <>
    <PageHeading eyebrow="CARBON MANAGEMENT" title="碳管理" description="以统一核算口径查看排放结构、企业贡献和碳强度。">
      <DataNotice data={data} year={year} />
      <details className="rules"><summary>核算规则与边界</summary><div>
        <h3>园区能源活动核算</h3>
        <p>采用 GIP_2026 口径，按发改环资〔2025〕910号附件4计算；电力、热力按净受入处理，燃料以活动量及对应因子核算，原料用途与燃料用途分别处理。</p>
        <p>空间地图中的企业分布不作为核算边界；核算对象由数据库对象树和计入规则确定。自发可再生能源与外购绿电按已批准因子处理，不额外重复计入“抵消”。</p>
        <MoreLink href={`/admin/data?year=${year}`}>数据与因子库</MoreLink>
      </div></details>
    </PageHeading>
    <DataError error={error} />
    <div className="stats-row">
      <Metric label={`${year} 年二氧化碳排放`} value={data?.co2_t} unit="tCO₂" tone="carbon" />
      <Metric label="单位工业增加值 CO₂" value={intensity} unit="tCO₂/万元" digits={3} tone="carbon" delay={0.05} />
      <Metric label="单位综合能耗 CO₂" value={perEnergy} unit="tCO₂/tce" digits={3} tone="info" delay={0.1} />
      <Metric label="工业增加值" value={data?.value_added_wan} unit="万元" delay={0.15} />
    </div>
    <LinkTabs id="carbon" label="碳管理模块" active={tab} items={[{ key: "analysis", label: "碳排放分析", href: `/carbon?year=${year}` }, { key: "flow", label: "碳流分析", href: `/carbon?year=${year}&tab=flow` }]} />

    {tab === "analysis" ? <div className="stack">
      <div className="grid-2">
        <Reveal><Panel title="近三年碳排放强度" subtitle="单位工业增加值二氧化碳排放，持续下降为基本要求">
          <MetricChart rows={(detail?.annual || []).map((row) => ({ name: String(row.year), value: row.co2_t != null && row.value_added ? row.co2_t / row.value_added : null }))} kind="line" unit="tCO₂/万元" color={C.carbon} label="年度碳强度" />
        </Panel></Reveal>
        <Reveal delay={0.06}><Panel title={`${year} 年排放结构`} subtitle="按能源品种分解">
          <MetricChart rows={(detail?.carbonStructure || []).map((row) => ({ name: row.name, value: row.co2_t }))} kind="pie" unit="tCO₂" color={C.carbon} label="碳排放结构" />
        </Panel></Reveal>
      </div>
      <Reveal><Panel title="企业碳排放贡献" subtitle="按排放量排序；单位产值 CO₂ 缺少产值时留空">
        <div className="table-scroll"><table><thead><tr><th>企业</th><th>贡献</th><th className="num">排放量 / tCO₂</th><th className="num">占园区总量</th><th className="num">单位产值 CO₂</th></tr></thead>
          <tbody>{detail?.carbonRanking.map((row) => <tr key={row.code}>
            <td>{row.name}</td>
            <td style={{ width: "28%" }}><div className="rank-bar"><i style={{ width: `${Math.max(2, row.co2_t / top * 100)}%` }} /></div></td>
            <td className="num">{fmt(row.co2_t)}</td><td className="num">{fmt(data?.co2_t ? row.co2_t / data.co2_t * 100 : null)}%</td><td className="num">{fmt(row.intensity, 4)}</td>
          </tr>)}</tbody></table></div>
      </Panel></Reveal>
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
