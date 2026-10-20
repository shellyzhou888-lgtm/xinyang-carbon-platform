import Link from "next/link";
import { inventory } from "@/lib/server";
import { selectedYear,formatNumber as fmt } from "@/lib/workspace";
import { AdminNavigation,DataError,PageHeading } from "@/components/WorkspaceParts";
export const dynamic="force-dynamic";
const SOURCES:Record<string,string>={estimated:"模拟估值",manual:"手动录入",measured:"实测接入",interpolated:"插值补全"};
export default async function DataManagement({searchParams}:{searchParams:Promise<{year?:string}>}){
  const year=selectedYear((await searchParams).year);
  let data:Awaited<ReturnType<typeof inventory>>|null=null,error="";
  try{data=await inventory();}catch(reason){error=reason instanceof Error?reason.message:"请稍后重试";}
  return <><PageHeading eyebrow="DATA MANAGEMENT" title="数据管理" description="集中查看数据接入、来源覆盖与核算因子，保持每项数据可追溯。"/><AdminNavigation active="data" year={year}/><DataError error={error}/>
    <section className="section"><div className="section-heading"><h2>能源活动来源</h2><span className="muted">全量当前版本记录 · 不限所选统计年</span></div><div className="table-scroll"><table><thead><tr><th>来源</th><th>当前记录数</th><th>覆盖月份</th><th>使用说明</th></tr></thead><tbody>{data?.sources.map(row=><tr key={row.source}><td><span className={`tag ${row.source==="estimated"?"est":""}`}>{SOURCES[row.source]||row.source}</span></td><td>{fmt(row.records,0)}</td><td>{row.first_month}—{row.last_month}</td><td>{row.source==="estimated"?"取得企业实测数据后替换":"按原始凭据追溯"}</td></tr>)}</tbody></table></div></section>
    <div className="workspace-two-col"><section className="section"><h2>数据接入路径</h2><div className="intake-row"><b>01 手动导入</b><p>现有Excel模板与导入工具支持按月入库，导入批次保留原始文件及来源。网页上传表单尚未开放。</p></div><div className="intake-row"><b>02 API接入</b><p>企业能管系统、电网及光伏监控按测点和对象编码接入；目前尚未接通实时采集接口。</p></div><div className="intake-row"><b>03 估值替换</b><p>模拟记录保持估值标记，替换时保留历史版本和治理记录。</p></div><Link href={`/admin?year=${year}`}>进入数据治理与语义审核 ↗</Link></section>
      <section className="section"><h2>核算因子库</h2><p className="section-subtitle">当前入库因子按类别汇总，具体适用年度和依据由计算引擎选择。</p><table><thead><tr><th>因子类别</th><th>记录数</th></tr></thead><tbody>{data?.factors.map(row=><tr key={row.kind}><td>{{std_coal:"折标准煤系数",ncv:"低位发热量",co2_per_unit:"单位活动CO₂因子",co2_per_tj:"单位热值CO₂因子",carbon_content:"含碳量",oxidation_rate:"氧化率"}[row.kind]||row.kind}</td><td>{row.records}</td></tr>)}</tbody></table></section></div>
    <section className="section"><h2>空间与建模资料</h2><p className="section-subtitle">26号文：围合26.3429km²、规划建设用地15.5630km²；正式界址坐标尚未取得。4个规划功能片区已初步定位并叠加于卫星地图，仍需独立控制点校核。</p><div className="data-resource-links"><a href="/geography/dem-manifest.json" download>免费DEM处理记录 ↓</a><a href="/geography/dem-height-grid-wgs84.json" download>WGS84高程网格 ↓</a><a href="https://www.henan.gov.cn/2023/07-06/2773998.html" target="_blank" rel="noreferrer">26号文原文 ↗</a></div><p className="hint">ASTER GDEM V3（N32E114）已免费下载、裁剪并生成高程网格。原始30米栅格保存在本机storage；网页网格每3个原像元取样，不能解释成建筑高度。目前尚未挂载三维地形，卫星定位使用高德在线影像。DEM后续可提供地形起伏及坡度分析基础；当前页面只是高程资料预览，能耗与碳排放核算未使用DEM。它不能代替园区界址、厂房模型或建筑高度数据。</p><img className="dem-preview" src="/geography/dem-elevation-preview.png" alt="园区周边56至191米高程的相对地形预览，并非卫星影像"/></section>
  </>;
}
