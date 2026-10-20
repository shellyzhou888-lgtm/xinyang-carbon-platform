import Link from "next/link";
import { management, overview, carbonManagement } from "@/lib/server";
import { selectedYear,formatNumber as fmt } from "@/lib/workspace";
import { AchievedIndicators,DataError,DataNotice,Metric,PageHeading } from "@/components/WorkspaceParts";
import MetricChart from "@/components/MetricChart";
import { BudgetComparison,CarbonReferences } from "@/components/CarbonDataSections";

export const dynamic="force-dynamic";
export default async function Carbon({searchParams}:{searchParams:Promise<{year?:string;tab?:string}>}){
  const sp=await searchParams,year=selectedYear(sp.year),tab=sp.tab==="flow"?"flow":"analysis";
  let data:Awaited<ReturnType<typeof overview>>|null=null,detail:Awaited<ReturnType<typeof management>>|null=null,extended:Awaited<ReturnType<typeof carbonManagement>>|null=null,error="";
  try{[data,detail,extended]=await Promise.all([overview(year),management(year),carbonManagement(year)]);}catch(reason){error=reason instanceof Error?reason.message:"请稍后重试";}
  const intensity=data?.co2_t!=null&&data?.value_added_wan?data.co2_t/data.value_added_wan:null;
  return <><PageHeading eyebrow="CARBON MANAGEMENT" title="碳管理" description="以统一核算口径查看排放结构、企业贡献和碳强度。"/><DataNotice data={data} year={year}/><DataError error={error}/>
    <div className="workspace-toolbar"><nav className="workspace-tabs" aria-label="碳管理模块"><Link className={tab==="analysis"?"on":""} href={`/carbon?year=${year}`}>碳排放分析</Link><Link className={tab==="flow"?"on":""} href={`/carbon?year=${year}&tab=flow`}>碳流分析</Link></nav>
      <details className="accounting-rules"><summary>碳核算规则与边界</summary><div><h2>园区能源活动核算</h2><p>采用GIP_2026口径，按发改环资〔2025〕910号附件4计算，电力、热力按净受入处理；燃料以活动量及对应因子核算。原料用途与燃料用途分别处理。</p><p>空间地图中的企业分布面不作为核算边界；核算对象由数据库对象树和计入规则确定。自发可再生能源与外购绿电按已批准因子处理，不额外重复计入“抵消”。</p><Link href={`/admin/data?year=${year}`}>查看数据与因子库 ↗</Link></div></details></div>
    <div className="workspace-metrics"><Metric label="二氧化碳排放" value={data?.co2_t} unit="tCO₂"/><Metric label="单位工业增加值CO₂" value={intensity} unit="tCO₂/万元"/><Metric label="单位综合能耗CO₂" value={data?.co2_t!=null&&data.tce?data.co2_t/data.tce:null} unit="tCO₂/tce"/></div>
    <AchievedIndicators data={data} codes={["I17","I18","I19"]} title="碳排放达标表现"/>
    {tab==="analysis"&&<><BudgetComparison data={extended} kind="carbon"/><CarbonReferences data={extended}/></>}
    {tab==="analysis"?<><div className="workspace-two-col"><section className="section"><h2>近三年碳排放强度</h2><MetricChart rows={(detail?.annual||[]).map(row=>({name:String(row.year),value:row.co2_t!=null&&row.value_added?row.co2_t/row.value_added:null}))} kind="line" unit="tCO₂/万元" color="#f2b84b" label="年度碳强度"/></section><section className="section"><h2>{year} 年排放结构</h2><MetricChart rows={(detail?.carbonStructure||[]).map(row=>({name:row.name,value:row.co2_t}))} kind="pie" unit="tCO₂" color="#f2b84b" label="碳排放结构"/></section></div>
      <section className="section"><h2>企业碳排放贡献</h2><div className="table-scroll"><table><thead><tr><th>企业</th><th>排放量 / tCO₂</th><th>占园区总量</th><th>单位产值CO₂</th></tr></thead><tbody>{detail?.carbonRanking.map(row=><tr key={row.code}><td>{row.name}</td><td>{fmt(row.co2_t)}</td><td>{fmt(data?.co2_t?row.co2_t/data.co2_t*100:null)}%</td><td>{fmt(row.intensity,4)}</td></tr>)}</tbody></table></div></section></>:<section className="section"><h2>碳流与内部转供</h2><div className="workspace-empty"><strong>{detail?.transfers.length?"内部转供尚未关联独立排放因子":"尚无可闭合的碳流记录"}</strong><p>碳流需由对应能流、计量单位和因子逐项换算，现有排放结构可在“碳排放分析”查看。</p><Link href={`/energy?year=${year}&tab=flow`}>查看能流数据 ↗</Link></div></section>}
  </>;
}
