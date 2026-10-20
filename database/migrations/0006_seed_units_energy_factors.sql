-- 0006 参考数据：单位、行业、能源品种、因子出处、折标系数、低位发热量、排放因子
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。
-- 所有因子以 draft（草稿）状态入库：数值逐项抄自标准原文，经人工复核后改为 approved 才参与计算。

SET ROLE greensystem;

-- 1. 单位 ----------------------------------------------------------------
INSERT INTO core.unit (code, name, dimension, base_code, to_base) VALUES
  ('kWh',    '千瓦时',       'electricity', NULL,  NULL),
  ('MWh',    '兆瓦时',       'electricity', 'kWh', 1000),
  ('万kWh',  '万千瓦时',     'electricity', 'kWh', 10000),
  ('t',      '吨',           'mass',        NULL,  NULL),
  ('kg',     '千克',         'mass',        't',   0.001),
  ('万t',    '万吨',         'mass',        't',   10000),
  ('m3',     '立方米',       'volume',      NULL,  NULL),
  ('万m3',   '万立方米',     'volume',      'm3',  10000),
  ('L',      '升',           'volume',      'm3',  0.001),
  ('GJ',     '吉焦',         'heat',        NULL,  NULL),
  ('MJ',     '兆焦',         'heat',        'GJ',  0.001),
  ('TJ',     '太焦',         'heat',        'GJ',  1000),
  ('tce',    '吨标准煤',     'energy_std',  NULL,  NULL),
  ('kgce',   '千克标准煤',   'energy_std',  'tce', 0.001),
  ('万tce',  '万吨标准煤',   'energy_std',  'tce', 10000),
  ('tCO2',   '吨二氧化碳',   'emission',    NULL,  NULL),
  ('kgCO2',  '千克二氧化碳', 'emission',    'tCO2', 0.001),
  ('万tCO2', '万吨二氧化碳', 'emission',    'tCO2', 10000),
  ('万元',   '万元',         'money',       NULL,  NULL),
  ('元',     '元',           'money',       '万元', 0.0001),
  ('亿元',   '亿元',         'money',       '万元', 10000),
  ('m2',     '平方米',       'area',        NULL,  NULL),
  ('万m2',   '万平方米',     'area',        'm2',  10000),
  ('km2',    '平方千米',     'area',        'm2',  1000000),
  ('亩',     '亩',           'area',        'm2',  666.6666667),
  ('人',     '人',           'count',       NULL,  NULL),
  ('项',     '项',           'count',       NULL,  NULL),
  ('个',     '个',           'count',       NULL,  NULL),
  ('件',     '件',           'count',       NULL,  NULL),
  ('%',      '百分比',       'ratio',       NULL,  NULL),
  ('1',      '无量纲',       'ratio',       NULL,  NULL);

-- 2. 行业（GB/T 4754-2017 中与园区两大主导产业相关的门类）--------------------
INSERT INTO core.industry (code, name, parent_code, park_category) VALUES
  ('C20',  '木材加工和木、竹、藤、棕、草制品业', NULL,  'green_home'),
  ('202',  '人造板制造',                         'C20', 'green_home'),
  ('C21',  '家具制造业',                         NULL,  'green_home'),
  ('211',  '木质家具制造',                       'C21', 'green_home'),
  ('C39',  '计算机、通信和其他电子设备制造业',   NULL,  'electronics'),
  ('397',  '电子器件制造',                       'C39', 'electronics'),
  ('SVC',  '现代服务业（园区自定义）',           NULL,  'service');

-- 3. 能源品种 ---------------------------------------------------------------
-- 清洁能源口径：旧版评价要求“清洁能源包括天然气等清洁燃气、电和低硫轻柴油等清洁燃油（不含机动车用燃油）”，
-- 可再生能源同时计为清洁能源。柴油、汽油是否计入清洁燃油需按实际用途判断，这里先不计。
INSERT INTO core.energy_type
  (code, name, category, default_unit, is_fossil, is_clean, is_renewable, electricity_kind, heat_kind, sort_order) VALUES
  ('RAW_COAL',              '原煤',               'coal',           't',   true,  false, false, NULL,              NULL,        10),
  ('WASHED_COAL',           '洗精煤',             'coal',           't',   true,  false, false, NULL,              NULL,        11),
  ('COKE',                  '焦炭',               'coal',           't',   true,  false, false, NULL,              NULL,        12),
  ('GASOLINE',              '汽油',               'oil',            't',   true,  false, false, NULL,              NULL,        20),
  ('KEROSENE',              '煤油',               'oil',            't',   true,  false, false, NULL,              NULL,        21),
  ('DIESEL',                '柴油',               'oil',            't',   true,  false, false, NULL,              NULL,        22),
  ('FUEL_OIL',              '燃料油',             'oil',            't',   true,  false, false, NULL,              NULL,        23),
  ('LPG',                   '液化石油气',         'oil',            't',   true,  true,  false, NULL,              NULL,        24),
  ('NATURAL_GAS',           '天然气',             'gas',            'm3',  true,  true,  false, NULL,              NULL,        30),
  ('LNG',                   '液化天然气',         'gas',            't',   true,  true,  false, NULL,              NULL,        31),
  ('BIOGAS',                '沼气',               'renewable_fuel', 'm3',  false, true,  true,  NULL,              NULL,        40),
  ('BIOMASS',               '生物质燃料',         'renewable_fuel', 't',   false, true,  true,  NULL,              NULL,        41),
  ('ELEC_GRID',             '电网电力',           'electricity',    'kWh', false, true,  false, 'grid',            NULL,        50),
  ('ELEC_DIRECT_NONFOSSIL', '直供非化石能源电力', 'electricity',    'kWh', false, true,  true,  'direct_nonfossil', NULL,       51),
  ('ELEC_GREEN_TRADE',      '绿证绿电交易电力',   'electricity',    'kWh', false, true,  true,  'green_trade',     NULL,        52),
  ('ELEC_SELF_PV',          '自发光伏电力',       'electricity',    'kWh', false, true,  true,  'self_pv',         NULL,        53),
  ('ELEC_SELF_WIND',        '自发风电电力',       'electricity',    'kWh', false, true,  true,  'self_wind',       NULL,        54),
  ('HEAT_FOSSIL',           '外购热力（化石能源）', 'heat',          'GJ',  false, false, false, NULL,              'fossil',    60),
  ('HEAT_NONFOSSIL',        '外购热力（非化石能源）', 'heat',        'GJ',  false, true,  true,  NULL,              'nonfossil', 61);

