-- 0007 参考数据：评价标准版本、三级基础量、公式、各版本指标、判定基准、版本对照、
--      能碳管理中心功能清单、术语、预警规则、减碳策略
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。
-- 公式均为 draft，经人工审核（approved）后才参与计算。

SET ROLE greensystem;

-- =====================================================================
-- 1. 标准版本
-- =====================================================================
INSERT INTO core.standard_version (code, name, doc_no, issued_on, scoring_method, total_score, is_primary, source_file, note) VALUES
  ('GIP_2024', '绿色工业园区评价要求（旧版，31 项，含引领值）', '工信部节〔2024〕13号 附件2', NULL, 'green_index', NULL, false,
   '2024_工信部节〔2024〕13号_绿色工厂梯度培育及管理暂行办法（附件2为旧版园区评价要求31项含引领值，省级获评依据）.pdf',
   '2024 年河南省省级绿色工业园区评审依据；GI = 100/24 × Σ无量纲值，作为已达标基线'),
  ('GIP_2025', '绿色工业园区评价要求（17 项，含类型与分值）', '工信厅节函〔2025〕390号 附件2', DATE '2025-09-28', 'weighted_score', 100, false,
   '2025_工信厅节函〔2025〕390号_附件2_绿色工业园区评价要求（园区17项，含类型和分值，黑龙江工信厅转发）.pdf',
   '一级分值：产业发展 18、能源利用 20、资源利用 20、基础设施 16、生态环境 26'),
  ('GIP_2026', '绿色工业园区评价要求（19 项，现行申报版）', '工信厅节函〔2026〕461号 附件2', DATE '2026-09-24', 'weighted_score', NULL, true,
   '2026_工信厅节函〔2026〕461号_附件2_绿色工业园区评价要求（园区19项，仅名称和单位，现行申报版）.pdf',
   '原件只有名称和单位；类型与分值暂按 2025 版对应指标，新增第 14、18 项分值待官方公布'),
  ('ZCP_2025', '国家级零碳园区建设指标体系（试行）', '发改环资〔2025〕910号 附件3', NULL, 'threshold', NULL, false,
   '⭐2025_发改环资〔2025〕910号_关于开展零碳园区建设的通知（含零碳园区指标体系与碳排放核算方法）.pdf',
   '核心指标必须达到；引导指标为参考。只在达到时作为亮点展示');

-- =====================================================================
-- 2. 三级基础量
-- =====================================================================
INSERT INTO core.metric_def (code, name, unit, category, aggregation, dim_kind, description) VALUES
  ('ECO_GROSS_OUTPUT',          '工业总产值',                         '万元', 'economic',       'sum',  NULL, NULL),
  ('ECO_VA_CONST',              '工业增加值（不变价）',               '万元', 'economic',       'sum',  NULL, '能源产出率、水资源产出率等均按不变价'),
  ('ECO_GREEN_FACTORY_OUTPUT',  '省级及以上绿色工厂工业总产值',       '万元', 'economic',       'sum',  NULL, '可由企业荣誉（counts_for_indicator）与企业产值汇总得到'),
  ('ECO_HIGHTECH_OUTPUT',       '高新技术企业工业总产值',             '万元', 'economic',       'sum',  NULL, '依据《高新技术企业认定管理办法》认定的工业企业'),
  ('ECO_GREEN_IND_VA',          '绿色产业增加值',                     '万元', 'economic',       'sum',  NULL, '按《战略性新兴产业分类》节能环保产业和新能源产业统计（旧版指标）'),
  ('ECO_EMPLOYEES',             '工业从业人员',                       '人',   'economic',       'avg',  NULL, NULL),
  ('ENG_TCE',                   '综合能耗',                           'tce',  'energy',         'sum',  NULL, 'GB/T 2589：Σ(各能源实物量 × 折标准煤系数)，由能源活动计算'),
  ('ENG_TERMINAL_TCE',          '终端能源消费量',                     'tce',  'energy',         'sum',  NULL, '清洁能源使用率分母'),
  ('ENG_CLEAN_TCE',             '清洁能源使用量',                     'tce',  'energy',         'sum',  NULL, '按 energy_type.is_clean 汇总'),
  ('ENG_RENEWABLE_TCE',         '可再生能源使用量',                   'tce',  'energy',         'sum',  NULL, '按 energy_type.is_renewable 汇总'),
  ('ENG_LEVEL2_ENT_TCE',        '单位产品能耗达到 2 级以上企业的综合能耗', 'tce', 'energy',      'sum',  NULL, '企业单耗对照适用的能耗限额国标'),
  ('ENG_WASTE_HEAT_RECOVERED',  '余热、余冷、余压回收利用量',         'GJ',   'energy',         'sum',  NULL, NULL),
  ('ENG_WASTE_HEAT_AVAILABLE',  '余热、余冷、余压资源量',             'GJ',   'energy',         'sum',  NULL, NULL),
  ('CO2_TOTAL',                 '二氧化碳排放量',                     'tCO2', 'carbon',         'sum',  NULL, '按 910 号附件 4 核算，由碳核算结果汇总'),
  ('RES_FRESH_WATER',           '工业用新鲜水量',                     'm3',   'resource',       'sum',  NULL, NULL),
  ('RES_WATER_REUSED',          '工业重复利用水量',                   'm3',   'resource',       'sum',  NULL, NULL),
  ('RES_INDUSTRIAL_LAND',       '工业用地面积',                       'km2',  'resource',       'last', NULL, '规划范围内已投产的工业用地'),
  ('RES_SW_GENERATED',          '一般工业固体废物产生量',             't',    'resource',       'sum',  NULL, NULL),
  ('RES_SW_UTILIZED',           '一般工业固体废物综合利用量',         't',    'resource',       'sum',  NULL, '含当年利用往年贮存量'),
  ('RES_SW_STOCK_UTILIZED',     '综合利用往年贮存量',                 't',    'resource',       'sum',  NULL, NULL),
  ('ENV_WASTEWATER',            '工业废水排放量',                     't',    'environment',    'sum',  NULL, '不含企业梯级利用的废水和生活废水'),
  ('ENV_POLLUTANT',             '主要污染物排放量',                   't',    'environment',    'sum',  'pollutant', 'COD、SO2、氨氮、NOx 等，按 dim_code 区分'),
  ('INF_NEW_IND_BLDG_AREA',     '新建工业建筑面积',                   'm2',   'infrastructure', 'sum',  NULL, NULL),
  ('INF_NEW_IND_GREEN_AREA',    '新建工业建筑中绿色建筑面积',         'm2',   'infrastructure', 'sum',  NULL, NULL),
  ('INF_NEW_PUB_BLDG_AREA',     '新建公共建筑面积',                   'm2',   'infrastructure', 'sum',  NULL, NULL),
  ('INF_NEW_PUB_GREEN_AREA',    '新建公共建筑中绿色建筑面积',         'm2',   'infrastructure', 'sum',  NULL, NULL),
  ('PROD_OUTPUT',               '产品产量',                           '件',   'production',     'sum',  'product', '按 dim_code 区分产品，实际单位记在数据行上');

