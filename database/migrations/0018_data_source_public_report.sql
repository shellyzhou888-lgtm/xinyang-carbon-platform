-- 0018 “数据来源”下拉增加“公开报道”（记为 manual），用于导入新闻、政府通报等公开渠道获得的真实数值
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。

SET ROLE greensystem;

UPDATE core.import_field_map
SET transform = jsonb_set(transform, '{value_map,公开报道}', '"manual"')
WHERE target_field = 'data_source' AND transform ? 'value_map';

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0018', '数据来源下拉增加“公开报道”');
