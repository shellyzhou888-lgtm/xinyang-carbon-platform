import type { HonorKind } from "@/lib/honors";
import { HONOR_KINDS } from "@/lib/honors";

/** One glyph per honour category, drawn on a tinted tile in the category colour (24px grid). */
const GLYPH: Record<HonorKind, React.ReactNode> = {
  green_park: <><path d="M7 3h10v5.5a5 5 0 0 1-10 0z" fill="currentColor" stroke="none" /><path d="M7 5H4.5V7a3.5 3.5 0 0 0 3.6 3.5M17 5h2.5V7a3.5 3.5 0 0 1-3.6 3.5" /><path d="M10.5 13.5h3l.5 3.5h-4z" fill="currentColor" stroke="none" /><rect x="7.5" y="17.5" width="9" height="3" rx="1" fill="currentColor" stroke="none" /></>,
  green_factory: <><path d="M3 20V10l5 3V10l5 3V7h3v13z" /><path d="M3 20h18" /><path d="M17.5 9.5c0-3 2-5 4.5-5.5-.2 3-1.8 5.2-4.5 5.5z" fill="currentColor" stroke="none" /></>,
  zero_carbon: <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 15.5C8.5 10.5 12 8 16.5 8c0 4.5-3 7.5-8 7.5z" fill="currentColor" stroke="none" /><path d="M8.5 15.5 12 12" stroke="var(--honor-tile)" /></>,
  smart_factory: <><circle cx="12" cy="17" r="1.6" fill="currentColor" stroke="none" /><path d="M8.5 13.5a5 5 0 0 1 7 0M5.5 10.5a9.2 9.2 0 0 1 13 0M2.8 7.6a13 13 0 0 1 18.4 0" /></>,
  little_giant: <><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor" stroke="none" /></>,
  high_tech: <><rect x="7" y="7" width="10" height="10" rx="2" /><rect x="10" y="10" width="4" height="4" fill="currentColor" stroke="none" /><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" /></>,
  cluster: <><circle cx="12" cy="6" r="2.4" fill="currentColor" stroke="none" /><circle cx="6" cy="17" r="2.4" fill="currentColor" stroke="none" /><circle cx="18" cy="17" r="2.4" fill="currentColor" stroke="none" /><path d="M11 8 7 15M13 8l4 7M8.4 17h7.2" /></>,
};

export function HonorIcon({ kind, size = 36 }: { kind: HonorKind; size?: number }) {
  const color = kind === "green_park" ? "#ffc93c" : HONOR_KINDS.find((row) => row.kind === kind)?.color ?? "var(--accent)";
  return <span className="honor-icon-tile" style={{ ["--honor" as string]: color, width: size, height: size }} aria-hidden="true">
    <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{GLYPH[kind]}</svg>
  </span>;
}