-- =====================================================================
-- 3. 公式（表达式记法：变量为基础量编码；cagr(X,n) 为 n 年年均增长率；
--    lag(X,n) 为 n 年前的值；avg_dim(expr, dim) 为按附加维度求平均）
-- =====================================================================
INSERT INTO core.formula (code, expression, variables, description) VALUES
  ('F_ENERGY_OUTPUT',         'ECO_VA_CONST / ENG_TCE', ARRAY['ECO_VA_CONST','ENG_TCE'],
   '能源产出率（万元/tce）= 工业增加值（不变价）/ 综合能耗。来源：旧版附件2、模型文档'),
  ('F_RENEWABLE_RATIO',       'ENG_RENEWABLE_TCE / ENG_TCE * 100', ARRAY['ENG_RENEWABLE_TCE','ENG_TCE'],
   '可再生能源使用比例/利用率（%）= 可再生能源使用量 / 综合能耗 × 100。来源：旧版附件2、模型文档'),
  ('F_CLEAN_RATIO',           'ENG_CLEAN_TCE / ENG_TERMINAL_TCE * 100', ARRAY['ENG_CLEAN_TCE','ENG_TERMINAL_TCE'],
   '清洁能源使用率（%）= 清洁能源使用量 / 终端能源消费总量 × 100。来源：旧版附件2、模型文档'),
  ('F_LEVEL2_SHARE',          'ENG_LEVEL2_ENT_TCE / ENG_TCE * 100', ARRAY['ENG_LEVEL2_ENT_TCE','ENG_TCE'],
   '单位产品能耗达到 2 级以上企业综合能源消耗占比（%）。来源：2025/2026 版附件2（官方计算说明待补）'),
  ('F_WATER_OUTPUT',          'ECO_VA_CONST * 10000 / RES_FRESH_WATER', ARRAY['ECO_VA_CONST','RES_FRESH_WATER'],
   '水资源产出率（元/m3）= 工业增加值 / 工业用新鲜水量；增加值由万元换算为元'),
  ('F_LAND_OUTPUT',           'ECO_VA_CONST / 10000 / RES_INDUSTRIAL_LAND', ARRAY['ECO_VA_CONST','RES_INDUSTRIAL_LAND'],
   '土地资源产出率（亿元/km2）= 工业增加值 / 工业用地面积；增加值由万元换算为亿元'),
  ('F_SW_UTIL_RATE',          'RES_SW_UTILIZED / (RES_SW_GENERATED + RES_SW_STOCK_UTILIZED) * 100',
   ARRAY['RES_SW_UTILIZED','RES_SW_GENERATED','RES_SW_STOCK_UTILIZED'],
   '工业固体废物综合利用率（%）= 综合利用量 / (产生量 + 综合利用往年贮存量) × 100。来源：旧版附件2、模型文档'),
  ('F_WATER_REUSE_RATE',      'RES_WATER_REUSED / (RES_WATER_REUSED + RES_FRESH_WATER) * 100',
   ARRAY['RES_WATER_REUSED','RES_FRESH_WATER'],
   '工业用水重复利用率（%）= 重复利用水量 / (重复利用水量 + 新鲜水量) × 100'),
  ('F_WASTE_HEAT_RATE',       'ENG_WASTE_HEAT_RECOVERED / ENG_WASTE_HEAT_AVAILABLE * 100',
   ARRAY['ENG_WASTE_HEAT_RECOVERED','ENG_WASTE_HEAT_AVAILABLE'],
   '余热/余冷/余压综合利用率（%）。910 号附件3 定义为三类利用率的加权平均，权重口径待确认，此式为合并计算的近似'),
  ('F_OUTPUT_CAGR3',          'cagr(ECO_GROSS_OUTPUT, 3) * 100', ARRAY['ECO_GROSS_OUTPUT'],
   '近三年工业总产值年均增长率（%）'),
  ('F_GREEN_FACTORY_SHARE',   'ECO_GREEN_FACTORY_OUTPUT / ECO_GROSS_OUTPUT * 100', ARRAY['ECO_GREEN_FACTORY_OUTPUT','ECO_GROSS_OUTPUT'],
   '省以上绿色工厂总产值占园区工业总产值比例（%）'),
  ('F_HIGHTECH_SHARE',        'ECO_HIGHTECH_OUTPUT / ECO_GROSS_OUTPUT * 100', ARRAY['ECO_HIGHTECH_OUTPUT','ECO_GROSS_OUTPUT'],
   '高新技术企业工业总产值占园区工业总产值比例（%）。来源：模型文档'),
  ('F_GREEN_IND_SHARE',       'ECO_GREEN_IND_VA / ECO_VA_CONST * 100', ARRAY['ECO_GREEN_IND_VA','ECO_VA_CONST'],
   '绿色产业增加值占园区工业增加值比例（%）。来源：模型文档（旧版指标）'),
  ('F_VA_PER_CAPITA',         'ECO_VA_CONST / ECO_EMPLOYEES', ARRAY['ECO_VA_CONST','ECO_EMPLOYEES'],
   '人均工业增加值（万元/人）'),
  ('F_NEW_IND_GREEN_BLDG',    'INF_NEW_IND_GREEN_AREA / INF_NEW_IND_BLDG_AREA * 100', ARRAY['INF_NEW_IND_GREEN_AREA','INF_NEW_IND_BLDG_AREA'],
   '新建工业建筑中绿色建筑的比例（%），按建筑面积计（口径待核实）'),
  ('F_NEW_PUB_GREEN_BLDG',    'INF_NEW_PUB_GREEN_AREA / INF_NEW_PUB_BLDG_AREA * 100', ARRAY['INF_NEW_PUB_GREEN_AREA','INF_NEW_PUB_BLDG_AREA'],
   '新建公共建筑中绿色建筑的比例（%），按建筑面积计（口径待核实）'),
  ('F_WASTEWATER_INTENSITY',  'ENV_WASTEWATER / ECO_VA_CONST', ARRAY['ENV_WASTEWATER','ECO_VA_CONST'],
   '单位工业增加值废水排放量（t/万元）。来源：旧版附件2'),
  ('F_POLLUTANT_ELASTICITY',  'avg_dim(cagr(ENV_POLLUTANT, 3) / cagr(ECO_VA_CONST, 3), pollutant)', ARRAY['ENV_POLLUTANT','ECO_VA_CONST'],
   '主要污染物排放弹性系数 = 各污染物排放量年均增长率 / 工业增加值年均增长率 的算术平均。来源：旧版附件2'),
  ('F_CO2_PER_VA',            'CO2_TOTAL / ECO_VA_CONST', ARRAY['CO2_TOTAL','ECO_VA_CONST'],
   '单位工业增加值二氧化碳排放量（tCO2/万元）。来源：模型文档'),
  ('F_CO2_PER_TCE',           'CO2_TOTAL / ENG_TCE', ARRAY['CO2_TOTAL','ENG_TCE'],
   '单位能耗二氧化碳排放量（tCO2/tce）。来源：模型文档、910 号附件3（零碳园区口径电力按等价值折标）'),
  ('F_CO2_ELASTICITY',        'cagr(CO2_TOTAL, 3) / cagr(ECO_VA_CONST, 3)', ARRAY['CO2_TOTAL','ECO_VA_CONST'],
   '二氧化碳排放弹性系数，参照主要污染物弹性系数的定义（官方计算说明待补）'),
  ('F_CO2_VA_REDUCTION',      '(1 - power((CO2_TOTAL / ECO_VA_CONST) / lag(CO2_TOTAL / ECO_VA_CONST, period_years), 1.0 / period_years)) * 100',
   ARRAY['CO2_TOTAL','ECO_VA_CONST'],
   '万元工业增加值碳排放量消减率（%），period_years 为创建周期。来源：旧版附件2、模型文档');

