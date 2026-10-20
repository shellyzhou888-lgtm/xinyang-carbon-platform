"""Generate the Excel import templates from core.import_template / core.import_field_map.

Headers are read from the database so the workbook always matches the field mapping.
Usage (SSH tunnel running, DATABASE_URL in .env):
    python scripts/generate_import_templates.py
Outputs:
    templates/enterprise-monthly-energy_v1.xlsx
    templates/enterprise-annual-economic_v1.xlsx   (sheets: 经济指标, 产品产量)
"""
import json
import os
import subprocess
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "templates"
PSQL = os.environ.get("PSQL", r"C:\Program Files\PostgreSQL\17\bin\psql.exe")
INPUT_ROWS = 500  # rows pre-formatted for input

FONT = "Arial"
TITLE = Font(name=FONT, size=12, bold=True)
NOTE = Font(name=FONT, size=9, color="595959")
HEADER = Font(name=FONT, size=10, bold=True, color="FFFFFF")
BODY = Font(name=FONT, size=10)
REQUIRED_FILL = PatternFill("solid", fgColor="C00000")
OPTIONAL_FILL = PatternFill("solid", fgColor="1F4E78")
INPUT_FILL = PatternFill("solid", fgColor="FFF2CC")
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def database_url() -> str:
    text = (ROOT / ".env").read_text(encoding="utf-8-sig")
    for line in text.splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("DATABASE_URL not found in .env")


def load_templates() -> dict:
    sql = """
    select json_object_agg(t.code, json_build_object(
             'name', t.name, 'sheet', t.sheet_name, 'header_row', t.header_row, 'description', t.description,
             'fields', (select json_agg(json_build_object(
                          'src', m.source_field, 'tgt', m.target_field, 'energy', m.energy_type_code,
                          'metric', m.metric_code, 'unit', m.unit_code, 'tf', m.transform, 'req', m.is_required)
                        order by m.map_id)
                        from core.import_field_map m where m.template_id = t.template_id)))
    from core.import_template t where t.is_active
    """
    env = dict(os.environ, PGCLIENTENCODING="UTF8")
    out = subprocess.run([PSQL, database_url(), "-X", "-w", "-At", "-c", sql],
                         capture_output=True, check=True, env=env)
    return json.loads(out.stdout.decode("utf-8"))


# Column notes shown as header comments and on the instructions sheet.
NOTES = {
    "统一社会信用代码": "18 位代码；有代码时优先按代码匹配企业",
    "企业名称": "与营业执照一致；无信用代码时按名称匹配",
    "年月": "格式 YYYY-MM，例如 2025-03；每家企业每月一行",
    "年份": "四位年份，例如 2025",
    "电网购电量（kWh）": "从公共电网购入、计入电费结算的电量；万千瓦时请 ×10000",
    "绿电交易电量（kWh）": "通过绿电交易或绿证对应获取的可再生能源电量，排放因子计 0",
    "直供非化石电量（kWh）": "非化石能源电力直接供应（直连）电量，排放因子计 0",
    "光伏发电自用电量（kWh）": "厂内光伏发电并自用的电量",
    "光伏上网电量（kWh）": "厂内光伏发电送入电网的电量",
    "天然气（m3）": "标准立方米；万立方米请 ×10000",
    "外购热力（GJ）": "外购蒸汽、热水（化石能源热源）。蒸汽按吨填写的，请按热焓换算为 GJ 后填写",
    "外购非化石热力（GJ）": "热源为生物质、地热等非化石能源的外购热力",
    "柴油（t）": "按吨填写；升请按实际密度换算",
    "汽油（t）": "按吨填写",
    "液化石油气（t）": "按吨填写",
    "生物质燃料（t）": "秸秆、木屑、成型燃料等",
    "原煤（t）": "按吨填写",
    "数据来源": "从下拉列表选择，用于标记数据质量",
    "备注": "可选",
    "工业总产值（当年价，万元）": "统计报表口径",
    "工业增加值（不变价，万元）": "按不变价计；能源产出率、水资源产出率等均使用此值",
    "年末从业人数（人）": "可选；年末工业企业从业人数（人均工业增加值的分母）",
    "绿色产业增加值（万元）": "可选；节能环保产业和新能源产业部分（2024 版指标使用）",
    "是否规模以上工业企业": "是 / 否",
    "是否高新技术企业": "是 / 否；计入“高新技术企业工业总产值占比”",
    "高新技术企业证书编号": "如 GR2023…",
    "产品名称": "与能耗限额标准中的产品名称尽量一致，一种产品一行",
    "产量": "合格产品产量",
    "计量单位": "如 m3、t、万只、件；与产量对应",
    "单位产品综合能耗（kgce/计量单位）": "可选；企业自算的单位产品综合能耗",
    "适用能耗限额标准编号": "可选；如 GB 3xxxx-20xx",
}

