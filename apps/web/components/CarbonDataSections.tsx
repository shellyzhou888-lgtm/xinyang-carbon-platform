import type { CarbonManagementData } from "@xinyang/db-agent";
import { formatNumber as fmt } from "@/lib/workspace";
import ComparisonChart from "./ComparisonChart";

export function BudgetComparison({data,kind}:{data:CarbonManagementData|null;kind:"energy"|"carbon"}){
  const budget=data?.budget.find(row=>row.kind===kind),unit=kind==="energy"?"tce":"tCO₂";
  return <section className="section"><h2>累计{kind==="energy"?"能耗":"排放"}与预算</h2><p className="section-subtitle">预算为模拟目标，按月份等额分配；累计实际超过预算的月份在下表标红。模拟数据，仅供演示。</p>{budget?.annual_budget!=null?<><ComparisonChart labels={budget.months.map(row=>row.month.slice(5))} series={[{name:"累计实际（模拟）",values:budget.months.map(row=>row.cumulative),color:"#3ddc97"},{name:"累计预算（模拟）",values:budget.months.map(row=>row.budget_cumulative),color:"#f2b84b",dashed:true}]} unit={unit} label="累计实际与模拟预算比较"/><div className="budget-months">{budget.months.map(row=><span key={row.month} className={row.cumulative!=null&&row.budget_cumulative!=null&&row.cumulative>row.budget_cumulative?"over-budget":""}>{row.month.slice(5)}月 <b>{fmt(row.cumulative)}</b></span>)}</div><small className="muted">年度模拟预算 {fmt(budget.annual_budget)} {unit}</small></>:<div className="workspace-empty">本年度未录入预算</div>}</section>;
}

export function Roadmap({data}:{data:CarbonManagementData|null}){
  const roadmap=data?.roadmap,years=[...new Set([...(roadmap?.actual.map(row=>row.year)||[]),...(roadmap?.scenarios.flatMap(row=>row.points.map(point=>point.year))||[])])].sort();
  return <section className="section"><h2>碳达峰情景路线图</h2><p className="section-subtitle">历史值与策略参数均含模拟估值；情景用于演示，不代表正式达峰承诺。最新成功批次 {roadmap?.run_id||"—"}。</p>{roadmap?.scenarios.length?<><ComparisonChart labels={years.map(String)} unit="tCO₂" label="历史排放与基准、低碳情景路线图" series={[{name:"历史排放（含估值）",values:years.map(year=>roadmap.actual.find(row=>row.year===year)?.co2_t??null),color:"#9cbab3"},...roadmap.scenarios.map((scenario,index)=>({name:scenario.label||scenario.code,values:years.map(year=>scenario.points.find(row=>row.year===year)?.co2_t??null),color:index?"#3ddc97":"#f2b84b",dashed:true})),{name:"模拟达峰上限",values:years.map(year=>data?.targets.find(row=>row.kind==="carbon_peak_t"&&row.year===year)?.value??null),color:"#ef6f6c",dashed:true}]}/><div className="forecast-meta">{roadmap.scenarios.map(row=><span key={row.code}>{row.label||row.code}：{row.peak_year?`${row.peak_year}年峰值 ${fmt(row.peak_co2_t)} tCO₂`:"预测期内未达峰"}</span>)}</div></>:<div className="workspace-empty">暂无已发布的情景路线图</div>}</section>;
}

export function CarbonReferences({data}:{data:CarbonManagementData|null}){
  return <div className="workspace-two-col"><section className="section"><h2>碳市场行情</h2>{data?.carbon_price.some(row=>row.latest)?data.carbon_price.map(row=><p key={row.market}>{row.name}：{fmt(row.latest?.price,2)} 元/t · {row.latest?.date||"暂无行情数据"}</p>):<p className="workspace-empty">暂无行情数据，待接入官方交易记录</p>}</section><section className="section"><h2>产品碳足迹参考</h2>{data?.footprint_refs.length?data.footprint_refs.map((row,index)=><p key={index}>{row.product} · {fmt(row.value,4)} {row.unit} / {row.functional_unit}<span className="tag">{row.status==="draft"?"待审核":"参考值"}</span><small className="table-subtext">{row.boundary} · {row.source}</small></p>):<p className="workspace-empty">暂无参考数据，待补充产品功能单位、边界与来源</p>}</section></div>;
}
