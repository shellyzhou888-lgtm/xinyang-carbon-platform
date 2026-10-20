-- 0016 公式出处与批准、人均工业增加值口径修正、绿色建筑口径落实、补录其他燃料参数
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。
-- 依据：项目负责人 2026-10-20 在会话中同意：有原文出处的 17 条公式批准，推定的 5 条保持草稿。
-- 2024 版原文：policies/green-industrial-park/2024_MIIT-2024-13_green-factory-cultivation-measures_annex2-old-park-criteria-31items-lead-values_provincial-basis.pdf

SET ROLE greensystem;

-- 1. 人均工业增加值：原文分母为“园区年末工业企业从业人数”（PDF 第62页） ----------------
UPDATE core.metric_def
SET name = '年末工业企业从业人数', aggregation = 'last',
    description = '人均工业增加值分母，按原文取年末人数（工信部节〔2024〕13号 附件2，PDF 第62页）'
WHERE code = 'ECO_EMPLOYEES';

UPDATE core.import_field_map m
SET source_field = '年末从业人数（人）'
FROM core.import_template t
WHERE m.template_id = t.template_id AND t.code = 'ENT_ANNUAL_ECONOMIC' AND m.source_field = '从业人员年平均人数（人）';

-- 2. 绿色建筑：原文按面积计，且只计二星及以上（PDF 第60页） ------------------------------
UPDATE core.metric_def SET name = '新建工业建筑中绿色建筑面积（二星及以上）',
  description = '按 GB/T 50878《绿色工业建筑评价标准》获得二星及以上评级' WHERE code = 'INF_NEW_IND_GREEN_AREA';
UPDATE core.metric_def SET name = '新建公共建筑中绿色建筑面积（二星及以上）',
  description = '按 GB/T 50378《绿色建筑评价标准》获得二星及以上评级' WHERE code = 'INF_NEW_PUB_GREEN_AREA';