# One realistic example row per template, shown on the instructions sheet only.
EXAMPLES = {
    "ENT_MONTHLY_ENERGY": {
        "统一社会信用代码": "91411500XXXXXXXXXX", "企业名称": "示例家居有限公司", "年月": "2025-03",
        "电网购电量（kWh）": 1250000, "光伏发电自用电量（kWh）": 86000, "光伏上网电量（kWh）": 12000,
        "天然气（m3）": 210000, "外购热力（GJ）": 3500, "柴油（t）": 1.8, "数据来源": "计量表实测",
    },
    "ENT_ANNUAL_ECONOMIC": {
        "统一社会信用代码": "91411500XXXXXXXXXX", "企业名称": "示例家居有限公司", "年份": "2025",
        "工业总产值（当年价，万元）": 68000, "工业增加值（不变价，万元）": 15600, "年末从业人数（人）": 820,
        "是否规模以上工业企业": "是", "是否高新技术企业": "否", "数据来源": "统计报表",
    },
    "ENT_ANNUAL_PRODUCTION": {
        "统一社会信用代码": "91411500XXXXXXXXXX", "企业名称": "示例家居有限公司", "年份": "2025",
        "产品名称": "刨花板", "产量": 350000, "计量单位": "m3", "数据来源": "生产台账",
    },
}


def dropdown_values(field: dict):
    tf = field.get("tf") or {}
    if "value_map" in tf:
        return list(tf["value_map"].keys())
    return None


def write_data_sheet(ws, code: str, tpl: dict):
    fields = tpl["fields"]
    header_row = tpl["header_row"]
    ws.sheet_properties.tabColor = "1F4E78"
    ws["A1"] = f"{tpl['name']}：红色表头为必填，蓝色为选填；从第 {header_row + 1} 行开始填写（浅黄色区域），不要修改表头。"
    ws["A1"].font = Font(name=FONT, size=10, bold=True, color="C00000")
    for col, field in enumerate(fields, start=1):
        cell = ws.cell(row=header_row, column=col, value=field["src"])
        cell.font = HEADER
        cell.fill = REQUIRED_FILL if field["req"] else OPTIONAL_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BOX
        # No cell comments: exceljs (used by the importer) fails to read openpyxl-written comment parts.
        # Column notes live on the 填写说明 sheet instead.
        letter = get_column_letter(col)
        ws.column_dimensions[letter].width = max(12, min(30, len(field["src"]) * 2 + 2))
        is_text = field["tgt"] in ("node_credit_code", "node_name", "period_month", "period_year",
                                   "dim_code", "unit", "note", "data_source") or field["tgt"].startswith("enterprise_profile")
        for r in range(header_row + 1, header_row + 1 + INPUT_ROWS):
            c = ws.cell(row=r, column=col)
            c.fill = INPUT_FILL
            c.font = BODY
            c.border = BOX
            c.number_format = "@" if is_text else "#,##0.####"
        options = dropdown_values(field)
        if options:
            dv = DataValidation(type="list", formula1='"' + ",".join(options) + '"', allow_blank=not field["req"],
                                showErrorMessage=True, errorTitle="请从下拉列表选择", error="取值：" + "、".join(options))
            dv.add(f"{letter}{header_row + 1}:{letter}{header_row + INPUT_ROWS}")
            ws.add_data_validation(dv)
        elif not field["tgt"].startswith(("node_", "period_", "dim_code", "unit", "note", "attributes.unit_energy", "attributes.limit", "enterprise_profile")):
            dv = DataValidation(type="decimal", operator="greaterThanOrEqual", formula1="0", allow_blank=True,
                                showErrorMessage=True, errorTitle="请填写数值", error="请填写不小于 0 的数字，不要带单位")
            dv.add(f"{letter}{header_row + 1}:{letter}{header_row + INPUT_ROWS}")
            ws.add_data_validation(dv)
    ws.row_dimensions[header_row].height = 36
    ws.freeze_panes = ws.cell(row=header_row + 1, column=3)


