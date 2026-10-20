-- 0010 复核本园区相关的四类因子：电网电力、天然气、热力、柴油
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。
-- 复核 = 已对照官方原文核对数值（reviewed_by）；批准使用（approved）仍需负责人确认。
-- 原文已归档到 policies/factors/。

SET ROLE greensystem;

-- 1. 新增因子出处 ---------------------------------------------------------------
INSERT INTO core.factor_source (code, title, doc_no, published_on, url, note) VALUES
  ('MEE_NBS_2024_12', '生态环境部 国家统计局 关于发布2021年电力二氧化碳排放因子的公告 附件1', '公告2024年第12号', DATE '2024-04-12',
   'https://www.mee.gov.cn/xxgk2018/xxgk/xxgk01/202404/t20240412_1070565.html',
   '归档：policies/factors/2024_MEE-NBS-2024-12_2021-electricity-co2-factors.pdf'),
  ('MEE_NBS_2024_33', '生态环境部 国家统计局 关于发布2022年电力二氧化碳排放因子的公告', '公告2024年第33号', DATE '2024-12-26',
   'https://www.mee.gov.cn/xxgk2018/xxgk/xxgk01/202412/t20241226_1099413.html',
   '因子表在公告网页正文中'),
  ('MEE_NBS_2025_47', '生态环境部 国家统计局 关于发布2023年电力二氧化碳排放因子的公告 附件', '公告2025年第47号', DATE '2025-12-31',
   'https://www.mee.gov.cn/xxgk2018/xxgk/xxgk01/202512/t20251231_1139517.html',
   '归档：policies/factors/2025_MEE-NBS-2025-47_2023-electricity-co2-factors.pdf'),
  ('MEE_STEEL_GUIDE_A1', '企业温室气体排放核算与报告指南 钢铁行业 附录A 附表A.1 常用化石燃料相关参数缺省值', 'CETS-AG-03.01-V01-2024', DATE '2025-01-24',
   'https://www.mee.gov.cn/xxgk2018/xxgk/xxgk06/202501/W020250124388842647934.pdf',
   '天然气、柴油等的低位发热量、单位热值含碳量、碳氧化率；与发电设施指南取值一致。归档：policies/factors/');

-- 2. 电网电力：2021–2023 年官方电力二氧化碳排放因子（kgCO2/kWh）------------------
INSERT INTO core.factor (factor_kind, energy_type_code, basis, variant, value, unit, source_id, source_page,
                         valid_from, valid_to, note, reviewed_by, reviewed_at, review_note)
SELECT 'co2_per_unit', 'ELEC_GRID', 'default', t.variant, t.val, 'kgCO2/kWh', s.source_id, t.tbl,
       make_date(t.yr, 1, 1), make_date(t.yr, 12, 31), t.note,
       'Claude（AI 复核）', now(), '已与生态环境部官网原文逐项核对'
