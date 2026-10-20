-- 0005 Agent 日志、变更审计、mart 只读视图
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。

SET ROLE greensystem;

-- =====================================================================
-- 1. Agent 会话与工具调用
-- =====================================================================

CREATE TABLE agent.session (
  session_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_ref    text,                            -- 网站用户标识
  channel     text NOT NULL CHECK (channel IN ('web','voice','system')),
  agent_name  text NOT NULL,                   -- orchestrator、db_query、voice …
  model       text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);

CREATE TABLE agent.message (
  message_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  uuid NOT NULL REFERENCES agent.session(session_id),
  role        text NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_message_session_idx ON agent.message (session_id, created_at);

CREATE TABLE agent.tool_call (
  call_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id   uuid NOT NULL REFERENCES agent.session(session_id),
  message_id   bigint REFERENCES agent.message(message_id),
  tool_name    text NOT NULL,
  arguments    jsonb NOT NULL DEFAULT '{}'::jsonb,
  db_role      text,                           -- 实际使用的数据库角色
  row_count    integer,
  duration_ms  integer,
  status       text NOT NULL CHECK (status IN ('ok','error','denied')),
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE agent.tool_call IS 'Agent 只调用受限工具，不直接拼写 SQL；每次调用留痕';

-- =====================================================================
-- 2. 变更审计（因子、公式、指标配置、对象树、指标值）
-- =====================================================================

CREATE TABLE audit.change_log (
  log_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name  text NOT NULL,
  row_pk      text,
  action      text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_row     jsonb,
  new_row     jsonb,
  db_user     text NOT NULL DEFAULT session_user,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_log_table_idx ON audit.change_log (table_name, changed_at);

CREATE FUNCTION audit.tg_change_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, audit AS $$
DECLARE
  pk_col text := TG_ARGV[0];
BEGIN
  INSERT INTO audit.change_log (table_name, row_pk, action, old_row, new_row)
  VALUES (
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ->> pk_col ELSE to_jsonb(NEW) ->> pk_col END,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN NULL;
END $$;

CREATE TRIGGER audit_org_node        AFTER INSERT OR UPDATE OR DELETE ON core.org_node
  FOR EACH ROW EXECUTE FUNCTION audit.tg_change_log('node_id');
CREATE TRIGGER audit_factor          AFTER INSERT OR UPDATE OR DELETE ON core.factor
  FOR EACH ROW EXECUTE FUNCTION audit.tg_change_log('factor_id');
CREATE TRIGGER audit_formula         AFTER INSERT OR UPDATE OR DELETE ON core.formula
  FOR EACH ROW EXECUTE FUNCTION audit.tg_change_log('formula_id');
CREATE TRIGGER audit_indicator_def   AFTER INSERT OR UPDATE OR DELETE ON core.indicator_def
  FOR EACH ROW EXECUTE FUNCTION audit.tg_change_log('indicator_id');
CREATE TRIGGER audit_benchmark       AFTER INSERT OR UPDATE OR DELETE ON core.indicator_benchmark
  FOR EACH ROW EXECUTE FUNCTION audit.tg_change_log('benchmark_id');
CREATE TRIGGER audit_indicator_value AFTER INSERT OR UPDATE OR DELETE ON fact.indicator_value
  FOR EACH ROW EXECUTE FUNCTION audit.tg_change_log('value_id');

-- =====================================================================
-- 3. mart 只读视图（网站与 Agent 查询入口）
-- =====================================================================

CREATE VIEW mart.v_org_node AS
SELECT n.node_id, n.parent_id, n.node_type, n.code, n.name, n.path::text AS path,
       nlevel(n.path) AS depth, n.industry_code, i.name AS industry_name, i.park_category,
       n.function_tag, n.lng, n.lat,
       e.legal_name, e.credit_code, e.is_above_scale, e.is_high_tech, e.main_products
FROM core.org_node n
LEFT JOIN core.industry i ON i.code = n.industry_code
LEFT JOIN core.enterprise_profile e ON e.node_id = n.node_id
WHERE n.is_active;
COMMENT ON VIEW mart.v_org_node IS '对象树（含企业档案）';

CREATE VIEW mart.v_screen_honor AS
SELECT h.honor_id, h.node_id, n.name AS node_name, h.honor_type, h.level, h.title, h.year, h.issuer, n.lng, n.lat
FROM core.honor h
JOIN core.org_node n ON n.node_id = h.node_id
WHERE h.show_on_screen;
COMMENT ON VIEW mart.v_screen_honor IS '大屏企业荣誉标识';

CREATE VIEW mart.v_energy_monthly AS
SELECT a.node_id, n.name AS node_name, n.path::text AS path, a.period_month,
       a.energy_type_code, t.name AS energy_type_name, t.category,
       t.is_clean, t.is_renewable, a.flow, a.use_type,
       a.quantity_std, t.default_unit AS unit, a.tce, a.data_source
FROM fact.energy_activity a
JOIN core.org_node n ON n.node_id = a.node_id
JOIN core.energy_type t ON t.code = a.energy_type_code
WHERE a.is_current;
COMMENT ON VIEW mart.v_energy_monthly IS '月度能源活动（当前有效版本）';

CREATE VIEW mart.v_carbon_monthly AS
SELECT c.node_id, n.name AS node_name, n.path::text AS path, c.period_month, c.category,
       c.energy_type_code, sum(c.co2_t) AS co2_t
FROM fact.carbon_emission c
JOIN core.org_node n ON n.node_id = c.node_id
WHERE c.is_current
GROUP BY c.node_id, n.name, n.path, c.period_month, c.category, c.energy_type_code;
COMMENT ON VIEW mart.v_carbon_monthly IS '月度碳排放（按核算类别和能源品种汇总）';

CREATE VIEW mart.v_indicator_display AS
SELECT v.value_id, d.indicator_id, sv.code AS version_code, d.code AS indicator_code, d.name AS indicator_name,
       d.level, d.unit, d.score AS full_score, d.display_position,
       v.node_id, n.name AS node_name, v.period_type, v.period_start, v.period_end,
       v.value, v.value_text, v.normalized, v.score, b.benchmark_type, b.value AS benchmark_value,
       b.source_doc AS benchmark_source
FROM fact.indicator_value v
JOIN core.indicator_def d     ON d.indicator_id = v.indicator_id
JOIN core.standard_version sv ON sv.version_id = d.version_id
JOIN core.org_node n          ON n.node_id = v.node_id
LEFT JOIN core.indicator_benchmark b ON b.benchmark_id = v.benchmark_id
WHERE v.is_current AND v.achieved AND d.display_enabled;
COMMENT ON VIEW mart.v_indicator_display IS '前台达标展示：只含当前有效、已达标且允许展示的指标';

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0005', 'Agent 会话与工具调用日志、变更审计触发器、mart 只读视图');
