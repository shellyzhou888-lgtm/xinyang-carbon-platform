"use client";

import Link from "next/link";
import { motion } from "motion/react";

const STEPS = [
  { key: "spatial", no: "01", label: "实景诊断", detail: "分析与预警在地图上定位" },
  { key: "evaluation", no: "02", label: "碳评价", detail: "对照评价指标" },
  { key: "strategies", no: "03", label: "能耗优化", detail: "策略测算与效果" },
];

/** The four-step diagnosis flow (spatial diagnosis → evaluation → optimisation); the active step carries a sliding highlight. */
export default function DiagnosisSteps({ year, active, counts }: { year: number; active: string; counts: Record<string, number> }) {
  return <nav className="stepper" aria-label="诊断流程">
    {STEPS.map((step) => <Link key={step.key} href={`/diagnosis?year=${year}&tab=${step.key}`} className={`step ${active === step.key ? "on" : ""}`} aria-current={active === step.key ? "step" : undefined} scroll={false}>
      {active === step.key && <motion.span layoutId="diagnosis-step" className="step-pill" transition={{ type: "spring", stiffness: 380, damping: 34 }} />}
      <span>{step.no}</span>
      <b>{step.label}<small>{step.detail}{counts[step.key] ? ` · ${counts[step.key]}` : ""}</small></b>
    </Link>)}
  </nav>;
}