FROM (VALUES
  ('MEE_NBS_2024_12', 2021, 'national_average',               0.5568, '表1', '全国电力平均'),
  ('MEE_NBS_2024_12', 2021, 'central_china',                  0.5354, '表2', '华中区域电力平均'),
  ('MEE_NBS_2024_12', 2021, 'henan',                          0.6369, '表3', '河南省电力平均'),
  ('MEE_NBS_2024_12', 2021, 'national_excl_market_nonfossil', 0.5942, '表4', '全国电力平均（不含市场化交易的非化石能源电量）'),
  ('MEE_NBS_2024_12', 2021, 'national_fossil',                0.8426, '表5', '全国化石能源电力'),
  ('MEE_NBS_2024_33', 2022, 'national_average',               0.5366, '表1', '全国电力平均'),
  ('MEE_NBS_2024_33', 2022, 'central_china',                  0.5395, '表2', '华中区域电力平均'),
  ('MEE_NBS_2024_33', 2022, 'henan',                          0.6058, '表3', '河南省电力平均'),
  ('MEE_NBS_2024_33', 2022, 'national_excl_market_nonfossil', 0.5856, '表4', '全国电力平均（不含市场化交易的非化石能源电量）'),
  ('MEE_NBS_2024_33', 2022, 'national_fossil',                0.8325, '表5', '全国化石能源电力；即 910 号文附件4 引用值'),
  ('MEE_NBS_2025_47', 2023, 'national_average',               0.5306, '表1', '全国电力平均'),
  ('MEE_NBS_2025_47', 2023, 'central_china',                  0.5271, '表2', '华中区域电力平均'),
  ('MEE_NBS_2025_47', 2023, 'henan',                          0.5897, '表3', '河南省电力平均'),
  ('MEE_NBS_2025_47', 2023, 'national_excl_market_nonfossil', 0.6096, '表4', '全国电力平均（不含市场化交易的非化石能源电量）'),
  ('MEE_NBS_2025_47', 2023, 'national_fossil',                0.8273, '表5', '全国化石能源电力')
) AS t(src, yr, variant, val, tbl, note)
JOIN core.factor_source s ON s.code = t.src;

-- 910 号文附件4 中写明的 0.8325：归为 national_fossil 口径
UPDATE core.factor f
SET variant = 'national_fossil',
    reviewed_by = 'Claude（AI 复核）', reviewed_at = now(),
    review_note = '910 号文附件4 写明 0.8325 kgCO2/kWh，即 2022 年全国化石能源电力因子（公告2024年第33号表5）；2023 年同口径已更新为 0.8273'
FROM core.factor_source s
WHERE f.source_id = s.source_id AND s.code = 'NDRC_2025_910_A4'
  AND f.energy_type_code = 'ELEC_GRID' AND f.factor_kind = 'co2_per_unit';

-- 3. 天然气、柴油：生态环境部指南缺省参数 ---------------------------------------------
--    CO2 = 消费量 × 低位发热量 × 单位热值含碳量 × 碳氧化率 × 44/12
--    天然气：389.310 GJ/万Nm3 × 0.01532 tC/GJ × 99% × 44/12 → 55.6116 tCO2/TJ，2.1650 kgCO2/m3
--    柴油：  42.652 GJ/t      × 0.02020 tC/GJ × 98% × 44/12 → 72.5853 tCO2/TJ，3.0959 tCO2/t
INSERT INTO core.factor (factor_kind, energy_type_code, basis, variant, value, unit, source_id, source_page,
                         note, reviewed_by, reviewed_at, review_note)
SELECT t.kind, t.energy, 'default', 'mee_guideline', t.val, t.unit, s.source_id, '附表A.1', t.note,
       'Claude（AI 复核）', now(), t.review
FROM (VALUES
  ('ncv',            'NATURAL_GAS', 38931,    'kJ/m3',     '原表 389.310 GJ/万Nm3', '与原文一致'),
  ('carbon_content', 'NATURAL_GAS', 0.01532,  'tC/GJ',     NULL,                    '与原文一致'),
  ('oxidation_rate', 'NATURAL_GAS', 0.99,     '1',         '99%',                   '与原文一致'),
  ('co2_per_tj',     'NATURAL_GAS', 55.6116,  'tCO2/TJ',   '= 15.32 × 99% × 44/12', '由原文参数计算'),
  ('co2_per_unit',   'NATURAL_GAS', 2.1650,   'kgCO2/m3',  '= 389.310/10^4 GJ/m3 × 0.01532 × 99% × 44/12', '由原文参数计算'),
  ('ncv',            'DIESEL',      42652,    'kJ/kg',     '原表 42.652 GJ/t',      '与原文一致'),
  ('carbon_content', 'DIESEL',      0.02020,  'tC/GJ',     NULL,                    '与原文一致'),
  ('oxidation_rate', 'DIESEL',      0.98,     '1',         '98%',                   '与原文一致'),
  ('co2_per_tj',     'DIESEL',      72.5853,  'tCO2/TJ',   '= 20.20 × 98% × 44/12', '由原文参数计算'),
  ('co2_per_unit',   'DIESEL',      3.0959,   'tCO2/t',    '= 42.652 GJ/t × 0.02020 × 98% × 44/12', '由原文参数计算')
) AS t(kind, energy, val, unit, note, review)
JOIN core.factor_source s ON s.code = 'MEE_STEEL_GUIDE_A1';

