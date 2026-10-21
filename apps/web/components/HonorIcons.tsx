import type { HonorKind } from "@/lib/honors";
import { HONOR_KINDS } from "@/lib/honors";

/** Solid single-colour badge per honour category, drawn like the trophy: filled shapes, no tile and no outline (24px grid). */
const GLYPH: Record<HonorKind, React.ReactNode> = {
  green_park: <><path d="M7 3h10v5.5a5 5 0 0 1-10 0z" /><path d="M7 5H4.4a.4.4 0 0 0-.4.4V7a3.6 3.6 0 0 0 3.7 3.6l.2-1.6A2 2 0 0 1 5.6 7V6.6H7zM17 5h2.6a.4.4 0 0 1 .4.4V7a3.6 3.6 0 0 1-3.7 3.6l-.2-1.6A2 2 0 0 0 18.4 7V6.6H17z" /><path d="M10.5 13.4h3l.6 3.6h-4.2z" /><rect x="7.5" y="17.6" width="9" height="3" rx="1" /></>,
  green_factory: <><path d="M2.5 21V11.2l5 3v-3l5 3V8h3.4v13z" /><path d="M16.8 9.6c.2-3.6 2.4-6 5.2-6.4-.1 3.6-2.2 6.1-5.2 6.4z" /></>,
  zero_carbon: <><path d="M5 19C4.6 10.8 10 5 20 4.5c.4 9.8-5.6 15-13.6 14.6L5.3 21.6 3.8 20.9z" /></>,
  smart_factory: <><circle cx="12" cy="18" r="2.2" /><path d="M7.3 14.2a6.7 6.7 0 0 1 9.4 0l-1.6 1.6a4.4 4.4 0 0 0-6.2 0zM4 10.9a11.3 11.3 0 0 1 16 0l-1.6 1.6a9 9 0 0 0-12.8 0zM.8 7.6a15.9 15.9 0 0 1 22.4 0l-1.6 1.6a13.6 13.6 0 0 0-19.2 0z" /></>,
  little_giant: <><path d="m12 2.5 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3 1.1-6.5-4.7-4.6 6.5-.9z" /></>,
  high_tech: <><rect x="6.5" y="6.5" width="11" height="11" rx="2" /><path d="M9 2.5h1.6v3H9zM13.4 2.5H15v3h-1.6zM9 18.5h1.6v3H9zM13.4 18.5H15v3h-1.6zM2.5 9h3v1.6h-3zM2.5 13.4h3V15h-3zM18.5 9h3v1.6h-3zM18.5 13.4h3V15h-3z" /></>,
  cluster: <><circle cx="12" cy="5.5" r="3" /><circle cx="5.5" cy="17.5" r="3" /><circle cx="18.5" cy="17.5" r="3" /><path d="m10.6 7.6 1.6.9-4.2 7.3-1.6-.9zM13.4 7.6l-1.6.9 4.2 7.3 1.6-.9zM8.5 16.6h7v1.8h-7z" /></>,
};

export function HonorIcon({ kind, size = 24 }: { kind: HonorKind; size?: number }) {
  const color = kind === "green_park" ? "#ffc93c" : HONOR_KINDS.find((row) => row.kind === kind)?.color ?? "var(--accent)";
  return <svg className="honor-icon" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ color }} aria-hidden="true">{GLYPH[kind]}</svg>;
}
