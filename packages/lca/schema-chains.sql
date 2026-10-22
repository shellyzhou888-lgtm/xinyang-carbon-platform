-- Product carbon trajectories (packages/lca/product_chains.py). Kept in schema lab while the module is piloted.
CREATE TABLE IF NOT EXISTS lab.product_chain (
  product_chain_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_code      text NOT NULL,
  name            text NOT NULL,
  industry        text,
  functional_unit text NOT NULL,
  year            int NOT NULL,
  total_kgco2e    double precision,
  milestones      jsonb,
  factor_rule     text,
  data_source     text NOT NULL DEFAULT 'estimated',
  batch_id        bigint NOT NULL,
  is_current      boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE lab.product_chain IS '园区产业链产品碳足迹（碳轨迹）试点：每条链一个功能单位的摇篮到大门及分销足迹；物料清单、产量、运输为模拟值（data_source=estimated）';
COMMENT ON COLUMN lab.product_chain.chain_code IS '产业链编码（HOME 绿色家居、ELEC 电子信息）';
COMMENT ON COLUMN lab.product_chain.name IS '产业链名称';
COMMENT ON COLUMN lab.product_chain.industry IS '所属产业';
COMMENT ON COLUMN lab.product_chain.functional_unit IS '功能单位';
COMMENT ON COLUMN lab.product_chain.year IS '园区生产数据年份';
COMMENT ON COLUMN lab.product_chain.total_kgco2e IS '功能单位碳足迹合计，kgCO2e';
COMMENT ON COLUMN lab.product_chain.milestones IS '中间产品节点（如刨花板、LED 芯片）及到该节点的累计足迹';
COMMENT ON COLUMN lab.product_chain.factor_rule IS '背景因子取值规则';
COMMENT ON COLUMN lab.product_chain.data_source IS '数据来源（estimated 为模拟）';
COMMENT ON COLUMN lab.product_chain.batch_id IS '导入批次（raw.import_batch.batch_id）';
COMMENT ON COLUMN lab.product_chain.is_current IS '是否为当前版本';

CREATE TABLE IF NOT EXISTS lab.product_chain_stage (
  product_chain_stage_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_code      text NOT NULL,
  seq             int NOT NULL,
  stage_code      text NOT NULL,
  phase           text NOT NULL,
  name            text NOT NULL,
  enterprise_code text,
  amount          double precision NOT NULL,
  unit            text NOT NULL,
  factor_kind     text NOT NULL CHECK (factor_kind IN ('tiangong','park_factor','park_enterprise')),
  factor_value    double precision,
  factor_unit     text,
  factor_basis    text,
  process_code    text,
  process_name    text,
  kgco2e          double precision,
  cumulative_kgco2e double precision,
  note            text,
  data_source     text NOT NULL DEFAULT 'estimated',
  batch_id        bigint NOT NULL,
  is_current      boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE lab.product_chain_stage IS '产品碳轨迹的各阶段：用量 × 因子 = 排放，cumulative_kgco2e 为沿产业链累计的足迹';
COMMENT ON COLUMN lab.product_chain_stage.chain_code IS '产业链编码';
COMMENT ON COLUMN lab.product_chain_stage.seq IS '阶段顺序';
COMMENT ON COLUMN lab.product_chain_stage.stage_code IS '阶段编码';
COMMENT ON COLUMN lab.product_chain_stage.phase IS '生命周期环节（原料获取、运输、园区生产、包装、分销）';
COMMENT ON COLUMN lab.product_chain_stage.name IS '阶段名称';
COMMENT ON COLUMN lab.product_chain_stage.enterprise_code IS '园区企业节点编码（园区生产阶段）';
COMMENT ON COLUMN lab.product_chain_stage.amount IS '每功能单位用量';
COMMENT ON COLUMN lab.product_chain_stage.unit IS '用量单位';
COMMENT ON COLUMN lab.product_chain_stage.factor_kind IS '因子来源：tiangong 天工背景过程，park_factor 园区核算因子，park_enterprise 企业排放 ÷ 产量';
COMMENT ON COLUMN lab.product_chain_stage.factor_value IS '排放因子数值';
COMMENT ON COLUMN lab.product_chain_stage.factor_unit IS '排放因子单位';
COMMENT ON COLUMN lab.product_chain_stage.factor_basis IS '因子取值依据（Brightway 递归、天工严格版或企业排放）';
COMMENT ON COLUMN lab.product_chain_stage.process_code IS '天工过程（UUID_版本）';
COMMENT ON COLUMN lab.product_chain_stage.process_name IS '天工过程名称';
COMMENT ON COLUMN lab.product_chain_stage.kgco2e IS '本阶段排放，kgCO2e / 功能单位';
COMMENT ON COLUMN lab.product_chain_stage.cumulative_kgco2e IS '截至本阶段的累计排放（碳轨迹）';
COMMENT ON COLUMN lab.product_chain_stage.note IS '用量与替代过程说明';
COMMENT ON COLUMN lab.product_chain_stage.data_source IS '数据来源（estimated 为模拟）';
COMMENT ON COLUMN lab.product_chain_stage.batch_id IS '导入批次（raw.import_batch.batch_id）';
COMMENT ON COLUMN lab.product_chain_stage.is_current IS '是否为当前版本';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'green_app') THEN GRANT SELECT ON lab.product_chain, lab.product_chain_stage TO green_app; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'green_agent_ro') THEN GRANT SELECT ON lab.product_chain, lab.product_chain_stage TO green_agent_ro; END IF;
END $$;
