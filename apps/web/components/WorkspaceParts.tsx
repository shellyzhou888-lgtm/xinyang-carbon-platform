import Link from "next/link";
import type { ParkOverview } from "@xinyang/db-agent";
import { formatNumber as fmt } from "@/lib/workspace";

export function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="workspace-heading"><div className="map-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></header>;
}
export function DataNotice({ data, year }: { data: ParkOverview | null; year: number }) {
  return (data?.energy_estimated_share ?? 0) > 0 ? <div className="data-notice">{year} 年能耗含模拟估算数据，当前用于功能演示。<Link href={`/admin/data?year=${year}`}>查看数据来源 ↗</Link></div> : null;
}
export function DataError({ error }: { error: string }) {
  return error ? <div className="section error" role="status">数据暂不可用：{error}</div> : null;
}
export function Metric({ label, value, unit, hint }: { label: string; value: number | null | undefined; unit: string; hint?: string }) {
  return <div className="workspace-metric"><span>{label}</span><strong>{fmt(value)}<small>{unit}</small></strong>{hint && <p>{hint}</p>}</div>;
}
export function AchievedIndicators({ data, codes, title }: { data: ParkOverview | null; codes: string[]; title: string }) {
  const rows = data?.achieved.filter(row => codes.includes(row.code)) || [];
  if (!rows.length) return null;
  return <section className="section achieved-section"><h2>{title}</h2><div className="achieved-strip">{rows.map(row => <div key={row.code}><span className="tag">✓ 达标</span><span>{row.name}</span><strong>{fmt(row.value,4)} <small>{row.unit}</small></strong></div>)}</div></section>;
}
export function AdminNavigation({ active, year }: { active: "data" | "indicators" | "governance"; year: number }) {
  return <nav className="workspace-tabs" aria-label="后台模块">{[["data","数据管理","/admin/data"],["indicators","指标体系","/admin/indicators"],["governance","数据治理","/admin"]].map(([key,label,href]) => <Link key={key} className={active===key?"on":""} href={`${href}?year=${year}`}>{label}</Link>)}</nav>;
}
