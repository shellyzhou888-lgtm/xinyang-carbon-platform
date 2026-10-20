-- 0011 第一批导入模板：企业月度能耗表、企业年度经济统计表、企业年度产品产量表
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。
--
-- 设计：Excel 采用“宽表”（一行 = 一家企业一个月/一年，每种能源或指标一列），便于企业填写；
-- import_field_map 把每一列映射到能源品种/基础量、单位和流向，导入时拆成“长表”写入事实表。
-- 企业匹配：先按统一社会信用代码，其次按企业名称。
-- transform 约定：
--   {"flow":"feed_in"}            写入 energy_activity.flow
--   {"format":"YYYY-MM"}          期间格式
--   {"value_map":{...}}           文本取值映射（如 数据来源、是/否）
--   {"multiply":n}                数值换算

SET ROLE greensystem;

INSERT INTO core.import_template (code, name, target, file_kind, sheet_name, header_row, description) VALUES
  ('ENT_MONTHLY_ENERGY',    '企业月度能耗表',     'energy_activity', 'excel', '月度能耗', 2,
   '模板文件 templates/enterprise-monthly-energy_v1.xlsx；一行为一家企业一个月；空单元格表示无该能源，不写入'),
  ('ENT_ANNUAL_ECONOMIC',   '企业年度经济统计表', 'statistic_value', 'excel', '经济指标', 2,
   '模板文件 templates/enterprise-annual-economic_v1.xlsx 工作表“经济指标”；是否规上、是否高企同时更新企业档案'),
  ('ENT_ANNUAL_PRODUCTION', '企业年度产品产量表', 'statistic_value', 'excel', '产品产量', 2,
   '模板文件 templates/enterprise-annual-economic_v1.xlsx 工作表“产品产量”；一行为一种产品');

-- 1. 企业月度能耗表 -----------------------------------------------------------------
INSERT INTO core.import_field_map (template_id, source_field, target_field, energy_type_code, unit_code, transform, is_required)
SELECT t.template_id, m.src, m.tgt, m.energy, m.unit, m.tf::jsonb, m.req
FROM core.import_template t,
(VALUES
  ('统一社会信用代码',        'node_credit_code', NULL,                    NULL,  NULL, false),
  ('企业名称',                'node_name',        NULL,                    NULL,  NULL, true),
  ('年月',                    'period_month',     NULL,                    NULL,  '{"format":"YYYY-MM"}', true),
  ('电网购电量（kWh）',       'quantity',         'ELEC_GRID',             'kWh', NULL, false),
  ('绿电交易电量（kWh）',     'quantity',         'ELEC_GREEN_TRADE',      'kWh', NULL, false),
  ('直供非化石电量（kWh）',   'quantity',         'ELEC_DIRECT_NONFOSSIL', 'kWh', NULL, false),
  ('光伏发电自用电量（kWh）', 'quantity',         'ELEC_SELF_PV',          'kWh', '{"flow":"consumption"}', false),
  ('光伏上网电量（kWh）',     'quantity',         'ELEC_SELF_PV',          'kWh', '{"flow":"feed_in"}', false),
  ('天然气（m3）',            'quantity',         'NATURAL_GAS',           'm3',  NULL, false),
  ('外购热力（GJ）',          'quantity',         'HEAT_FOSSIL',           'GJ',  NULL, false),
  ('外购非化石热力（GJ）',    'quantity',         'HEAT_NONFOSSIL',        'GJ',  NULL, false),
  ('柴油（t）',               'quantity',         'DIESEL',                't',   NULL, false),
  ('汽油（t）',               'quantity',         'GASOLINE',              't',   NULL, false),
  ('液化石油气（t）',         'quantity',         'LPG',                   't',   NULL, false),
  ('生物质燃料（t）',         'quantity',         'BIOMASS',               't',   NULL, false),
  ('原煤（t）',               'quantity',         'RAW_COAL',              't',   NULL, false),
  ('数据来源',                'data_source',      NULL,                    NULL,
   '{"value_map":{"计量表实测":"measured","系统导出":"measured","手工台账":"manual","发票/结算单":"manual"}}', true),
  ('备注',                    'note',             NULL,                    NULL,  NULL, false)
) AS m(src, tgt, energy, unit, tf, req)
WHERE t.code = 'ENT_MONTHLY_ENERGY' AND t.revision = 1;

