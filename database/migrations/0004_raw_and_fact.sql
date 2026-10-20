-- 0004 数据湖（raw）与事实、计算结果（fact）
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。
--
-- 事实表共同约定：
--   data_source   数据来源：measured 实测/API、manual 手工或 Excel、estimated AI 估值、interpolated 插值
--   quality_flag  质量标记：ok、suspect 可疑、corrected 已修正
--   is_current    当前有效版本；更正或真实数据替换估值时，旧行置 false 并由 superseded_by 指向新行
--   不授予 DELETE，历史版本全部保留

SET ROLE greensystem;

-- =====================================================================
-- 1. 数据湖
-- =====================================================================

CREATE TABLE raw.document (
  document_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  storage_key   text NOT NULL,                 -- 对象存储或服务器文件路径
  original_name text NOT NULL,
  mime_type     text,
  size_bytes    bigint,
  sha256        text,
  doc_kind      text NOT NULL CHECK (doc_kind IN ('import_file','invoice','evidence','report','policy','other')),
  uploaded_by   text NOT NULL DEFAULT session_user,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  note          text
);
COMMENT ON TABLE raw.document IS '文件元数据：导入表格、发票、佐证材料、报告；文件本体存对象存储';

CREATE TABLE raw.import_batch (
  batch_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_type        text NOT NULL CHECK (source_type IN ('form','file_upload','api','estimated','system')),
  source_name        text,                     -- 接口名、估值模型名或上传说明
  document_id        bigint REFERENCES raw.document(document_id),
  template_id        bigint REFERENCES core.import_template(template_id),   -- 为空表示只入湖，待配置模板后再解析
  submitted_by       text NOT NULL DEFAULT session_user,
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'received' CHECK (status IN
                       ('received','parsed','validated','loaded','partially_loaded','rejected','raw_only')),
  row_count          integer,
  error_count        integer,
  estimation_method  text,                     -- AI 估值批次：方法说明
  estimation_inputs  jsonb,                    -- 引用的公开数据集、行业强度、配平目标
  model_name         text,
  note               text
);
COMMENT ON TABLE raw.import_batch IS '每次导入、接口拉取或 AI 估值都形成一个批次';

