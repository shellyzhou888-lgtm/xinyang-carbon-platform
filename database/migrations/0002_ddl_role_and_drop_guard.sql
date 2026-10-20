-- 0002 建表权限角色、防删除保护、Agent 只读范围调整
-- 执行身份：postgres（创建角色、事件触发器需要超级用户）。事务由执行脚本控制。
--
-- 设计要点：
--   1. 新增组角色 green_ddl：可以建表、改自己建的表，但不能删除任何表、列、视图、schema。
--   2. “不能删除”由事件触发器统一拦截：非超级用户执行的 DROP（含 ALTER TABLE ... DROP COLUMN）一律回滚。
--   3. green_ddl 默认不持有自己表上的 DELETE、TRUNCATE 权限。
--   4. green_agent_ro 增加 core（字典、指标定义、术语）只读；raw、fact 仍不开放，只经 mart 视图访问。
--   5. 新增 lab schema：用户或 Agent 自建的数据表默认放这里，与迁移管理的正式表分开。

-- 1. green_ddl --------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'green_ddl') THEN
    CREATE ROLE green_ddl NOLOGIN;
  END IF;
END $$;
COMMENT ON ROLE green_ddl IS '可建表（自建表可改结构），不能删除对象、不能 DELETE/TRUNCATE；继承 green_app 的读写';

GRANT green_app TO green_ddl;   -- 读写业务数据
GRANT green_ddl TO zyz;         -- 开发期 zyz 同时具有建表权限

-- zyz 连到 greensystem 时自动切换为 green_ddl，使其新建对象统一归 green_ddl 所有、套用下面的默认授权
ALTER ROLE zyz IN DATABASE greensystem SET role = 'green_ddl';

-- 2. lab schema 与建表权限 ---------------------------------------------------
CREATE SCHEMA IF NOT EXISTS lab AUTHORIZATION greensystem;
COMMENT ON SCHEMA lab IS '自建数据表：网站用户上传的新类型数据集、Agent 生成的中间表，不由迁移管理';

GRANT USAGE ON SCHEMA lab TO green_app, green_etl;
GRANT USAGE, CREATE ON SCHEMA core, raw, fact, mart, lab TO green_ddl;

-- greensystem 在 lab 中建的对象
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA lab
  GRANT SELECT, INSERT, UPDATE ON TABLES TO green_app, green_etl;
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA lab
  GRANT USAGE, SELECT ON SEQUENCES TO green_app, green_etl;

-- green_ddl 自建对象：其他角色的访问规则与正式表一致
ALTER DEFAULT PRIVILEGES FOR ROLE green_ddl IN SCHEMA core
  GRANT SELECT ON TABLES TO green_etl, green_agent_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE green_ddl IN SCHEMA core
  GRANT SELECT, INSERT, UPDATE ON TABLES TO green_app;
ALTER DEFAULT PRIVILEGES FOR ROLE green_ddl IN SCHEMA raw, fact, lab
  GRANT SELECT, INSERT, UPDATE ON TABLES TO green_etl, green_app;
ALTER DEFAULT PRIVILEGES FOR ROLE green_ddl IN SCHEMA mart
  GRANT SELECT ON TABLES TO green_etl, green_app, green_agent_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE green_ddl IN SCHEMA core, raw, fact, lab
  GRANT USAGE, SELECT ON SEQUENCES TO green_app, green_etl;
-- 所有者默认拥有全部权限，这里收回自己表上的 DELETE、TRUNCATE
ALTER DEFAULT PRIVILEGES FOR ROLE green_ddl
  REVOKE DELETE, TRUNCATE ON TABLES FROM green_ddl;
ALTER DEFAULT PRIVILEGES FOR ROLE green_ddl REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 3. Agent 只读范围：core 可读 --------------------------------------------------
GRANT USAGE ON SCHEMA core TO green_agent_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA core
  GRANT SELECT ON TABLES TO green_agent_ro;

-- 4. 防删除事件触发器 -----------------------------------------------------------
CREATE OR REPLACE FUNCTION audit.block_drop() RETURNS event_trigger
LANGUAGE plpgsql AS $$
DECLARE
  obj record;
BEGIN
  -- 超级用户（人工管理员执行的迁移）放行
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) THEN
    RETURN;
  END IF;
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects() LOOP
    IF NOT obj.is_temporary
       AND obj.object_type IN ('schema','table','table column','view','materialized view','foreign table')
    THEN
      RAISE EXCEPTION '禁止删除 %（%）。删除表、列、视图需由管理员执行迁移。', obj.object_identity, obj.object_type
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION audit.block_drop() FROM PUBLIC;

DROP EVENT TRIGGER IF EXISTS green_block_drop;
CREATE EVENT TRIGGER green_block_drop ON sql_drop
  EXECUTE FUNCTION audit.block_drop();
COMMENT ON EVENT TRIGGER green_block_drop IS '非超级用户不得删除表、列、视图、schema';

INSERT INTO audit.schema_migration (version, description)
VALUES ('0002', '建表角色 green_ddl、lab schema、防删除事件触发器、Agent 可读 core');
