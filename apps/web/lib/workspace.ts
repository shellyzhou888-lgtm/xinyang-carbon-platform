export const YEARS = [2023, 2024, 2025] as const;
export function selectedYear(value?: string) { const year = Number(value); return YEARS.includes(year as typeof YEARS[number]) ? year : 2025; }
export const formatNumber = (value: number | null | undefined, digits = 1) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
