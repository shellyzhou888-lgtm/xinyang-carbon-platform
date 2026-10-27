import type { DiagnosisLoop } from "@xinyang/db-agent";
import { formatNumber as fmt } from "@/lib/workspace";
import { Empty, MoreLink } from "./WorkspaceParts";

/** Reuse the diagnosis strategies so measures and estimates agree across both entrances. */
export default function CarbonReductionActions({ loop, year }: { loop: DiagnosisLoop | null; year: number }) {
  const rows = [...(loop?.strategies ?? [])].sort((a, b) => b.co2Reduction - a.co2Reduction);
  if (!rows.length) return <Empty title="本年度暂无企业减排措施" action={<MoreLink href={`/diagnosis?year=${year}&tab=strategy`}>查看策略生成</MoreLink>}>根据诊断问题匹配企业适用措施后展示。</Empty>;
  return <div className="reduction-actions">
    <div className="reduction-summary"><span><b className="num">{rows.length}</b> 项措施</span><span><b className="num">{new Set(rows.map(row => row.enterprise)).size}</b> 家企业</span></div>
    <ol aria-label="企业减排措施清单">{rows.map(row => <li key={`${row.enterprise}-${row.code}`}>
      <header><b>{row.name}</b><span>预计减排</span></header>
      <div className="reduction-action-main"><span>{row.enterpriseName.replace(/（[^）]*）/g, "")}</span><strong className="num">{fmt(row.co2Reduction, 0)}<small> tCO₂/年</small></strong></div>
      {row.tceSaving != null && <p>预计节能 {fmt(row.tceSaving, 0)} tce/年</p>}
      <details><summary>问题与测算依据</summary><p>{row.findings.join("；")}</p><p>{row.method}</p><p>{row.basis}</p></details>
    </li>)}</ol>
    <p className="panel-note">基于诊断问题和策略参数估算，需按企业工况核实；预计减排量不代表已完成减排。</p>
  </div>;
}