-- =====================================================================
-- 4. 指标定义
-- =====================================================================
-- 4.1 一级指标
INSERT INTO core.indicator_def (version_id, code, level, seq, name, score)
SELECT v.version_id, t.code, 1, t.seq, t.name, t.score
FROM (VALUES
  ('GIP_2024', 'EG', 1, '能源利用绿色化指标', NULL::numeric),
  ('GIP_2024', 'RG', 2, '资源利用绿色化指标', NULL),
  ('GIP_2024', 'IG', 3, '基础设施绿色化指标', NULL),
  ('GIP_2024', 'CG', 4, '产业绿色化指标', NULL),
  ('GIP_2024', 'HG', 5, '生态环境绿色化指标', NULL),
  ('GIP_2024', 'MG', 6, '运行管理绿色化指标', NULL),
  ('GIP_2025', 'IND', 1, '产业发展', 18),
  ('GIP_2025', 'ENE', 2, '能源利用', 20),
  ('GIP_2025', 'RES', 3, '资源利用', 20),
  ('GIP_2025', 'INF', 4, '基础设施', 16),
  ('GIP_2025', 'ECO', 5, '生态环境', 26),
  ('GIP_2026', 'IND', 1, '产业发展', NULL),
  ('GIP_2026', 'ENE', 2, '能源利用', NULL),
  ('GIP_2026', 'RES', 3, '资源利用', NULL),
  ('GIP_2026', 'INF', 4, '基础设施', NULL),
  ('GIP_2026', 'ECO', 5, '生态环境', NULL),
  ('ZCP_2025', 'CORE',  1, '核心指标', NULL),
  ('ZCP_2025', 'GUIDE', 2, '引导指标', NULL)
) AS t(ver, code, seq, name, score)
JOIN core.standard_version v ON v.code = t.ver;

-- 4.2 二级指标
--   字段：版本, 编码, 上级, 序号, 名称, 单位, 方向, 原文类型, 分值, 选择组, 组内需选, 处理方式, 公式, 展示位置, 出处
INSERT INTO core.indicator_def
  (version_id, code, level, parent_id, seq, name, unit, direction, indicator_type, score,
   select_group, select_count, handling, formula_id, display_position, source_page)
SELECT v.version_id, t.code, 2, p.indicator_id, t.seq, t.name, t.unit, t.dir, t.itype, t.score,
       t.grp, t.grp_n, t.handling, f.formula_id, t.disp, t.src
