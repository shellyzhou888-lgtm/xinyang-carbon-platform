"use client";

import { useState } from "react";
import type { ManagementData } from "@xinyang/db-agent";
import { formatNumber as fmt } from "@/lib/workspace";
import { ALERT_GROUPS, alertDeviation, alertGroup, alertSeverity, type AlertGroupKey } from "@/lib/diagnosis-alerts";
import AlertEvidence from "./AlertEvidence";
import s from "./DiagnosisAlerts.module.css";

type Alert = ManagementData["alerts"][number];

export default function DiagnosisAlerts({ alerts, openCount }: { alerts: Alert[]; openCount: number }) {
  const [active, setActive] = useState<AlertGroupKey | null>(null);
  const counts = Object.fromEntries(ALERT_GROUPS.map((group) => [group.key, alerts.filter((row) => alertGroup(row.rule_code) === group.key).length])) as Record<AlertGroupKey, number>;
  const high = alerts.filter((row) => ["critical", "high"].includes(row.severity)).length;
  const enterprises = new Set(alerts.map((row) => row.node)).size;
  const shown = alerts.filter((row) => !active || alertGroup(row.rule_code) === active);
  const ordered = [...shown].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return <div className="stack">
    <div className={s.summary} aria-label="预警概览">
      <div className={s.metric}><span>当前显示</span><strong>{alerts.length}</strong><small>其中待处理 {openCount} 项</small></div>
      <div className={s.metric}><span>高风险及紧急</span><strong>{high}</strong><small>建议优先核查</small></div>
      <div className={s.metric}><span>问题类别</span><strong>{ALERT_GROUPS.filter((group) => counts[group.key]).length}</strong><small>点击类别查看明细</small></div>
      <div className={s.metric}><span>涉及对象</span><strong>{enterprises}</strong><small>按预警对象去重</small></div>
    </div>
    <div className={s.groups} aria-label="按问题类别筛选预警">
      {ALERT_GROUPS.map((group) => <button key={group.key} type="button" className={`${s.groupCard} ${active === group.key ? s.groupCardActive : ""}`} style={{ "--group-color": group.color } as React.CSSProperties} aria-pressed={active === group.key} onClick={() => setActive(active === group.key ? null : group.key)}>
        <span className={s.groupHead}>{group.label}<b>{counts[group.key]}</b></span>
        <small>{group.hint}</small>
        <span className={s.barTrack}><span className={s.barFill} style={{ width: `${alerts.length ? counts[group.key] / alerts.length * 100 : 0}%` }} /></span>
      </button>)}
    </div>
    <div><div className={s.sectionHead}><h2>{active ? ALERT_GROUPS.find((group) => group.key === active)?.label : "全部预警"} <small>· {ordered.length} 项</small></h2>{active && <button className={s.clear} onClick={() => setActive(null)}>查看全部</button>}</div>
      <div className={s.list}>{ordered.map((row) => {
        const group = ALERT_GROUPS.find((item) => item.key === alertGroup(row.rule_code))!;
        const deviation = alertDeviation(row.observed, row.baseline);
        return <article className={s.row} key={row.id} style={{ "--group-color": group.color } as React.CSSProperties}>
          <div className={s.rowTop}><div className={s.rowTitle}><b>{row.rule_name || group.label}</b><span>{row.node}</span></div><div className={s.rowMeta}><span className={s.severity}>{alertSeverity(row.severity)}</span><span>{row.status === "open" ? "待处理" : row.status === "resolved" ? "已解决" : "已确认"}</span></div></div>
          <div className={s.rowBottom}>{deviation != null && <span>偏离基线 <strong>{deviation >= 0 ? "+" : ""}{fmt(deviation, 1)}%</strong></span>}<span>观测值 <strong>{fmt(row.observed, 4)}</strong></span><span>基线 <strong>{fmt(row.baseline, 4)}</strong></span></div>
          <details className={s.details}><summary>查看诊断与证据</summary><p>{row.message}</p><AlertEvidence value={row.root_cause} /></details>
        </article>;
      })}</div>
    </div>
  </div>;
}

function severityRank(value: string) { return value === "critical" ? 4 : value === "high" ? 3 : ["medium", "warning"].includes(value) ? 2 : 1; }
