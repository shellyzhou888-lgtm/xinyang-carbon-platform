"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { formatNumber } from "@/lib/workspace";

/** Number that counts up once when it scrolls into view; falls back to the static value for reduced motion. */
export function CountUp({ value, digits = 1 }: { value: number | null | undefined; digits?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  useEffect(() => {
    const node = ref.current;
    if (!node || value == null || !Number.isFinite(value) || reduce || !inView) return;
    const controls = animate(0, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => { node.textContent = formatNumber(v, digits); } });
    return () => controls.stop();
  }, [value, digits, inView, reduce]);
  return <span ref={ref} className="num">{formatNumber(value, digits)}</span>;
}

export type Tone = "energy" | "carbon" | "accent" | "info" | "neutral";

/** KPI tile: label, animated value and unit, optional hint and achieved flag. Borderless; the tone only tints the glow. */
export function Stat({ label, value, unit, digits = 1, tone = "neutral", hint, achieved, delay = 0 }: {
  label: string; value: number | null | undefined; unit?: string; digits?: number; tone?: Tone; hint?: string; achieved?: boolean; delay?: number;
}) {
  const reduce = useReducedMotion();
  return <motion.div className={`stat rise tone-${tone}`} style={{ ["--delay" as string]: `${delay}s` }} whileHover={reduce ? undefined : { y: -2 }}>
    <span className="stat-label">{label}{achieved && <em className="chip-ok">达标</em>}</span>
    <strong className="stat-value"><CountUp value={value} digits={digits} />{unit && <small>{unit}</small>}</strong>
    {hint && <span className="stat-hint">{hint}</span>}
  </motion.div>;
}

/** Fade-and-rise wrapper for a block (CSS keyframe, so it never hides server-rendered content). */
export function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return <div className={`rise ${className}`} style={{ ["--delay" as string]: `${delay}s` }}>{children}</div>;
}

/** Segmented link tabs with a sliding indicator; each tab is a real URL so state survives reloads and sharing. */
export function LinkTabs({ items, active, id, label }: { items: { key: string; label: string; href: string; badge?: string | number }[]; active: string; id: string; label: string }) {
  return <nav className="tabs" aria-label={label}>
    {items.map((item) => <Link key={item.key} href={item.href} className={item.key === active ? "on" : ""} aria-current={item.key === active ? "page" : undefined} scroll={false}>
      {item.key === active && <motion.span layoutId={`tabs-${id}`} className="tabs-pill" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
      <span>{item.label}{item.badge != null && <em>{item.badge}</em>}</span>
    </Link>)}
  </nav>;
}
