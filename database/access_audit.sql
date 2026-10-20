-- 只读连接审计：分别用 postgres 和 zyz 执行，对比实际访问能力。
\set ON_ERROR_STOP on

SELECT current_database() AS database_name,
       current_user AS connected_as,
       current_setting('server_version') AS server_version,
       inet_server_addr() AS server_address,
       has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect;

SELECT n.nspname AS schema_name,
       has_schema_privilege(current_user, n.oid, 'USAGE') AS can_use,
       has_schema_privilege(current_user, n.oid, 'CREATE') AS can_create
FROM pg_namespace AS n
WHERE n.nspname NOT IN ('information_schema', 'pg_catalog')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
ORDER BY n.nspname;

SELECT n.nspname AS schema_name,
       count(*) FILTER (WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')) AS table_or_view_count,
       count(*) FILTER (WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
                        AND has_table_privilege(current_user, c.oid, 'SELECT')) AS selectable_count,
       count(*) FILTER (WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
                        AND has_table_privilege(current_user, c.oid, 'INSERT')) AS insertable_count,
       count(*) FILTER (WHERE c.relkind = 'S') AS sequence_count,
       count(*) FILTER (WHERE c.relkind = 'S'
                        AND has_sequence_privilege(current_user, c.oid, 'USAGE')) AS usable_sequence_count
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('information_schema', 'pg_catalog')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
GROUP BY n.nspname
ORDER BY n.nspname;