-- 天然气折标准煤系数：GB/T 2589 只给区间 1.1000~1.3300 kgce/m3，按指南低位发热量折算得到采用值
INSERT INTO core.factor (factor_kind, energy_type_code, basis, variant, value, value_low, value_high, unit, source_id, source_page,
                         note, reviewed_by, reviewed_at, review_note)
SELECT 'std_coal', 'NATURAL_GAS', 'default', 'mee_guideline', 1.3284, 1.1000, 1.3300, 'kgce/m3', s.source_id, '附表A.1',
       '= 38931 kJ/m3 ÷ 29307.6 kJ/kgce；位于 GB/T 2589 区间内',
       'Claude（AI 复核）', now(), '与碳核算采用同一低位发热量，能耗与碳排放口径一致'
FROM core.factor_source s WHERE s.code = 'MEE_STEEL_GUIDE_A1';

-- 4. 已有数值的复核记录 -------------------------------------------------------------
UPDATE core.factor f
SET reviewed_by = 'Claude（AI 复核）', reviewed_at = now(),
    review_note = '已与 GB/T 2589-2020 原文表A.1/A.2 核对一致'
FROM core.factor_source s
WHERE f.source_id = s.source_id AND s.code = 'GBT2589_2020_A'
  AND f.energy_type_code IN ('ELEC_GRID','NATURAL_GAS','DIESEL','HEAT_FOSSIL','HEAT_NONFOSSIL');

UPDATE core.factor f
SET reviewed_by = 'Claude（AI 复核）', reviewed_at = now(),
    review_note = '与 910 号文附件4 原文一致：化石能源热力缺省值 0.11 tCO2/GJ，非化石热力计 0'
FROM core.factor_source s
WHERE f.source_id = s.source_id AND s.code = 'NDRC_2025_910_A4'
  AND f.energy_type_code IN ('HEAT_FOSSIL','HEAT_NONFOSSIL');

UPDATE core.factor f
SET variant = 'model_doc_apx_b',
    reviewed_by = 'Claude（AI 复核）', reviewed_at = now(),
    review_note = CASE f.energy_type_code
      WHEN 'NATURAL_GAS' THEN '57.2 与生态环境部指南（55.61）及 IPCC 2006 缺省值（56.1）均不一致，来源不明，不建议采用'
      WHEN 'DIESEL'      THEN '74.1 为 IPCC 2006 缺省值；国内核算建议采用生态环境部指南口径 72.59'
      ELSE '数值与 IPCC 2006 缺省值一致；国内核算建议改用生态环境部指南附表A.1 参数'
    END
FROM core.factor_source s
WHERE f.source_id = s.source_id AND s.code = 'MODEL_DOC_APX_B';

-- 5. 各评价标准的因子偏好（建议值，可在后台调整）-------------------------------------
UPDATE core.standard_version
SET factor_preferences = '{"ELEC_GRID":"henan","NATURAL_GAS":"mee_guideline","DIESEL":"mee_guideline","HEAT_FOSSIL":"default"}'
WHERE code IN ('GIP_2024','GIP_2025','GIP_2026');

UPDATE core.standard_version
SET factor_preferences = '{"ELEC_GRID":"national_fossil","NATURAL_GAS":"mee_guideline","DIESEL":"mee_guideline","HEAT_FOSSIL":"default"}'
WHERE code = 'ZCP_2025';

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0010', '复核电网电力、天然气、热力、柴油因子；新增 2021–2023 年官方电力因子与生态环境部燃料参数；设置各标准因子偏好');