-- 3. 公式出处（写入描述，供依据溯源与 Agent 引用） ---------------------------------------
UPDATE core.formula f SET description = t.descr
FROM (VALUES
  ('F_ENERGY_OUTPUT',        '能源产出率（万元/tce）= 园区工业增加值（万元不变价）/ 能源综合消耗总量（tce）。出处：工信部节〔2024〕13号 附件2（PDF 第55页）；模型文档 页面一'),
  ('F_RENEWABLE_RATIO',      '可再生能源使用比例（%）= 工业企业可再生能源使用量（tce）/ 工业企业综合能耗总量（tce）×100%。出处：工信部节〔2024〕13号 附件2（PDF 第56页）；模型文档 页面二。2025/2026 版改称“可再生能源利用率”，沿用此式'),
  ('F_CLEAN_RATIO',          '清洁能源使用率（%）= 清洁能源使用量（tce）/ 终端能源消费总量（tce）×100%。出处：工信部节〔2024〕13号 附件2（PDF 第56页）；模型文档 页面二'),
  ('F_WATER_OUTPUT',         '水资源产出率（元/m3）= 园区工业增加值（万元不变价）/ 园区工业用新鲜水量（m3）；增加值 ×10000 由万元换算为元，与指标单位一致。出处：工信部节〔2024〕13号 附件2（PDF 第57页）；模型文档'),
  ('F_LAND_OUTPUT',          '土地资源产出率（亿元/km2）= 园区工业增加值（万元不变价）/ 园区工业用地面积（km2）；增加值 ÷10000 由万元换算为亿元。出处：工信部节〔2024〕13号 附件2（PDF 第57页）；模型文档'),
  ('F_SW_UTIL_RATE',         '工业固体废弃物综合利用率（%）= 综合利用量（t）/（产生量 + 综合利用往年贮存量）（t）×100%。出处：工信部节〔2024〕13号 附件2（PDF 第58页）；模型文档。2025/2026 版限定为一般工业固体废弃物'),
  ('F_WATER_REUSE_RATE',     '工业用水重复利用率（%）= 工业重复用水量（m3）/ 工业用水总量（m3）×100%，用水总量 = 新鲜水量 + 重复用水量。出处：工信部节〔2024〕13号 附件2（PDF 第58页）'),
  ('F_NEW_IND_GREEN_BLDG',   '新建工业建筑中绿色建筑的比例（%）= 新建工业建筑中绿色建筑面积（m2）/ 新建工业建筑面积（m2）×100%；绿色建筑指 GB/T 50878 二星及以上。出处：工信部节〔2024〕13号 附件2（PDF 第60页）'),
  ('F_NEW_PUB_GREEN_BLDG',   '新建公共建筑中绿色建筑的比例（%）= 新建公共建筑中绿色建筑面积（m2）/ 新建公共建筑面积（m2）×100%；绿色建筑指 GB/T 50378 二星及以上。出处：工信部节〔2024〕13号 附件2（PDF 第60页）'),
  ('F_GREEN_IND_SHARE',      '绿色产业增加值占园区工业增加值比例（%）= 绿色产业增加值（万元）/ 园区工业增加值（万元）×100%。出处：工信部节〔2024〕13号 附件2（PDF 第62页）；模型文档'),
  ('F_HIGHTECH_SHARE',       '高新技术产业产值占园区工业总产值比例（%）= 高新技术企业的工业产值之和（万元）/ 工业园区工业总产值（万元）×100%。出处：工信部节〔2024〕13号 附件2（PDF 第61–62页）；模型文档'),
  ('F_VA_PER_CAPITA',        '人均工业增加值（万元/人）= 园区工业增加值（万元）/ 园区年末工业企业从业人数（人）。出处：工信部节〔2024〕13号 附件2（PDF 第62页）'),
  ('F_WASTEWATER_INTENSITY', '单位工业增加值废水排放量（t/万元）= 园区工业废水排放总量（t）/ 园区工业增加值总量（万元）。出处：工信部节〔2024〕13号 附件2（PDF 第64页）'),
  ('F_POLLUTANT_ELASTICITY', '主要污染物排放弹性系数 = 各污染物（创建周期年均增长率 / 工业增加值创建周期年均增长率）之和 ÷ 污染物个数；周期按原文“三年”。出处：工信部节〔2024〕13号 附件2（PDF 第64页）'),
  ('F_CO2_VA_REDUCTION',     '万元工业增加值碳排放量消减率（%）= [1 −（验收年单位工业增加值 CO2 排放量 / 创建基准年单位工业增加值 CO2 排放量）^(1/创建周期)] ×100%。出处：工信部节〔2024〕13号 附件2（PDF 第64页）；模型文档 页面三'),
  ('F_CO2_PER_VA',           '单位工业增加值二氧化碳排放量（tCO2/万元）= 二氧化碳排放量 / 工业增加值。出处：模型文档 页面三；2025/2026 版评价要求指标名称'),
  ('F_CO2_PER_TCE',          '单位能耗二氧化碳排放量（tCO2/tce）= 二氧化碳排放量 / 综合能耗。出处：模型文档 页面三；发改环资〔2025〕910号 附件3“每消费一吨标准煤产生的碳排放量”（零碳园区口径电力按等价值折标）'),
  ('F_OUTPUT_CAGR3',         '【推定，官方计算说明待核】近三年工业总产值年均增长率（%）=（当年总产值 / 三年前总产值）^(1/3) − 1，按指标名称采用复合增长率'),
  ('F_GREEN_FACTORY_SHARE',  '【推定，官方计算说明待核】省以上绿色工厂总产值占园区工业总产值比例（%）= 省级及以上绿色工厂工业总产值 / 园区工业总产值 ×100%，按指标名称'),
  ('F_LEVEL2_SHARE',         '【推定，官方计算说明待核】单位产品能源消耗达到 2 级以上企业综合能源消耗占比（%）= 单耗达到能耗限额 2 级及以上企业的综合能耗 / 园区综合能耗 ×100%；“达 2 级”的判定方法待核'),
  ('F_CO2_ELASTICITY',       '【推定，官方计算说明待核】二氧化碳排放弹性系数 = CO2 排放量三年年均增长率 / 工业增加值三年年均增长率，参照主要污染物排放弹性系数'),
  ('F_WASTE_HEAT_RATE',      '【推定，官方计算说明待核】余热/余冷/余压综合利用率（%）。910 号附件3 定义为三类利用率的加权平均但未给权重，此式按回收利用量合计 / 资源量合计近似')
) AS t(code, descr)
WHERE f.code = t.code AND f.revision = 1;

