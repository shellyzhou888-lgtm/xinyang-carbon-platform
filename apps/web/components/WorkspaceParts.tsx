import Link from "next/link";
import type { ParkOverview } from "@xinyang/db-agent";
import { formatNumber as fmt } from "@/lib/workspace";
import { LinkTabs, Stat, type Tone } from "./MotionParts";
import { IconArrow, IconCheck } from "./icons";

export function PageHeading({ eyebrow, title, description, children }: { eyebrow: string; title: string; description?: string; children?: React.ReactNode }) {
  return <header className="page-head">
    <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {children && <div className="page-head-actions">{children}</div>}
  </header>;
}

/** Borderless glass surface. `title` renders a compact header row with an optional action on the right. */
export function Panel({ title, subtitle, action, children, className = "", id }: { title?: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return <section className={`panel ${className}`} id={id}>
    {(title || action) && <header className="panel-head"><div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>{action}</header>}
    {children}
  </section>;
}

export function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link className="more-link" href={href}>{children}<IconArrow size={14} /></Link>;
}

export function DataNotice({ data, year }: { data: ParkOverview | null; year: number }) {
  return (data?.energy_estimated_share ?? 0) > 0
    ? <div className="notice"><i aria-hidden="true" />{year} 年能耗含模拟估算数据，当前用于功能演示。<Link href={`/admin/data?year=${year}`}>查看数据来源</Link></div>
    : null;
}

export function DataError({ error }: { error: string }) {
  if (!error) return null;
  const tunnel = /ECONNREFUSED|timeout|超时|connect/i.test(error);
  return <div className="notice danger" role="status"><i aria-hidden="true" />
    <div><b>数据暂不可用</b>{tunnel ? "：无法连接园区数据库，请确认 SSH 隧道（scripts/start-db-tunnel.ps1）已打开后刷新。" : `：${error}`}</div>
  </div>;
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty"><b>{title}</b>{children && <p>{children}</p>}{action}</div>;
}

export function Metric({ label, value, unit, hint, tone, digits, achieved, delay }: { label: string; value: number | null | undefined; unit: string; hint?: string; tone?: Tone; digits?: number; achieved?: boolean; delay?: number }) {
  return <Stat label={label} value={value} unit={unit} hint={hint} tone={tone} digits={digits} achieved={achieved} delay={delay} />;
}

/** Only achieved indicators are shown (platform rule): the park presents what it already meets. */
export function AchievedIndicators({ data, codes, title, compact = false }: { data: ParkOverview | null; codes: string[]; title: string; compact?: boolean }) {
  const rows = data?.achieved.filter((row) => codes.includes(row.code)) || [];
  if (!rows.length) return null;
  return <section className={`achieved ${compact ? "compact" : ""}`} aria-label={title}>
    <header><span className="eyebrow">{title}</span><span className="achieved-count">{rows.length} 项达标</span></header>
    <div className="achieved-list">{rows.map((row) => <div key={row.code} className="achieved-item">
      <span className="achieved-check"><IconCheck /></span>
      <span className="achieved-name">{row.name}</span>
      <strong>{fmt(row.value, 2)}<small>{row.unit}</small></strong>
    </div>)}</div>
  </section>;
}

export function AdminNavigation({ active, year }: { active: "data" | "indicators" | "governance"; year: number }) {
  return <LinkTabs id="admin" label="后台模块" active={active} items={[
    { key: "data", label: "数据管理", href: `/admin/data?year=${year}` },
    { key: "indicators", label: "指标体系", href: `/admin/indicators?year=${year}` },
    { key: "governance", label: "数据治理", href: `/admin?year=${year}` },
  ]} />;
}
