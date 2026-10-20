-- 0022 语义目录与数据治理（schema semantic）
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。
--
-- 针对直接 Text-to-SQL 的三类问题（参考方案表 7）：
--   1. 模型只在提问时临时读表结构        → 语义目录：表/字段业务说明、关联图、指标层、已验证问答对，提问前就建好
--   2. 脏数据、口径歧义、关联陷阱靠人工  → 治理检测（SQL 规则）+ 治理工单，管理员在网站“数据治理”页审批
--   3. 复杂查询生成错误 SQL、口径幻觉    → 指标层约束口径、关联图约束连接，SQL 经计划校验与试执行后交付（在 Agent 代码中）

SET ROLE greensystem;

CREATE SCHEMA semantic;
COMMENT ON SCHEMA semantic IS '语义目录与数据治理：表/字段业务说明、字段剖析、关联图、指标层视图、已验证问答对、治理规则与工单';

-- 1. 专题 -----------------------------------------------------------------------------------
CREATE TABLE semantic.topic (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  sort_order  smallint NOT NULL DEFAULT 100
);
COMMENT ON TABLE semantic.topic IS '数据专题：组织表、权限和问答的共同单位';

INSERT INTO semantic.topic (code, name, description, sort_order) VALUES
  ('org',        '园区与企业',   '对象树（园区→片区→企业/公共设施）、企业档案、资格、荣誉', 10),
  ('energy',     '能源',         '月度能源活动（实物量、折标准煤）、能源品种、折标系数', 20),
  ('carbon',     '碳排放',       '碳核算结果、排放因子与来源、计算口径', 30),
  ('economy',    '经济',         '工业总产值、工业增加值、从业人数等年度统计', 40),
  ('resource',   '资源环境',     '用水、用地、固废、污染物、绿色建筑等年度统计', 50),
  ('evaluation', '指标评价',     '评价标准版本、指标定义、公式、判定基准、指标计算结果', 60),
  ('reference',  '参考字典',     '计量单位、行业、术语、导入模板', 70),
  ('ops',        '运行与治理',   '计算批次、导入批次、语义目录、治理工单', 80);

-- 2. 表与字段的业务说明 -----------------------------------------------------------------------
CREATE TABLE semantic.table_doc (
  object         text PRIMARY KEY,                 -- schema.table，如 fact.energy_activity
  topic_code     text REFERENCES semantic.topic(code),
  layer          text CHECK (layer IN ('master','fact','derived','reference','ops')),
  business_name  text,
  description    text,
  grain          text,                             -- 一行代表什么
  usage_notes    text,                             -- 怎么正确使用
  caveats        text[] NOT NULL DEFAULT '{}',     -- 口径与陷阱
  synonyms       text[] NOT NULL DEFAULT '{}',
  queryable      boolean NOT NULL DEFAULT false,   -- Agent 写 SQL 时可查询
  origin         text NOT NULL DEFAULT 'comment' CHECK (origin IN ('human_seed','comment','ai_draft','admin')),
  review_status  text NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft','approved','rejected')),
  reviewed_by    text,
  reviewed_at    timestamptz,
  review_note    text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE semantic.table_doc IS '表/视图的业务说明（语义目录）。draft 为待审核，approved 后回写数据库 COMMENT';

CREATE TABLE semantic.column_doc (
  object         text NOT NULL REFERENCES semantic.table_doc(object),
  column_name    text NOT NULL,
  data_type      text,
  business_name  text,
  description    text,
  unit           text,
  value_notes    jsonb,                            -- 取值含义，如 {"estimated":"模拟估值"}
  caveats        text,
  synonyms       text[] NOT NULL DEFAULT '{}',
  origin         text NOT NULL DEFAULT 'comment' CHECK (origin IN ('human_seed','comment','ai_draft','admin')),
  review_status  text NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft','approved','rejected')),
  reviewed_by    text,
  reviewed_at    timestamptz,
  review_note    text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (object, column_name)
);
COMMENT ON TABLE semantic.column_doc IS '字段的业务说明、单位、取值含义与口径提示（语义目录）';

-- 3. 字段剖析（由 semantic.profile_object 计算） --------------------------------------------------
CREATE TABLE semantic.column_profile (
  object          text NOT NULL,
  column_name     text NOT NULL,
  profiled_at     timestamptz NOT NULL DEFAULT now(),
  row_count       bigint,
  null_count      bigint,
  distinct_count  bigint,
  min_value       text,
  max_value       text,
  top_values      jsonb,                           -- 取值不超过 30 种时的前 8 个高频值
  PRIMARY KEY (object, column_name)
);
COMMENT ON TABLE semantic.column_profile IS '字段剖析：行数、空值、唯一值、最值、高频值；供模型判断字段含义和取值格式';

-- 4. 关联图 ---------------------------------------------------------------------------------
CREATE TABLE semantic.join_edge (
  edge_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_object    text NOT NULL,
  from_columns   text[] NOT NULL,
  to_object      text NOT NULL,
  to_columns     text[] NOT NULL,
  cardinality    text NOT NULL CHECK (cardinality IN ('N:1','1:1','1:N','N:M')),  -- from 对 to
  origin         text NOT NULL CHECK (origin IN ('fk','declared','inferred','sql_log')),
  note           text,                             -- 连接时的附加条件与陷阱
  review_status  text NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft','approved','rejected')),
  reviewed_by    text,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_object, from_columns, to_object, to_columns)
);
COMMENT ON TABLE semantic.join_edge IS '关联图：哪些表能连接、用什么键、基数。Agent 写的 SQL 只允许沿 approved 的边连接';

-- 5. 已验证问答对 ----------------------------------------------------------------------------
CREATE TABLE semantic.qa_pair (
  qa_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question       text NOT NULL,
  sql            text NOT NULL,
  sql_hash       text NOT NULL,                    -- 归一化 SQL 的 md5，去重
  objects        text[] NOT NULL DEFAULT '{}',
  answer_note    text,
  origin         text NOT NULL CHECK (origin IN ('agent_log','admin')),
  status         text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','approved','rejected')),
  session_id     uuid,
  hit_count      integer NOT NULL DEFAULT 0,
  last_used_at   timestamptz,
  reviewed_by    text,
  reviewed_at    timestamptz,
  review_note    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sql_hash)
);
COMMENT ON TABLE semantic.qa_pair IS '问答对：Agent 成功执行的查询自动成为候选，管理员批准后作为生成 SQL 的示例';

