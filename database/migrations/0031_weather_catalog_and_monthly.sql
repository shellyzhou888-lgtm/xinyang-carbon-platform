-- 气象数据规整：参数字典、月度汇总视图、表与字段注释，并登记进语义目录（草稿，待后台审核）。
-- 前置：0028–0030（高德天气、NASA POWER 日值与小时值）。只新增对象和注释，不改动已入库数据。
SET ROLE greensystem;

-- 1. 参数字典：NASA POWER 参数代码 → 中文名称、单位与用途 ---------------------------------------
CREATE TABLE core.weather_parameter (
  code         text PRIMARY KEY,
  name         text NOT NULL,
  category     text NOT NULL CHECK (category IN ('temperature','humidity','wind','precipitation','radiation','cloud','degree_day')),
  unit_daily   text,
  unit_hourly  text,
  description  text,
  usage_hint   text,
  sort_order   smallint NOT NULL DEFAULT 100
);
COMMENT ON TABLE core.weather_parameter IS '气象参数字典：NASA POWER 参数代码的中文名称、日值与小时值单位、用途说明';

INSERT INTO core.weather_parameter (code, name, category, unit_daily, unit_hourly, description, usage_hint, sort_order) VALUES
  ('T2M',               '2 米气温',             'temperature',   '℃',          '℃',     '距地面 2 米处气温；日值为当地日平均',                       '气温修正能耗、负荷分析', 10),
  ('T2M_MAX',           '日最高气温',           'temperature',   '℃',          NULL,    '当地日内 2 米最高气温',                                     '高温日识别、制冷负荷峰值', 11),
  ('T2M_MIN',           '日最低气温',           'temperature',   '℃',          NULL,    '当地日内 2 米最低气温',                                     '低温日识别、采暖负荷峰值', 12),
  ('RH2M',              '2 米相对湿度',         'humidity',      '%',          '%',     '距地面 2 米处相对湿度',                                     '除湿与空调负荷分析', 20),
  ('WS10M',             '10 米风速',            'wind',          'm/s',        'm/s',   '距地面 10 米处平均风速',                                    '风电资源初评、散热条件', 30),
  ('PRECTOTCORR',       '修正降水量',           'precipitation', 'mm/day',     'mm/hour','经偏差修正的降水；2026 年起日值由 24 个小时值求和（derivation=hourly_sum）', '雨水回用、施工与运行条件', 40),
  ('ALLSKY_SFC_SW_DWN', '水平面总辐射（GHI）',  'radiation',     'kWh/m²/day', 'Wh/m²', '全天空条件下到达水平地表的短波辐射总量',                    '光伏发电量估算、自发光伏核对', 50),
  ('CLRSKY_SFC_SW_DWN', '晴空水平面总辐射',     'radiation',     'kWh/m²/day', NULL,    '假设无云时到达水平地表的短波辐射',                          '光伏潜力上限、云量影响分析', 51),
  ('ALLSKY_SFC_SW_DNI', '法向直接辐射（DNI）',  'radiation',     'kWh/m²/day', 'Wh/m²', '垂直于太阳光线平面接收的直接辐射',                          '跟踪式光伏与光热评估', 52),
  ('ALLSKY_SFC_SW_DIFF','水平面散射辐射（DHI）','radiation',     'kWh/m²/day', 'Wh/m²', '经大气散射后到达水平地表的辐射',                            '阴天光伏出力分析', 53),
  ('CLOUD_AMT',         '云量',                 'cloud',         '%',          '%',     '天空被云覆盖的比例',                                        '辐射与光伏波动解释', 60),
  ('HDD18_3',           '采暖度日（18.3℃）',    'degree_day',    '℃·d',        NULL,    '日平均气温低于 18.3℃ 的差值累计',                           '采暖能耗气候修正、年度能耗可比性', 70),
  ('CDD18_3',           '制冷度日（18.3℃）',    'degree_day',    '℃·d',        NULL,    '日平均气温高于 18.3℃ 的差值累计',                           '制冷能耗气候修正、夏季用电分析', 71);

