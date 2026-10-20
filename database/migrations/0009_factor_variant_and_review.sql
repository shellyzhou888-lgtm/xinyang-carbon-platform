-- 0009 因子口径（variant）、复核记录、标准版本的因子偏好；同步政策文件改名后的路径
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。
--
-- 为什么需要“口径”：同一能源可能并存多个合法因子，例如电网电力有全国化石能源电力因子
-- （零碳园区核算用）、河南省级电力平均因子、全国电力平均因子。用 variant 区分后，
-- 不同评价标准按 standard_version.factor_preferences 选择各自口径，历史结果可复现。

SET ROLE greensystem;

ALTER TABLE core.factor
  ADD COLUMN variant      text NOT NULL DEFAULT 'default',
  ADD COLUMN reviewed_by  text,
  ADD COLUMN reviewed_at  timestamptz,
  ADD COLUMN review_note  text;
COMMENT ON COLUMN core.factor.variant     IS '口径：default、national_fossil、national_average、central_china、henan、mee_guideline、ipcc_2006 等';
COMMENT ON COLUMN core.factor.reviewed_by IS '复核人（核对原文数值）；批准使用仍需 approved_by';

ALTER TABLE core.factor DROP CONSTRAINT factor_factor_kind_check;
ALTER TABLE core.factor ADD CONSTRAINT factor_factor_kind_check CHECK (factor_kind IN
  ('std_coal','ncv','co2_per_tj','co2_per_unit','carbon_content','oxidation_rate'));

ALTER TABLE core.factor DROP CONSTRAINT factor_factor_kind_energy_type_code_basis_source_id_valid_f_key;
ALTER TABLE core.factor ADD CONSTRAINT factor_unique_variant
  UNIQUE (factor_kind, energy_type_code, basis, variant, source_id, valid_from);

ALTER TABLE core.standard_version
  ADD COLUMN factor_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN core.standard_version.factor_preferences IS
  '计算该版本指标时各能源选用的因子口径，例：{"ELEC_GRID":"henan"}；未指定时取 default';

-- 政策文件改为英文路径后，同步标准版本中的文件名
UPDATE core.standard_version SET source_file = 'policies/green-industrial-park/2024_MIIT-2024-13_green-factory-cultivation-measures_annex2-old-park-criteria-31items-lead-values_provincial-basis.pdf' WHERE code = 'GIP_2024';
UPDATE core.standard_version SET source_file = 'policies/green-industrial-park/2025_MIIT-2025-390_annex2_green-PARK-criteria-17items-types-scores_via-heilongjiang.pdf' WHERE code = 'GIP_2025';
UPDATE core.standard_version SET source_file = 'policies/green-industrial-park/2026_MIIT-2026-461_annex2_green-PARK-criteria-19items-names-only_CURRENT.pdf' WHERE code = 'GIP_2026';
UPDATE core.standard_version SET source_file = 'policies/2025_KEY_NDRC-2025-910_zero-carbon-park-notice_annex3-indicators_annex4-carbon-accounting.pdf' WHERE code = 'ZCP_2025';
UPDATE core.factor_source SET title = 'reference/park-energy-carbon-model.docx（园区能碳管理模型）附录B 能源碳排放因子（tCO2/TJ）'
WHERE code = 'MODEL_DOC_APX_B';

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0009', '因子口径 variant、复核字段、标准版本因子偏好；同步政策文件英文路径');
