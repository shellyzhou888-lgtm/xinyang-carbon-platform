-- Tables for TianGong LCI results computed with Brightway (packages/lca/tiangong_lca.py).
-- Kept in schema lab until the product-footprint module is approved; safe to run repeatedly.
CREATE TABLE IF NOT EXISTS lab.lca_process (
  lca_process_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  process_code     text NOT NULL,
  process_uuid     text NOT NULL,
  version          text,
  name_zh          text,
  name_en          text,
  region_code      text,
  region_name      text,
  industry_code    text,
  ref_year         int,
  dataset_type     text,
  ref_amount       numeric,
  functional_unit  text,
  n_inputs         int,
  n_linked_inputs  int,
  n_ghg_flows      int,
  closure          text CHECK (closure IN ('complete','partial','none')),
  gwp_kgco2e       double precision,
  gwp_direct_kgco2e double precision,
  gwp_groups       jsonb,
  tiangong_strict_kgco2e double precision,
  tiangong_strict_status text,
  method           text NOT NULL DEFAULT '天工 LCIA 气候变化 IPCC GWP100（Brightway 2.5 计算）',
  release          text NOT NULL DEFAULT '20261019',
  batch_id         bigint NOT NULL,
  is_current       boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lca_process_current ON lab.lca_process (process_code) WHERE is_current;
COMMENT ON TABLE lab.lca_process IS '天工 LCI 过程（20261019 版）及用 Brightway 2.5 计算的气候变化足迹（IPCC GWP100，kgCO2e/参考量）；投入无生产者时截断，closure 记录闭合程度；重算时旧行 is_current=false';
COMMENT ON COLUMN lab.lca_process.process_code IS '天工过程 UUID_版本';
COMMENT ON COLUMN lab.lca_process.process_uuid IS '天工过程 UUID';
COMMENT ON COLUMN lab.lca_process.version IS '天工过程数据集版本';
COMMENT ON COLUMN lab.lca_process.name_zh IS '产品 / 过程中文名称';
COMMENT ON COLUMN lab.lca_process.name_en IS '产品 / 过程英文名称';
COMMENT ON COLUMN lab.lca_process.region_code IS '地区代码（CN、CN-省、GLO 等）';
COMMENT ON COLUMN lab.lca_process.region_name IS '地区名称';
COMMENT ON COLUMN lab.lca_process.industry_code IS '行业代码（ISIC 两位，如 C16 木材加工）';
COMMENT ON COLUMN lab.lca_process.ref_year IS '数据参考年份';
COMMENT ON COLUMN lab.lca_process.dataset_type IS 'ILCD 数据集类型（单元过程、黑箱等）';
COMMENT ON COLUMN lab.lca_process.ref_amount IS '参考流数量（足迹按 1 个参考单位折算）';
COMMENT ON COLUMN lab.lca_process.functional_unit IS '功能单位（取自天工严格版结果，如 1 kg、1 m3、1 reference unit）';
COMMENT ON COLUMN lab.lca_process.n_inputs IS '技术圈投入条数（不含基本流）';
COMMENT ON COLUMN lab.lca_process.n_linked_inputs IS '能链接到天工生产过程的投入条数';
COMMENT ON COLUMN lab.lca_process.n_ghg_flows IS '带气候变化特征化因子的基本流条数';
COMMENT ON COLUMN lab.lca_process.closure IS '供应链闭合程度：complete 全部投入已链接；partial 部分；none 均未链接';
COMMENT ON COLUMN lab.lca_process.gwp_kgco2e IS 'Brightway 计算的摇篮到大门气候变化足迹，kgCO2e / 参考单位';
COMMENT ON COLUMN lab.lca_process.gwp_direct_kgco2e IS '其中本过程直接排放，kgCO2e / 参考单位';
COMMENT ON COLUMN lab.lca_process.gwp_groups IS '按来源分组的足迹（直接排放、电力与热力、化石燃料、运输、化工与塑料、金属、农林与木材纸品、其他上游），kgCO2e';
COMMENT ON COLUMN lab.lca_process.tiangong_strict_kgco2e IS '天工严格版结果（仅对照，不参与计算）';
COMMENT ON COLUMN lab.lca_process.tiangong_strict_status IS '天工严格版结果状态（完整闭合、部分闭合、无供应商）';
COMMENT ON COLUMN lab.lca_process.method IS '特征化方法与计算引擎';
COMMENT ON COLUMN lab.lca_process.release IS '天工数据发布版本';
COMMENT ON COLUMN lab.lca_process.batch_id IS '导入批次（raw.import_batch.batch_id）';
COMMENT ON COLUMN lab.lca_process.is_current IS '是否为当前版本';

CREATE TABLE IF NOT EXISTS lab.lca_contribution (
  lca_contribution_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  process_code      text NOT NULL,
  rank              int NOT NULL,
  contributor_code  text NOT NULL,
  contributor_name  text,
  contributor_group text,
  kgco2e            double precision,
  batch_id          bigint NOT NULL,
  is_current        boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lca_contribution_current ON lab.lca_contribution (process_code) WHERE is_current;
COMMENT ON TABLE lab.lca_contribution IS '天工过程足迹的主要贡献过程（每个过程前 8 位，Brightway 贡献分析）';
COMMENT ON COLUMN lab.lca_contribution.process_code IS '被分析的天工过程（UUID_版本）';
COMMENT ON COLUMN lab.lca_contribution.rank IS '贡献排名';
COMMENT ON COLUMN lab.lca_contribution.contributor_code IS '贡献过程（UUID_版本）';
COMMENT ON COLUMN lab.lca_contribution.contributor_name IS '贡献过程名称';
COMMENT ON COLUMN lab.lca_contribution.contributor_group IS '贡献分组';
COMMENT ON COLUMN lab.lca_contribution.kgco2e IS '贡献量，kgCO2e / 被分析过程的参考单位';
COMMENT ON COLUMN lab.lca_contribution.batch_id IS '导入批次（raw.import_batch.batch_id）';
COMMENT ON COLUMN lab.lca_contribution.is_current IS '是否为当前版本';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'green_app') THEN GRANT SELECT ON lab.lca_process, lab.lca_contribution TO green_app; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'green_agent_ro') THEN GRANT SELECT ON lab.lca_process, lab.lca_contribution TO green_agent_ro; END IF;
END $$;
