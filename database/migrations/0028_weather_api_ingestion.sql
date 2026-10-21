-- 高德实况/预报与 NASA POWER 日值：原始响应、标准化事实和同步状态。
SET ROLE greensystem;

INSERT INTO raw.api_source (code, name, endpoint, auth_kind, schedule_cron, enabled, note) VALUES
  ('AMAP_WEATHER', '高德平桥区天气', 'https://restapi.amap.com/v3/weather/weatherInfo', 'server_env:AMAP_WEB_SERVICE_KEY', '0 * * * *', false, '行政区 411503；实况和短期预报，每小时检查。'),
  ('NASA_POWER_DAILY', 'NASA POWER 园区附近日值', 'https://power.larc.nasa.gov/api/temporal/daily/point', 'none', '0 2 * * *', false, 'WGS84 114.12E,32.22N 演示采样点；本机时间每日 02:00 检查，各参数发布延迟不同。')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE raw.api_sync_state (
  source_id bigint NOT NULL REFERENCES raw.api_source(source_id),
  segment_key text NOT NULL,
  payload_sha256 text,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_batch_id bigint REFERENCES raw.import_batch(batch_id),
  last_error text,
  PRIMARY KEY (source_id, segment_key)
);

CREATE TABLE fact.weather_daily (
  source_id bigint NOT NULL REFERENCES raw.api_source(source_id),
  location_code text NOT NULL,
  period_date date NOT NULL,
  parameter_code text NOT NULL,
  value numeric(18,6) NOT NULL,
  unit text NOT NULL,
  quality_flag text NOT NULL CHECK (quality_flag IN ('ok','suspect')),
  batch_id bigint NOT NULL REFERENCES raw.import_batch(batch_id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, location_code, period_date, parameter_code)
);
CREATE INDEX weather_daily_parameter_date_idx ON fact.weather_daily (parameter_code, period_date DESC);
COMMENT ON TABLE fact.weather_daily IS 'NASA POWER 网格日值；不是园区站点实测值，-999 缺测不入库。';

CREATE TABLE fact.weather_live (
  source_id bigint NOT NULL REFERENCES raw.api_source(source_id),
  adcode text NOT NULL,
  report_at timestamptz NOT NULL,
  province text,
  city text,
  weather text,
  temperature_c numeric(7,2),
  humidity_pct numeric(7,2),
  wind_direction text,
  wind_power text,
  quality_flag text NOT NULL CHECK (quality_flag IN ('ok','suspect')),
  batch_id bigint NOT NULL REFERENCES raw.import_batch(batch_id),
  PRIMARY KEY (source_id, adcode, report_at)
);
CREATE INDEX weather_live_recent_idx ON fact.weather_live (adcode, report_at DESC);
COMMENT ON TABLE fact.weather_live IS '高德行政区实况快照；report_at 为接口发布时间（中国标准时间），不是逐企业实测。';

CREATE TABLE fact.weather_forecast (
  source_id bigint NOT NULL REFERENCES raw.api_source(source_id),
  adcode text NOT NULL,
  issued_at timestamptz NOT NULL,
  forecast_date date NOT NULL,
  day_weather text,
  night_weather text,
  day_temp_c numeric(7,2),
  night_temp_c numeric(7,2),
  day_wind text,
  night_wind text,
  day_wind_power text,
  night_wind_power text,
  quality_flag text NOT NULL CHECK (quality_flag IN ('ok','suspect')),
  batch_id bigint NOT NULL REFERENCES raw.import_batch(batch_id),
  PRIMARY KEY (source_id, adcode, issued_at, forecast_date)
);
CREATE INDEX weather_forecast_recent_idx ON fact.weather_forecast (adcode, issued_at DESC, forecast_date);
COMMENT ON TABLE fact.weather_forecast IS '高德短期预报逐发布时间保留版本；不能充作观测或太阳辐照预测。';

CREATE VIEW mart.weather_parameter_latest AS
SELECT s.code AS source_code, d.location_code, d.parameter_code,
       max(d.period_date) AS latest_date, count(*)::integer AS valid_days,
       count(*) FILTER (WHERE d.quality_flag = 'suspect')::integer AS suspect_days
  FROM fact.weather_daily d JOIN raw.api_source s ON s.source_id = d.source_id
 GROUP BY s.code, d.location_code, d.parameter_code;

CREATE VIEW mart.weather_sync_health AS
SELECT s.code AS source_code, s.name, s.enabled, s.schedule_cron, s.last_run_at,
       max(st.last_checked_at) AS last_checked_at,
       max(st.last_success_at) AS last_success_at,
       count(*) FILTER (WHERE st.last_error IS NOT NULL)::integer AS error_segments
  FROM raw.api_source s LEFT JOIN raw.api_sync_state st ON st.source_id = s.source_id
 WHERE s.code IN ('AMAP_WEATHER','NASA_POWER_DAILY')
 GROUP BY s.source_id;

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0028', '高德天气与 NASA POWER：原始响应、标准化气象事实、逐字段新鲜度和同步状态');