-- 2. 月度汇总：只取质量为 ok 的日值，按当地月份汇总，可直接与 fact.energy_activity 的 period_month 对齐 ----------
CREATE VIEW mart.weather_monthly AS
SELECT date_trunc('month', d.period_date)::date AS period_month, d.location_code,
       count(DISTINCT d.period_date) FILTER (WHERE d.parameter_code = 'T2M')::int AS days_t2m,
       round(avg(d.value) FILTER (WHERE d.parameter_code = 'T2M'), 2) AS t2m_avg_c,
       round(max(d.value) FILTER (WHERE d.parameter_code = 'T2M_MAX'), 2) AS t2m_max_c,
       round(min(d.value) FILTER (WHERE d.parameter_code = 'T2M_MIN'), 2) AS t2m_min_c,
       round(sum(d.value) FILTER (WHERE d.parameter_code = 'HDD18_3'), 1) AS hdd_18_3,
       round(sum(d.value) FILTER (WHERE d.parameter_code = 'CDD18_3'), 1) AS cdd_18_3,
       round(sum(d.value) FILTER (WHERE d.parameter_code = 'ALLSKY_SFC_SW_DWN'), 1) AS ghi_kwh_m2,
       count(DISTINCT d.period_date) FILTER (WHERE d.parameter_code = 'ALLSKY_SFC_SW_DWN')::int AS days_ghi,
       round(sum(d.value) FILTER (WHERE d.parameter_code = 'PRECTOTCORR'), 1) AS precip_mm,
       round(avg(d.value) FILTER (WHERE d.parameter_code = 'RH2M'), 1) AS rh_avg_pct,
       round(avg(d.value) FILTER (WHERE d.parameter_code = 'WS10M'), 2) AS ws10m_avg_ms,
       round(avg(d.value) FILTER (WHERE d.parameter_code = 'CLOUD_AMT'), 1) AS cloud_avg_pct
  FROM fact.weather_daily d
 WHERE d.quality_flag = 'ok'
 GROUP BY 1, 2;
COMMENT ON VIEW mart.weather_monthly IS '园区附近气象月度汇总：月均 / 极值气温、采暖与制冷度日、水平面总辐射、降水、湿度、风速、云量（仅 quality_flag=ok 的 NASA POWER 日值）';
COMMENT ON COLUMN mart.weather_monthly.period_month IS '月份（当月 1 日，当地时间），与 fact.energy_activity.period_month 对齐';
COMMENT ON COLUMN mart.weather_monthly.days_t2m IS '当月有效气温天数；小于当月天数表示数据尚未发布完整';
COMMENT ON COLUMN mart.weather_monthly.hdd_18_3 IS '当月采暖度日合计（基准 18.3℃），℃·d';
COMMENT ON COLUMN mart.weather_monthly.cdd_18_3 IS '当月制冷度日合计（基准 18.3℃），℃·d';
COMMENT ON COLUMN mart.weather_monthly.ghi_kwh_m2 IS '当月水平面总辐射合计，kWh/m²；1 kWp 光伏月发电量约等于该值 × 系统效率（约 0.8）';
COMMENT ON COLUMN mart.weather_monthly.days_ghi IS '当月有效辐射天数；辐射参数发布滞后约 2–3 个月';
COMMENT ON COLUMN mart.weather_monthly.precip_mm IS '当月降水合计，mm';

-- 3. 事实表字段注释（语义目录据此生成说明） -------------------------------------------------------
COMMENT ON COLUMN fact.weather_daily.source_id IS '数据源（raw.api_source），NASA_POWER_DAILY';
COMMENT ON COLUMN fact.weather_daily.location_code IS '网格采样点，WGS84 经纬度（114.12E, 32.22N，园区附近）';
COMMENT ON COLUMN fact.weather_daily.period_date IS '日期（当地日界）';
COMMENT ON COLUMN fact.weather_daily.parameter_code IS '参数代码，含义见 core.weather_parameter';
COMMENT ON COLUMN fact.weather_daily.value IS '日值，单位见 unit';
COMMENT ON COLUMN fact.weather_daily.unit IS '单位（NASA POWER 原始单位）';
COMMENT ON COLUMN fact.weather_daily.quality_flag IS 'ok 可用；suspect 存疑（2026 年起的原始日降水值，已被小时值求和替代）';
COMMENT ON COLUMN fact.weather_hourly.period_at IS '整点时间，UTC；按北京时间统计时需 at time zone ''Asia/Shanghai''';
COMMENT ON COLUMN fact.weather_hourly.parameter_code IS '参数代码，含义见 core.weather_parameter';
COMMENT ON COLUMN fact.weather_hourly.value IS '小时值，单位见 unit（辐射为 Wh/m²，降水为 mm/hour）';
COMMENT ON COLUMN fact.weather_hourly.location_code IS '网格采样点，WGS84 经纬度（114.12E, 32.22N）';
COMMENT ON COLUMN fact.weather_live.adcode IS '行政区编码，411503 为信阳市平桥区';
COMMENT ON COLUMN fact.weather_live.report_at IS '高德实况发布时间';
COMMENT ON COLUMN fact.weather_forecast.issued_at IS '预报发布时间；同一预报日期保留多次发布版本，取最新用 max(issued_at)';
COMMENT ON COLUMN fact.weather_forecast.forecast_date IS '预报日期';

