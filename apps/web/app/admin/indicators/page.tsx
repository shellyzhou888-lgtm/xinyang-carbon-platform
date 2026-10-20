import Link from "next/link";
import { inventory,indicatorConfiguration } from "@/lib/server";
import { selectedYear } from "@/lib/workspace";
import { AdminNavigation,DataError,PageHeading } from "@/components/WorkspaceParts";
export const dynamic="force-dynamic";
export default async function IndicatorManagement({searchParams}:{searchParams:Promise<{year?:string;version?:string}>}){
  const sp=await searchParams,year=selectedYear(sp.year),versions=["GIP_2024","GIP_2025","GIP_2026","ZCP_2025"],version=versions.includes(sp.version||"")?sp.version!:"GIP_2026";
  let data:Awaited<ReturnType<typeof inventory>>|null=null,rows:Awaited<ReturnType<typeof indicatorConfiguration>>=[],error="";
  try{[data,rows]=await Promise.all([inventory(),indicatorConfiguration(version)]);}catch(reason){error=reason instanceof Error?reason.message:"请稍后重试";}
  return <><PageHeading eyebrow="INDICATOR SYSTEM" title="指标体系管理" description="按标准版本查看指标定义、公式审核状态与业务页面归属。"/><AdminNavigation active="indicators" year={year}/><DataError error={error}/>
    <nav className="workspace-tabs" aria-label="标准版本">{data?.standards.map(row=><Link key={row.code} href={`/admin/indicators?year=${year}&version=${row.code}`} className={version===row.code?"on":""}>{row.code} · {row.indicators}项</Link>)}</nav>
    <section className="section"><h2>{data?.standards.find(row=>row.code===version)?.name||version}</h2><p className="section-subtitle">前台按规则展示达标表现，指标配置在后台集中查看。此页只读，公式审核仍通过现有管理流程处理。</p><div className="table-scroll"><table><thead><tr><th>编码</th><th>指标</th><th>单位</th><th>处理方式</th><th>公式 / 审核状态</th><th>展示位置</th></tr></thead><tbody>{rows.map(row=><tr key={row.code}><td>{row.code}</td><td>{row.name}</td><td>{row.unit||"—"}</td><td>{{deep_calc:"深算",calc:"计算",manual:"录入",self_proof:"平台自证"}[row.handling]||row.handling}</td><td>{row.formula||"—"}{row.formula_status&&<small className="table-subtext">{row.formula_status==="approved"?"已审核":row.formula_status==="draft"?"草稿":"已停用"}</small>}</td><td>{row.display_enabled?(row.display_position||"按页面规则"):"不展示"}</td></tr>)}</tbody></table></div></section>
  </>;
}
