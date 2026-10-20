-- 0023 修正 0021 漏授权：engine.qualified 未授予执行权限，导致应用角色计算“高新技术企业产值占比”时报 permission denied。
-- 同时为 engine schema 设默认权限，以后新增的计算函数自动授权给 green_app / green_etl。
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。

SET ROLE greensystem;

GRANT EXECUTE ON FUNCTION engine.qualified(bigint, text, int) TO green_app, green_etl;
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA engine GRANT EXECUTE ON FUNCTIONS TO green_app, green_etl;

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0023', '补授 engine.qualified 执行权限；engine 新函数默认授权');
