import { inventory, indicatorConfiguration } from "@/lib/server";
import { selectedYear } from "@/lib/workspace";
import { AdminNavigation, DataError, PageHeading, Panel } from "@/components/WorkspaceParts";
import { LinkTabs } from "@/components/MotionParts";

export const dynamic = "force-dynamic";
const HANDLING: Record<string, string> = { deep_calc: "深算", calc: "计算", manual: "录入", self_proof: "平台自证" };

export default async function IndicatorManagement({ searchParams }: { searchParams: Promise<{ year?: string; version?: string }> }) {
  const sp = await searchParams, year = selectedYear(sp.year), versions = ["GIP_2024", "GIP_2025", "GIP_2026", "ZCP_2025"], version = versions.includes(sp.version || "") ? sp.version! : "GIP_2026";
  let data: Awaited<ReturnType<typeof inventory>> | null = null, rows: Awaited<ReturnType<typeof indicatorConfiguration>> = [], error = "";
  try { [data, rows] = await Promise.all([inventory(), indicatorConfiguration(version, year)]); } catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }
  return <>
    <PageHeading eyebrow="INDICATOR SYSTEM" title="指标体系管理" description={`按标准版本查看 ${year} 年园区指标实绩与达标情况。`} />
    <AdminNavigation active="indicators" year={year} />
    <DataError error={error} />
    {data && <LinkTabs id="standard" label="标准版本" active={version} items={data.standards.map((row) => ({ key: row.code, label: row.code, badge: row.indicators, href: `/admin/indicators?year=${year}&version=${row.code}` }))} />}
    <Panel title={data?.standards.find((row) => row.code === version)?.name || version} subtitle="达标状态依据当前年度园区指标测算值；缺少测算值时显示待测算。">
      <div className="table-scroll"><table><thead><tr><th>编码</th><th>指标</th><th>单位</th><th>处理方式</th><th>实绩 / 引领值</th><th>是否达标</th><th>展示位置</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.code}>
          <td className="muted">{row.code}</td><td>{row.name}</td><td className="muted">{row.unit || "—"}</td>
          <td><span className="chip">{HANDLING[row.handling] || row.handling}</span></td>
          <td className="num">{row.value == null ? "—" : row.value.toLocaleString("zh-CN", { maximumFractionDigits: 3 })}{row.benchmark != null && <small className="table-subtext">{row.comparator || ""} {row.benchmark}</small>}</td>
          <td><span className={`chip ${row.achieved === true ? "chip-ok" : row.achieved === false ? "chip-bad" : ""}`}>{row.achieved === true ? "已达标" : row.achieved === false ? "未达标" : "待测算"}</span></td>
          <td className="muted">{row.display_enabled ? (row.display_position || "按页面规则") : "不展示"}</td>
        </tr>)}</tbody></table></div>
    </Panel>
  </>;
}
