/** Single-weight line icons (24px grid, 1.6 stroke) so the navigation and toolbars share one visual language. */
type IconProps = { size?: number; className?: string };
const base = (size: number, className?: string) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className, "aria-hidden": true });

export const IconOverview = ({ size = 20, className }: IconProps) => <svg {...base(size, className)}><path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>;
export const IconEnergy = ({ size = 20, className }: IconProps) => <svg {...base(size, className)}><path d="M13 2 4.5 13.5H12L11 22l8.5-11.5H12z" /></svg>;
export const IconCarbon = ({ size = 20, className }: IconProps) => <svg {...base(size, className)}><path d="M6.5 18A4.5 4.5 0 0 1 6 9.03 6 6 0 0 1 17.6 8.1 5 5 0 0 1 17 18z" /><path d="M9.5 14.5c1-.9 2-.9 3 0s2 .9 3 0" /></svg>;
export const IconDiagnosis = ({ size = 20, className }: IconProps) => <svg {...base(size, className)}><path d="M3 12h4l2.5-6 4 12 2.5-6H21" /></svg>;
export const IconDirectory = ({ size = 20, className }: IconProps) => <svg {...base(size, className)}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
export const IconAdmin = ({ size = 20, className }: IconProps) => <svg {...base(size, className)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
export const IconChat = ({ size = 20, className }: IconProps) => <svg {...base(size, className)}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" /><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" strokeWidth={2.4} /></svg>;
export const IconLogout = ({ size = 18, className }: IconProps) => <svg {...base(size, className)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>;
export const IconArrow = ({ size = 16, className }: IconProps) => <svg {...base(size, className)}><path d="M7 17 17 7M8 7h9v9" /></svg>;
export const IconClose = ({ size = 18, className }: IconProps) => <svg {...base(size, className)}><path d="M18 6 6 18M6 6l12 12" /></svg>;
export const IconCheck = ({ size = 14, className }: IconProps) => <svg {...base(size, className)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
export const IconExpand = ({ size = 16, className }: IconProps) => <svg {...base(size, className)}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>;
export const IconLayers = ({ size = 16, className }: IconProps) => <svg {...base(size, className)}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></svg>;
export const IconSearch = ({ size = 16, className }: IconProps) => <svg {...base(size, className)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
export const IconSpark = ({ size = 16, className }: IconProps) => <svg {...base(size, className)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" /></svg>;
export const IconSun = ({ size = 18, className }: IconProps) => <svg {...base(size, className)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
export const IconMoon = ({ size = 18, className }: IconProps) => <svg {...base(size, className)}><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" /></svg>;
/** Filled trophy for honours (gold cup, used where an achievement should read at a glance). */
export const IconTrophy = ({ size = 18, className }: IconProps) => <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
  <path d="M7 3h10v5.5a5 5 0 0 1-10 0z" fill="currentColor" />
  <path d="M7 5H4.5a.5.5 0 0 0-.5.5V7a3.5 3.5 0 0 0 3.6 3.5M17 5h2.5a.5.5 0 0 1 .5.5V7a3.5 3.5 0 0 1-3.6 3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
  <path d="M10.5 13.2h3l.6 3.8h-4.2z" fill="currentColor" opacity={0.85} />
  <rect x="7.5" y="17.5" width="9" height="3" rx="1" fill="currentColor" />
  <path d="M9.5 5.2v2.6" stroke="#fff" strokeOpacity={0.55} strokeWidth={1.4} strokeLinecap="round" />
</svg>;
export const IconAward = ({ size = 16, className }: IconProps) => <svg {...base(size, className)}><circle cx="12" cy="9" r="6" /><path d="m8.5 14-1.5 7 5-3 5 3-1.5-7" /></svg>;
export const IconRotateLeft = ({ size = 16, className }: IconProps) => <svg {...base(size, className)}><path d="M3 11a9 9 0 1 0 2.5-5.7L3 8" /><path d="M3 3v5h5" /></svg>;
export const IconRotateRight = ({ size = 16, className }: IconProps) => <svg {...base(size, className)}><path d="M21 11a9 9 0 1 1-2.5-5.7L21 8" /><path d="M21 3v5h-5" /></svg>;
export const IconTiltUp = ({ size = 16, className }: IconProps) => <svg {...base(size, className)}><path d="m6 14 6-6 6 6M6 20l6-6 6 6" /></svg>;
export const IconTiltDown = ({ size = 16, className }: IconProps) => <svg {...base(size, className)}><path d="m6 4 6 6 6-6m-12 6 6 6 6-6" /></svg>;
export const IconSpreadsheet = ({ size = 18, className }: IconProps) => <svg {...base(size, className)}><rect x="3" y="2" width="18" height="20" rx="2" /><path d="M8 2v20M3 8h18M3 15h18M14 8v14" /></svg>;
export const IconUpload = ({ size = 16, className }: IconProps) => <svg {...base(size, className)}><path d="M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4" /></svg>;
/** Solid, heavy download arrow (filled shaft and head over a tray), for primary export buttons. */
export const IconDownloadSolid = ({ size = 18, className }: IconProps) => <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
  <path d="M10 2.5h4v8.6h3.6L12 17.2l-5.6-6.1H10z" fill="currentColor" />
  <rect x="3" y="18.6" width="18" height="3" rx="1.5" fill="currentColor" />
</svg>;