CREATE TABLE raw.import_record (
  record_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id       bigint NOT NULL REFERENCES raw.import_batch(batch_id),
  row_no         integer,
  payload        jsonb NOT NULL,               -- 原样保存
  parse_status   text NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending','ok','error','skipped')),
  error_message  text,
  target_table   text,
  target_id      bigint,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_record_batch_idx ON raw.import_record (batch_id);

CREATE TABLE raw.api_source (
  source_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  endpoint       text,
  auth_kind      text,                         -- 只记方式，密钥放服务器环境变量
  schedule_cron  text,
  enabled        boolean NOT NULL DEFAULT false,
  last_run_at    timestamptz,
  note           text
);

-- 0003 中预留的佐证文件外键
ALTER TABLE core.honor
  ADD CONSTRAINT honor_evidence_fk FOREIGN KEY (evidence_document_id) REFERENCES raw.document(document_id);
ALTER TABLE core.green_building
  ADD CONSTRAINT green_building_evidence_fk FOREIGN KEY (evidence_document_id) REFERENCES raw.document(document_id);

-- =====================================================================
-- 2. 能源活动（月度）
-- =====================================================================

CREATE TABLE fact.energy_activity (
  activity_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_id              bigint NOT NULL REFERENCES core.org_node(node_id),
  period_month         date NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  energy_type_code     text NOT NULL REFERENCES core.energy_type(code),
  flow                 text NOT NULL DEFAULT 'consumption' CHECK (flow IN
                         ('consumption','receive','send_out','generation','self_use','feed_in')),
  use_type             text NOT NULL DEFAULT 'fuel' CHECK (use_type IN ('fuel','raw_material','transport','other')),
  quantity             numeric(20,6) NOT NULL,
  unit                 text NOT NULL REFERENCES core.unit(code),
  quantity_std         numeric(20,6),          -- 换算到能源品种默认单位
  tce                  numeric(20,6),          -- 折标准煤，由计算写入
  std_coal_factor_id   bigint REFERENCES core.factor(factor_id),
  data_source          text NOT NULL CHECK (data_source IN ('measured','manual','estimated','interpolated')),
  quality_flag         text NOT NULL DEFAULT 'ok' CHECK (quality_flag IN ('ok','suspect','corrected')),
  batch_id             bigint REFERENCES raw.import_batch(batch_id),
  record_id            bigint REFERENCES raw.import_record(record_id),
  is_current           boolean NOT NULL DEFAULT true,
  superseded_by        bigint REFERENCES fact.energy_activity(activity_id),
  attributes           jsonb NOT NULL DEFAULT '{}'::jsonb,
  note                 text,
  created_by           text NOT NULL DEFAULT session_user,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX energy_activity_current_uq
  ON fact.energy_activity (node_id, period_month, energy_type_code, flow, use_type) WHERE is_current;
CREATE INDEX energy_activity_period_idx ON fact.energy_activity (period_month);
COMMENT ON TABLE  fact.energy_activity IS '能源活动月度事实：消费、受入、送出、自发电等';
COMMENT ON COLUMN fact.energy_activity.use_type IS '用作原料的能源计入综合能耗，但不计燃料燃烧排放';

CREATE TABLE fact.energy_transfer (
  transfer_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_node_id      bigint NOT NULL REFERENCES core.org_node(node_id),
  to_node_id        bigint NOT NULL REFERENCES core.org_node(node_id),
  period_month      date NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  energy_type_code  text NOT NULL REFERENCES core.energy_type(code),
  quantity          numeric(20,6) NOT NULL,
  unit              text NOT NULL REFERENCES core.unit(code),
  allocation_rule   text,                      -- 计量或分摊规则说明
  data_source       text NOT NULL CHECK (data_source IN ('measured','manual','estimated','interpolated')),
  batch_id          bigint REFERENCES raw.import_batch(batch_id),
  is_current        boolean NOT NULL DEFAULT true,
  superseded_by     bigint REFERENCES fact.energy_transfer(transfer_id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (from_node_id <> to_node_id)
);
CREATE INDEX energy_transfer_period_idx ON fact.energy_transfer (period_month);
COMMENT ON TABLE fact.energy_transfer IS '内部转供与分摊，用于能流、碳流桑基图闭合，避免重复计入';

-- =====================================================================
-- 3. 统计台账（经济、资源、环境、产量）
-- =====================================================================

CREATE TABLE fact.statistic_value (
  stat_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_id        bigint NOT NULL REFERENCES core.org_node(node_id),
  period_type    text NOT NULL CHECK (period_type IN ('month','quarter','year')),
  period_start   date NOT NULL,
  metric_code    text NOT NULL REFERENCES core.metric_def(code),
  dim_code       text NOT NULL DEFAULT '',     -- 产品、污染物、固废种类；无附加维度时为空串
  value          numeric(24,6) NOT NULL,
  unit           text NOT NULL REFERENCES core.unit(code),
  data_source    text NOT NULL CHECK (data_source IN ('measured','manual','estimated','interpolated')),
  quality_flag   text NOT NULL DEFAULT 'ok' CHECK (quality_flag IN ('ok','suspect','corrected')),
  batch_id       bigint REFERENCES raw.import_batch(batch_id),
  record_id      bigint REFERENCES raw.import_record(record_id),
  is_current     boolean NOT NULL DEFAULT true,
  superseded_by  bigint REFERENCES fact.statistic_value(stat_id),
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by     text NOT NULL DEFAULT session_user,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX statistic_value_current_uq
  ON fact.statistic_value (node_id, period_type, period_start, metric_code, dim_code) WHERE is_current;
COMMENT ON TABLE fact.statistic_value IS '三级基础量的取值：产值、增加值、用水、用地、固废、废水、污染物、产品产量等';

-- =====================================================================
-- 4. 计算批次与结果
-- =====================================================================

CREATE TABLE fact.calc_run (
  run_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_type       text NOT NULL CHECK (run_type IN ('energy','carbon','indicator','forecast','diagnosis')),
  version_id     bigint REFERENCES core.standard_version(version_id),
  period_from    date,
  period_to      date,
  node_scope     ltree,
  params         jsonb NOT NULL DEFAULT '{}'::jsonb,
  formula_ids    bigint[],                     -- 本次使用的公式版本
  factor_ids     bigint[],                     -- 本次使用的因子
  status         text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
  triggered_by   text NOT NULL DEFAULT session_user,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  error_message  text
);
COMMENT ON TABLE fact.calc_run IS '计算批次：记录口径、公式和因子版本，结果可复现';

CREATE TABLE fact.carbon_emission (
  emission_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id             bigint NOT NULL REFERENCES fact.calc_run(run_id),
  node_id            bigint NOT NULL REFERENCES core.org_node(node_id),
  period_month       date NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  category           text NOT NULL CHECK (category IN
                       ('fuel_combustion','energy_conversion','indirect_electricity','indirect_heat','industrial_process')),
  energy_type_code   text REFERENCES core.energy_type(code),
  activity_id        bigint REFERENCES fact.energy_activity(activity_id),
  activity_quantity  numeric(20,6),
  factor_id          bigint REFERENCES core.factor(factor_id),
  co2_t              numeric(20,6) NOT NULL,   -- 送出部分为负值，体现“净受入”
  estimated_share    numeric(5,4) NOT NULL DEFAULT 0 CHECK (estimated_share BETWEEN 0 AND 1),
  is_current         boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX carbon_emission_node_period_idx ON fact.carbon_emission (node_id, period_month) WHERE is_current;
COMMENT ON TABLE fact.carbon_emission IS '碳核算结果（发改环资〔2025〕910 号附件 4），逐笔追溯到活动数据与因子';

CREATE TABLE fact.indicator_value (
  value_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  indicator_id     bigint NOT NULL REFERENCES core.indicator_def(indicator_id),
  node_id          bigint NOT NULL REFERENCES core.org_node(node_id),
  period_type      text NOT NULL CHECK (period_type IN ('month','quarter','year','period')),
  period_start     date NOT NULL,
  period_end       date,
  value            numeric(24,8),
  value_text       text,                       -- 定性指标取值
  normalized       numeric(12,6),              -- 指标值/引领值（逆向为引领值/指标值）
  score            numeric(8,2),               -- 按版本计分规则得到的分数
  achieved         boolean,                    -- 是否达到判定基准，决定前台是否展示
  benchmark_id     bigint REFERENCES core.indicator_benchmark(benchmark_id),
  run_id           bigint REFERENCES fact.calc_run(run_id),
  input_snapshot   jsonb,                      -- 计算时用到的变量取值，供依据溯源
  estimated_share  numeric(5,4) NOT NULL DEFAULT 0 CHECK (estimated_share BETWEEN 0 AND 1),
  review_status    text NOT NULL DEFAULT 'auto' CHECK (review_status IN ('auto','submitted','approved','rejected')),
  is_current       boolean NOT NULL DEFAULT true,
  superseded_by    bigint REFERENCES fact.indicator_value(value_id),
  created_by       text NOT NULL DEFAULT session_user,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX indicator_value_current_uq
  ON fact.indicator_value (indicator_id, node_id, period_type, period_start) WHERE is_current;
COMMENT ON TABLE fact.indicator_value IS '指标值与得分；计算型由引擎写入，录入型由后台填报并审核';

CREATE TABLE fact.evidence (
  evidence_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  indicator_id   bigint NOT NULL REFERENCES core.indicator_def(indicator_id),
  node_id        bigint NOT NULL REFERENCES core.org_node(node_id),
  year           smallint NOT NULL,
  value_id       bigint REFERENCES fact.indicator_value(value_id),
  document_id    bigint NOT NULL REFERENCES raw.document(document_id),
  description    text,
  review_status  text NOT NULL DEFAULT 'submitted' CHECK (review_status IN ('submitted','approved','rejected')),
  reviewed_by    text,
  reviewed_at    timestamptz,
  is_current     boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE fact.evidence IS '指标佐证材料，对应工信部平台填报时上传的证明';

CREATE TABLE fact.function_compliance (
  compliance_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_id               bigint NOT NULL REFERENCES core.org_node(node_id),
  year                  smallint NOT NULL,
  item_id               bigint NOT NULL REFERENCES core.function_item(item_id),
  compliant             boolean NOT NULL,
  evidence_document_id  bigint REFERENCES raw.document(document_id),
  note                  text,
  is_current            boolean NOT NULL DEFAULT true,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX function_compliance_current_uq
  ON fact.function_compliance (node_id, year, item_id) WHERE is_current;

-- =====================================================================
-- 5. 诊断：预警 → 根因溯源 → 减碳策略 → 能碳预测
-- =====================================================================

CREATE TABLE fact.alert_event (
  alert_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id         bigint NOT NULL REFERENCES core.alert_rule(rule_id),
  node_id         bigint NOT NULL REFERENCES core.org_node(node_id),
  period_start    date NOT NULL,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  severity        text NOT NULL CHECK (severity IN ('info','warning','critical')),
  message         text NOT NULL,
  observed_value  numeric(24,6),
  baseline_value  numeric(24,6),
  root_cause      jsonb,                       -- 根因溯源结果：下级节点贡献度排序
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  resolved_at     timestamptz,
  run_id          bigint REFERENCES fact.calc_run(run_id)
);
CREATE INDEX alert_event_open_idx ON fact.alert_event (status, detected_at);

CREATE TABLE fact.strategy_plan (
  plan_id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_id                bigint NOT NULL REFERENCES core.org_node(node_id),
  strategy_id            bigint NOT NULL REFERENCES core.strategy(strategy_id),
  alert_id               bigint REFERENCES fact.alert_event(alert_id),
  params                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_tce_saving    numeric(20,6),
  expected_co2_reduction numeric(20,6),
  forecast_run_id        bigint REFERENCES fact.calc_run(run_id),
  status                 text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','adopted','implemented','rejected')),
  created_by             text NOT NULL DEFAULT session_user,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fact.forecast (
  forecast_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id         bigint NOT NULL REFERENCES fact.calc_run(run_id),
  node_id        bigint NOT NULL REFERENCES core.org_node(node_id),
  target_kind    text NOT NULL CHECK (target_kind IN ('energy_tce','co2_t','metric','indicator')),
  target_code    text,
  scenario_code  text NOT NULL DEFAULT 'baseline',   -- baseline 或策略编码
  plan_id        bigint REFERENCES fact.strategy_plan(plan_id),
  period_month   date NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  value          numeric(24,6) NOT NULL,
  lower_bound    numeric(24,6),
  upper_bound    numeric(24,6),
  budget_value   numeric(24,6)                       -- 用能与碳排放预算，用于对比
);
CREATE INDEX forecast_lookup_idx ON fact.forecast (node_id, target_kind, scenario_code, period_month);

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0004', '数据湖与事实：文件、导入批次、能源活动、统计台账、碳核算、指标值、佐证、预警、策略、预测');
