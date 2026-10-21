-- 治理兜底：不经过导入工具、直接写库或建表（例如在编程会话里用 SQL 导入）也会留下待治理事件。
--   · DDL 事件触发器：在 core / fact / mart / lab 新建或修改表、视图时记 'ddl' 事件；
--   · 语句级写入触发器：core、fact 业务表发生 INSERT / UPDATE 时记 'write' 事件（同一张表一小时内未处理的事件只记一次）；
--   · 治理运行 `govern --if-changed`（导入脚本结束时、每小时计划任务）看到这些事件就会刷新目录、起草说明并跑检测。
-- 气象表由同步脚本按批次记事件，不重复挂写入触发器。

SET ROLE greensystem;

ALTER TABLE semantic.publish_event DROP CONSTRAINT IF EXISTS publish_event_kind_check;
ALTER TABLE semantic.publish_event ADD CONSTRAINT publish_event_kind_check CHECK (kind IN ('import','calc','ddl','write'));
ALTER TABLE semantic.publish_event ADD COLUMN detail text;
COMMENT ON COLUMN semantic.publish_event.kind IS 'import 导入批次入库；calc 计算完成；ddl 新建或修改表 / 视图；write 业务表被直接写入';
COMMENT ON COLUMN semantic.publish_event.detail IS 'ddl / write 事件涉及的对象（schema.table）';

CREATE FUNCTION semantic.on_table_written() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE obj text := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM semantic.publish_event
                  WHERE kind = 'write' AND detail = obj AND run_id IS NULL AND created_at > now() - interval '1 hour') THEN
    INSERT INTO semantic.publish_event (kind, ref_id, detail) VALUES ('write', 0, obj);
  END IF;
  RETURN NULL;
END $$;
COMMENT ON FUNCTION semantic.on_table_written() IS '业务表语句级写入后记一次待治理事件（一小时内同表未处理事件不重复）';

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN ('core','fact') AND c.relkind IN ('r','p') AND c.relname NOT LIKE 'weather%'
  LOOP
    EXECUTE format('CREATE TRIGGER governance_write_event AFTER INSERT OR UPDATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION semantic.on_table_written()',
                   t.nspname, t.relname);
  END LOOP;
END $$;

CREATE FUNCTION semantic.on_ddl_end() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT object_identity FROM pg_event_trigger_ddl_commands()
            WHERE schema_name IN ('core','fact','mart','lab')
              AND object_type IN ('table','view','materialized view','table column')
  LOOP
    INSERT INTO semantic.publish_event (kind, ref_id, detail) VALUES ('ddl', 0, r.object_identity);
  END LOOP;
END $$;
COMMENT ON FUNCTION semantic.on_ddl_end() IS '在 core / fact / mart / lab 建表、建视图或加列后记待治理事件';

RESET ROLE;

-- 事件触发器只能由超级用户创建；函数归 greensystem 所有并以其权限写事件表。
CREATE EVENT TRIGGER governance_ddl_event ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'CREATE VIEW', 'CREATE MATERIALIZED VIEW', 'ALTER TABLE', 'SELECT INTO')
  EXECUTE FUNCTION semantic.on_ddl_end();

INSERT INTO audit.schema_migration (version, description)
VALUES ('0034', '治理兜底：DDL 事件触发器与业务表写入触发器记待治理事件（publish_event 新增 ddl / write 类型）');
