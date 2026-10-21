/**
 * Display clean-up for provenance text. The database keeps page numbers and file names for internal checking;
 * pages show only the official document or public source name (no "PDF 第 x 页", local file names or upload wording).
 */
const PAGE = /(?:原件|PDF|pdf|正文|目录正文)?\s*第\s*[0-9]+\s*页(?:\s*[（(][^）)]*[）)])?/g;
const LOCAL_PATH = /(?:[A-Za-z]:)?(?:[\w.-]+[\\/])+[\w.\-（）()一-龥]+\.(?:pdf|docx?|xlsx?|md|json)/gi;
const EXTENSION = /\.(?:pdf|docx?|xlsx?)\b/gi;
const UPLOAD = /(?:用户|本地)(?:上传|提供)的?(?:PDF|pdf|文件|资料|Word|word|摘录)?|用户(?:PDF|pdf|文件|资料|摘录)/g;

/** Strips page numbers, local paths and upload wording; wraps a bare document title in 《》. */
export function cleanSource(text: string | null | undefined): string {
  if (!text) return "";
  let s = text.replace(LOCAL_PATH, "").replace(PAGE, "").replace(UPLOAD, "").replace(EXTENSION, "");
  s = s.replace(/同份\s*(?:PDF|pdf)/g, "同一文件").replace(/\b(?:PDF|pdf)\b\s*/g, "");
  s = s.replace(/[（(]\s*([^（）()]*?)\s*[）)]/g, (_, inner: string) => inner.trim() ? `（${inner.trim()}）` : "");
  s = s.replace(/[；;，,、]\s*(?=[；;，,。)）]|$)/g, "").replace(/\s{2,}/g, " ").trim();
  s = s.replace(/^[；;，,、。\s]+/, "").replace(/\s+([；;，,。、])/g, "$1");
  return s;
}

/** A document title for citation: cleaned and wrapped in 《》 unless it already carries title marks or is a URL. */
export function documentTitle(text: string | null | undefined): string {
  const s = cleanSource(text);
  if (!s || /^https?:/.test(s) || /《.*》/.test(s)) return s;
  return `《${s}》`;
}
