-- POWER 的长区间日接口曾对 PRECTOTCORR 给出 24 倍值；降水改用小时值求和。
SET ROLE greensystem;

ALTER TABLE fact.weather_daily
  ADD COLUMN derivation text NOT NULL DEFAULT 'api_daily'
  CHECK (derivation IN ('api_daily','hourly_sum'));

UPDATE fact.weather_daily
   SET quality_flag='suspect'
 WHERE parameter_code='PRECTOTCORR' AND period_date >= DATE '2026-01-01'
   AND derivation='api_daily';

CREATE OR REPLACE VIEW mart.weather_parameter_latest AS
SELECT s.code AS source_code, d.location_code, d.parameter_code,
       max(d.period_date) AS latest_date, count(*)::integer AS valid_days,
       count(*) FILTER (WHERE d.quality_flag = 'suspect')::integer AS suspect_days,
       max(d.period_date) FILTER (WHERE d.quality_flag = 'ok') AS latest_trusted_date,
       count(*) FILTER (WHERE d.quality_flag = 'ok')::integer AS trusted_days,
       count(*) FILTER (WHERE d.derivation = 'hourly_sum')::integer AS hourly_derived_days
  FROM fact.weather_daily d JOIN raw.api_source s ON s.source_id = d.source_id
 GROUP BY s.code, d.location_code, d.parameter_code;

COMMENT ON COLUMN fact.weather_daily.derivation IS 'api_daily 为原始 NASA 日值；hourly_sum 为 24 个小时 PRECTOTCORR 求和得到的 mm/day。';

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0029', 'NASA 降水质量修复：小时降水聚合来源标记、旧日值隔离、可信末日');
