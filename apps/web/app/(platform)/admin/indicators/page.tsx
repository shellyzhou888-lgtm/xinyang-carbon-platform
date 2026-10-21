import { inventory, indicatorConfiguration } from "@/lib/server";
import { selectedYear } from "@/lib/workspace";
import { AdminNavigation, DataError, PageHeading, Panel } from "@/components/WorkspaceParts";
import { LinkTabs } from "@/components/MotionParts";

export const dynamic = "force-dynamic";
const HANDLING: Record<string, string> = { deep_calc: "深算", calc: "计算", manual: "录入", self_proof: "平台自证" };

export default async function IndicatorManagement({ searchParams }: { searchParams: Promise<{ year?: string; version?: string }> }) {
  const sp = await searchParams, year = selectedYear(sp.year), versions = ["GIP_2024", "GIP_2025", "GIP_2026", "ZCP_2025"], version = versions.includes(sp.version || "") ? sp.version! : "GIP_2026";
  let data: Awaited<ReturnType<typeof inventory>> | null = null, rows: Awaited<ReturnType<typeof indicatorConfiguration>> = [], error = "";
  try { [data, rows] = await Promise.all([inventory(), indicatorConfiguration(version)]); } catch (reason) { error = reason instanceof Error ? reason.message : "请稍后重试"; }
  return <>
    <PageHeading eyebrow="INDICATOR SYSTEM" title="指标体系管理" description="按标准版本查看指标定义、公式审核状态与业务页面归属。" />
    <AdminNavigation active="indicators" year={year} />
    <DataError error={error} />
    {data && <LinkTabs id="standard" label="标准版本" active={version} items={data.standards.map((row) => ({ key: row.code, label: row.code, badge: row.indicators, href: `/admin/indicators?year=${year}&version=${row.code}` }))} />}
    <Panel title={data?.standards.find((row) => row.code === version)?.name || version} subtitle="前台按规则展示达标表现，指标配置在后台集中查看。此页只读，公式审核仍通过现有管理流程处理。">
      <div className="table-scroll"><table><thead><tr><th>编码</th><th>指标</th><th>单位</th><th>处理方式</th><th>公式 / 审核状态</th><th>展示位置</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.code}>
          <td className="muted">{row.code}</td><td>{row.name}</td><td className="muted">{row.unit || "—"}</td>
          <td><span className="chip">{HANDLING[row.handling] || row.handling}</span></td>
          <td>{row.formula || "—"}{row.formula_status && <small className={`table-subtext st-${row.formula_status}`}>{row.formula_status === "approved" ? "已审核" : row.formula_status === "draft" ? "草稿" : "已停用"}</small>}</td>
          <td className="muted">{row.display_enabled ? (row.display_position || "按页面规则") : "不展示"}</td>
        </tr>)}</tbody></table></div>
    </Panel>
  </>;
}