-- 4. 批准有原文出处的 17 条公式 -----------------------------------------------------------
UPDATE core.formula
SET status = 'approved',
    reviewed_by = 'shellyzhou888-lgtm（项目负责人，2026-10-20 会话确认）',
    reviewed_at = now(),
    review_note = 'AI 已逐条对照原文核对（出处页码见描述）；有原文出处的 17 条批准，推定的 5 条保持草稿'
WHERE revision = 1 AND status = 'draft' AND code IN (
  'F_ENERGY_OUTPUT','F_RENEWABLE_RATIO','F_CLEAN_RATIO','F_WATER_OUTPUT','F_LAND_OUTPUT','F_SW_UTIL_RATE',
  'F_WATER_REUSE_RATE','F_NEW_IND_GREEN_BLDG','F_NEW_PUB_GREEN_BLDG','F_GREEN_IND_SHARE','F_HIGHTECH_SHARE',
  'F_VA_PER_CAPITA','F_WASTEWATER_INTENSITY','F_POLLUTANT_ELASTICITY','F_CO2_VA_REDUCTION','F_CO2_PER_VA','F_CO2_PER_TCE');

-- 5. 其他燃料参数（生态环境部钢铁行业指南 附表A.1；固体 99%、液体 98%、气体 99%） ------------
--    排放因子由原表参数计算：tCO2/TJ = 含碳量 × 1000 × 氧化率 × 44/12；tCO2/t = 热值(GJ/t) × 含碳量 × 氧化率 × 44/12
--    原煤未录入：附表按无烟煤、烟煤、褐煤细分，需确认煤种后再录。
WITH p(energy, ncv_gj, cc, ox) AS (VALUES
  ('GASOLINE',    43.070, 0.01890, 0.98),
  ('KEROSENE',    43.070, 0.01960, 0.98),
  ('FUEL_OIL',    41.816, 0.02110, 0.98),
  ('LPG',         50.179, 0.01720, 0.98),
  ('LNG',         51.498, 0.01720, 0.98),
  ('COKE',        28.435, 0.02942, 0.99),
  ('WASHED_COAL', 26.344, 0.02541, 0.99)
), rows(energy, kind, val, unit, note) AS (
  SELECT energy, 'ncv',            ncv_gj * 1000,                       'kJ/kg',   '原表 ' || ncv_gj || ' GJ/t' FROM p
  UNION ALL SELECT energy, 'carbon_content', cc,                         'tC/GJ',   NULL FROM p
  UNION ALL SELECT energy, 'oxidation_rate', ox,                         '1',       (ox * 100)::int || '%' FROM p
  UNION ALL SELECT energy, 'co2_per_tj',     round(cc * 1000 * ox * 44 / 12, 4), 'tCO2/TJ', '= 含碳量 × 1000 × 氧化率 × 44/12' FROM p
  UNION ALL SELECT energy, 'co2_per_unit',   round(ncv_gj * cc * ox * 44 / 12, 4), 'tCO2/t', '= 热值 × 含碳量 × 氧化率 × 44/12' FROM p
)
INSERT INTO core.factor (factor_kind, energy_type_code, basis, variant, value, unit, source_id, source_page,
                         note, reviewed_by, reviewed_at, review_note)
SELECT r.kind, r.energy, 'default', 'mee_guideline', r.val, r.unit, s.source_id, '附表A.1', r.note,
       'Claude（AI 复核）', now(), '已与原表核对；未批准，用到该燃料时由负责人批准'
FROM rows r JOIN core.factor_source s ON s.code = 'MEE_STEEL_GUIDE_A1';

-- 各标准的因子偏好补充这些燃料
UPDATE core.standard_version
SET factor_preferences = factor_preferences || '{"GASOLINE":"mee_guideline","KEROSENE":"mee_guideline","FUEL_OIL":"mee_guideline","LPG":"mee_guideline","LNG":"mee_guideline","COKE":"mee_guideline","WASHED_COAL":"mee_guideline"}'::jsonb
WHERE code IN ('GIP_2024','GIP_2025','GIP_2026','ZCP_2025');

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0016', '公式出处页码；批准有原文出处的 17 条公式；人均工业增加值改为年末人数；绿色建筑口径；补录 7 种燃料的生态环境部参数');
