/**
 * Test-only fixture: copies the real templates into the OS temp directory and fills a few rows,
 * so the ingest pipeline can be exercised with --dry-run. Nothing here is written to the repository
 * or kept in the database.
 */
import ExcelJS from "exceljs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..", "..");
const out = join(tmpdir(), "xinyang-ingest-fixture");

async function fill(template: string, sheetName: string, rows: (string | number)[][], target: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(root, "templates", template));
  const ws = wb.getWorksheet(sheetName)!;
  rows.forEach((values, i) => values.forEach((v, c) => { if (v !== "") ws.getRow(3 + i).getCell(c + 1).value = v; }));
  await wb.xlsx.writeFile(target);
  console.log("fixture", target);
}

const GUMAI = "91411502MA3XG3BLXL";
await import("node:fs").then((fs) => fs.mkdirSync(out, { recursive: true }));
// 列顺序与模板一致：信用代码, 企业名称, 年月, 电网, 绿电, 直供, 光伏自用, 光伏上网, 天然气, 外购热力, 非化石热力, 柴油, 汽油, LPG, 生物质, 原煤, 数据来源, 备注
await fill("enterprise-monthly-energy_v1.xlsx", "月度能耗", [
  [GUMAI, "信阳市谷麦光电子科技有限公司", "2023-01", 1000000, "", "", 50000, 10000, 20000, "", "", "", "", "", "", "", "计量表实测", ""],
  [GUMAI, "信阳市谷麦光电子科技有限公司", "2020-01", 900000, "", "", "", "", "", "", "", "", "", "", "", "", "手工台账", ""],
  ["", "亚丹生态科技（信阳）有限公司", "2023-01", 300000, "", "", "", "", 50000, 500, "", 2, "", "", "", "", "发票/结算单", ""],
  ["", "不存在的公司", "2023-01", 100, "", "", "", "", "", "", "", "", "", "", "", "", "手工台账", "应报错：未登记企业"],
], join(out, "monthly.xlsx"));
// 信用代码, 企业名称, 年份, 总产值, 增加值, 从业人员, 绿色产业增加值, 是否规上, 是否高企, 高企证书, 数据来源, 备注
await fill("enterprise-annual-economic_v1.xlsx", "经济指标", [
  [GUMAI, "信阳市谷麦光电子科技有限公司", "2023", 50000, 12000, "", "", "是", "是", "", "统计报表", ""],
  [GUMAI, "信阳市谷麦光电子科技有限公司", "2020", 40000, 10000, "", "", "", "", "", "统计报表", ""],
  ["", "亚丹生态科技（信阳）有限公司", "2023", 20000, 5000, "", "", "", "", "", "统计报表", ""],
  ["", "亚丹生态科技（信阳）有限公司", "2020", 15000, 4000, "", "", "", "", "", "统计报表", ""],
], join(out, "annual.xlsx"));