def write_instructions(ws, codes: list, templates: dict):
    ws.sheet_properties.tabColor = "7F7F7F"
    ws["A1"] = "填写说明"
    ws["A1"].font = TITLE
    lines = [
        "1. 只在数据工作表的浅黄色区域填写；红色表头为必填，蓝色为选填。请勿增删列或修改表头文字。",
        "2. 没有使用的能源或指标留空，不要填 0 以外的占位符（如“/”“无”）。",
        "3. 数值只填数字，不带单位；单位以表头括号内为准。",
        "4. 上传后系统先原样保存原始表格，再按模板解析入库；解析失败的行会提示原因，可修改后重新上传。",
        "5. 同一企业同一期间重复上传时，新数据替换旧数据，旧数据保留历史记录，不会被删除。",
    ]
    row = 2
    for line in lines:
        ws.cell(row=row, column=1, value=line).font = BODY
        row += 1
    for code in codes:
        tpl = templates[code]
        row += 1
        ws.cell(row=row, column=1, value=f"【{tpl['sheet']}】{tpl['name']}").font = Font(name=FONT, size=11, bold=True)
        row += 1
        for col, title in enumerate(["列名", "是否必填", "说明", "示例"], start=1):
            c = ws.cell(row=row, column=col, value=title)
            c.font = HEADER
            c.fill = OPTIONAL_FILL
            c.border = BOX
        row += 1
        example = EXAMPLES.get(code, {})
        for field in tpl["fields"]:
            values = [field["src"], "必填" if field["req"] else "选填", NOTES.get(field["src"], ""), example.get(field["src"], "")]
            for col, v in enumerate(values, start=1):
                c = ws.cell(row=row, column=col, value=v)
                c.font = BODY
                c.border = BOX
                c.alignment = Alignment(wrap_text=True, vertical="top")
            row += 1
    ws.column_dimensions["A"].width = 34
    ws.column_dimensions["B"].width = 10
    ws.column_dimensions["C"].width = 70
    ws.column_dimensions["D"].width = 22


def build(filename: str, codes: list, templates: dict):
    wb = Workbook()
    write_instructions(wb.active, codes, templates)
    wb.active.title = "填写说明"
    for code in codes:
        write_data_sheet(wb.create_sheet(templates[code]["sheet"]), code, templates[code])
    wb.active = 1
    OUT.mkdir(exist_ok=True)
    path = OUT / filename
    wb.save(path)
    print("written", path.relative_to(ROOT))


def main():
    templates = load_templates()
    build("enterprise-monthly-energy_v1.xlsx", ["ENT_MONTHLY_ENERGY"], templates)
    build("enterprise-annual-economic_v1.xlsx", ["ENT_ANNUAL_ECONOMIC", "ENT_ANNUAL_PRODUCTION"], templates)


if __name__ == "__main__":
    main()
