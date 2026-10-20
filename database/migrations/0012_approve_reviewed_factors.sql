-- 0012 批准已复核的四类因子（电网电力、天然气、热力、柴油），停用模型文档中来源不明的天然气因子
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。
-- 依据：项目负责人 2026-10-20 在会话中确认同意复核结论与因子口径（绿色园区用河南省级电力因子，零碳园区用全国化石能源电力因子）。

SET ROLE greensystem;

-- 1. 绿电、自发电零排放因子：补充复核记录（910 号文附件4 原文）
UPDATE core.factor f
SET reviewed_by = 'Claude（AI 复核）', reviewed_at = now(),
    review_note = '与 910 号文附件4 原文一致：直供非化石能源电力、绿证绿电交易电力计 0；园区内自发非化石电力按非化石电力计 0'
FROM core.factor_source s
WHERE f.source_id = s.source_id AND s.code = 'NDRC_2025_910_A4'
  AND f.energy_type_code IN ('ELEC_DIRECT_NONFOSSIL','ELEC_GREEN_TRADE','ELEC_SELF_PV','ELEC_SELF_WIND');

-- 2. 批准：已复核、有采用值、属于本次范围的因子
UPDATE core.factor f
SET status = 'approved',
    approved_by = 'shellyzhou888-lgtm（项目负责人，2026-10-20 会话确认）',
    approved_at = now()
FROM core.factor_source s
WHERE f.source_id = s.source_id
  AND f.status = 'draft'
  AND f.value IS NOT NULL
  AND f.reviewed_by IS NOT NULL
  AND (
        -- 电网电力 2021–2023 官方因子；910 号文引用值
        (s.code IN ('MEE_NBS_2024_12','MEE_NBS_2024_33','MEE_NBS_2025_47','NDRC_2025_910_A4')
         AND f.energy_type_code IN ('ELEC_GRID','ELEC_DIRECT_NONFOSSIL','ELEC_GREEN_TRADE','ELEC_SELF_PV','ELEC_SELF_WIND',
                                    'HEAT_FOSSIL','HEAT_NONFOSSIL'))
        -- 天然气、柴油：生态环境部指南参数及由此计算的值
     OR (s.code = 'MEE_STEEL_GUIDE_A1' AND f.energy_type_code IN ('NATURAL_GAS','DIESEL'))
        -- GB/T 2589 折标准煤系数：电力、热力、柴油
     OR (s.code = 'GBT2589_2020_A' AND f.factor_kind = 'std_coal'
         AND f.energy_type_code IN ('ELEC_GRID','HEAT_FOSSIL','HEAT_NONFOSSIL','DIESEL'))
  );

-- 3. 停用：模型文档附录B 天然气 57.2 tCO2/TJ（与官方值、IPCC 值均不一致）
UPDATE core.factor f
SET status = 'retired',
    review_note = review_note || '；2026-10-20 经项目负责人确认停用'
FROM core.factor_source s
WHERE f.source_id = s.source_id AND s.code = 'MODEL_DOC_APX_B'
  AND f.energy_type_code = 'NATURAL_GAS' AND f.factor_kind = 'co2_per_tj';

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0012', '批准已复核的电网电力、天然气、热力、柴油因子；停用模型文档天然气因子');