RESET ROLE;

-- 4. 读取权限 ----------------------------------------------------------------------------------
GRANT SELECT ON core.weather_parameter, mart.weather_monthly TO green_app, green_agent_ro;

-- 5. 语义目录：登记新对象并补业务说明（草稿，管理员在网站“数据治理”页审核） ---------------------
INSERT INTO semantic.topic (code, name, description, sort_order)
VALUES ('weather', '气象环境', '园区附近气温、湿度、风速、降水、太阳辐射与度日；高德行政区实况与预报', 75)
ON CONFLICT (code) DO NOTHING;

SELECT semantic.refresh_catalog();

UPDATE semantic.table_doc SET topic_code = 'weather', queryable = true, origin = 'ai_draft', review_status = 'draft', updated_at = now(),
       business_name = v.business_name, grain = v.grain, usage_notes = v.usage_notes, caveats = v.caveats, synonyms = v.synonyms
  FROM (VALUES
    ('fact.weather_daily',  '气象日值', '一个数据源 × 采样点 × 日期 × 参数一行',
     '按 parameter_code 筛选参数，参数含义与单位查 core.weather_parameter；分析月度能耗与气候关系优先用 mart.weather_monthly。',
     ARRAY['NASA POWER 网格值，不是园区站点实测','辐射类参数发布滞后约 2–3 个月，最新日期因参数而异','2026 年起降水日值由小时值求和（derivation=hourly_sum）'],
     ARRAY['天气','气温','温度','辐照','太阳辐射','降水','湿度','风速','度日']),
    ('fact.weather_hourly', '气象小时值', '一个数据源 × 采样点 × 整点 × 参数一行',
     '时间为 UTC，按北京时间分析需转换时区；辐射为 Wh/m²。',
     ARRAY['UTC 时间戳','非现场实测、非预报'],
     ARRAY['逐小时天气','小时气温','小时辐照']),
    ('fact.weather_live',   '高德天气实况', '一个行政区 × 发布时间一行',
     '查询当前天气取 report_at 最新一行。',
     ARRAY['行政区级实况，不是逐企业观测'],
     ARRAY['实时天气','当前天气','现在天气']),
    ('fact.weather_forecast','高德天气预报', '一个行政区 × 发布时间 × 预报日期一行',
     '同一预报日期有多个发布版本，取 max(issued_at) 的一组。',
     ARRAY['预报不是观测','不含太阳辐射预测'],
     ARRAY['天气预报','未来天气']),
    ('mart.weather_monthly','气象月度汇总', '一个采样点 × 月份一行',
     '与 fact.energy_activity 按 period_month 关联，可做度日修正、辐射与光伏发电对照；days_* 小于当月天数表示数据未发布完整。',
     ARRAY['仅含 quality_flag=ok 的日值','月份按当地时间'],
     ARRAY['月度气象','月均气温','采暖度日','制冷度日','月辐照']),
    ('core.weather_parameter','气象参数字典', '一个参数代码一行',
     '解释 parameter_code 的中文名称、单位与用途。',
     ARRAY[]::text[],
     ARRAY['气象参数','参数代码'])
  ) AS v(object, business_name, grain, usage_notes, caveats, synonyms)
 WHERE semantic.table_doc.object = v.object;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0031', '气象数据规整：参数字典 core.weather_parameter、月度汇总 mart.weather_monthly、字段注释与语义目录登记');
