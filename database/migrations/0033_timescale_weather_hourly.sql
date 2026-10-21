-- 启用 TimescaleDB（服务器已提供 2.22.0 扩展包），把 NASA POWER 逐小时气象 fact.weather_hourly 转为超表：
--   · 按月分块（period_at，UTC），既有数据随迁移移入分块；
--   · 210 天前的分块自动压缩（NASA 会回补近 6 个月，避开仍在更新的区间），按 数据源/采样点/参数 分段、按时间排序；
--   · 新增连续聚合 mart.weather_hourly_daily（北京时间日界的日均 / 极值 / 合计），每小时自动刷新。
-- 前置：postgresql.conf 的 shared_preload_libraries 含 timescaledb 并已重启数据库，否则本迁移在第一步报错且不做任何改动。
-- 本文件由 apply-migrations.ps1 在单事务中执行；连续聚合以 WITH NO DATA 创建，由刷新策略在后台补算。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    RAISE EXCEPTION '服务器未安装 timescaledb 扩展包';
  END IF;
  IF position('timescaledb' IN current_setting('shared_preload_libraries')) = 0 THEN
    RAISE EXCEPTION 'TimescaleDB 未预加载：请在 postgresql.conf 设置 shared_preload_libraries = ''timescaledb''（保留已有项，用逗号分隔），重启 PostgreSQL 后再执行本迁移';
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS timescaledb;

SET ROLE greensystem;

SELECT create_hypertable('fact.weather_hourly', by_range('period_at', INTERVAL '1 month'), migrate_data => true);

ALTER TABLE fact.weather_hourly SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'source_id, location_code, parameter_code',
  timescaledb.compress_orderby = 'period_at'
);
SELECT add_compression_policy('fact.weather_hourly', INTERVAL '210 days');

CREATE MATERIALIZED VIEW mart.weather_hourly_daily
WITH (timescaledb.continuous) AS
SELECT time_bucket(INTERVAL '1 day', period_at, 'Asia/Shanghai') AS day_start,
       source_id, location_code, parameter_code,
       avg(value)  AS avg_value,
       min(value)  AS min_value,
       max(value)  AS max_value,
       sum(value)  AS sum_value,
       count(*)::int AS hours
  FROM fact.weather_hourly
 WHERE quality_flag = 'ok'
 GROUP BY 1, 2, 3, 4
WITH NO DATA;
COMMENT ON VIEW mart.weather_hourly_daily IS 'NASA POWER 小时值的北京时间日汇总（TimescaleDB 连续聚合，每小时增量刷新）；hours<24 表示当日小时值未齐';
COMMENT ON COLUMN mart.weather_hourly_daily.day_start IS '北京时间当日 0 点（timestamptz）';
COMMENT ON COLUMN mart.weather_hourly_daily.sum_value IS '小时值合计：辐射为 Wh/m²/日，降水为 mm/日';
COMMENT ON COLUMN mart.weather_hourly_daily.hours IS '参与汇总的有效小时数';

SELECT add_continuous_aggregate_policy('mart.weather_hourly_daily',
  start_offset => INTERVAL '240 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '1 hour');

COMMENT ON TABLE fact.weather_hourly IS 'NASA POWER 网格逐小时值（TimescaleDB 超表，按月分块，210 天前压缩）；UTC，非分钟级/现场实测/未来预报，-999 缺测不入库。';

RESET ROLE;

GRANT SELECT ON mart.weather_hourly_daily TO green_app, green_agent_ro;

SELECT semantic.refresh_catalog();
UPDATE semantic.table_doc SET topic_code = 'weather', queryable = true, origin = 'ai_draft', review_status = 'draft', updated_at = now(),
       business_name = '气象小时值日汇总', grain = '一个数据源 × 采样点 × 参数 × 北京时间日一行',
       usage_notes = '按北京时间统计日均气温、日辐射量时优先用本视图（比扫描小时表快）；parameter_code 含义查 core.weather_parameter。',
       caveats = ARRAY['连续聚合每小时刷新，最近 1 小时内的数据可能尚未汇总','hours<24 表示当日不完整'],
       synonyms = ARRAY['日气温','日辐射','逐日气象']
 WHERE object = 'mart.weather_hourly_daily';

INSERT INTO audit.schema_migration (version, description)
VALUES ('0033', '启用 TimescaleDB：fact.weather_hourly 转超表（月分块、210 天压缩），连续聚合 mart.weather_hourly_daily');
