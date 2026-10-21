import { resolve } from "node:path";
import pg from "pg";
import { REPO_ROOT, type AgentConfig } from "./config.js";
import { triggerGovernance } from "./governance.js";

/** Import templates offered on the website (codes match core.import_template; files live in templates/). */
export const IMPORT_TEMPLATES = [
  { code: "ENT_MONTHLY_ENERGY", name: "企业月度能耗表", file: "enterprise-monthly-energy_v1.xlsx", note: "一行为一家企业一个月，空单元格表示无该能源" },
  { code: "ENT_ANNUAL_ECONOMIC", name: "企业年度经济统计表", file: "enterprise-annual-economic_v1.xlsx", note: "工作表“经济指标”：产值、增加值、从业人数等" },
  { code: "ENT_ANNUAL_PRODUCTION", name: "企业年度产品产量表", file: "enterprise-annual-economic_v1.xlsx", note: "同一模板文件的“产品产量”工作表" },
  { code: "PARK_ANNUAL_RESOURCE_ENV", name: "资源环境年度统计表", file: "park-annual-resource-environment_v1.xlsx", note: "一行为一个单位一年：用水、用地、固废等" },
] as const;
export type ImportTemplateCode = typeof IMPORT_TEMPLATES[number]["code"];
export const templatePath = (file: string) => resolve(REPO_ROOT, "templates", file);

export interface ImportRequest { filePath: string; templateCode: ImportTemplateCode; dryRun: boolean; estimatedMethod?: string; note?: string; by: string }

/**
 * Imports one workbook through the standard pipeline (original file kept, raw records, parse and load), the same path as
 * the agent's import_excel tool. A dry run validates inside a rolled-back transaction. A real import starts the
 * governance step in the background (catalog refresh, drafted descriptions, detection rules).
 */
export async function importWorkbook(cfg: AgentConfig, req: ImportRequest) {
  const client = new pg.Client({ connectionString: cfg.databaseUrl });
  await client.connect();
  try {
    await client.query("SET ROLE green_app");
    const { ingestFile } = await import("../../ingest/src/ingest.js");
    const r = await ingestFile(client, {
      filePath: req.filePath, templateCode: req.templateCode, dryRun: req.dryRun,
      note: req.note ? `${req.note}（网站上传：${req.by}）` : `网站上传：${req.by}`,
      estimated: req.estimatedMethod ? { method: req.estimatedMethod, model: "web-upload" } : undefined,
    });
    if (!r.dryRun) triggerGovernance(cfg, "import");
    return { batchId: r.batchId, rowsRead: r.rowsRead, unknownHeaders: r.unknownHeaders, load: r.load, dryRun: r.dryRun };
  } finally {
    await client.end();
  }
}
