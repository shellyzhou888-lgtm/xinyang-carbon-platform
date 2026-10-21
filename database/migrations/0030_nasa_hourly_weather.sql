-- NASA POWER 逐小时气象与辐照参考数据；UTC 时间戳，普通索引表。
SET ROLE greensystem;

INSERT INTO raw.api_source (code, name, endpoint, auth_kind, schedule_cron, enabled, note)
VALUES ('NASA_POWER_HOURLY', 'NASA POWER 园区附近小时值',
        'https://power.larc.nasa.gov/api/temporal/hourly/point', 'none', '0 2 * * *', false,
        'WGS84 114.12E,32.22N 网格；time-standard=UTC；每日检查，不是分钟级或现场实测。')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE fact.weather_hourly (
  source_id bigint NOT NULL REFERENCES raw.api_source(source_id),
  location_code text NOT NULL,
  period_at timestamptz NOT NULL,
  parameter_code text NOT NULL,
  value numeric(18,6) NOT NULL,
  unit text NOT NULL,
  quality_flag text NOT NULL CHECK (quality_flag IN ('ok','suspect')),
  batch_id bigint NOT NULL REFERENCES raw.import_batch(batch_id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, location_code, period_at, parameter_code)
);
CREATE INDEX weather_hourly_parameter_at_idx ON fact.weather_hourly (parameter_code, period_at DESC);
COMMENT ON TABLE fact.weather_hourly IS 'NASA POWER 网格逐小时值；UTC，非分钟级/现场实测/未来预报，-999 缺测不入库。';

CREATE VIEW mart.weather_hourly_parameter_latest AS
SELECT s.code AS source_code, h.location_code, h.parameter_code,
       max(h.period_at) AS latest_at, count(*)::bigint AS valid_hours,
       count(*) FILTER (WHERE h.quality_flag='suspect')::bigint AS suspect_hours,
       max(h.period_at) FILTER (WHERE h.quality_flag='ok') AS latest_trusted_at
  FROM fact.weather_hourly h JOIN raw.api_source s ON s.source_id=h.source_id
 GROUP BY s.code,h.location_code,h.parameter_code;

CREATE OR REPLACE VIEW mart.weather_sync_health AS
SELECT s.code AS source_code, s.name, s.enabled, s.schedule_cron, s.last_run_at,
       max(st.last_checked_at) AS last_checked_at,
       max(st.last_success_at) AS last_success_at,
       count(*) FILTER (WHERE st.last_error IS NOT NULL)::integer AS error_segments
  FROM raw.api_source s LEFT JOIN raw.api_sync_state st ON st.source_id=s.source_id
 WHERE s.code IN ('AMAP_WEATHER','NASA_POWER_DAILY','NASA_POWER_HOURLY')
 GROUP BY s.source_id;

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0030', 'NASA POWER 小时级气象与辐照：UTC 事实表及逐参数新鲜度');
