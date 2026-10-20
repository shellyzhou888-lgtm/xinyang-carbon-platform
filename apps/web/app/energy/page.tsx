import Link from "next/link";
import { charts, management, overview,carbonManagement } from "@/lib/server";
import { selectedYear, formatNumber as fmt } from "@/lib/workspace";
import { AchievedIndicators, DataError, DataNotice, Metric, PageHeading } from "@/components/WorkspaceParts";
import { StructureChart, RankingChart } from "@/components/EnergyCharts";
import MetricChart from "@/components/MetricChart";
import Energy3DPanel from "@/components/Energy3DPanel";
import { BudgetComparison } from "@/components/CarbonDataSections";
import EnergyFlow from "@/components/EnergyFlow";

export const dynamic = "force-dynamic";
export default async function Energy({searchParams}:{searchParams:Promise<{year?:string;tab?:string}>}) {
  const sp = await searchParams, year = selectedYear(sp.year);
  const tabs = [["consumption","能源消费"],["renewable","可再生能源"],["intensity","能源强度"],["flow","能流网络"]];
  const tab = tabs.some(([key])=>key===sp.tab)?sp.tab!:"consumption";
  let data:Awaited<ReturnType<typeof overview>>|null=null, chart:Awaited<ReturnType<typeof charts>>|null=null, detail:Awaited<ReturnType<typeof management>>|null=null,error="";
  let extended:Awaited<ReturnType<typeof carbonManagement>>|null=null;
  try{[data,chart,detail,extended]=await Promise.all([overview(year),charts(year),management(year),carbonManagement(year)]);}catch(reason){error=reason instanceof Error?reason.message:"请稍后重试";}
  const monthly=chart?.monthly.filter(row=>row.month.startsWith(String(year)))||[];
  const renewable=detail?.renewable.filter(row=>row.renewable).reduce((total,row)=>total+row.tce,0);
  return <><PageHeading eyebrow="ENERGY MANAGEMENT" title="能源管理" description="从消费结构到企业强度，逐层查看园区用能。"/><DataNotice data={data} year={year}/><DataError error={error}/>
    <nav className="workspace-tabs" aria-label="能源模块">{tabs.map(([key,label])=><Link key={key} href={`/energy?year=${year}&tab=${key}`} className={tab===key?"on":""}>{label}</Link>)}</nav>
    <div className="workspace-metrics"><Metric label="综合能耗" value={data?.tce} unit="tce"/><Metric label="能耗样本企业" value={chart?.ranking.length} unit="家"/><Metric label="可再生能源折标量" value={renewable} unit="tce"/></div>
    <AchievedIndicators data={data} codes={tab==="renewable"?["I05"]:tab==="intensity"?["I04","I06"]:["I04","I05","I06"]} title="能源利用达标表现"/>
    {tab==="consumption"&&<BudgetComparison data={extended} kind="energy"/>}
    {tab==="renewable"&&extended?.storage.length? <section className="section"><h2>储能与充电月度电量（模拟）</h2><div className="table-scroll"><table><thead><tr><th>月份</th><th>储能充电 / kWh</th><th>储能放电 / kWh</th><th>充电桩电量 / kWh</th></tr></thead><tbody>{extended.storage.map(row=><tr key={row.month}><td>{row.month}</td><td>{fmt(row.storage_charge_kwh)}</td><td>{fmt(row.storage_discharge_kwh)}</td><td>{fmt(row.ev_charge_kwh)}</td></tr>)}</tbody></table></div></section>:null}
    {tab==="flow"&&!!detail?.transfers.length&&<section className="section"><h2>企业 → 厂区 → 产线</h2><EnergyFlow rows={detail.transfers}/></section>}
    {tab==="consumption"&&<><div className="workspace-two-col"><section className="section"><h2>{year} 年月度综合能耗</h2><MetricChart rows={monthly.map(row=>({name:row.month.slice(5),value:row.tce}))} kind="line" unit="tce" label="月度综合能耗"/></section><section className="section"><h2>能源消费结构</h2>{chart?<StructureChart data={chart}/>:<p className="hint">暂无数据</p>}</section></div><section className="section"><h2>企业能耗空间对比</h2><Energy3DPanel year={year} ranking={chart?.ranking||[]}/></section></>}
    {tab==="renewable"&&<div className="workspace-two-col"><section className="section"><h2>各来源能源折标量</h2><MetricChart rows={(detail?.renewable||[]).map(row=>({name:row.name,value:row.tce}))} unit="tce" label="各来源能源折标量"/></section><section className="section"><h2>可再生属性与用能来源</h2><div className="table-scroll"><table><thead><tr><th>来源</th><th>折标量 / tce</th><th>能源属性</th></tr></thead><tbody>{detail?.renewable.map(row=><tr key={row.name}><td>{row.name}</td><td>{fmt(row.tce)}</td><td>{row.renewable?"可再生":"其他"}</td></tr>)}</tbody></table></div><p className="hint">按能源品种库的可再生属性与年度净消费量汇总。</p></section></div>}
    {tab==="intensity"&&<section className="section"><h2>企业综合能耗与单位产值能耗</h2>{chart?<RankingChart data={chart}/>:<p className="hint">暂无数据</p>}<p className="hint">能耗单位为tce；单位产值能耗为tce/万元产值。缺少产值的企业不填造强度。</p></section>}
    {tab==="flow"&&<section className="section"><h2>企业 / 厂区内部转供网络</h2>{detail?.transfers.length?<div className="table-scroll"><table><thead><tr><th>来源</th><th>去向</th><th>能源</th><th>转供量</th></tr></thead><tbody>{detail.transfers.map((row,index)=><tr key={index}><td>{row.source}</td><td>{row.target}</td><td>{row.energy}</td><td>{fmt(row.quantity)} {row.unit}</td></tr>)}</tbody></table></div>:<div className="workspace-empty"><strong>尚无内部转供记录</strong><p>录入来源、去向与计量单位后，可按能源品种建立能流网络。</p><Link href={`/admin/data?year=${year}`}>查看数据接入</Link></div>}</section>}
  </>;
}
