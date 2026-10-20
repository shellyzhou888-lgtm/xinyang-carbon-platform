-- 0003 主数据与配置（core）
-- 执行身份：postgres 连接后 SET ROLE greensystem，使对象归 greensystem 所有并套用 0001 的默认授权。
-- 事务由执行脚本控制（psql --single-transaction）。

SET ROLE greensystem;

-- =====================================================================
-- 1. 通用字典
-- =====================================================================

CREATE TABLE core.unit (
  code       text PRIMARY KEY,                 -- kWh、MWh、t、m3、GJ、万元 …
  name       text NOT NULL,
  dimension  text NOT NULL CHECK (dimension IN
               ('electricity','mass','volume','heat','energy_std','money','area','count','ratio','emission','other')),
  base_code  text REFERENCES core.unit(code),  -- 同量纲的基准单位
  to_base    numeric(24,10)                    -- 1 本单位 = to_base 基准单位
);
COMMENT ON TABLE core.unit IS '计量单位及换算';

CREATE TABLE core.industry (
  code          text PRIMARY KEY,              -- GB/T 4754 行业代码或自定义代码
  name          text NOT NULL,
  parent_code   text REFERENCES core.industry(code),
  park_category text CHECK (park_category IN ('green_home','electronics','service','other'))
);
COMMENT ON TABLE  core.industry IS '行业字典';
COMMENT ON COLUMN core.industry.park_category IS '园区主导产业归类：绿色家居、电子信息、现代服务业、其他';

-- =====================================================================
-- 2. 对象树：园区 → 片区/公共区域 → 企业 → 厂区 → 生产线 → 设备
-- =====================================================================

CREATE TABLE core.org_node (
  node_id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id          bigint REFERENCES core.org_node(node_id),
  node_type          text NOT NULL CHECK (node_type IN
                       ('park','zone','public_area','enterprise','site','line','equipment')),
  code               text NOT NULL UNIQUE,
  name               text NOT NULL,
  path               ltree,                    -- 由触发器维护，标签为 node_id
  industry_code      text REFERENCES core.industry(code),
  function_tag       text CHECK (function_tag IN
                       ('production','transport','infrastructure','office','other')),
  is_key_energy_unit boolean NOT NULL DEFAULT false,
  lng                numeric(10,6),
  lat                numeric(10,6),
  is_active          boolean NOT NULL DEFAULT true,
  valid_from         date,
  valid_to           date,
  remark             text,
  attributes         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- 扩展属性：未预设的字段先放这里，不改表结构
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NOT NULL OR node_type = 'park')
);
CREATE INDEX org_node_path_gist ON core.org_node USING gist (path);
CREATE INDEX org_node_parent_idx ON core.org_node (parent_id);
COMMENT ON TABLE  core.org_node IS '多维嵌套对象树；能源与碳数据挂在任意层级节点上，沿 path 汇总';
COMMENT ON COLUMN core.org_node.function_tag IS '功能属性（生产/交通/基础设施），用于能流的辅助维度';

CREATE FUNCTION core.tg_org_node_path() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_path ltree;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path := text2ltree(NEW.node_id::text);
  ELSE
    SELECT path INTO parent_path FROM core.org_node WHERE node_id = NEW.parent_id;
    IF parent_path IS NULL THEN
      RAISE EXCEPTION '上级节点 % 不存在', NEW.parent_id;
    END IF;
    IF parent_path ~ ('*.' || NEW.node_id || '.*')::lquery THEN
      RAISE EXCEPTION '节点 % 不能挂到自己的下级节点上', NEW.node_id;
    END IF;
    NEW.path := parent_path || text2ltree(NEW.node_id::text);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION core.tg_org_node_cascade() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- 上级变化后逐层刷新下级路径
  UPDATE core.org_node SET parent_id = parent_id WHERE parent_id = NEW.node_id;
  RETURN NULL;
END $$;

CREATE TRIGGER org_node_path
  BEFORE INSERT OR UPDATE OF parent_id ON core.org_node
  FOR EACH ROW EXECUTE FUNCTION core.tg_org_node_path();
CREATE TRIGGER org_node_cascade
  AFTER UPDATE OF parent_id ON core.org_node
  FOR EACH ROW WHEN (OLD.path IS DISTINCT FROM NEW.path)
  EXECUTE FUNCTION core.tg_org_node_cascade();