FROM (VALUES
  -- 2024 旧版（31 项，可选组：RG_4_2 四选二，IG_2_1A/IG_2_1B/CG_2_1 二选一，HG_3_1 三选一）
  ('GIP_2024','I01','EG', 1,'能源产出率','万元/tce','positive','必选',NULL::numeric,'required',NULL::smallint,'deep_calc','F_ENERGY_OUTPUT','overview_left;energy_intensity','附表2.1'),
  ('GIP_2024','I02','EG', 2,'可再生能源使用比例','%','positive','必选',NULL,'required',NULL,'deep_calc','F_RENEWABLE_RATIO','overview_left;renewable','附表2.1'),
  ('GIP_2024','I03','EG', 3,'清洁能源使用率','%','positive','必选',NULL,'required',NULL,'deep_calc','F_CLEAN_RATIO','overview_left;energy_consumption','附表2.1'),
  ('GIP_2024','I04','RG', 4,'水资源产出率','元/m3','positive','必选',NULL,'required',NULL,'calc','F_WATER_OUTPUT','overview_top_resource','附表2.1'),
  ('GIP_2024','I05','RG', 5,'土地资源产出率','亿元/km2','positive','必选',NULL,'required',NULL,'calc','F_LAND_OUTPUT','overview_top_resource','附表2.1'),
  ('GIP_2024','I06','RG', 6,'工业固体废弃物综合利用率','%','positive','必选',NULL,'required',NULL,'calc','F_SW_UTIL_RATE','overview_top_resource','附表2.1'),
  ('GIP_2024','I07','RG', 7,'工业用水重复利用率','%','positive','必选',NULL,'required',NULL,'calc','F_WATER_REUSE_RATE','overview_top_resource','附表2.1'),
  ('GIP_2024','I08','RG', 8,'中水回用率','%','positive','4项选2项',NULL,'RG_4_2',2,'manual',NULL,'overview_top_resource','附表2.1'),
  ('GIP_2024','I09','RG', 9,'余热资源回收利用率','%','positive','4项选2项',NULL,'RG_4_2',2,'manual',NULL,'overview_top_resource;energy_flow','附表2.1'),
  ('GIP_2024','I10','RG',10,'废气资源回收利用率','%','positive','4项选2项',NULL,'RG_4_2',2,'manual',NULL,'overview_top_resource','附表2.1'),
  ('GIP_2024','I11','RG',11,'再生资源回收利用率','%','positive','4项选2项',NULL,'RG_4_2',2,'manual',NULL,'overview_top_resource','附表2.1'),
  ('GIP_2024','I12','IG',12,'污水集中处理设施',NULL,'qualitative','必选',NULL,'required',NULL,'manual',NULL,'overview_top_infrastructure','附表2.1'),
  ('GIP_2024','I13','IG',13,'新建工业建筑中绿色建筑的比例','%','positive','2项选1项',NULL,'IG_2_1A',1,'calc','F_NEW_IND_GREEN_BLDG','overview_top_infrastructure','附表2.1'),
  ('GIP_2024','I14','IG',14,'新建公共建筑中绿色建筑的比例','%','positive','2项选1项',NULL,'IG_2_1A',1,'calc','F_NEW_PUB_GREEN_BLDG','overview_top_infrastructure','附表2.1'),
  ('GIP_2024','I15','IG',15,'500米公交站点覆盖率','%','positive','2项选1项',NULL,'IG_2_1B',1,'manual',NULL,'overview_top_infrastructure','附表2.1'),
  ('GIP_2024','I16','IG',16,'节能与新能源公交车比例','%','positive','2项选1项',NULL,'IG_2_1B',1,'manual',NULL,'overview_top_infrastructure','附表2.1'),
  ('GIP_2024','I17','CG',17,'高新技术产业产值占园区工业总产值比例','%','positive','必选',NULL,'required',NULL,'calc','F_HIGHTECH_SHARE','overview_top_industry','附表2.1'),
  ('GIP_2024','I18','CG',18,'绿色产业增加值占园区工业增加值比例','%','positive','必选',NULL,'required',NULL,'calc','F_GREEN_IND_SHARE','overview_top_industry','附表2.1'),
  ('GIP_2024','I19','CG',19,'人均工业增加值','万元/人','positive','2项选1项',NULL,'CG_2_1',1,'calc','F_VA_PER_CAPITA','overview_top_industry','附表2.1'),
  ('GIP_2024','I20','CG',20,'现代服务业比例','%','positive','2项选1项',NULL,'CG_2_1',1,'manual',NULL,'overview_top_industry','附表2.1'),
  ('GIP_2024','I21','HG',21,'工业固体废弃物（含危废）处置利用率','%','positive','必选',NULL,'required',NULL,'manual',NULL,'ecology_summary','附表2.1'),
  ('GIP_2024','I22','HG',22,'万元工业增加值碳排放量消减率','%','positive','必选',NULL,'required',NULL,'deep_calc','F_CO2_VA_REDUCTION','overview_right;carbon_intensity','附表2.1'),
  ('GIP_2024','I23','HG',23,'单位工业增加值废水排放量','t/万元','negative','必选（逆向）',NULL,'required',NULL,'calc','F_WASTEWATER_INTENSITY','ecology_summary','附表2.1'),
  ('GIP_2024','I24','HG',24,'主要污染物弹性系数',NULL,'negative','必选（逆向）',NULL,'required',NULL,'calc','F_POLLUTANT_ELASTICITY','ecology_summary','附表2.1'),
  ('GIP_2024','I25','HG',25,'园区空气质量优良率','%','positive','必选',NULL,'required',NULL,'manual',NULL,'ecology_summary','附表2.1'),
  ('GIP_2024','I26','HG',26,'绿化覆盖率','%','positive','3项选1项',NULL,'HG_3_1',1,'manual',NULL,'ecology_summary','附表2.1'),
  ('GIP_2024','I27','HG',27,'道路遮荫比例','%','positive','3项选1项',NULL,'HG_3_1',1,'manual',NULL,'ecology_summary','附表2.1'),
  ('GIP_2024','I28','HG',28,'露天停车场遮荫比例','%','positive','3项选1项',NULL,'HG_3_1',1,'manual',NULL,'ecology_summary','附表2.1'),
  ('GIP_2024','I29','MG',29,'绿色工业园区标准体系完善程度',NULL,'qualitative','必选',NULL,'required',NULL,'manual',NULL,'management_summary','附表2.1'),
  ('GIP_2024','I30','MG',30,'编制绿色工业园区发展规划',NULL,'qualitative','必选',NULL,'required',NULL,'manual',NULL,'management_summary','附表2.1'),
  ('GIP_2024','I31','MG',31,'绿色工业园区信息平台完善程度',NULL,'qualitative','必选',NULL,'required',NULL,'self_proof',NULL,'management_summary','附表2.1'),
  -- 2025 版（17 项，合计 100 分）
  ('GIP_2025','I01','IND', 1,'近三年工业总产值年均增长率','%','positive','正向定量',4,NULL,NULL,'calc','F_OUTPUT_CAGR3','overview_top_industry','附件2'),
  ('GIP_2025','I02','IND', 2,'省以上绿色工厂总产值占园区工业总产值比例','%','positive','正向定量',7,NULL,NULL,'calc','F_GREEN_FACTORY_SHARE','overview_top_industry','附件2'),
  ('GIP_2025','I03','IND', 3,'高新技术企业工业总产值占园区工业总产值比例','%','positive','正向定量',7,NULL,NULL,'calc','F_HIGHTECH_SHARE','overview_top_industry','附件2'),
  ('GIP_2025','I04','ENE', 4,'能源产出率','万元/tce','positive','正向定量',7,NULL,NULL,'deep_calc','F_ENERGY_OUTPUT','overview_left;energy_intensity','附件2'),
  ('GIP_2025','I05','ENE', 5,'可再生能源利用率','%','positive','正向定量',7,NULL,NULL,'deep_calc','F_RENEWABLE_RATIO','overview_left;renewable','附件2'),
  ('GIP_2025','I06','ENE', 6,'单位产品能源消耗达到2级以上企业综合能源消耗占比','%','positive','正向定量',6,NULL,NULL,'deep_calc','F_LEVEL2_SHARE','energy_intensity','附件2'),
  ('GIP_2025','I07','RES', 7,'水资源产出率','元/m3','positive','正向定量',7,NULL,NULL,'calc','F_WATER_OUTPUT','overview_top_resource','附件2'),
  ('GIP_2025','I08','RES', 8,'土地资源产出率','亿元/km2','positive','正向定量',6,NULL,NULL,'calc','F_LAND_OUTPUT','overview_top_resource','附件2'),
  ('GIP_2025','I09','RES', 9,'一般工业固体废弃物综合利用率','%','positive','正向定量',7,NULL,NULL,'calc','F_SW_UTIL_RATE','overview_top_resource','附件2'),
  ('GIP_2025','I10','INF',10,'新建工业建筑中绿色建筑的比例','%','positive','正向定量',3,NULL,NULL,'calc','F_NEW_IND_GREEN_BLDG','overview_top_infrastructure','附件2'),
  ('GIP_2025','I11','INF',11,'新建公共建筑中绿色建筑的比例','%','positive','正向定量',3,NULL,NULL,'calc','F_NEW_PUB_GREEN_BLDG','overview_top_infrastructure','附件2'),
  ('GIP_2025','I12','INF',12,'建设园区工业绿色微电网',NULL,'qualitative','正向定性',5,NULL,NULL,'manual',NULL,'overview_top_infrastructure','附件2'),
  ('GIP_2025','I13','INF',13,'建设园区能碳管理中心',NULL,'qualitative','正向定性',5,NULL,NULL,'self_proof',NULL,'overview_top_infrastructure','附件2'),
  ('GIP_2025','I14','ECO',14,'单位工业增加值废水排放量','t/万元','negative','逆向定量',6,NULL,NULL,'calc','F_WASTEWATER_INTENSITY','ecology_summary','附件2'),
  ('GIP_2025','I15','ECO',15,'主要污染物排放弹性系数',NULL,'elastic','弹性系数',6,NULL,NULL,'calc','F_POLLUTANT_ELASTICITY','ecology_summary','附件2'),
  ('GIP_2025','I16','ECO',16,'单位工业增加值二氧化碳排放量','tCO2/万元','negative','逆向定量',7,NULL,NULL,'deep_calc','F_CO2_PER_VA','overview_right;carbon_intensity','附件2'),
  ('GIP_2025','I17','ECO',17,'二氧化碳排放弹性系数',NULL,'elastic','弹性系数',7,NULL,NULL,'deep_calc','F_CO2_ELASTICITY','carbon_analysis','附件2'),
  -- 2026 版（19 项，主版本；类型与分值暂按 2025 版对应指标）
  ('GIP_2026','I01','IND', 1,'近三年工业总产值年均增长率','%','positive','正向定量',4,NULL,NULL,'calc','F_OUTPUT_CAGR3','overview_top_industry','附件2'),
  ('GIP_2026','I02','IND', 2,'省以上绿色工厂总产值占园区工业总产值比例','%','positive','正向定量',7,NULL,NULL,'calc','F_GREEN_FACTORY_SHARE','overview_top_industry','附件2'),
  ('GIP_2026','I03','IND', 3,'高新技术企业工业总产值占园区工业总产值比例','%','positive','正向定量',7,NULL,NULL,'calc','F_HIGHTECH_SHARE','overview_top_industry','附件2'),
  ('GIP_2026','I04','ENE', 4,'能源产出率','万元/tce','positive','正向定量',7,NULL,NULL,'deep_calc','F_ENERGY_OUTPUT','overview_left;energy_intensity','附件2'),
  ('GIP_2026','I05','ENE', 5,'可再生能源利用率','%','positive','正向定量',7,NULL,NULL,'deep_calc','F_RENEWABLE_RATIO','overview_left;renewable','附件2'),
  ('GIP_2026','I06','ENE', 6,'单位产品能源消耗达到2级以上企业综合能源消耗占比','%','positive','正向定量',6,NULL,NULL,'deep_calc','F_LEVEL2_SHARE','energy_intensity','附件2'),
  ('GIP_2026','I07','RES', 7,'水资源产出率','元/m3','positive','正向定量',7,NULL,NULL,'calc','F_WATER_OUTPUT','overview_top_resource','附件2'),
  ('GIP_2026','I08','RES', 8,'土地资源产出率','亿元/km2','positive','正向定量',6,NULL,NULL,'calc','F_LAND_OUTPUT','overview_top_resource','附件2'),
  ('GIP_2026','I09','RES', 9,'一般工业固体废弃物综合利用率','%','positive','正向定量',7,NULL,NULL,'calc','F_SW_UTIL_RATE','overview_top_resource','附件2'),
  ('GIP_2026','I10','INF',10,'新建工业建筑中绿色建筑的比例','%','positive','正向定量',3,NULL,NULL,'calc','F_NEW_IND_GREEN_BLDG','overview_top_infrastructure','附件2'),
  ('GIP_2026','I11','INF',11,'新建公共建筑中绿色建筑的比例','%','positive','正向定量',3,NULL,NULL,'calc','F_NEW_PUB_GREEN_BLDG','overview_top_infrastructure','附件2'),
  ('GIP_2026','I12','INF',12,'园区工业绿色微电网功能符合数量','项','positive','待公布（2025版为正向定性）',5,NULL,NULL,'manual',NULL,'overview_top_infrastructure','附件2'),
  ('GIP_2026','I13','INF',13,'园区能碳管理中心功能符合数量','项','positive','待公布（2025版为正向定性）',5,NULL,NULL,'self_proof',NULL,'overview_top_infrastructure','附件2'),
  ('GIP_2026','I14','INF',14,'园区信息平台完善程度','%','positive','待公布（2026版新增）',NULL,NULL,NULL,'self_proof',NULL,'overview_top_infrastructure','附件2'),
  ('GIP_2026','I15','ECO',15,'单位工业增加值废水排放量','t/万元','negative','逆向定量',6,NULL,NULL,'calc','F_WASTEWATER_INTENSITY','ecology_summary','附件2'),
  ('GIP_2026','I16','ECO',16,'主要污染物排放弹性系数',NULL,'elastic','弹性系数',6,NULL,NULL,'calc','F_POLLUTANT_ELASTICITY','ecology_summary','附件2'),
  ('GIP_2026','I17','ECO',17,'单位工业增加值二氧化碳排放量','tCO2/万元','negative','逆向定量',7,NULL,NULL,'deep_calc','F_CO2_PER_VA','overview_right;carbon_intensity','附件2'),
  ('GIP_2026','I18','ECO',18,'单位能耗二氧化碳排放量','tCO2/tce','negative','待公布（2026版新增）',NULL,NULL,NULL,'deep_calc','F_CO2_PER_TCE','overview_right;carbon_intensity','附件2'),
  ('GIP_2026','I19','ECO',19,'二氧化碳排放弹性系数',NULL,'elastic','弹性系数',7,NULL,NULL,'deep_calc','F_CO2_ELASTICITY','carbon_analysis','附件2'),
  -- 零碳园区（910 号附件3）
  ('ZCP_2025','C01','CORE', 1,'单位能耗碳排放','tCO2/tce','negative','核心指标',NULL,'required',NULL,'deep_calc','F_CO2_PER_TCE','overview_right;carbon_intensity','附件3'),
  ('ZCP_2025','G01','GUIDE',2,'清洁能源消费占比','%','positive','引导指标',NULL,NULL,NULL,'deep_calc','F_CLEAN_RATIO','energy_consumption','附件3'),
  ('ZCP_2025','G02','GUIDE',3,'园区企业产出产品单位能耗',NULL,'qualitative','引导指标',NULL,NULL,NULL,'manual',NULL,'energy_intensity','附件3'),
  ('ZCP_2025','G03','GUIDE',4,'工业固体废弃物综合利用率','%','positive','引导指标',NULL,NULL,NULL,'calc','F_SW_UTIL_RATE','overview_top_resource','附件3'),
  ('ZCP_2025','G04','GUIDE',5,'余热/余冷/余压综合利用率','%','positive','引导指标',NULL,NULL,NULL,'calc','F_WASTE_HEAT_RATE','energy_flow','附件3'),
  ('ZCP_2025','G05','GUIDE',6,'工业用水重复利用率','%','positive','引导指标',NULL,NULL,NULL,'calc','F_WATER_REUSE_RATE','overview_top_resource','附件3')
) AS t(ver, code, parent, seq, name, unit, dir, itype, score, grp, grp_n, handling, formula, disp, src)
JOIN core.standard_version v ON v.code = t.ver
JOIN core.indicator_def p ON p.version_id = v.version_id AND p.code = t.parent AND p.level = 1
LEFT JOIN core.formula f ON f.code = t.formula AND f.revision = 1;

