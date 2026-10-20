-- 0013 计算引擎所需的 schema 与字段
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。

SET ROLE greensystem;

CREATE SCHEMA IF NOT EXISTS engine AUTHORIZATION greensystem;
COMMENT ON SCHEMA engine IS '导入解析与计算引擎函数：load_batch、calc_energy、calc_carbon、calc_indicators、run_all';
GRANT USAGE ON SCHEMA engine TO green_app, green_etl;

-- 计算批次：警告与汇总
ALTER TABLE fact.calc_run
  ADD COLUMN warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN summary  jsonb;

-- 碳排放结果按口径（评价标准版本）区分：同一条能源活动在不同口径下因子不同
ALTER TABLE fact.carbon_emission ADD COLUMN profile_code text;
COMMENT ON COLUMN fact.carbon_emission.profile_code IS '计算口径，即 standard_version.code（决定因子偏好）';
CREATE UNIQUE INDEX carbon_emission_current_uq
  ON fact.carbon_emission (profile_code, activity_id) WHERE is_current AND activity_id IS NOT NULL;

-- 判定基准的适用条件，例如零碳园区按年综合能源消费量分档
ALTER TABLE core.indicator_benchmark ADD COLUMN applies_when jsonb;
COMMENT ON COLUMN core.indicator_benchmark.applies_when IS
  '适用条件，例：{"metric":"ENG_TCE","min":200000,"max":1000000}（单位同基础量）；为空表示总是适用';

UPDATE core.indicator_benchmark b
SET applies_when = CASE WHEN b.value = 0.2 THEN '{"metric":"ENG_TCE","min":200000,"max":1000000}'::jsonb
                        ELSE '{"metric":"ENG_TCE","min":1000000}'::jsonb END
FROM core.indicator_def d JOIN core.standard_version v USING (version_id)
WHERE b.indicator_id = d.indicator_id AND v.code = 'ZCP_2025' AND d.code = 'C01';

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0013', '计算引擎 schema；计算批次警告与汇总、碳排放口径、判定基准适用条件');
