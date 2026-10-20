/**
 * Real values found in public sources, written into the official template with 数据来源 = 公开报道.
 * Output: data/public/annual-economic_public.xlsx
 */
import ExcelJS from "exceljs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..", "..");
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(join(root, "templates", "enterprise-annual-economic_v1.xlsx"));
const ws = wb.getWorksheet("经济指标")!;
// 列：信用代码, 企业名称, 年份, 总产值, 增加值, 年末从业人数, 绿色产业增加值, 是否规上, 是否高企, 高企证书编号, 数据来源, 备注
const rows: (string | number | null)[][] = [
  [null, "今上半导体（信阳）有限公司", "2022", 27500, null, null, null, null, null, null, "公开报道",
   "2022 年实现产值 2.75 亿元。来源：大河网《创新河南 创出新彩丨信阳崛起电子信息产业新高地》2023-09 https://5g.dahe.cn/news/202309071299991"],
  [null, "河南螓杰智能科技有限公司", "2023", null, null, null, null, null, "是", "GR202341000426", "公开报道",
   "高新技术企业证书。来源：河南省认定机构 2023 年认定报备的第一批高新技术企业备案名单"],
];
rows.forEach((values, r) => values.forEach((v, c) => { if (v !== null) ws.getRow(3 + r).getCell(c + 1).value = v; }));
await wb.xlsx.writeFile(join(root, "data", "public", "annual-economic_public.xlsx"));
console.log("data/public/annual-economic_public.xlsx", rows.length, "行");
