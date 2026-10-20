import ExcelJS from "exceljs";
import type { ImportTemplate } from "./template.js";

export interface ParsedRow {
  rowNo: number; // Excel row number, so errors can point back to the sheet
  payload: Record<string, string>;
}

export interface ParseResult {
  sheet: string;
  rows: ParsedRow[];
  missingRequiredHeaders: string[];
  unknownHeaders: string[];
}

/**
 * Normalises an exceljs cell value to text. The database parses numbers and periods,
 * so everything is passed as a string exactly as the user entered it.
 */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("").trim();
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text).trim();
    if ("error" in value) return "";
  }
  return String(value).trim();
}

/** Reads the template's sheet; each non-empty data row becomes {header text: cell text}. */
export async function parseWorkbook(file: string | Buffer, template: ImportTemplate): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  if (typeof file === "string") await workbook.xlsx.readFile(file);
  else await workbook.xlsx.load(file as unknown as ArrayBuffer);

  const sheet = (template.sheet_name && workbook.getWorksheet(template.sheet_name)) || undefined;
  if (!sheet) {
    const names = workbook.worksheets.map((w) => w.name).join("、");
    throw new Error(`找不到工作表“${template.sheet_name}”（文件中的工作表：${names}）`);
  }

  const headers = new Map<number, string>();
  sheet.getRow(template.header_row).eachCell({ includeEmpty: false }, (cell, col) => {
    const text = cellText(cell.value);
    if (text) headers.set(col, text);
  });

  const known = new Set(template.fields.map((f) => f.source_field));
  const present = new Set(headers.values());
  const missingRequiredHeaders = template.fields
    .filter((f) => f.is_required && !present.has(f.source_field))
    .map((f) => f.source_field);
  const unknownHeaders = [...present].filter((h) => !known.has(h));

  const rows: ParsedRow[] = [];
  for (let r = template.header_row + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const payload: Record<string, string> = {};
    let hasValue = false;
    for (const [col, header] of headers) {
      const text = cellText(row.getCell(col).value);
      if (text !== "") {
        payload[header] = text;
        hasValue = true;
      }
    }
    if (hasValue) rows.push({ rowNo: r, payload });
  }
  return { sheet: sheet.name, rows, missingRequiredHeaders, unknownHeaders };
}