-- 4. 因子出处 ---------------------------------------------------------------
INSERT INTO core.factor_source (code, title, doc_no, published_on, note) VALUES
  ('GBT2589_2020_A', 'GB/T 2589-2020 综合能耗计算通则 附录A 各种能源折标准煤系数（参考值）', 'GB/T 2589-2020', NULL,
   '资料性附录；有实测值时优先采用实测值'),
  ('NDRC_2025_910_A4', '国家发展改革委 工业和信息化部 国家能源局关于开展零碳园区建设的通知 附件4 零碳园区碳排放核算方法（试行）',
   '发改环资〔2025〕910号', DATE '2025-07-01', '电力、热力排放因子；化石燃料排放因子要求采用国家温室气体排放因子数据库'),
  ('MODEL_DOC_APX_B', '园区能碳管理模型.docx 附录B 能源碳排放因子（tCO2/TJ）', NULL, NULL,
   '原始出处待核实；910 号文要求化石燃料排放因子采用国家温室气体排放因子数据库，确认后应替换为该数据库数值');

-- 5. 折标准煤系数与低位发热量（GB/T 2589-2020 表 A.1、A.2）---------------------
--    折标准煤系数 kgce/kg 与 tce/t 数值相同；kgce/m3 需除以 1000 得 tce/m3
INSERT INTO core.factor (factor_kind, energy_type_code, basis, value, value_low, value_high, unit, source_id, source_page, note)
SELECT k, e, b, v, lo, hi, u, (SELECT source_id FROM core.factor_source WHERE code = 'GBT2589_2020_A'), p, n
FROM (VALUES
  ('std_coal', 'RAW_COAL',    'default',    0.7143, NULL::numeric, NULL::numeric, 'kgce/kg', '表A.1', NULL),
  ('std_coal', 'WASHED_COAL', 'default',    0.9000, NULL, NULL, 'kgce/kg', '表A.1', NULL),
  ('std_coal', 'COKE',        'default',    0.9714, NULL, NULL, 'kgce/kg', '表A.1', '焦炭（干全焦）'),
  ('std_coal', 'GASOLINE',    'default',    1.4714, NULL, NULL, 'kgce/kg', '表A.1', NULL),
  ('std_coal', 'KEROSENE',    'default',    1.4714, NULL, NULL, 'kgce/kg', '表A.1', NULL),
  ('std_coal', 'DIESEL',      'default',    1.4571, NULL, NULL, 'kgce/kg', '表A.1', NULL),
  ('std_coal', 'FUEL_OIL',    'default',    1.4286, NULL, NULL, 'kgce/kg', '表A.1', NULL),
  ('std_coal', 'LPG',         'default',    1.7143, NULL, NULL, 'kgce/kg', '表A.1', NULL),
  ('std_coal', 'NATURAL_GAS', 'default',    NULL,   1.1000, 1.3300, 'kgce/m3', '表A.1', '标准给出区间，需按气源实测热值或统一口径确定采用值'),
  ('std_coal', 'LNG',         'default',    1.7572, NULL, NULL, 'kgce/kg', '表A.1', NULL),
  ('std_coal', 'BIOGAS',      'default',    NULL,   0.7143, 0.8286, 'kgce/m3', '表A.1', '标准给出区间'),
  ('std_coal', 'ELEC_GRID',   'equivalent', 0.1229, NULL, NULL, 'kgce/kWh', '表A.2', '当量值；等价值按上年电厂发电标准煤耗，需逐年录入'),
  ('std_coal', 'ELEC_DIRECT_NONFOSSIL', 'equivalent', 0.1229, NULL, NULL, 'kgce/kWh', '表A.2', '当量值'),
  ('std_coal', 'ELEC_GREEN_TRADE',      'equivalent', 0.1229, NULL, NULL, 'kgce/kWh', '表A.2', '当量值'),
  ('std_coal', 'ELEC_SELF_PV',          'equivalent', 0.1229, NULL, NULL, 'kgce/kWh', '表A.2', '当量值'),
  ('std_coal', 'ELEC_SELF_WIND',        'equivalent', 0.1229, NULL, NULL, 'kgce/kWh', '表A.2', '当量值'),
  ('std_coal', 'HEAT_FOSSIL',    'equivalent', 0.03412, NULL, NULL, 'kgce/MJ', '表A.2', '当量值'),
  ('std_coal', 'HEAT_NONFOSSIL', 'equivalent', 0.03412, NULL, NULL, 'kgce/MJ', '表A.2', '当量值'),
  ('ncv', 'RAW_COAL',    'default', 20934, NULL, NULL, 'kJ/kg', '表A.1', '平均低位发热量'),
  ('ncv', 'WASHED_COAL', 'default', 26377, NULL, NULL, 'kJ/kg', '表A.1', NULL),
  ('ncv', 'COKE',        'default', 28470, NULL, NULL, 'kJ/kg', '表A.1', NULL),
  ('ncv', 'GASOLINE',    'default', 43124, NULL, NULL, 'kJ/kg', '表A.1', NULL),
  ('ncv', 'KEROSENE',    'default', 43124, NULL, NULL, 'kJ/kg', '表A.1', NULL),
  ('ncv', 'DIESEL',      'default', 42705, NULL, NULL, 'kJ/kg', '表A.1', NULL),
  ('ncv', 'FUEL_OIL',    'default', 41868, NULL, NULL, 'kJ/kg', '表A.1', NULL),
  ('ncv', 'LPG',         'default', 50242, NULL, NULL, 'kJ/kg', '表A.1', NULL),
  ('ncv', 'NATURAL_GAS', 'default', NULL,  32238, 38979, 'kJ/m3', '表A.1', '标准给出区间'),
  ('ncv', 'LNG',         'default', 51498, NULL, NULL, 'kJ/kg', '表A.1', NULL),
  ('ncv', 'BIOGAS',      'default', NULL,  20934, 24283, 'kJ/m3', '表A.1', '标准给出区间')
) AS t(k, e, b, v, lo, hi, u, p, n);

