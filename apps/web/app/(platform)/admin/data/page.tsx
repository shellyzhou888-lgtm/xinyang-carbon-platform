import { inventory } from "@/lib/server";
import { selectedYear, formatNumber as fmt } from "@/lib/workspace";
import { AdminNavigation, DataError, MoreLink, PageHeading, Panel } from "@/components/WorkspaceParts";
import { Reveal, Stat } from "@/components/MotionParts";

export const dynamic = "force-dynamic";
const SOURCES: Record<string, string> = { estimated: "测算值", manual: "手动录入", measured: "实测接入", interpolated: "插值补全" };
const FACTORS: Record<string, string> = { std_coal: "折标准煤系数", ncv: "低位发热量", co2_per_unit: "单位活动CO₂因子", co2_per_tj: "单位热值CO₂因子", carbon_content: "含碳量", oxidation_rate: "氧化率" };

export default async function DataManagement({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const year = selectedYear((await searchParams).year);
  let data: Awaited<ReturnType<typeof inventory>> | null = null, error = "";
  try { data = await inventory(); } catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }
  const records = data?.sources.reduce((total, row) => total + Number(row.records), 0) ?? null;
  const estimated = data?.sources.find((row) => row.source === "estimated")?.records ?? 0;
  const factors = data?.factors.reduce((total, row) => total + Number(row.records), 0) ?? null;

  return <>
    <PageHeading eyebrow="DATA MANAGEMENT" title="数据管理" description="集中查看数据接入、来源覆盖与核算因子，保持每项数据可追溯。" />
    <AdminNavigation active="data" year={year} />
    <DataError error={error} />
    <div className="stats-row">
      <Stat label="能源活动记录（当前版本）" value={records} unit="条" digits={0} tone="energy" />
      <Stat label="其中测算值" value={Number(estimated)} unit="条" digits={0} tone="carbon" hint="接入企业计量数据后按版本更新" delay={0.05} />
      <Stat label="核算因子" value={factors} unit="条" digits={0} tone="info" delay={0.1} />
      <Stat label="指标标准版本" value={data?.standards.length} unit="套" digits={0} delay={0.15} />
    </div>
    <div className="stack">
      <Reveal><Panel title="能源活动来源" subtitle="全量当前版本记录 · 不限所选统计年">
        <div className="table-scroll"><table><thead><tr><th>来源</th><th className="num">当前记录数</th><th>覆盖月份</th><th>使用说明</th></tr></thead>
          <tbody>{data?.sources.map((row) => <tr key={row.source}><td><span className={`tag ${row.source === "estimated" ? "est" : ""}`} style={{ marginLeft: 0 }}>{SOURCES[row.source] || row.source}</span></td><td className="num">{fmt(row.records, 0)}</td><td>{row.first_month} — {row.last_month}</td><td className="muted">{row.source === "estimated" ? "取得企业实测数据后替换" : "按原始凭据追溯"}</td></tr>)}</tbody></table></div>
      </Panel></Reveal>
      <div className="grid-2">
        <Reveal><Panel title="数据接入路径" action={<MoreLink href={`/admin?year=${year}`}>数据治理与语义审核</MoreLink>}>
          <div className="intake">
            <div className="intake-row"><span>01</span><div><b>手动导入</b><p>Excel 模板与导入工具按月入库，导入批次保留原始文件及来源。网页上传表单规划中。</p></div></div>
            <div className="intake-row"><span>02</span><div><b>API 接入</b><p>企业能管系统、电网及光伏监控按测点和对象编码接入；实时采集接口按企业逐步接入。</p></div></div>
            <div className="intake-row"><span>03</span><div><b>版本更新</b><p>测算值接入计量数据后按版本更新，保留历史版本和治理记录。</p></div></div>
          </div>
        </Panel></Reveal>
        <Reveal delay={0.06}><Panel title="核算因子库" subtitle="按类别汇总，适用年度与依据由计算引擎选择">
          <div className="list">{data?.factors.map((row) => <div className="list-row" key={row.kind}><div><b>{FACTORS[row.kind] || row.kind}</b><small>{row.kind}</small></div><div className="list-figure"><span className="num">{row.records}</span><small>条</small></div></div>)}</div>
        </Panel></Reveal>
      </div>
      <Reveal><Panel title="空间与建模资料" subtitle="26号文：围合 26.3429 km²、规划建设用地 15.5630 km²；正式界址坐标尚未取得。">
        <p className="panel-note" style={{ marginTop: 0 }}>4 个规划功能片区已初步定位并叠加于卫星地图，仍需独立控制点校核。ASTER GDEM V3（N32E114）已免费下载、裁剪并生成高程网格，仅作为备用地形资料；总览不加载 DEM 起伏，能耗与碳排放核算不依赖 DEM，它也不能代替园区界址、厂房模型或建筑高度数据。</p>
        <div className="resource-links"><a className="btn-ghost small" href="/geography/dem-manifest.json" download>DEM 处理记录</a><a className="btn-ghost small" href="/geography/dem-height-grid-wgs84.json" download>WGS84 高程网格</a><a className="btn-ghost small" href="https://www.henan.gov.cn/2023/07-06/2773998.html" target="_blank" rel="noreferrer">26号文原文</a></div>
        <img className="dem-preview" src="/geography/dem-elevation-preview.png" alt="园区周边56至191米高程的相对地形预览，并非卫星影像" />
      </Panel></Reveal>
    </div>
  </>;
}