-- =====================================================================
-- 5. 判定基准
-- =====================================================================
-- 5.1 2024 旧版引领值（附表2.1）
INSERT INTO core.indicator_benchmark (indicator_id, benchmark_type, value, value_text, comparator, source_doc, source_page)
SELECT d.indicator_id, 'lead_value', t.val, t.txt, t.cmp, '工信部节〔2024〕13号 附件2 附表2.1', 'PDF 第53页'
FROM (VALUES
  ('I01', 3::numeric, NULL, '>='), ('I02', 15, NULL, '>='), ('I03', 75, NULL, '>='),
  ('I04', 1500, NULL, '>='), ('I05', 15, NULL, '>='), ('I06', 95, NULL, '>='), ('I07', 90, NULL, '>='),
  ('I08', 30, NULL, '>='), ('I09', 60, NULL, '>='), ('I10', 90, NULL, '>='), ('I11', 80, NULL, '>='),
  ('I12', NULL, '具备', 'bool'),
  ('I13', 30, NULL, '>='), ('I14', 60, NULL, '>='), ('I15', 90, NULL, '>='), ('I16', 30, NULL, '>='),
  ('I17', 30, NULL, '>='), ('I18', 30, NULL, '>='), ('I19', 15, NULL, '>='), ('I20', 30, NULL, '>='),
  ('I21', 100, NULL, '>='), ('I22', 3, NULL, '>='), ('I23', 5, NULL, '<='), ('I24', 0.3, NULL, '<='),
  ('I25', 80, NULL, '>='), ('I26', 30, NULL, '>='), ('I27', 80, NULL, '>='), ('I28', 80, NULL, '>='),
  ('I29', NULL, '完善', 'bool'), ('I30', NULL, '是', 'bool'), ('I31', NULL, '完善', 'bool')
) AS t(code, val, txt, cmp)
JOIN core.standard_version v ON v.code = 'GIP_2024'
JOIN core.indicator_def d ON d.version_id = v.version_id AND d.code = t.code;

