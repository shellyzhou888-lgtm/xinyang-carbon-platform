"use client";

import Link from "next/link";
import { motion } from "motion/react";

const STEPS = [
  { key: "alerts", no: "01", label: "诊断预警", detail: "发现异常与超预算" },
  { key: "causes", no: "02", label: "根因溯源", detail: "定位高排放对象" },
  { key: "strategies", no: "03", label: "减碳策略", detail: "匹配策略库" },
  { key: "forecast", no: "04", label: "能碳预测", detail: "检验策略效果" },
];

/** The four-step diagnosis flow as one stepper; the active step carries a sliding highlight. */
export default function DiagnosisSteps({ year, active, counts }: { year: number; active: string; counts: Record<string, number> }) {
  return <nav className="stepper" aria-label="诊断流程">
    {STEPS.map((step) => <Link key={step.key} href={`/diagnosis?year=${year}&tab=${step.key}`} className={`step ${active === step.key ? "on" : ""}`} aria-current={active === step.key ? "step" : undefined} scroll={false}>
      {active === step.key && <motion.span layoutId="diagnosis-step" className="step-pill" transition={{ type: "spring", stiffness: 380, damping: 34 }} />}
      <span>{step.no}</span>
      <b>{step.label}<small>{step.detail}{counts[step.key] ? ` · ${counts[step.key]}` : ""}</small></b>
    </Link>)}
  </nav>;
}
