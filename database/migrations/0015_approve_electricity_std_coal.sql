-- 0015 批准其余电力品种的折标准煤系数（GB/T 2589-2020 表A.2 电力当量值 0.1229 kgce/kWh）
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。
-- 说明：0012 只批准了电网电力的折标系数。直供非化石、绿证绿电、自发光伏、自发风电与电网电力
-- 同用表A.2 的电力当量值，属于项目负责人 2026-10-20 已同意的“电力”复核范围。
-- 未批准时，引擎会因缺少系数把光伏自用电量排除在综合能耗之外，可再生能源利用率被低估。

SET ROLE greensystem;

UPDATE core.factor f
SET reviewed_by = 'Claude（AI 复核）', reviewed_at = now(),
    review_note = '与 GB/T 2589-2020 表A.2 电力（当量值）0.1229 kgce/(kW·h) 一致',
    status = 'approved',
    approved_by = 'shellyzhou888-lgtm（项目负责人，2026-10-20 会话确认电力因子复核范围）',
    approved_at = now()
FROM core.factor_source s
WHERE f.source_id = s.source_id AND s.code = 'GBT2589_2020_A'
  AND f.factor_kind = 'std_coal' AND f.status = 'draft'
  AND f.energy_type_code IN ('ELEC_DIRECT_NONFOSSIL','ELEC_GREEN_TRADE','ELEC_SELF_PV','ELEC_SELF_WIND');

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0015', '批准直供非化石、绿证绿电、自发光伏、自发风电的电力折标准煤系数（当量值 0.1229）');