-- 5.2 零碳园区目标值（附件3）
INSERT INTO core.indicator_benchmark (indicator_id, benchmark_type, value, value_text, comparator, source_doc, source_page, note)
SELECT d.indicator_id, 'zero_carbon_target', t.val, t.txt, t.cmp, '发改环资〔2025〕910号 附件3', 'PDF 第11页', t.note
FROM (VALUES
  ('C01', 0.2::numeric, NULL, '<=', '适用于年综合能源消费量 20~100 万吨标准煤的园区；电力按等价值折标'),
  ('C01', 0.3,          NULL, '<=', '适用于年综合能源消费量 ≥100 万吨标准煤的园区'),
  ('G01', 90,           NULL, '>=', NULL),
  ('G02', NULL, '达到或优于二级能耗限额标准', 'bool', NULL),
  ('G03', 80,           NULL, '>=', NULL),
  ('G04', 50,           NULL, '>=', '三类利用率的加权平均值'),
  ('G05', 80,           NULL, '>=', NULL)
) AS t(code, val, txt, cmp, note)
JOIN core.standard_version v ON v.code = 'ZCP_2025'
JOIN core.indicator_def d ON d.version_id = v.version_id AND d.code = t.code;

-- =====================================================================
-- 6. 跨版本对照（2024 → 2026，2025 → 2026，零碳园区 → 2026）
-- =====================================================================
INSERT INTO core.indicator_mapping (from_indicator_id, to_indicator_id, relation, note)
SELECT f.indicator_id, d.indicator_id, t.rel, t.note
FROM (VALUES
  ('GIP_2024','I01','GIP_2026','I04','same',     NULL),
  ('GIP_2024','I02','GIP_2026','I05','renamed',  '可再生能源使用比例 → 可再生能源利用率'),
  ('GIP_2024','I04','GIP_2026','I07','same',     NULL),
  ('GIP_2024','I05','GIP_2026','I08','same',     NULL),
  ('GIP_2024','I06','GIP_2026','I09','narrowed', '工业固体废弃物 → 一般工业固体废弃物'),
  ('GIP_2024','I13','GIP_2026','I10','same',     NULL),
  ('GIP_2024','I14','GIP_2026','I11','same',     NULL),
  ('GIP_2024','I17','GIP_2026','I03','renamed',  '高新技术产业产值 → 高新技术企业工业总产值'),
  ('GIP_2024','I18','GIP_2026','I02','replaced', '绿色产业增加值占比 → 省以上绿色工厂总产值占比'),
  ('GIP_2024','I22','GIP_2026','I17','related',  '碳排放量消减率 → 单位工业增加值 CO2 排放量'),
  ('GIP_2024','I23','GIP_2026','I15','same',     NULL),
  ('GIP_2024','I24','GIP_2026','I16','renamed',  NULL),
  ('GIP_2024','I31','GIP_2026','I14','related',  '定性“完善” → 完善程度（%）'),
  ('GIP_2025','I01','GIP_2026','I01','same', NULL), ('GIP_2025','I02','GIP_2026','I02','same', NULL),
  ('GIP_2025','I03','GIP_2026','I03','same', NULL), ('GIP_2025','I04','GIP_2026','I04','same', NULL),
  ('GIP_2025','I05','GIP_2026','I05','same', NULL), ('GIP_2025','I06','GIP_2026','I06','same', NULL),
  ('GIP_2025','I07','GIP_2026','I07','same', NULL), ('GIP_2025','I08','GIP_2026','I08','same', NULL),
  ('GIP_2025','I09','GIP_2026','I09','same', NULL), ('GIP_2025','I10','GIP_2026','I10','same', NULL),
  ('GIP_2025','I11','GIP_2026','I11','same', NULL),
  ('GIP_2025','I12','GIP_2026','I12','replaced', '是否建设（定性） → 功能符合数量（项）'),
  ('GIP_2025','I13','GIP_2026','I13','replaced', '是否建设（定性） → 功能符合数量（项）'),
  ('GIP_2025','I14','GIP_2026','I15','same', NULL), ('GIP_2025','I15','GIP_2026','I16','same', NULL),
  ('GIP_2025','I16','GIP_2026','I17','same', NULL), ('GIP_2025','I17','GIP_2026','I19','same', NULL),
  ('ZCP_2025','C01','GIP_2026','I18','related', '同一计算式；零碳园区口径电力按等价值折标'),
  ('ZCP_2025','G03','GIP_2026','I09','related', NULL)
) AS t(fv, fc, tv, tc, rel, note)
JOIN core.standard_version fv ON fv.code = t.fv
JOIN core.indicator_def f ON f.version_id = fv.version_id AND f.code = t.fc
JOIN core.standard_version tv ON tv.code = t.tv
JOIN core.indicator_def d ON d.version_id = tv.version_id AND d.code = t.tc;