-- 6. 指标层视图 ------------------------------------------------------------------------------
CREATE VIEW semantic.v_metric AS
SELECT m.code, m.name, m.unit, m.category, m.aggregation, m.dim_kind, m.description,
       CASE WHEN m.code IN ('ENG_TCE','ENG_TERMINAL_TCE','ENG_CLEAN_TCE','ENG_RENEWABLE_TCE')
              THEN '由 fact.energy_activity 按核算单元汇总（净受入 = 消费 + 受入 − 送出）'
            WHEN m.code = 'CO2_TOTAL' THEN '由 fact.carbon_emission 汇总，必须指定计算口径 profile_code'
            WHEN m.code = 'ECO_HIGHTECH_OUTPUT' THEN '派生：当年具备高企资格（core.enterprise_qualification）企业的工业总产值之和'
            WHEN m.code = 'ECO_GREEN_FACTORY_OUTPUT' THEN '派生：获评省级及以上绿色工厂企业的工业总产值之和（core.honor）'
            ELSE 'fact.statistic_value 中 metric_code = ''' || m.code || ''' 的当前有效值；园区自身上报值优先于企业加总' END AS source,
       format('engine.metric_value(%L, 节点 node_id, 年份, 口径)', m.code) AS how_to_query,
       (SELECT array_agg(f.code ORDER BY f.code) FROM core.formula f WHERE m.code = ANY (f.variables) AND f.status = 'approved') AS used_by_formulas
FROM core.metric_def m;
COMMENT ON VIEW semantic.v_metric IS '指标层：基础量的名称、单位、聚合规则、来源与标准取数方式。回答这些量时用 query_metric 工具，不要自己拼 SQL';

-- 7. 治理规则、运行与工单 ----------------------------------------------------------------------
CREATE TABLE semantic.check_def (
  code          text PRIMARY KEY,
  name          text NOT NULL,
  category      text NOT NULL CHECK (category IN ('dirty_data','ambiguity','join_trap','coverage','catalog','insight')),
  risk          text NOT NULL CHECK (risk IN ('low','medium','high')),
  description   text NOT NULL,
  check_sql     text NOT NULL,                     -- 返回 subject text, title text, detail jsonb
  action_kind   text CHECK (action_kind IN ('comment_sync','run_calculation','draft_docs')),
  enabled       boolean NOT NULL DEFAULT true
);
COMMENT ON TABLE semantic.check_def IS '治理检测规则：统计检测全部由 SQL 完成；大模型只读取结果撰写工单说明';

CREATE TABLE semantic.governance_run (
  run_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trigger         text NOT NULL CHECK (trigger IN ('import','calc','manual','schedule')),
  triggered_by    text NOT NULL DEFAULT session_user,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
  summary         jsonb,
  error           text
);

CREATE TABLE semantic.governance_issue (
  issue_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  check_code      text NOT NULL REFERENCES semantic.check_def(code),
  fingerprint     text NOT NULL UNIQUE,            -- check_code:subject，同一问题只开一张工单
  subject         text NOT NULL,
  category        text NOT NULL,
  risk            text NOT NULL CHECK (risk IN ('low','medium','high')),
  title           text NOT NULL,
  evidence        jsonb NOT NULL,                  -- 检测结果
  description     text,                            -- 问题说明（大模型撰写或规则说明）
  impact          text,
  suggestion      text,
  action          jsonb,                           -- 可在网站一键执行的动作，如 {"kind":"comment_sync","object":"fact.x"}
  ai_written      boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected','applied','auto_closed')),
  first_run_id    bigint REFERENCES semantic.governance_run(run_id),
  last_run_id     bigint REFERENCES semantic.governance_run(run_id),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  decided_by      text,
  decided_at      timestamptz,
  decision_note   text,
  applied_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX governance_issue_status_idx ON semantic.governance_issue (status, risk);
COMMENT ON TABLE semantic.governance_issue IS '治理工单与洞察卡片：open 待处理；approved 管理员确认；applied 已执行动作；rejected 驳回（不再提示）；auto_closed 复查时问题已消失';

-- 8. 发布事件：导入批次入库、计算完成时记录，治理检测据此增量运行 ---------------------------------
CREATE TABLE semantic.publish_event (
  event_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('import','calc')),
  ref_id        bigint NOT NULL,                   -- batch_id 或 run_id
  created_at    timestamptz NOT NULL DEFAULT now(),
  run_id        bigint REFERENCES semantic.governance_run(run_id)   -- 处理该事件的治理运行
);
COMMENT ON TABLE semantic.publish_event IS '数据发布事件：导入批次入库、指标计算完成；run_id 为空表示尚未经过治理检测';

CREATE FUNCTION semantic.on_batch_loaded() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('loaded','partially_loaded') AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO semantic.publish_event (kind, ref_id) VALUES ('import', NEW.batch_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER import_batch_publish AFTER UPDATE OF status ON raw.import_batch
  FOR EACH ROW EXECUTE FUNCTION semantic.on_batch_loaded();

CREATE FUNCTION semantic.on_calc_finished() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'succeeded' AND NEW.run_type = 'indicator' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO semantic.publish_event (kind, ref_id) VALUES ('calc', NEW.run_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER calc_run_publish AFTER UPDATE OF status ON fact.calc_run
  FOR EACH ROW EXECUTE FUNCTION semantic.on_calc_finished();

-- 9. 目录维护函数 ----------------------------------------------------------------------------
-- 把 core / fact / mart 中尚未登记的表、视图、字段补进目录（说明取数据库 COMMENT，状态为待审核），
-- 并把外键登记为已批准的关联边。新增表时由治理运行自动调用。
CREATE FUNCTION semantic.refresh_catalog() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n_tab int; n_col int; n_edge int;
BEGIN
  INSERT INTO semantic.table_doc (object, layer, business_name, description, queryable, origin)
  SELECT n.nspname || '.' || c.relname,
         CASE n.nspname WHEN 'fact' THEN 'fact' WHEN 'mart' THEN 'derived' ELSE 'master' END,
         split_part(coalesce(obj_description(c.oid, 'pg_class'), c.relname), '：', 1),
         obj_description(c.oid, 'pg_class'),
         n.nspname IN ('core','fact','mart','semantic'),
         CASE WHEN obj_description(c.oid, 'pg_class') IS NULL THEN 'ai_draft' ELSE 'comment' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('core','fact','mart') AND c.relkind IN ('r','v','m','p')
  ON CONFLICT (object) DO NOTHING;
  GET DIAGNOSTICS n_tab = ROW_COUNT;

  INSERT INTO semantic.column_doc (object, column_name, data_type, description, origin)
  SELECT n.nspname || '.' || c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
         col_description(c.oid, a.attnum),
         CASE WHEN col_description(c.oid, a.attnum) IS NULL THEN 'ai_draft' ELSE 'comment' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE n.nspname IN ('core','fact','mart') AND c.relkind IN ('r','v','m','p')
    AND EXISTS (SELECT 1 FROM semantic.table_doc t WHERE t.object = n.nspname || '.' || c.relname)
  ON CONFLICT (object, column_name) DO UPDATE SET data_type = EXCLUDED.data_type;
  GET DIAGNOSTICS n_col = ROW_COUNT;

  INSERT INTO semantic.join_edge (from_object, from_columns, to_object, to_columns, cardinality, origin, review_status, reviewed_by, reviewed_at)
  SELECT fn.nspname || '.' || fc.relname,
         (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum),
         tn.nspname || '.' || tc.relname,
         (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum),
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint u WHERE u.conrelid = con.conrelid AND u.contype IN ('p','u')
                             AND u.conkey::int[] @> con.conkey::int[] AND u.conkey::int[] <@ con.conkey::int[])
              THEN '1:1' ELSE 'N:1' END,
         'fk', 'approved', 'foreign key', now()
  FROM pg_constraint con
  JOIN pg_class fc ON fc.oid = con.conrelid JOIN pg_namespace fn ON fn.oid = fc.relnamespace
  JOIN pg_class tc ON tc.oid = con.confrelid JOIN pg_namespace tn ON tn.oid = tc.relnamespace
  WHERE con.contype = 'f' AND fn.nspname IN ('core','fact') AND tn.nspname IN ('core','fact')
  ON CONFLICT (from_object, from_columns, to_object, to_columns) DO NOTHING;
  GET DIAGNOSTICS n_edge = ROW_COUNT;

  RETURN jsonb_build_object('tables_added', n_tab, 'columns_upserted', n_col, 'fk_edges_added', n_edge);
END $$;

-- 剖析一个表或视图的全部字段（行数、空值、唯一值、最值、高频值）。
CREATE FUNCTION semantic.profile_object(p_object text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE rel regclass := p_object::regclass; col record; r record; n int := 0; total bigint;
BEGIN
  EXECUTE format('SELECT count(*) FROM %s', rel) INTO total;
  FOR col IN SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS typ FROM pg_attribute a
             WHERE a.attrelid = rel AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum LOOP
    EXECUTE format($q$SELECT count(*) FILTER (WHERE %1$I IS NULL) AS nulls, count(DISTINCT %1$I::text) AS dist,
                             min(%1$I::text) AS mn, max(%1$I::text) AS mx FROM %2$s$q$, col.attname, rel) INTO r;
    INSERT INTO semantic.column_profile AS p (object, column_name, profiled_at, row_count, null_count, distinct_count, min_value, max_value, top_values)
    VALUES (p_object, col.attname, now(), total, r.nulls, r.dist, left(r.mn, 200), left(r.mx, 200), NULL)
    ON CONFLICT (object, column_name) DO UPDATE SET profiled_at = now(), row_count = EXCLUDED.row_count,
      null_count = EXCLUDED.null_count, distinct_count = EXCLUDED.distinct_count,
      min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value, top_values = NULL;
    IF r.dist BETWEEN 1 AND 30 AND col.typ NOT IN ('jsonb','json') THEN
      EXECUTE format($q$SELECT jsonb_agg(jsonb_build_object('value', v, 'count', c) ORDER BY c DESC)
                        FROM (SELECT left(%1$I::text, 80) AS v, count(*) AS c FROM %2$s WHERE %1$I IS NOT NULL
                              GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t$q$, col.attname, rel)
        INTO r;
      UPDATE semantic.column_profile SET top_values = r.jsonb_agg WHERE object = p_object AND column_name = col.attname;
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- 已批准的单列关联边上，from 表中找不到对应记录的行数（关联覆盖率）。
CREATE FUNCTION semantic.edge_coverage() RETURNS TABLE (edge_id bigint, total bigint, orphans bigint)
LANGUAGE plpgsql STABLE AS $$
DECLARE e record;
BEGIN
  FOR e IN SELECT j.* FROM semantic.join_edge j
           JOIN pg_class c ON c.oid = to_regclass(j.from_object) AND c.relkind IN ('r','p')
           WHERE j.review_status = 'approved' AND cardinality(j.from_columns) = 1 AND to_regclass(j.to_object) IS NOT NULL LOOP
    edge_id := e.edge_id;
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM %s t WHERE t.%I = f.%I)) FROM %s f WHERE f.%I IS NOT NULL',
                   e.to_object, e.to_columns[1], e.from_columns[1], e.from_object, e.from_columns[1])
      INTO total, orphans;
    RETURN NEXT;
  END LOOP;
END $$;

-- 把已审核的说明回写为数据库 COMMENT（人与模型读同一份说明）。只处理 core / fact / mart。
CREATE FUNCTION semantic.apply_comment_sync(p_object text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, semantic AS $$
DECLARE rel regclass := p_object::regclass; kind "char"; d record; n int := 0;
BEGIN
  IF split_part(p_object, '.', 1) NOT IN ('core','fact','mart') THEN
    RAISE EXCEPTION '只能回写 core / fact / mart 的注释';
  END IF;
  SELECT relkind INTO kind FROM pg_class WHERE oid = rel;
  FOR d IN SELECT description FROM semantic.table_doc WHERE object = p_object AND review_status = 'approved' AND description IS NOT NULL LOOP
    EXECUTE format('COMMENT ON %s %s IS %L', CASE kind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, rel, d.description);
    n := n + 1;
  END LOOP;
  FOR d IN SELECT cd.column_name, cd.description FROM semantic.column_doc cd
           JOIN pg_attribute a ON a.attrelid = rel AND a.attname = cd.column_name AND NOT a.attisdropped
           WHERE cd.object = p_object AND cd.review_status = 'approved' AND cd.description IS NOT NULL LOOP
    EXECUTE format('COMMENT ON COLUMN %s.%I IS %L', rel, d.column_name, d.description);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION semantic.apply_comment_sync(text) FROM PUBLIC;

-- 10. 修正：月度碳排放视图原先把不同计算口径（GIP_2026 / GIP_2024 / ZCP_2025）加在一起 -----------
--     视图增加 profile_code 列并按口径分组；使用时必须筛选 profile_code。
CREATE OR REPLACE VIEW mart.v_carbon_monthly AS
SELECT c.node_id, n.name AS node_name, n.path::text AS path, c.period_month, c.category,
       c.energy_type_code, sum(c.co2_t) AS co2_t, c.profile_code
FROM fact.carbon_emission c
JOIN core.org_node n ON n.node_id = c.node_id
WHERE c.is_current
GROUP BY c.node_id, n.name, n.path, c.period_month, c.category, c.energy_type_code, c.profile_code;
COMMENT ON VIEW mart.v_carbon_monthly IS '月度碳排放（按计算口径、核算类别和能源品种汇总）；必须按 profile_code 筛选一个口径，不同口径不能相加';

-- 11. 治理检测规则 ---------------------------------------------------------------------------
INSERT INTO semantic.check_def (code, name, category, risk, action_kind, description, check_sql) VALUES
('DQ_ENERGY_GAP', '月度能耗缺月', 'dirty_data', 'medium', NULL,
 '同一对象、同一能源品种在首末月份之间缺少某些月份的消费记录，年度汇总会偏低。',
 $chk$
with s as (
  select node_id, energy_type_code, min(period_month) f, max(period_month) l, count(distinct period_month) n
    from fact.energy_activity where is_current and flow = 'consumption' group by 1, 2),
s2 as (select s.*, ((extract(year from s.l) - extract(year from s.f)) * 12 + extract(month from s.l) - extract(month from s.f) + 1)::int as expected from s)
select n.code || '/' || s2.energy_type_code as subject,
       n.name || ' ' || s2.energy_type_code || ' 月度数据缺 ' || (s2.expected - s2.n) || ' 个月' as title,
       jsonb_build_object('node', n.code, 'energy_type', s2.energy_type_code, 'first', to_char(s2.f, 'YYYY-MM'), 'last', to_char(s2.l, 'YYYY-MM'),
         'months_present', s2.n, 'missing', (select jsonb_agg(to_char(m, 'YYYY-MM')) from generate_series(s2.f, s2.l, interval '1 month') m
            where not exists (select 1 from fact.energy_activity a where a.is_current and a.flow = 'consumption'
                               and a.node_id = s2.node_id and a.energy_type_code = s2.energy_type_code and a.period_month = m::date))) as detail
  from s2 join core.org_node n using (node_id)
 where s2.n < s2.expected
$chk$),

('DQ_ENERGY_SPIKE', '月度用量量级跳变', 'dirty_data', 'medium', NULL,
 '某月用量超过该对象该品种月度中位数 4 倍或不足 1/4，可能是单位填错（如 kWh 与万 kWh）、漏填或重复。',
 $chk$
with m as (select node_id, energy_type_code, period_month, sum(quantity_std) q
             from fact.energy_activity where is_current and flow = 'consumption' group by 1, 2, 3),
med as (select node_id, energy_type_code, percentile_cont(0.5) within group (order by q) as med, count(*) n from m group by 1, 2)
select n.code || '/' || m.energy_type_code || '/' || to_char(m.period_month, 'YYYY-MM') as subject,
       n.name || ' ' || to_char(m.period_month, 'YYYY-MM') || ' ' || m.energy_type_code || ' 用量为月度中位数的 '
         || round((m.q / med.med)::numeric, 2) || ' 倍' as title,
       jsonb_build_object('node', n.code, 'energy_type', m.energy_type_code, 'month', to_char(m.period_month, 'YYYY-MM'),
         'quantity', round(m.q, 2), 'median', round(med.med::numeric, 2), 'ratio', round((m.q / med.med)::numeric, 2)) as detail
  from m join med using (node_id, energy_type_code) join core.org_node n using (node_id)
 where med.n >= 6 and med.med > 0 and (m.q > 4 * med.med or m.q < med.med / 4)
$chk$),

('DQ_NEGATIVE', '出现负值', 'dirty_data', 'high', NULL,
 '能源实物量或年度统计值为负，除“送出”外都不应出现。',
 $chk$
select 'energy_activity/' || a.activity_id as subject,
       n.name || ' ' || to_char(a.period_month, 'YYYY-MM') || ' ' || a.energy_type_code || ' 实物量为负' as title,
       jsonb_build_object('table', 'fact.energy_activity', 'id', a.activity_id, 'quantity', a.quantity, 'flow', a.flow) as detail
  from fact.energy_activity a join core.org_node n using (node_id) where a.is_current and a.quantity < 0
union all
select 'statistic_value/' || s.stat_id, n.name || ' ' || s.metric_code || ' ' || to_char(s.period_start, 'YYYY') || ' 为负值',
       jsonb_build_object('table', 'fact.statistic_value', 'id', s.stat_id, 'value', s.value)
  from fact.statistic_value s join core.org_node n using (node_id) where s.is_current and s.value < 0
$chk$),

('AMB_UNIT_MISMATCH', '统计单位与定义不一致', 'ambiguity', 'medium', NULL,
 '年度统计值的单位与基础量定义的单位不同；直接相加或与基准比较会出错。',
 $chk$
select s.metric_code || '/' || s.unit as subject,
       '基础量“' || m.name || '”有 ' || count(*) || ' 条记录用单位 ' || s.unit || '（定义为 ' || m.unit || '）' as title,
       jsonb_build_object('metric', s.metric_code, 'defined_unit', m.unit, 'stored_unit', s.unit, 'rows', count(*),
         'convertible', bool_and(u1.base_code is not null and u1.base_code = u2.base_code)) as detail
  from fact.statistic_value s join core.metric_def m on m.code = s.metric_code
  left join core.unit u1 on u1.code = s.unit left join core.unit u2 on u2.code = m.unit
 where s.is_current and s.unit <> m.unit
 group by s.metric_code, s.unit, m.name, m.unit
$chk$),

('COV_ESTIMATED', '模拟数据占比过高', 'coverage', 'medium', NULL,
 '当年有效数据中一半以上是模拟估值（estimated），计算结果不能作为申报依据。',
 $chk$
select t.tbl || '/' || t.yr as subject,
       t.tbl_name || ' ' || t.yr || ' 年模拟估值占 ' || round(100.0 * t.est / t.total) || '%' as title,
       jsonb_build_object('table', t.tbl, 'year', t.yr, 'rows', t.total, 'estimated_rows', t.est) as detail
  from (select 'fact.energy_activity' tbl, '能源活动数据' tbl_name, extract(year from period_month)::int yr, count(*) total,
               count(*) filter (where data_source in ('estimated','interpolated')) est
          from fact.energy_activity where is_current group by 3
        union all
        select 'fact.statistic_value', '年度统计数据', extract(year from period_start)::int, count(*),
               count(*) filter (where data_source in ('estimated','interpolated'))
          from fact.statistic_value where is_current group by 3) t
 where t.est::numeric / t.total > 0.5
$chk$),

('AMB_FACTOR_FALLBACK', '碳核算因子提示', 'ambiguity', 'medium', NULL,
 '最近一次碳核算有因子提示，例如该年份因子未发布而沿用往年值；因子发布后需重算。',
 $chk$
select v.code || '/carbon' as subject,
       v.code || ' 最近一次碳核算有 ' || jsonb_array_length(r.warnings) || ' 条因子提示' as title,
       jsonb_build_object('run_id', r.run_id, 'profile', v.code, 'finished_at', r.finished_at, 'warnings', r.warnings) as detail
  from (select distinct on (version_id) * from fact.calc_run
         where run_type = 'carbon' and status = 'succeeded' order by version_id, run_id desc) r
  join core.standard_version v using (version_id)
 where jsonb_array_length(r.warnings) > 0
$chk$),

('AMB_QUAL_CONFLICT', '企业资格真实记录与模拟记录冲突', 'ambiguity', 'medium', NULL,
 '同一企业同一年度，原件核验的资格与模拟占位的资格不一致。计算已按真实记录取值，模拟记录应修正。',
 $chk$
select n.code || '/' || q.qual_type || '/' || y as subject,
       n.name || ' ' || y || ' 年' || case q.qual_type when 'high_tech' then '高新技术企业' else '规上企业' end || '资格：真实记录与模拟记录不一致' as title,
       jsonb_build_object('node', n.code, 'qual_type', q.qual_type, 'year', y,
         'real', bool_or(q.holds) filter (where q.data_source <> 'estimated'),
         'estimated', bool_or(q.holds) filter (where q.data_source = 'estimated')) as detail
  from core.enterprise_qualification q
  cross join lateral generate_series(q.first_year::int, q.last_year::int) y
  join core.org_node n on n.node_id = q.node_id
 where q.is_current
 group by n.code, n.name, q.qual_type, y
having count(*) filter (where q.data_source <> 'estimated') > 0 and count(*) filter (where q.data_source = 'estimated') > 0
   and bool_or(q.holds) filter (where q.data_source <> 'estimated') is distinct from bool_or(q.holds) filter (where q.data_source = 'estimated')
$chk$),

('AMB_LEGAL_NAME', '企业法人名称未核实', 'ambiguity', 'low', NULL,
 '企业档案中的名称是基地或品牌称谓，尚未对应到具体法人；按名称匹配导入或检索资料时可能出错。',
 $chk$
select n.code as subject, n.name || ' 的法人名称尚未核实' as title,
       jsonb_build_object('node', n.code, 'legal_name', e.legal_name) as detail
  from core.enterprise_profile e join core.org_node n using (node_id)
 where (e.attributes ->> 'legal_name_verified')::boolean is false
$chk$),

('JT_CARBON_PROFILE', '碳排放视图未区分计算口径', 'join_trap', 'high', NULL,
 'fact.carbon_emission 同时保存多个计算口径的当前结果；不区分 profile_code 的视图或查询会把同一笔排放重复相加。',
 $chk$
select v.oid::regclass::text as subject,
       v.oid::regclass::text || ' 汇总碳排放但没有 profile_code 列，会把多个口径相加' as title,
       jsonb_build_object('view', v.oid::regclass::text,
         'profiles_current', (select jsonb_agg(distinct profile_code) from fact.carbon_emission where is_current)) as detail
  from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class
 where d.refobjid = 'fact.carbon_emission'::regclass and v.oid <> d.refobjid and v.relkind in ('v','m')
   and not exists (select 1 from pg_attribute a where a.attrelid = v.oid and a.attname = 'profile_code' and not a.attisdropped)
   and (select count(distinct profile_code) from fact.carbon_emission where is_current) > 1
 group by v.oid
$chk$),

('JT_EDGE_COVERAGE', '关联键找不到对应记录', 'join_trap', 'medium', NULL,
 '已批准的关联边上，部分行的关联键在目标表中不存在；内连接会丢行，左连接会出现空值。',
 $chk$
select j.from_object || '.' || j.from_columns[1] || '→' || j.to_object as subject,
       j.from_object || '.' || j.from_columns[1] || ' 有 ' || c.orphans || ' 行在 ' || j.to_object || ' 中找不到' as title,
       jsonb_build_object('edge_id', j.edge_id, 'total', c.total, 'orphans', c.orphans) as detail
  from semantic.edge_coverage() c join semantic.join_edge j using (edge_id)
 where c.orphans > 0
$chk$),

('CAT_UNDOCUMENTED', '字段缺少业务说明', 'catalog', 'medium', 'draft_docs',
 'Agent 可查询的表中有字段没有业务说明。治理运行会让 AI 根据剖析结果起草说明，管理员在“语义目录”中审核。',
 $chk$
select t.object as subject,
       t.object || ' 有 ' || count(*) filter (where c.description is null) || ' 个字段缺少业务说明' as title,
       jsonb_build_object('object', t.object, 'columns', jsonb_agg(c.column_name) filter (where c.description is null)) as detail
  from semantic.table_doc t join semantic.column_doc c using (object)
 where t.queryable
 group by t.object
having count(*) filter (where c.description is null) > 0
$chk$),

('CAT_COMMENT_SYNC', '数据库注释与已审核说明不一致', 'catalog', 'medium', 'comment_sync',
 '语义目录中已审核的说明尚未回写到数据库 COMMENT。批准后执行回写，人和模型读同一份说明。',
 $chk$
select x.object as subject, x.object || ' 有 ' || count(*) || ' 处注释待回写' as title,
       jsonb_build_object('object', x.object, 'items', jsonb_agg(x.item)) as detail
  from (select t.object, '(表)' as item from semantic.table_doc t
         where t.review_status = 'approved' and t.description is not null and to_regclass(t.object) is not null
           and t.description is distinct from obj_description(to_regclass(t.object), 'pg_class')
        union all
        select c.object, c.column_name from semantic.column_doc c
          join pg_attribute a on a.attrelid = to_regclass(c.object) and a.attname = c.column_name and not a.attisdropped
         where c.review_status = 'approved' and c.description is not null
           and c.description is distinct from col_description(a.attrelid, a.attnum)) x
 where split_part(x.object, '.', 1) in ('core','fact','mart')
 group by x.object
$chk$),

('COV_PENDING_FORMULA', '主版本指标公式未批准', 'coverage', 'low', NULL,
 '主评价版本中有指标的公式仍是草稿，无法计算；需项目负责人核对出处后批准或改写。',
 $chk$
select v.code || '/' || d.code as subject,
       v.code || ' ' || d.code || ' ' || d.name || '：公式 ' || f.code || ' 尚未批准' as title,
       jsonb_build_object('version', v.code, 'indicator', d.code, 'formula', f.code, 'expression', f.expression) as detail
  from core.indicator_def d join core.standard_version v using (version_id) join core.formula f on f.formula_id = d.formula_id
 where v.is_primary and f.status <> 'approved'
$chk$),

('DQ_STALE_CALC', '导入晚于最近一次计算', 'dirty_data', 'medium', 'run_calculation',
 '有导入批次在最近一次主版本指标计算之后入库，相关年份的结果可能已过期，需要重算。',
 $chk$
with last_calc as (select max(r.finished_at) t from fact.calc_run r join core.standard_version v using (version_id)
                    where v.is_primary and r.run_type = 'indicator' and r.status = 'succeeded')
select 'batch/' || b.batch_id as subject,
       '导入批次 ' || b.batch_id || '（' || coalesce(b.source_name, b.source_type) || '）晚于最近一次指标计算' as title,
       jsonb_build_object('batch_id', b.batch_id, 'submitted_at', b.submitted_at, 'last_calc', l.t,
         'years', (select jsonb_agg(distinct y order by y) from (
                     select extract(year from period_month)::int y from fact.energy_activity where batch_id = b.batch_id
                     union select extract(year from period_start)::int from fact.statistic_value where batch_id = b.batch_id) z)) as detail
  from raw.import_batch b cross join last_calc l
 where b.status in ('loaded','partially_loaded') and b.submitted_at > coalesce(l.t, '-infinity'::timestamptz)
$chk$),

('INS_YOY', '园区能耗同比变化较大', 'insight', 'low', NULL,
 '园区综合能耗同比变化超过 10%，值得查看是哪些企业或能源品种带来的变化。',
 $chk$
with y as (
  select g as y, engine.metric_value('ENG_TCE', n.node_id, g, 'GIP_2026') as tce,
         engine.metric_value('CO2_TOTAL', n.node_id, g, 'GIP_2026') as co2
    from core.org_node n,
         generate_series((select extract(year from min(period_month))::int from fact.energy_activity where is_current),
                         (select extract(year from max(period_month))::int from fact.energy_activity where is_current)) g
   where n.code = 'XYEDZ')
select 'XYEDZ/' || y.y as subject,
       '园区 ' || y.y || ' 年综合能耗同比 ' || case when y.tce >= p.tce then '+' else '' end || round(100 * (y.tce / p.tce - 1), 1) || '%' as title,
       jsonb_build_object('year', y.y, 'tce', round(y.tce, 1), 'prev_tce', round(p.tce, 1),
                          'co2_t', round(y.co2, 1), 'prev_co2_t', round(p.co2, 1)) as detail
  from y join y p on p.y = y.y - 1
 where p.tce > 0 and abs(y.tce / p.tce - 1) > 0.10
$chk$),

('INS_INTENSITY_OUTLIER', '企业单位产值能耗明显偏高', 'insight', 'low', NULL,
 '企业单位工业总产值能耗超过园区平均水平 2 倍，是节能诊断和指标改善的重点对象。',
 $chk$
with e as (
  select n.code, n.name, g as y, engine.metric_value('ENG_TCE', n.node_id, g, 'GIP_2026') as tce,
         engine.stat_value('ECO_GROSS_OUTPUT', n.node_id, g, '') as out
    from core.org_node n cross join generate_series(2021, extract(year from now())::int - 1) g
   where n.node_type = 'enterprise' and n.is_active),
p as (select y, sum(tce) / nullif(sum(out), 0) as avg_int from e where tce is not null and out > 0 group by y)
select e.code || '/' || e.y as subject,
       e.name || ' ' || e.y || ' 年单位产值能耗为园区平均的 ' || round(e.tce / e.out / p.avg_int, 1) || ' 倍' as title,
       jsonb_build_object('node', e.code, 'year', e.y, 'tce', round(e.tce, 1), 'gross_output_wan', e.out,
                          'intensity_tce_per_wan', round(e.tce / e.out, 4), 'park_avg', round(p.avg_int, 4)) as detail
  from e join p using (y)
 where e.out > 0 and e.tce / e.out > 2 * p.avg_int
$chk$);

-- 12. 语义目录初稿（人工起草，状态 draft，管理员在网站“语义目录”审核） -------------------------------
INSERT INTO semantic.table_doc (object, topic_code, layer, business_name, description, grain, usage_notes, caveats, synonyms, queryable, origin) VALUES
('fact.energy_activity', 'energy', 'fact', '月度能源活动',
 '企业、公共设施逐月逐能源品种的能源消费、受入、送出、发电等活动量，含实物量和折标准煤。',
 '一行 = 一个核算对象 × 一个月 × 一种能源品种 × 一种流向（flow）的一个数据版本',
 '综合能耗 = 消费 + 受入 − 送出 的 tce；发电、自用、上网（generation/self_use/feed_in）不直接相加。按年汇总请优先用 get_energy_summary 或 query_metric(ENG_TCE)。',
 ARRAY['必须筛选 is_current = true，否则会把历史版本重复计入',
       'flow 不同含义不同：不能把所有 flow 的 tce 直接求和',
       'data_source = estimated 为模拟估值，回答时要说明占比',
       '园区、片区本身没有能源记录，汇总园区要累加下属企业和公共设施（core.org_node.path 或 engine.accounting_nodes）'],
 ARRAY['能耗','用能','能源消费','用电量','用气量','耗能','综合能耗','标煤'], true, 'human_seed'),
('fact.carbon_emission', 'carbon', 'fact', '碳排放核算结果',
 '按《发改环资〔2025〕910 号》附件 4 核算的逐笔碳排放，可追溯到能源活动和排放因子。',
 '一行 = 一个计算口径（profile_code）× 一条能源活动记录 × 一个核算类别',
 '同一笔能源活动在 GIP_2026、GIP_2024、ZCP_2025 等口径下各有一行。回答碳排放必须先确定口径，默认 GIP_2026。',
 ARRAY['必须筛选 profile_code（一个口径）和 is_current = true；不同口径相加会重复计算',
       '送出部分 co2_t 为负值，体现净受入',
       'estimated_share 为该行所用活动数据中模拟估值的占比'],
 ARRAY['碳排放','排放量','二氧化碳','CO2','碳核算'], true, 'human_seed'),
('fact.statistic_value', 'economy', 'fact', '统计数据（长表）',
 '企业或园区的年度/月度统计量：产值、增加值、从业人数、用水、用地、固废、污染物、建筑面积、产品产量等。',
 '一行 = 一个对象 × 一个期间 × 一个基础量（metric_code）× 一个附加维度（dim_code，如污染物种类）的一个数据版本',
 '具体是什么量看 metric_code，对照 core.metric_def / semantic.v_metric。回答这些基础量优先用 query_metric 工具（按引擎口径汇总）。',
 ARRAY['必须筛选 is_current = true',
       '园区自身上报值优先于企业加总；同时有园区值和企业值时不能再相加',
       'dim_code 非空时（污染物、产品）不同维度不能直接相加',
       '单位以 unit 列为准，可能与 metric_def 的单位不同'],
 ARRAY['产值','工业总产值','增加值','从业人数','用水量','用地','固废','污染物','产量','统计'], true, 'human_seed'),
('fact.indicator_value', 'evaluation', 'fact', '指标计算结果',
 '评价指标的计算值、判定基准、是否达标、得分及计算输入快照。',
 '一行 = 一个指标（某标准版本）× 一个对象 × 一个期间的一个计算版本',
 '指标状态（达标/未达标/待审核/缺数据）请用 get_indicators，不要自行用 value 与基准比较。',
 ARRAY['必须筛选 is_current = true', 'indicator_id 属于某个标准版本，跨版本比较要经 core.indicator_mapping',
       'achieved 为空表示无判定基准，不等于未达标'],
 ARRAY['指标','达标','评价结果','得分'], true, 'human_seed'),
('fact.calc_run', 'ops', 'ops', '计算批次',
 '每次折标、碳核算、指标计算的运行记录，含使用的公式、因子和提示（warnings）。',
 '一行 = 一次计算运行', '查看因子年份回退等提示时读 warnings。', ARRAY[]::text[], ARRAY['计算记录','核算批次'], true, 'human_seed'),
('core.org_node', 'org', 'master', '园区对象树',
 '园区 → 片区 → 企业 / 公共设施（→ 厂区、产线、设备）的层级对象。',
 '一行 = 一个对象', 'code 是对外编码（园区 XYEDZ，企业 E_ 开头）；path 为层级路径（ltree），查下属对象用 path <@。',
 ARRAY['用户说的企业简称要先换成 code（find_entities）'], ARRAY['园区','片区','企业','对象','单位'], true, 'human_seed'),
('core.enterprise_profile', 'org', 'master', '企业档案',
 '企业的法人名称、统一社会信用代码、主营产品、规上/高企当前标记等。与 core.org_node 一对一（node_id）。',
 '一行 = 一家企业', '历史年份是否高企、是否规上请查 core.enterprise_qualification，不要用当前标记 is_high_tech/is_above_scale 代表历史年份。',
 ARRAY['is_high_tech、is_above_scale 只是当前标记，且部分为模拟'], ARRAY['企业信息','法人','信用代码'], true, 'human_seed'),
('core.enterprise_qualification', 'org', 'master', '企业资格履历',
 '高新技术企业、规模以上工业企业资格按统计年度的记录，含证书编号、原件页码。',
 '一行 = 一家企业的一项资格覆盖的一段年度（first_year–last_year）',
 '判断某年是否具备资格：真实记录（data_source <> estimated）优先，其次模拟记录。',
 ARRAY['同一年度可能同时有真实记录和模拟记录，以真实记录为准'], ARRAY['高企','高新技术企业','规上企业','资格','证书'], true, 'human_seed'),
('core.energy_type', 'energy', 'reference', '能源品种',
 '能源品种字典：类别、默认单位、是否化石/清洁/可再生、电力和热力种类。', '一行 = 一种能源品种',
 'is_clean、is_renewable 决定清洁能源、可再生能源指标的口径。', ARRAY[]::text[], ARRAY['能源种类','品种','电','天然气','柴油','热力','光伏'], true, 'human_seed'),
('core.factor', 'carbon', 'reference', '折标系数与排放因子',
 '折标准煤系数、低位发热量、单位热值含碳/排放因子，含口径（variant）、适用年份、出处和审核状态。', '一行 = 一个因子值的一个适用期间与口径',
 '计算只用 status = approved 的因子；电力因子按年份与 variant（河南省级 / 全国化石能源）区分。',
 ARRAY['同一品种有多个 variant 和年份，不能随意取一个', 'draft 因子未经人工审核，不能用于正式结果'],
 ARRAY['因子','排放因子','折标系数','电网因子'], true, 'human_seed'),
('core.metric_def', 'evaluation', 'reference', '基础量定义',
 '指标公式中用到的基础量：名称、单位、聚合方式、附加维度。', '一行 = 一个基础量',
 '取值方式见 semantic.v_metric；回答用 query_metric。', ARRAY[]::text[], ARRAY['基础量','统计口径'], true, 'human_seed'),
('core.formula', 'evaluation', 'reference', '指标公式',
 '指标计算公式的表达式、变量、出处与审核状态。', '一行 = 一个公式的一个修订版本',
 '只有 status = approved 的公式参与正式计算。', ARRAY['草稿公式（推定）不能当作正式口径'], ARRAY['公式','计算方法'], true, 'human_seed'),
('core.indicator_def', 'evaluation', 'reference', '指标定义',
 '各评价标准版本的指标：编码、名称、单位、方向、分值、处理方式（计算/录入/自证）、公式。', '一行 = 一个标准版本中的一个指标',
 '同一编码（如 I04）在不同版本含义可能不同，必须与 standard_version 一起使用。',
 ARRAY['指标编码只在同一版本内唯一'], ARRAY['指标','评价指标','二级指标'], true, 'human_seed'),
('core.indicator_benchmark', 'evaluation', 'reference', '判定基准',
 '指标的引领值、基准值等判定条件，含比较符与出处。', '一行 = 一个指标的一个基准', '', ARRAY[]::text[], ARRAY['引领值','基准值','门槛'], true, 'human_seed'),
('core.standard_version', 'evaluation', 'reference', '评价标准版本',
 'GIP_2024 / GIP_2025 / GIP_2026 绿色工业园区评价要求，ZCP_2025 零碳园区；同时作为碳核算的计算口径。', '一行 = 一个版本',
 'is_primary 为当前主版本（GIP_2026）。', ARRAY[]::text[], ARRAY['标准','版本','口径'], true, 'human_seed'),
('core.honor', 'org', 'master', '荣誉与称号',
 '园区与企业获得的绿色工厂、零碳工厂、高企、专精特新等称号。', '一行 = 一个称号',
 'counts_for_indicator 表示计入绿色工厂产值占比指标；show_on_screen 表示在大屏展示。', ARRAY[]::text[], ARRAY['荣誉','称号','绿色工厂','零碳工厂'], true, 'human_seed'),
('mart.v_energy_monthly', 'energy', 'derived', '月度能源活动视图',
 '当前有效的月度能源活动，已连接对象名称和能源品种属性。', '同 fact.energy_activity（只含 is_current）',
 '写 SQL 汇总能耗时优先用这个视图。', ARRAY['flow 不同含义不同：综合能耗 = consumption + receive − send_out'], ARRAY['能耗','月度能耗'], true, 'human_seed'),
('mart.v_carbon_monthly', 'carbon', 'derived', '月度碳排放视图',
 '按计算口径、对象、月份、核算类别、能源品种汇总的碳排放。', '一行 = 口径 × 对象 × 月 × 类别 × 品种',
 '必须筛选 profile_code，默认 GIP_2026。', ARRAY['不同 profile_code 不能相加'], ARRAY['碳排放','月度碳排放'], true, 'human_seed'),
('mart.v_indicator_display', 'evaluation', 'derived', '达标指标展示视图',
 '只包含当前有效、已达标且允许展示的指标，供前台大屏。', '一行 = 一个达标指标结果',
 '只能回答“哪些达标”，不能用来判断未达标或缺数据。', ARRAY['不含未达标与未计算的指标'], ARRAY['达标指标','大屏指标'], true, 'human_seed'),
('mart.v_org_node', 'org', 'derived', '对象树视图', '对象树连接行业与企业档案。', '一行 = 一个启用中的对象', '', ARRAY[]::text[], ARRAY['企业列表'], true, 'human_seed'),
('mart.v_screen_honor', 'org', 'derived', '大屏荣誉视图', '允许在大屏展示的荣誉。', '一行 = 一个荣誉', '', ARRAY[]::text[], ARRAY['荣誉'], true, 'human_seed');

INSERT INTO semantic.column_doc (object, column_name, business_name, description, unit, value_notes, caveats, synonyms, origin) VALUES
('fact.energy_activity', 'flow', '流向', '能源活动的流向。', NULL,
 '{"consumption":"消费","receive":"从园区内其他对象受入","send_out":"送出给其他对象（汇总时减去）","generation":"发电/产能","self_use":"自发自用","feed_in":"上网"}',
 '综合能耗只算 consumption + receive − send_out', ARRAY['方向'], 'human_seed'),
('fact.energy_activity', 'quantity', '实物量（原单位）', '按填报单位记录的实物量。', '见 unit 列', NULL, '不同单位不能直接相加，汇总请用 quantity_std 或 tce', ARRAY['用量'], 'human_seed'),
('fact.energy_activity', 'quantity_std', '实物量（标准单位）', '换算到能源品种默认单位后的实物量。', 'core.energy_type.default_unit', NULL, NULL, ARRAY['用量','用电量','用气量'], 'human_seed'),
('fact.energy_activity', 'tce', '折标准煤', '按已批准折标系数折算的标准煤量。', 'tce（吨标准煤）', NULL, '电力按当量值 0.1229 kgce/kWh', ARRAY['标煤','综合能耗'], 'human_seed'),
('fact.energy_activity', 'data_source', '数据来源', '数据的真实性标记。', NULL,
 '{"measured":"计量/接口实测","manual":"人工填报或公开资料的真实值","estimated":"模拟估值","interpolated":"插值"}', '回答时要说明 estimated 占比', ARRAY['来源','是否模拟'], 'human_seed'),
('fact.energy_activity', 'is_current', '当前有效', '是否为当前有效版本；修正数据时旧行置为 false。', NULL, '{"true":"当前版本","false":"已被替代的历史版本"}', '查询必须筛选 is_current', ARRAY[]::text[], 'human_seed'),
('fact.energy_activity', 'period_month', '月份', '统计月份（当月 1 日）。', NULL, NULL, NULL, ARRAY['月份','时间'], 'human_seed'),
('fact.carbon_emission', 'profile_code', '计算口径', '碳核算口径，即标准版本编码，决定电力因子取河南省级还是全国化石能源。', NULL,
 '{"GIP_2026":"绿色工业园区 2026 版（主口径，河南省电力因子）","GIP_2024":"2024 版","ZCP_2025":"零碳园区（全国化石能源电力因子）"}', '必须只取一个口径', ARRAY['口径','版本'], 'human_seed'),
('fact.carbon_emission', 'co2_t', '二氧化碳排放量', '本行核算的二氧化碳排放量。', 'tCO2', NULL, '送出部分为负', ARRAY['碳排放','排放量'], 'human_seed'),
('fact.carbon_emission', 'category', '核算类别', '排放的核算类别。', NULL,
 '{"fuel_combustion":"化石燃料燃烧","energy_conversion":"能源加工转换","indirect_electricity":"净调入电力间接排放","indirect_heat":"净调入热力间接排放","industrial_process":"工业过程"}', NULL, ARRAY['范围','排放源'], 'human_seed'),
('fact.carbon_emission', 'estimated_share', '估值占比', '本行所用活动数据中模拟估值的占比（0–1）。', NULL, NULL, NULL, ARRAY[]::text[], 'human_seed'),
('fact.statistic_value', 'metric_code', '基础量编码', '统计的是哪个量，对照 core.metric_def。', NULL, NULL, NULL, ARRAY['指标项','统计项'], 'human_seed'),
('fact.statistic_value', 'dim_code', '附加维度', '产品名、污染物种类（COD/NH3N/SO2/NOX）等；无附加维度时为空字符串。', NULL, NULL, '不同维度不能相加', ARRAY['污染物','产品'], 'human_seed'),
('fact.statistic_value', 'period_start', '期间起始日', '年度数据为当年 1 月 1 日。', NULL, NULL, '取年份用 extract(year from period_start)', ARRAY['年份'], 'human_seed'),
('fact.statistic_value', 'value', '数值', '统计值。', '见 unit 列', NULL, NULL, ARRAY[]::text[], 'human_seed'),
('fact.statistic_value', 'data_source', '数据来源', '数据的真实性标记，含义同能源活动。', NULL,
 '{"measured":"实测","manual":"人工填报或公开资料的真实值","estimated":"模拟估值","interpolated":"插值"}', NULL, ARRAY['来源','是否模拟'], 'human_seed'),
('fact.indicator_value', 'achieved', '是否达标', '与判定基准比较的结果；为空表示没有判定基准。', NULL, '{"true":"达标","false":"未达标","null":"无判定基准"}', NULL, ARRAY['达标'], 'human_seed'),
('fact.indicator_value', 'estimated_share', '估值占比', '计算该指标所用输入数据中模拟估值的占比（0–1）。', NULL, NULL, NULL, ARRAY[]::text[], 'human_seed'),
('fact.indicator_value', 'input_snapshot', '计算输入快照', '计算时各变量的取值、缺失项和基准继承情况（JSON）。', NULL, NULL, NULL, ARRAY['计算依据'], 'human_seed'),
('core.org_node', 'code', '对象编码', '园区 XYEDZ；片区 Z_ 开头；企业 E_ 开头；公共设施 P_ 开头。', NULL, NULL, NULL, ARRAY['编码'], 'human_seed'),
('core.org_node', 'node_type', '对象类型', '对象在层级中的类型。', NULL,
 '{"park":"园区","zone":"片区","enterprise":"企业","public_area":"公共设施","site":"厂区","line":"产线","equipment":"设备"}', NULL, ARRAY['类型'], 'human_seed'),
('core.org_node', 'path', '层级路径', 'ltree 路径，标签为 node_id；下属对象 path <@ 上级 path。', NULL, NULL, NULL, ARRAY[]::text[], 'human_seed'),
('core.enterprise_profile', 'is_high_tech', '当前是否高企', '当前的高新技术企业标记（不代表历史年份）。', NULL, NULL, '历史年份请查 core.enterprise_qualification', ARRAY['高企'], 'human_seed'),
('core.factor', 'status', '审核状态', '因子是否经人工审核批准。', NULL, '{"approved":"已批准，可用于正式计算","draft":"待审核","retired":"停用"}', NULL, ARRAY[]::text[], 'human_seed'),
('core.factor', 'variant', '口径', '同一品种的不同口径，如电力的河南省级、全国化石能源。', NULL, NULL, NULL, ARRAY[]::text[], 'human_seed');

-- 视图与无外键的逻辑关联（外键由 refresh_catalog 自动登记）
INSERT INTO semantic.join_edge (from_object, from_columns, to_object, to_columns, cardinality, origin, note, review_status, reviewed_by, reviewed_at) VALUES
('fact.carbon_emission', ARRAY['profile_code'], 'core.standard_version', ARRAY['code'], 'N:1', 'declared', '计算口径', 'approved', 'migration 0022', now()),
('mart.v_energy_monthly', ARRAY['node_id'], 'core.org_node', ARRAY['node_id'], 'N:1', 'declared', NULL, 'approved', 'migration 0022', now()),
('mart.v_energy_monthly', ARRAY['energy_type_code'], 'core.energy_type', ARRAY['code'], 'N:1', 'declared', NULL, 'approved', 'migration 0022', now()),
('mart.v_carbon_monthly', ARRAY['node_id'], 'core.org_node', ARRAY['node_id'], 'N:1', 'declared', NULL, 'approved', 'migration 0022', now()),
('mart.v_carbon_monthly', ARRAY['profile_code'], 'core.standard_version', ARRAY['code'], 'N:1', 'declared', NULL, 'approved', 'migration 0022', now()),
('mart.v_indicator_display', ARRAY['indicator_id'], 'core.indicator_def', ARRAY['indicator_id'], 'N:1', 'declared', NULL, 'approved', 'migration 0022', now()),
('mart.v_indicator_display', ARRAY['node_id'], 'core.org_node', ARRAY['node_id'], 'N:1', 'declared', NULL, 'approved', 'migration 0022', now()),
('mart.v_org_node', ARRAY['node_id'], 'core.org_node', ARRAY['node_id'], '1:1', 'declared', NULL, 'approved', 'migration 0022', now()),
('mart.v_screen_honor', ARRAY['node_id'], 'core.org_node', ARRAY['node_id'], 'N:1', 'declared', NULL, 'approved', 'migration 0022', now());

-- 补齐其余表、字段与外键关联
SELECT semantic.refresh_catalog();

-- 字段说明初稿：取自各迁移文件建表语句中的行内注释（人工撰写），只填空白项
UPDATE semantic.column_doc SET description = '例：{"op":"deviation_pct","gt":10,"baseline":"same_month_last_year"}', origin = 'human_seed' WHERE object = 'core.alert_rule' AND column_name = 'condition' AND description IS NULL;
UPDATE semantic.column_doc SET description = '为空表示全园区', origin = 'human_seed' WHERE object = 'core.alert_rule' AND column_name = 'node_scope' AND description IS NULL;
UPDATE semantic.column_doc SET description = '能源品种、基础量或指标编码', origin = 'human_seed' WHERE object = 'core.alert_rule' AND column_name = 'target_code' AND description IS NULL;
UPDATE semantic.column_doc SET description = '清洁能源使用率口径', origin = 'human_seed' WHERE object = 'core.energy_type' AND column_name = 'is_clean' AND description IS NULL;
UPDATE semantic.column_doc SET description = '可再生能源利用率口径', origin = 'human_seed' WHERE object = 'core.energy_type' AND column_name = 'is_renewable' AND description IS NULL;
UPDATE semantic.column_doc SET description = '统一社会信用代码', origin = 'human_seed' WHERE object = 'core.enterprise_profile' AND column_name = 'credit_code' AND description IS NULL;
UPDATE semantic.column_doc SET description = '适用的单位产品能耗限额国标（第 6 项指标）', origin = 'human_seed' WHERE object = 'core.enterprise_profile' AND column_name = 'energy_limit_standard' AND description IS NULL;
UPDATE semantic.column_doc SET description = '规模以上工业企业', origin = 'human_seed' WHERE object = 'core.enterprise_profile' AND column_name = 'is_above_scale' AND description IS NULL;
UPDATE semantic.column_doc SET description = '高新技术企业', origin = 'human_seed' WHERE object = 'core.enterprise_profile' AND column_name = 'is_high_tech' AND description IS NULL;
UPDATE semantic.column_doc SET description = 'kgce/kg、kJ/kg、tCO2/TJ、kgCO2/kWh …', origin = 'human_seed' WHERE object = 'core.factor' AND column_name = 'unit' AND description IS NULL;
UPDATE semantic.column_doc SET description = '采用值；标准只给区间时为空，待确定口径后填写', origin = 'human_seed' WHERE object = 'core.factor' AND column_name = 'value' AND description IS NULL;
UPDATE semantic.column_doc SET description = '标准给出区间时的下限', origin = 'human_seed' WHERE object = 'core.factor' AND column_name = 'value_low' AND description IS NULL;
UPDATE semantic.column_doc SET description = 'GBT2589_2020、NDRC_2025_910_A4 …', origin = 'human_seed' WHERE object = 'core.factor_source' AND column_name = 'code' AND description IS NULL;
UPDATE semantic.column_doc SET description = '例：ECO_VA_CONST / ENG_TCE', origin = 'human_seed' WHERE object = 'core.formula' AND column_name = 'expression' AND description IS NULL;
UPDATE semantic.column_doc SET description = '一星/二星/三星等', origin = 'human_seed' WHERE object = 'core.green_building' AND column_name = 'green_rating' AND description IS NULL;
UPDATE semantic.column_doc SET description = '计入“省以上绿色工厂总产值占比”', origin = 'human_seed' WHERE object = 'core.honor' AND column_name = 'counts_for_indicator' AND description IS NULL;
UPDATE semantic.column_doc SET description = '0003 中补外键', origin = 'human_seed' WHERE object = 'core.honor' AND column_name = 'evidence_document_id' AND description IS NULL;
UPDATE semantic.column_doc SET description = '大屏荣誉标识', origin = 'human_seed' WHERE object = 'core.honor' AND column_name = 'show_on_screen' AND description IS NULL;
UPDATE semantic.column_doc SET description = '例：2024 年度河南省省级绿色工厂', origin = 'human_seed' WHERE object = 'core.honor' AND column_name = 'title' AND description IS NULL;
UPDATE semantic.column_doc SET description = '表格列名或 JSON 路径', origin = 'human_seed' WHERE object = 'core.import_field_map' AND column_name = 'source_field' AND description IS NULL;
UPDATE semantic.column_doc SET description = '目标表字段，如 quantity、period_month、node_code', origin = 'human_seed' WHERE object = 'core.import_field_map' AND column_name = 'target_field' AND description IS NULL;
UPDATE semantic.column_doc SET description = '例：{"multiply":10000} 万千瓦时 → 千瓦时', origin = 'human_seed' WHERE object = 'core.import_field_map' AND column_name = 'transform' AND description IS NULL;
UPDATE semantic.column_doc SET description = 'target = lab_table 时写入的 lab 表名', origin = 'human_seed' WHERE object = 'core.import_template' AND column_name = 'lab_table' AND description IS NULL;
UPDATE semantic.column_doc SET description = '按主导产业分类的引领值（评价通则）', origin = 'human_seed' WHERE object = 'core.indicator_benchmark' AND column_name = 'park_category' AND description IS NULL;
UPDATE semantic.column_doc SET description = '定性基准：具备、完善、是', origin = 'human_seed' WHERE object = 'core.indicator_benchmark' AND column_name = 'value_text' AND description IS NULL;
UPDATE semantic.column_doc SET description = 'overview_left、energy_intensity …', origin = 'human_seed' WHERE object = 'core.indicator_def' AND column_name = 'display_position' AND description IS NULL;
UPDATE semantic.column_doc SET description = '原文：正向定量、正向定性、逆向定量、弹性系数', origin = 'human_seed' WHERE object = 'core.indicator_def' AND column_name = 'indicator_type' AND description IS NULL;
UPDATE semantic.column_doc SET description = '三级指标对应的基础量', origin = 'human_seed' WHERE object = 'core.indicator_def' AND column_name = 'metric_code' AND description IS NULL;
UPDATE semantic.column_doc SET description = '分值或权重', origin = 'human_seed' WHERE object = 'core.indicator_def' AND column_name = 'score' AND description IS NULL;
UPDATE semantic.column_doc SET description = '可选组内需选数量', origin = 'human_seed' WHERE object = 'core.indicator_def' AND column_name = 'select_count' AND description IS NULL;
UPDATE semantic.column_doc SET description = 'required 或可选组编码（如 RG_4_2）', origin = 'human_seed' WHERE object = 'core.indicator_def' AND column_name = 'select_group' AND description IS NULL;
UPDATE semantic.column_doc SET description = 'GB/T 4754 行业代码或自定义代码', origin = 'human_seed' WHERE object = 'core.industry' AND column_name = 'code' AND description IS NULL;
UPDATE semantic.column_doc SET description = 'ECO_GROSS_OUTPUT、ECO_VA_CONST、RES_FRESH_WATER …', origin = 'human_seed' WHERE object = 'core.metric_def' AND column_name = 'code' AND description IS NULL;
UPDATE semantic.column_doc SET description = '需要附加维度时', origin = 'human_seed' WHERE object = 'core.metric_def' AND column_name = 'dim_kind' AND description IS NULL;
UPDATE semantic.column_doc SET description = '扩展属性：未预设的字段先放这里，不改表结构', origin = 'human_seed' WHERE object = 'core.org_node' AND column_name = 'attributes' AND description IS NULL;
UPDATE semantic.column_doc SET description = '由触发器维护，标签为 node_id', origin = 'human_seed' WHERE object = 'core.org_node' AND column_name = 'path' AND description IS NULL;
UPDATE semantic.column_doc SET description = 'GIP_2024、GIP_2025、GIP_2026、ZCP_2025', origin = 'human_seed' WHERE object = 'core.standard_version' AND column_name = 'code' AND description IS NULL;
UPDATE semantic.column_doc SET description = '仓库 文件/ 下的文件名', origin = 'human_seed' WHERE object = 'core.standard_version' AND column_name = 'source_file' AND description IS NULL;
UPDATE semantic.column_doc SET description = '适用主导产业：green_home / electronics / all', origin = 'human_seed' WHERE object = 'core.strategy' AND column_name = 'applicable_category' AND description IS NULL;
UPDATE semantic.column_doc SET description = '参数定义与默认值，供情景仿真', origin = 'human_seed' WHERE object = 'core.strategy' AND column_name = 'parameters' AND description IS NULL;
UPDATE semantic.column_doc SET description = '同量纲的基准单位', origin = 'human_seed' WHERE object = 'core.unit' AND column_name = 'base_code' AND description IS NULL;
UPDATE semantic.column_doc SET description = 'kWh、MWh、t、m3、GJ、万元 …', origin = 'human_seed' WHERE object = 'core.unit' AND column_name = 'code' AND description IS NULL;
UPDATE semantic.column_doc SET description = '1 本单位 = to_base 基准单位', origin = 'human_seed' WHERE object = 'core.unit' AND column_name = 'to_base' AND description IS NULL;
UPDATE semantic.column_doc SET description = '根因溯源结果：下级节点贡献度排序', origin = 'human_seed' WHERE object = 'fact.alert_event' AND column_name = 'root_cause' AND description IS NULL;
UPDATE semantic.column_doc SET description = '本次使用的因子', origin = 'human_seed' WHERE object = 'fact.calc_run' AND column_name = 'factor_ids' AND description IS NULL;
UPDATE semantic.column_doc SET description = '本次使用的公式版本', origin = 'human_seed' WHERE object = 'fact.calc_run' AND column_name = 'formula_ids' AND description IS NULL;
UPDATE semantic.column_doc SET description = '换算到能源品种默认单位', origin = 'human_seed' WHERE object = 'fact.energy_activity' AND column_name = 'quantity_std' AND description IS NULL;
UPDATE semantic.column_doc SET description = '折标准煤，由计算写入', origin = 'human_seed' WHERE object = 'fact.energy_activity' AND column_name = 'tce' AND description IS NULL;
UPDATE semantic.column_doc SET description = '计量或分摊规则说明', origin = 'human_seed' WHERE object = 'fact.energy_transfer' AND column_name = 'allocation_rule' AND description IS NULL;
UPDATE semantic.column_doc SET description = '用能与碳排放预算，用于对比', origin = 'human_seed' WHERE object = 'fact.forecast' AND column_name = 'budget_value' AND description IS NULL;
UPDATE semantic.column_doc SET description = 'baseline 或策略编码', origin = 'human_seed' WHERE object = 'fact.forecast' AND column_name = 'scenario_code' AND description IS NULL;
UPDATE semantic.column_doc SET description = '是否达到判定基准，决定前台是否展示', origin = 'human_seed' WHERE object = 'fact.indicator_value' AND column_name = 'achieved' AND description IS NULL;
UPDATE semantic.column_doc SET description = '计算时用到的变量取值，供依据溯源', origin = 'human_seed' WHERE object = 'fact.indicator_value' AND column_name = 'input_snapshot' AND description IS NULL;
UPDATE semantic.column_doc SET description = '指标值/引领值（逆向为引领值/指标值）', origin = 'human_seed' WHERE object = 'fact.indicator_value' AND column_name = 'normalized' AND description IS NULL;
UPDATE semantic.column_doc SET description = '按版本计分规则得到的分数', origin = 'human_seed' WHERE object = 'fact.indicator_value' AND column_name = 'score' AND description IS NULL;
UPDATE semantic.column_doc SET description = '定性指标取值', origin = 'human_seed' WHERE object = 'fact.indicator_value' AND column_name = 'value_text' AND description IS NULL;
UPDATE semantic.column_doc SET description = '产品、污染物、固废种类；无附加维度时为空串', origin = 'human_seed' WHERE object = 'fact.statistic_value' AND column_name = 'dim_code' AND description IS NULL;

-- 常见字段的通用说明（只填空白项）
UPDATE semantic.column_doc SET description = '创建时间', origin = 'human_seed' WHERE column_name = 'created_at' AND description IS NULL;
UPDATE semantic.column_doc SET description = '创建人（数据库会话用户）', origin = 'human_seed' WHERE column_name = 'created_by' AND description IS NULL;
UPDATE semantic.column_doc SET description = '最后更新时间', origin = 'human_seed' WHERE column_name = 'updated_at' AND description IS NULL;
UPDATE semantic.column_doc SET description = '来源导入批次（raw.import_batch）', origin = 'human_seed' WHERE column_name = 'batch_id' AND description IS NULL;
UPDATE semantic.column_doc SET description = '来源导入行（raw.import_record）', origin = 'human_seed' WHERE column_name = 'record_id' AND description IS NULL;
UPDATE semantic.column_doc SET description = '是否当前有效版本；修正数据时旧行置为 false，查询必须筛选 true', origin = 'human_seed' WHERE column_name = 'is_current' AND description IS NULL;
UPDATE semantic.column_doc SET description = '被哪一行替代（同表主键）', origin = 'human_seed' WHERE column_name = 'superseded_by' AND description IS NULL;
UPDATE semantic.column_doc SET description = '扩展属性（JSON），未预设的字段放这里', origin = 'human_seed' WHERE column_name = 'attributes' AND description IS NULL;
UPDATE semantic.column_doc SET description = '备注', origin = 'human_seed' WHERE column_name = 'note' AND description IS NULL;
UPDATE semantic.column_doc SET description = '备注', origin = 'human_seed' WHERE column_name = 'remark' AND description IS NULL;
UPDATE semantic.column_doc SET description = '对象（core.org_node.node_id）', origin = 'human_seed' WHERE column_name = 'node_id' AND description IS NULL;
UPDATE semantic.column_doc SET description = '对象名称', origin = 'human_seed' WHERE column_name = 'node_name' AND description IS NULL;
UPDATE semantic.column_doc SET description = '能源品种编码（core.energy_type.code）', origin = 'human_seed' WHERE column_name = 'energy_type_code' AND description IS NULL;
UPDATE semantic.column_doc SET description = '能源品种名称', origin = 'human_seed' WHERE column_name = 'energy_type_name' AND description IS NULL;
UPDATE semantic.column_doc SET description = '计算批次（fact.calc_run.run_id）', origin = 'human_seed' WHERE column_name = 'run_id' AND description IS NULL;
UPDATE semantic.column_doc SET description = '质量标记：ok 正常、suspect 存疑、corrected 已修正', origin = 'human_seed' WHERE column_name = 'quality_flag' AND description IS NULL;
UPDATE semantic.column_doc SET description = '计量单位（core.unit.code）', origin = 'human_seed' WHERE column_name = 'unit' AND description IS NULL;
UPDATE semantic.column_doc SET description = '来源链接', origin = 'human_seed' WHERE column_name = 'source_url' AND description IS NULL;
UPDATE semantic.column_doc SET description = '出处页码', origin = 'human_seed' WHERE column_name = 'source_page' AND description IS NULL;
UPDATE semantic.column_doc SET description = '指标（core.indicator_def.indicator_id）', origin = 'human_seed' WHERE column_name = 'indicator_id' AND description IS NULL;
UPDATE semantic.column_doc SET description = '评价标准版本（core.standard_version.version_id）', origin = 'human_seed' WHERE column_name = 'version_id' AND description IS NULL;
UPDATE semantic.column_doc SET description = '审核状态', origin = 'human_seed' WHERE column_name = 'review_status' AND description IS NULL;
UPDATE semantic.column_doc SET description = '审核人', origin = 'human_seed' WHERE column_name = 'reviewed_by' AND description IS NULL;
UPDATE semantic.column_doc SET description = '审核时间', origin = 'human_seed' WHERE column_name = 'reviewed_at' AND description IS NULL;
UPDATE semantic.column_doc SET description = '审核意见', origin = 'human_seed' WHERE column_name = 'review_note' AND description IS NULL;
UPDATE semantic.column_doc SET description = '期间类型：month 月、quarter 季、year 年', origin = 'human_seed' WHERE column_name = 'period_type' AND description IS NULL;
UPDATE semantic.column_doc SET description = '名称', origin = 'human_seed' WHERE column_name = 'name' AND description IS NULL;
UPDATE semantic.column_doc SET description = '编码', origin = 'human_seed' WHERE column_name = 'code' AND description IS NULL;
UPDATE semantic.column_doc SET description = '说明', origin = 'human_seed' WHERE column_name = 'description' AND description IS NULL;
UPDATE semantic.column_doc SET description = '经度', origin = 'human_seed' WHERE column_name = 'lng' AND description IS NULL;
UPDATE semantic.column_doc SET description = '纬度', origin = 'human_seed' WHERE column_name = 'lat' AND description IS NULL;
UPDATE semantic.column_doc SET description = '是否启用', origin = 'human_seed' WHERE column_name = 'is_active' AND description IS NULL;
UPDATE semantic.column_doc SET description = '生效起始日', origin = 'human_seed' WHERE column_name = 'valid_from' AND description IS NULL;
UPDATE semantic.column_doc SET description = '生效截止日', origin = 'human_seed' WHERE column_name = 'valid_to' AND description IS NULL;
UPDATE semantic.column_doc SET description = '层级路径（ltree）', origin = 'human_seed' WHERE column_name = 'path' AND description IS NULL;
UPDATE semantic.column_doc SET description = '数据来源：measured 实测、manual 人工/公开资料真实值、estimated 模拟估值、interpolated 插值', origin = 'human_seed' WHERE column_name = 'data_source' AND description IS NULL;
UPDATE semantic.column_doc SET description = '原件（raw.document）', origin = 'human_seed' WHERE column_name = 'document_id' AND description IS NULL;
UPDATE semantic.column_doc SET description = '佐证原件（raw.document）', origin = 'human_seed' WHERE column_name = 'evidence_document_id' AND description IS NULL;
UPDATE semantic.column_doc SET description = '排序', origin = 'human_seed' WHERE column_name = 'sort_order' AND description IS NULL;
UPDATE semantic.column_doc SET description = '序号', origin = 'human_seed' WHERE column_name = 'seq' AND description IS NULL;
UPDATE semantic.column_doc SET description = '状态', origin = 'human_seed' WHERE column_name = 'status' AND description IS NULL;
UPDATE semantic.column_doc SET description = '数值', origin = 'human_seed' WHERE column_name = 'value' AND description IS NULL;
UPDATE semantic.column_doc SET description = '年度', origin = 'human_seed' WHERE column_name = 'year' AND description IS NULL;

-- 13. 权限 ---------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA semantic TO green_app, green_agent_ro, green_etl;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA semantic TO green_app;
GRANT SELECT ON ALL TABLES IN SCHEMA semantic TO green_agent_ro;
GRANT INSERT ON semantic.publish_event TO green_etl;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA semantic TO green_app, green_etl;
GRANT EXECUTE ON FUNCTION semantic.refresh_catalog(), semantic.profile_object(text), semantic.edge_coverage(),
                          semantic.apply_comment_sync(text) TO green_app;
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA semantic GRANT SELECT, INSERT, UPDATE ON TABLES TO green_app;
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA semantic GRANT SELECT ON TABLES TO green_agent_ro;

-- 智能查询可读事实层（此前只能读 mart 与 core）。查询经执行计划校验：必须筛选 is_current、碳排放必须指定口径、只沿关联图连接。
GRANT USAGE ON SCHEMA fact TO green_agent_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA fact TO green_agent_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE greensystem IN SCHEMA fact GRANT SELECT ON TABLES TO green_agent_ro;

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0022', '语义目录与数据治理 schema semantic：表/字段说明、剖析、关联图、指标层、问答对、治理规则与工单、发布事件；修正 mart.v_carbon_monthly 多口径相加');