-- 6. 电力、热力排放因子（910 号附件 4）--------------------------------------------
INSERT INTO core.factor (factor_kind, energy_type_code, basis, value, unit, source_id, source_page, note)
SELECT 'co2_per_unit', e, 'default', v, u, (SELECT source_id FROM core.factor_source WHERE code = 'NDRC_2025_910_A4'), '附件4 二（二）3', n
FROM (VALUES
  ('ELEC_GRID',             0.8325, 'kgCO2/kWh', '全国化石能源电力排放因子'),
  ('ELEC_DIRECT_NONFOSSIL', 0,      'kgCO2/kWh', '直供非化石能源电力计为 0'),
  ('ELEC_GREEN_TRADE',      0,      'kgCO2/kWh', '绿证绿电交易获取的可再生能源电力计为 0'),
  ('ELEC_SELF_PV',          0,      'kgCO2/kWh', '园区内非化石能源发电，按非化石电力计为 0'),
  ('ELEC_SELF_WIND',        0,      'kgCO2/kWh', '园区内非化石能源发电，按非化石电力计为 0'),
  ('HEAT_FOSSIL',           0.11,   'tCO2/GJ',   '化石能源热力缺省值；有实测值时采用实测值'),
  ('HEAT_NONFOSSIL',        0,      'tCO2/GJ',   '非化石能源热力计为 0')
) AS t(e, v, u, n);

-- 7. 化石燃料排放因子（模型文档附录 B，出处待核实）---------------------------------
--    计算：CO2(t) = 消费量 × 低位发热量 × 排放因子(tCO2/TJ) ÷ 10^9（kJ→TJ）
INSERT INTO core.factor (factor_kind, energy_type_code, basis, value, unit, source_id, source_page, note)
SELECT 'co2_per_tj', e, 'default', v, 'tCO2/TJ', (SELECT source_id FROM core.factor_source WHERE code = 'MODEL_DOC_APX_B'), '附录B', n
FROM (VALUES
  ('RAW_COAL',    94.6,  '附录B 无“原煤”项，暂按“一般烟煤”；910 号文要求原煤细分为无烟煤、炼焦烟煤、一般烟煤、褐煤'),
  ('WASHED_COAL', 94.6,  '暂按“炼焦烟煤”'),
  ('COKE',        107.1, NULL),
  ('GASOLINE',    69.3,  NULL),
  ('KEROSENE',    71.9,  NULL),
  ('DIESEL',      74.1,  NULL),
  ('FUEL_OIL',    77.4,  NULL),
  ('LPG',         63.1,  NULL),
  ('NATURAL_GAS', 57.2,  NULL),
  ('LNG',         56.8,  NULL)
) AS t(e, v, n);

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0006', '参考数据：单位、行业、能源品种、折标系数与排放因子（草稿，待人工复核）');