CREATE TABLE core.enterprise_profile (
  node_id                bigint PRIMARY KEY REFERENCES core.org_node(node_id),
  legal_name             text NOT NULL,
  credit_code            text UNIQUE,          -- 统一社会信用代码
  parent_company         text,
  founded_on             date,
  registered_capital_wan numeric(18,2),
  address                text,
  main_products          text,
  is_above_scale         boolean,              -- 规模以上工业企业
  is_high_tech           boolean,              -- 高新技术企业
  high_tech_cert_no      text,
  energy_limit_standard  text,                 -- 适用的单位产品能耗限额国标（第 6 项指标）
  source_url             text,
  attributes             jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enterprise_name_trgm ON core.enterprise_profile USING gin (legal_name gin_trgm_ops);
COMMENT ON TABLE core.enterprise_profile IS '企业档案（对象树中 node_type = enterprise 的扩展信息）';

CREATE TABLE core.honor (
  honor_id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_id               bigint NOT NULL REFERENCES core.org_node(node_id),
  honor_type            text NOT NULL CHECK (honor_type IN
                          ('green_factory','zero_carbon_factory','green_park','green_supply_chain',
                           'smart_factory','little_giant','high_tech','industry_cluster','other')),
  level                 text CHECK (level IN ('national','provincial','municipal')),
  title                 text NOT NULL,         -- 例：2024 年度河南省省级绿色工厂
  year                  smallint,
  issuer                text,
  doc_no                text,
  source_url            text,
  counts_for_indicator  boolean NOT NULL DEFAULT false, -- 计入“省以上绿色工厂总产值占比”
  show_on_screen        boolean NOT NULL DEFAULT true,  -- 大屏荣誉标识
  evidence_document_id  bigint,                         -- 0003 中补外键
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX honor_node_idx ON core.honor (node_id);
COMMENT ON TABLE core.honor IS '企业与园区荣誉：绿色工厂、零碳工厂、专精特新等';

CREATE TABLE core.green_building (
  building_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_id               bigint NOT NULL REFERENCES core.org_node(node_id),
  name                  text NOT NULL,
  building_category     text NOT NULL CHECK (building_category IN ('industrial','public')),
  is_new_build          boolean NOT NULL DEFAULT true,
  floor_area_m2         numeric(14,2),
  is_green              boolean NOT NULL DEFAULT false,
  green_rating          text,                  -- 一星/二星/三星等
  certified_year        smallint,
  evidence_document_id  bigint,
  source_url            text
);
COMMENT ON TABLE core.green_building IS '建筑台账：支撑新建工业建筑、公共建筑中绿色建筑比例（第 10、11 项）';

CREATE TABLE core.function_item (
  item_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  checklist_code  text NOT NULL CHECK (checklist_code IN ('carbon_center','microgrid','info_platform')),
  seq             smallint NOT NULL,
  name            text NOT NULL,
  description     text,
  source_doc      text,
  UNIQUE (checklist_code, seq)
);
COMMENT ON TABLE core.function_item IS '功能符合清单：能碳管理中心 12 项功能、绿色微电网功能、信息平台模块（第 12–14 项）';

-- =====================================================================
-- 3. 能源品种与因子库
-- =====================================================================

CREATE TABLE core.energy_type (
  code              text PRIMARY KEY,
  name              text NOT NULL,
  category          text NOT NULL CHECK (category IN
                      ('coal','oil','gas','electricity','heat','renewable_fuel','water','other')),
  default_unit      text NOT NULL REFERENCES core.unit(code),
  is_fossil         boolean NOT NULL,
  is_clean          boolean NOT NULL,          -- 清洁能源使用率口径
  is_renewable      boolean NOT NULL,          -- 可再生能源利用率口径
  electricity_kind  text CHECK (electricity_kind IN
                      ('grid','direct_nonfossil','green_trade','self_pv','self_wind','self_hydro','self_other')),
  heat_kind         text CHECK (heat_kind IN ('fossil','nonfossil')),
  sort_order        smallint NOT NULL DEFAULT 100
);
COMMENT ON TABLE  core.energy_type IS '能源品种；电力按来源细分，以区分电网电力（因子 0.8325）与直供绿电、绿证绿电（因子 0）';

CREATE TABLE core.factor_source (
  source_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE,          -- GBT2589_2020、NDRC_2025_910_A4 …
  title         text NOT NULL,
  doc_no        text,
  published_on  date,
  url           text,
  note          text
);

CREATE TABLE core.factor (
  factor_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  factor_kind       text NOT NULL CHECK (factor_kind IN
                      ('std_coal','ncv','co2_per_tj','co2_per_unit')),
  energy_type_code  text NOT NULL REFERENCES core.energy_type(code),
  basis             text NOT NULL DEFAULT 'default' CHECK (basis IN
                      ('default','equivalent','calorific_equal','measured')),
  value             numeric(24,10),            -- 采用值；标准只给区间时为空，待确定口径后填写
  value_low         numeric(24,10),            -- 标准给出区间时的下限
  value_high        numeric(24,10),
  unit              text NOT NULL,             -- kgce/kg、kJ/kg、tCO2/TJ、kgCO2/kWh …
  source_id         bigint NOT NULL REFERENCES core.factor_source(source_id),
  source_page       text,
  valid_from        date NOT NULL DEFAULT DATE '1900-01-01',
  valid_to          date,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  approved_by       text,
  approved_at       timestamptz,
  note              text,
  UNIQUE (factor_kind, energy_type_code, basis, source_id, valid_from),
  CHECK (value IS NOT NULL OR (value_low IS NOT NULL AND value_high IS NOT NULL)),
  CHECK (status <> 'approved' OR (value IS NOT NULL AND approved_by IS NOT NULL))
);
COMMENT ON TABLE  core.factor IS '折标系数、低位发热量、排放因子；带出处和生效期，审核通过后才参与计算';
COMMENT ON COLUMN core.factor.basis IS '电力、热力折标的当量值/等价值；其余为 default 或 measured（实测）';

-- =====================================================================
-- 4. 指标体系（多版本）
-- =====================================================================

CREATE TABLE core.standard_version (
  version_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code            text NOT NULL UNIQUE,        -- GIP_2024、GIP_2025、GIP_2026、ZCP_2025
  name            text NOT NULL,
  doc_no          text,
  issued_on       date,
  scoring_method  text NOT NULL CHECK (scoring_method IN ('green_index','weighted_score','threshold')),
  total_score     numeric(8,2),
  is_primary      boolean NOT NULL DEFAULT false,
  source_file     text,                        -- 仓库 文件/ 下的文件名
  note            text
);
CREATE UNIQUE INDEX standard_version_one_primary ON core.standard_version ((true)) WHERE is_primary;
COMMENT ON TABLE core.standard_version IS '评价标准版本；只能有一个展示主版本';

CREATE TABLE core.metric_def (
  code         text PRIMARY KEY,               -- ECO_GROSS_OUTPUT、ECO_VA_CONST、RES_FRESH_WATER …
  name         text NOT NULL,
  unit         text NOT NULL REFERENCES core.unit(code),
  category     text NOT NULL CHECK (category IN
                 ('economic','energy','carbon','resource','environment','production','infrastructure','management')),
  aggregation  text NOT NULL DEFAULT 'sum' CHECK (aggregation IN ('sum','avg','last','max','none')),
  dim_kind     text CHECK (dim_kind IN ('product','pollutant','waste')),  -- 需要附加维度时
  description  text
);
COMMENT ON TABLE core.metric_def IS '三级基础量：计算二级指标所需的统计量（产值、增加值、用水、用地、固废、污染物、产品产量等）';

CREATE TABLE core.formula (
  formula_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         text NOT NULL,
  revision     smallint NOT NULL DEFAULT 1,
  expression   text NOT NULL,                  -- 例：ECO_VA_CONST / ENG_TCE
  variables    text[] NOT NULL,
  description  text,
  origin       text NOT NULL DEFAULT 'human' CHECK (origin IN ('human','ai')),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  created_by   text NOT NULL DEFAULT session_user,
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_by  text,
  reviewed_at  timestamptz,
  review_note  text,
  UNIQUE (code, revision),
  CHECK (status <> 'approved' OR reviewed_by IS NOT NULL)
);
COMMENT ON TABLE core.formula IS '指标公式库；AI 生成的公式必须人工审核（approved）后才参与计算';

CREATE TABLE core.indicator_def (
  indicator_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id            bigint NOT NULL REFERENCES core.standard_version(version_id),
  code                  text NOT NULL,
  level                 smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  parent_id             bigint REFERENCES core.indicator_def(indicator_id),
  seq                   smallint,
  name                  text NOT NULL,
  unit                  text,
  direction             text CHECK (direction IN ('positive','negative','elastic','qualitative')),
  indicator_type        text,                  -- 原文：正向定量、正向定性、逆向定量、弹性系数
  score                 numeric(8,2),          -- 分值或权重
  select_group          text,                  -- required 或可选组编码（如 RG_4_2）
  select_count          smallint,              -- 可选组内需选数量
  handling              text CHECK (handling IN ('deep_calc','calc','self_proof','manual')),
  formula_id            bigint REFERENCES core.formula(formula_id),
  metric_code           text REFERENCES core.metric_def(code),   -- 三级指标对应的基础量
  definition            text,
  evidence_requirement  text,
  display_position      text,                  -- overview_left、energy_intensity …
  display_enabled       boolean NOT NULL DEFAULT true,
  source_page           text,
  UNIQUE (version_id, code)
);
CREATE INDEX indicator_def_parent_idx ON core.indicator_def (parent_id);
COMMENT ON TABLE core.indicator_def IS '指标定义：一、二、三级存在同一张表，按版本区分';

CREATE TABLE core.indicator_benchmark (
  benchmark_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  indicator_id      bigint NOT NULL REFERENCES core.indicator_def(indicator_id),
  benchmark_type    text NOT NULL CHECK (benchmark_type IN
                      ('lead_value','baseline','zero_carbon_target','industry_advanced','industry_average','custom')),
  park_category     text,                      -- 按主导产业分类的引领值（评价通则）
  value             numeric(24,10),
  value_text        text,                      -- 定性基准：具备、完善、是
  comparator        text NOT NULL CHECK (comparator IN ('>=','<=','=','bool')),
  source_doc        text,
  source_page       text,
  note              text
);
COMMENT ON TABLE core.indicator_benchmark IS '判定基准：引领值、零碳目标等，可多条并注明出处';

CREATE TABLE core.indicator_mapping (
  from_indicator_id  bigint NOT NULL REFERENCES core.indicator_def(indicator_id),
  to_indicator_id    bigint NOT NULL REFERENCES core.indicator_def(indicator_id),
  relation           text NOT NULL CHECK (relation IN ('same','renamed','narrowed','replaced','related')),
  note               text,
  PRIMARY KEY (from_indicator_id, to_indicator_id)
);
COMMENT ON TABLE core.indicator_mapping IS '跨版本指标对照（2024 ↔ 2025 ↔ 2026）';

-- =====================================================================
-- 5. 诊断配置：预警规则、减碳策略库、术语库
-- =====================================================================

CREATE TABLE core.alert_rule (
  rule_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  target_kind  text NOT NULL CHECK (target_kind IN ('energy','carbon','metric','indicator','data_gap','budget')),
  target_code  text,                           -- 能源品种、基础量或指标编码
  node_scope   ltree,                          -- 为空表示全园区
  condition    jsonb NOT NULL,                 -- 例：{"op":"deviation_pct","gt":10,"baseline":"same_month_last_year"}
  severity     text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  enabled      boolean NOT NULL DEFAULT true,
  description  text
);

CREATE TABLE core.strategy (
  strategy_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code                  text NOT NULL UNIQUE,
  name                  text NOT NULL,
  category              text NOT NULL CHECK (category IN
                          ('clean_energy','green_power','efficiency','waste_heat','electrification','process','management','offset')),
  applicable_category   text,                  -- 适用主导产业：green_home / electronics / all
  applicable_node_type  text,
  parameters            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 参数定义与默认值，供情景仿真
  effect_formula_id     bigint REFERENCES core.formula(formula_id),
  description           text,
  reference_source      text
);
COMMENT ON TABLE core.strategy IS '减碳策略库：光伏扩容、绿电交易、烘干余热回收、空压机变频等';

CREATE TABLE core.term (
  term_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  term        text NOT NULL UNIQUE,
  definition  text NOT NULL,
  source      text,
  aliases     text[]
);
CREATE INDEX term_trgm ON core.term USING gin (term gin_trgm_ops);
COMMENT ON TABLE core.term IS '术语库：页面命名与 Agent 解释';


-- =====================================================================
-- 6. 导入模板与字段映射（数据湖 → 正式数据）
-- =====================================================================

CREATE TABLE core.import_template (
  template_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code           text NOT NULL,
  revision       smallint NOT NULL DEFAULT 1,
  name           text NOT NULL,
  target         text NOT NULL CHECK (target IN
                   ('energy_activity','statistic_value','energy_transfer','org_node','enterprise_profile',
                    'honor','green_building','function_compliance','lab_table','raw_only')),
  file_kind      text NOT NULL DEFAULT 'excel' CHECK (file_kind IN ('excel','csv','json','api','form')),
  sheet_name     text,
  header_row     smallint DEFAULT 1,
  lab_table      text,                         -- target = lab_table 时写入的 lab 表名
  description    text,
  is_active      boolean NOT NULL DEFAULT true,
  created_by     text NOT NULL DEFAULT session_user,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, revision)
);
COMMENT ON TABLE core.import_template IS '导入模板：新的表格格式只需新增模板，不改表结构；raw_only 表示只入湖、暂不解析';

CREATE TABLE core.import_field_map (
  map_id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id       bigint NOT NULL REFERENCES core.import_template(template_id),
  source_field      text NOT NULL,             -- 表格列名或 JSON 路径
  target_field      text NOT NULL,             -- 目标表字段，如 quantity、period_month、node_code
  metric_code       text REFERENCES core.metric_def(code),
  energy_type_code  text REFERENCES core.energy_type(code),
  unit_code         text REFERENCES core.unit(code),
  transform         jsonb,                     -- 例：{"multiply":10000} 万千瓦时 → 千瓦时
  is_required       boolean NOT NULL DEFAULT false,
  UNIQUE (template_id, source_field, target_field)
);
COMMENT ON TABLE core.import_field_map IS '字段映射：表格某一列对应哪个能源品种、基础量、单位';

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0003', '主数据与配置：对象树、企业档案、荣誉、能源品种、因子库、指标体系、诊断配置');
