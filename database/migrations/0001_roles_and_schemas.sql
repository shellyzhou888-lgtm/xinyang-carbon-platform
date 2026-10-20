-- 0001 角色、schema、默认授权与迁移登记
-- 执行身份：postgres（需要 CREATEROLE 和安装扩展）。可重复执行。
-- 设计：权限放在 NOLOGIN 组角色上；登录账号只需加入对应组角色，不在本文件中设置任何密码。

\set ON_ERROR_STOP on
BEGIN;

-- 1. 组角色 ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'green_etl') THEN
    CREATE ROLE green_etl NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'green_app') THEN
    CREATE ROLE green_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'green_agent_ro') THEN
    CREATE ROLE green_agent_ro NOLOGIN;
  END IF;
END $$;

COMMENT ON ROLE green_etl      IS '数据管道：入库、清洗、标记、估值替换；无 DDL、无 DELETE';
COMMENT ON ROLE green_app      IS 'Next.js 网站服务端：业务读写；无 DDL、无 DELETE';
COMMENT ON ROLE green_agent_ro IS '自然语言查询 Agent：只读 mart 视图';

-- 开发期网站连接账号 zyz 加入 green_app
GRANT green_app TO zyz;

-- 2. 扩展 --------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS ltree;    -- 对象树路径
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- 企业名、术语的模糊检索

-- 3. schema（所有者为库所有者 greensystem，迁移以该角色执行） -------------
CREATE SCHEMA IF NOT EXISTS core  AUTHORIZATION greensystem;
CREATE SCHEMA IF NOT EXISTS raw   AUTHORIZATION greensystem;
CREATE SCHEMA IF NOT EXISTS fact  AUTHORIZATION greensystem;
CREATE SCHEMA IF NOT EXISTS mart  AUTHORIZATION greensystem;
CREATE SCHEMA IF NOT EXISTS agent AUTHORIZATION greensystem;
CREATE SCHEMA IF NOT EXISTS audit AUTHORIZATION greensystem;

COMMENT ON SCHEMA core  IS '主数据与配置：对象树、能源品种、因子、指标体系、策略库';
COMMENT ON SCHEMA raw   IS '数据湖：导入批次、原始记录、文件元数据';
COMMENT ON SCHEMA fact  IS '清洗后的事实与计算结果';
COMMENT ON SCHEMA mart  IS '面向页面与 Agent 的只读视图';
COMMENT ON SCHEMA agent IS 'Agent 会话与工具调用日志';
COMMENT ON SCHEMA audit IS '迁移登记与操作审计';

-- 4. schema 使用权 -----------------------------------------------------
GRANT USAGE ON SCHEMA core, raw, fact, mart        TO green_etl;
GRANT USAGE ON SCHEMA core, raw, fact, mart, agent, audit TO green_app;
GRANT USAGE ON SCHEMA mart                          TO green_agent_ro;

-- 5. 未来对象的默认授权（只对 greensystem 创建的对象生效） ----------------
-- core：配置由网站后台维护，ETL 只读
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA core
  GRANT SELECT ON TABLES TO green_etl;
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA core
  GRANT SELECT, INSERT, UPDATE ON TABLES TO green_app;

-- raw / fact：ETL 与网站都可写入、更新；不授予 DELETE（软删除）
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA raw
  GRANT SELECT, INSERT, UPDATE ON TABLES TO green_etl, green_app;
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA fact
  GRANT SELECT, INSERT, UPDATE ON TABLES TO green_etl, green_app;

-- mart：全部只读
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA mart
  GRANT SELECT ON TABLES TO green_etl, green_app, green_agent_ro;

-- agent：日志由网站服务端写入
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA agent
  GRANT SELECT, INSERT, UPDATE ON TABLES TO green_app;

-- audit：只读（写入由触发器以定义者权限完成）
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA audit
  GRANT SELECT ON TABLES TO green_app;

-- 自增序列
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA core, raw, fact, agent
  GRANT USAGE, SELECT ON SEQUENCES TO green_app;
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA raw, fact
  GRANT USAGE, SELECT ON SEQUENCES TO green_etl;

-- 函数默认不对 PUBLIC 开放执行，按需单独授权
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 6. 迁移登记表 --------------------------------------------------------
SET ROLE greensystem;

CREATE TABLE IF NOT EXISTS audit.schema_migration (
  version     text PRIMARY KEY,
  description text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text NOT NULL DEFAULT session_user
);

INSERT INTO audit.schema_migration (version, description)
VALUES ('0001', '角色、schema、默认授权与迁移登记')
ON CONFLICT (version) DO NOTHING;

RESET ROLE;
COMMIT;
