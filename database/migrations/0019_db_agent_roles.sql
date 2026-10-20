-- 0019 数据库 Agent 的权限准备
-- 执行身份：postgres。事务由执行脚本控制。
--
-- Agent 复用网站连接账号 zyz，每次工具调用在事务内用 SET LOCAL ROLE 切换到最小必要角色：
--   受限 SQL 查询   → green_agent_ro（只读 mart、core），并在只读事务中执行
--   固定查询工具   → green_app，但在只读事务中执行（数据库保证写不进去）
--   写数据         → green_app（无 DELETE）
--   建表、加列     → green_ddl（不能删除对象）
-- 为此 zyz 需要是 green_agent_ro 的成员（已是 green_app、green_ddl 的成员）。

GRANT green_agent_ro TO zyz;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0019', '数据库 Agent：zyz 加入 green_agent_ro，以便按工具切换最小权限角色');