-- =====================================================================
-- 7. 能碳管理中心 12 项业务功能（工信部办公厅《工业企业和园区数字化能碳管理中心建设指南》）
-- =====================================================================
INSERT INTO core.function_item (checklist_code, seq, name, source_doc) VALUES
  ('carbon_center',  1, '能耗查询',                     '能碳管理中心建设指南 二、业务功能'),
  ('carbon_center',  2, '能源消费量和强度计算',         '能碳管理中心建设指南 二、业务功能'),
  ('carbon_center',  3, '能源消费分析与用能策略推荐',   '能碳管理中心建设指南 二、业务功能'),
  ('carbon_center',  4, '能效对标',                     '能碳管理中心建设指南 二、业务功能'),
  ('carbon_center',  5, '能流分析',                     '能碳管理中心建设指南 二、业务功能'),
  ('carbon_center',  6, '能效平衡与优化',               '能碳管理中心建设指南 二、业务功能'),
  ('carbon_center',  7, '用能与碳排放预算管理',         '能碳管理中心建设指南 二、业务功能'),
  ('carbon_center',  8, '碳排放核算',                   '能碳管理中心建设指南 二、业务功能'),
  ('carbon_center',  9, '产品碳足迹核算',               '能碳管理中心建设指南 二、业务功能'),
  ('carbon_center', 10, '供应链碳管理',                 '能碳管理中心建设指南 二、业务功能'),
  ('carbon_center', 11, '碳核查支撑',                   '能碳管理中心建设指南 二、业务功能'),
  ('carbon_center', 12, '碳资产管理',                   '能碳管理中心建设指南 二、业务功能');