-- 2. 企业年度经济统计表 -------------------------------------------------------------
INSERT INTO core.import_field_map (template_id, source_field, target_field, metric_code, unit_code, transform, is_required)
SELECT t.template_id, m.src, m.tgt, m.metric, m.unit, m.tf::jsonb, m.req
FROM core.import_template t,
(VALUES
  ('统一社会信用代码',                          'node_credit_code',                    NULL,                NULL,  NULL, false),
  ('企业名称',                                  'node_name',                           NULL,                NULL,  NULL, true),
  ('年份',                                      'period_year',                         NULL,                NULL,  NULL, true),
  ('工业总产值（当年价，万元）',                'value',                               'ECO_GROSS_OUTPUT',  '万元', NULL, true),
  ('工业增加值（不变价，万元）',                'value',                               'ECO_VA_CONST',      '万元', NULL, true),
  ('从业人员年平均人数（人）',                  'value',                               'ECO_EMPLOYEES',     '人',   NULL, false),
  ('绿色产业增加值（万元）',                    'value',                               'ECO_GREEN_IND_VA',  '万元', NULL, false),
  ('是否规模以上工业企业',                      'enterprise_profile.is_above_scale',   NULL,                NULL,  '{"value_map":{"是":true,"否":false}}', false),
  ('是否高新技术企业',                          'enterprise_profile.is_high_tech',     NULL,                NULL,  '{"value_map":{"是":true,"否":false}}', false),
  ('高新技术企业证书编号',                      'enterprise_profile.high_tech_cert_no', NULL,               NULL,  NULL, false),
  ('数据来源',                                  'data_source',                         NULL,                NULL,
   '{"value_map":{"统计报表":"manual","财务报表":"manual","系统导出":"measured"}}', true),
  ('备注',                                      'note',                                NULL,                NULL,  NULL, false)
) AS m(src, tgt, metric, unit, tf, req)
WHERE t.code = 'ENT_ANNUAL_ECONOMIC' AND t.revision = 1;

-- 3. 企业年度产品产量表 -------------------------------------------------------------
INSERT INTO core.import_field_map (template_id, source_field, target_field, metric_code, unit_code, transform, is_required)
SELECT t.template_id, m.src, m.tgt, m.metric, NULL, m.tf::jsonb, m.req
FROM core.import_template t,
(VALUES
  ('统一社会信用代码',         'node_credit_code', NULL,          NULL, false),
  ('企业名称',                 'node_name',        NULL,          NULL, true),
  ('年份',                     'period_year',      NULL,          NULL, true),
  ('产品名称',                 'dim_code',         NULL,          NULL, true),
  ('产量',                     'value',            'PROD_OUTPUT', NULL, true),
  ('计量单位',                 'unit',             NULL,          NULL, true),
  ('单位产品综合能耗（kgce/计量单位）', 'attributes.unit_energy_kgce', NULL, NULL, false),
  ('适用能耗限额标准编号',     'attributes.limit_standard', NULL, NULL, false),
  ('数据来源',                 'data_source',      NULL,
   '{"value_map":{"统计报表":"manual","生产台账":"manual","系统导出":"measured"}}', true),
  ('备注',                     'note',             NULL,          NULL, false)
) AS m(src, tgt, metric, tf, req)
WHERE t.code = 'ENT_ANNUAL_PRODUCTION' AND t.revision = 1;

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0011', '导入模板：企业月度能耗表、企业年度经济统计表、企业年度产品产量表及字段映射');