-- =====================================================================
-- 8. 术语
-- =====================================================================
INSERT INTO core.term (term, definition, source, aliases) VALUES
  ('综合能耗', '统计报告期内实际消耗的各种能源实物量按规定方法和系数折算为标准煤后的总和，包括一次能源、二次能源和用作原料的能源：E = Σ(Eᵢ × kᵢ)。', 'GB/T 2589-2020', ARRAY['综合能源消费量']),
  ('年综合能源消费量', '园区范围内每年度实际消费的各类能源的总和，单位为吨标准煤，其中电力消费能耗按照等价值计算。', '发改环资〔2025〕910号 附件3', NULL),
  ('单位能耗碳排放', '园区范围内每消费一吨标准煤产生的碳排放量，仅指二氧化碳排放。', '发改环资〔2025〕910号 附件3', ARRAY['单位能耗二氧化碳排放量']),
  ('余热/余冷/余压综合利用率', '衡量生产过程中对热能、冷能和压力能的回收利用程度，为三类能源综合利用率的加权平均值。', '发改环资〔2025〕910号 附件3', NULL),
  ('清洁能源使用率', '清洁能源使用量与园区终端能源消费总量之比，均按标煤计。清洁能源包括天然气等清洁燃气、电和低硫轻柴油等清洁燃油（不含机动车用燃油）。', '工信部节〔2024〕13号 附件2', NULL),
  ('可再生能源利用率', '园区内工业企业可再生能源使用量与综合能耗总量之比。可再生能源包括太阳能、水能、生物质能、地热能、氢能、波浪能等非化石能源。', '工信部节〔2024〕13号 附件2（旧称可再生能源使用比例）', ARRAY['可再生能源使用比例']),
  ('能源产出率', '园区工业增加值（万元，不变价）与能源综合消耗总量（tce）之比。', '工信部节〔2024〕13号 附件2', NULL),
  ('水资源产出率', '报告期内园区消耗单位新鲜水量所创造的工业增加值。', '工信部节〔2024〕13号 附件2', NULL),
  ('土地资源产出率', '报告期内园区单位工业用地面积产生的工业增加值。', '工信部节〔2024〕13号 附件2', ARRAY['土地产出率']),
  ('电力净受入', '园区电力受入量蕴含的间接排放与送出量蕴含的间接排放之差。直供非化石能源电力、绿证绿电交易电力的排放因子计为 0，其余按全国化石能源电力排放因子 0.8325 kgCO2/kWh。', '发改环资〔2025〕910号 附件4', NULL),
  ('能流分析', '通过绘制桑基图、能源平衡表等，对能源输入、转换、分配、利用全过程进行计算，分析能流、能效与损失，识别重点能耗环节。', '能碳管理中心建设指南', ARRAY['能流网络分析']),
  ('用能与碳排放预算管理', '对一个时间周期内工业企业和园区的能源消费和碳排放进行分析预测，实现用能和碳排放的全流程管理和动态调整。', '能碳管理中心建设指南', NULL);

-- =====================================================================
-- 9. 预警规则（阈值来自需求资料，可在后台调整）
-- =====================================================================
INSERT INTO core.alert_rule (code, name, target_kind, target_code, condition, severity, description) VALUES
  ('CARBON_DEVIATION_10', '碳排放偏离基准超过 10%', 'carbon', 'CO2_TOTAL',
   '{"op":"deviation_pct","gt":10,"baseline":"same_month_last_year"}', 'warning', '来源：园区系统界面.doc（排放偏离正常值 10% 预警）'),
  ('ENERGY_DEVIATION_10', '能耗偏离基准超过 10%', 'energy', 'ENG_TCE',
   '{"op":"deviation_pct","gt":10,"baseline":"same_month_last_year"}', 'warning', '与历史同期对比'),
  ('BUDGET_OVERRUN', '能耗或碳排放超出预算', 'budget', NULL,
   '{"op":"actual_gt_budget"}', 'warning', '对比 fact.forecast.budget_value'),
  ('DATA_GAP_MONTH', '月度数据缺失', 'data_gap', NULL,
   '{"op":"missing_months","gt":0}', 'info', '提示补录或触发估值补全');

-- =====================================================================
-- 10. 减碳策略库（来自实施方案中的产业节能抓手；参数默认值待测算后填写）
-- =====================================================================
INSERT INTO core.strategy (code, name, category, applicable_category, parameters, description, reference_source) VALUES
  ('PV_EXPANSION',       '分布式光伏扩容',       'clean_energy',    'all',         '{"added_capacity_kw":null,"annual_hours":null}', '屋顶分布式光伏，提高可再生能源利用率', '实施方案（实例化）'),
  ('GREEN_POWER_TRADE',  '绿电绿证交易',         'green_power',     'all',         '{"annual_green_kwh":null}', '绿电电量排放因子计为 0', '910 号附件4'),
  ('DRYING_HEAT_RECOVERY','干燥/热压余热回收',   'waste_heat',      'green_home',  '{"recovery_rate":null}', '人造板、家具企业干燥与热压工序', '实施方案（实例化）'),
  ('HOT_AIR_OPTIMIZE',   '热风系统优化',         'efficiency',      'green_home',  '{"saving_rate":null}', NULL, '实施方案（实例化）'),
  ('DUST_FAN_VFD',       '除尘风机变频',         'efficiency',      'green_home',  '{"saving_rate":null}', NULL, '实施方案（实例化）'),
  ('GAS_BOILER_EFF',     '燃气锅炉效率提升',     'efficiency',      'green_home',  '{"efficiency_gain":null}', NULL, '实施方案（实例化）'),
  ('CLEANROOM_HVAC',     '洁净空调群控',         'efficiency',      'electronics', '{"saving_rate":null}', '电子企业洁净车间', '实施方案（实例化）'),
  ('AIR_COMPRESSOR_HR',  '空压机余热回收',       'waste_heat',      'electronics', '{"recovery_rate":null}', NULL, '实施方案（实例化）'),
  ('TOU_SCHEDULING',     '分时用电调度',         'management',      'electronics', '{"shift_ratio":null}', '峰谷电价调度', '实施方案（实例化）'),
  ('TRANSFORMER_ECON',   '变压器经济运行',       'efficiency',      'all',         '{"saving_rate":null}', NULL, '实施方案（实例化）');

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0007', '参考数据：标准版本、基础量、公式、2024/2025/2026/零碳园区指标、引领值、版本对照、功能清单、术语、预警、策略');
