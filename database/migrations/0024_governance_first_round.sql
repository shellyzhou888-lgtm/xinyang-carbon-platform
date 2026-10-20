-- 0024 处理首批治理工单（2026-10-20）
--   1. 修正三条误报或过碎的检测规则，同比洞察增加归因：
--      DQ_ENERGY_SPIKE   改为与“当年”月度中位数比较（万华 2022-12 新线投产后用量约 3.5 倍，跨年比较把 2021–2022 全部误报为偏低）
--      AMB_UNIT_MISMATCH 按产品计量的基础量（PROD_OUTPUT，单位记在数据行上）改为检查同一产品是否混用单位
--      COV_ESTIMATED     每张表一张工单（原来每年一张）
--      INS_YOY           标题与证据列出贡献最大的 3 个对象
--   2. 永豪轩 2021、2022 年高企模拟记录（否）已被原件证实为“是”，作废模拟记录（不删除，保留历史）
--   3. 天一美家节点法人确定为信阳天一美家实业有限公司（项目负责人确认）
--   4. 项目负责人确认批准 GIP_2026 的 4 个推定公式：F_OUTPUT_CAGR3、F_GREEN_FACTORY_SHARE、F_LEVEL2_SHARE、F_CO2_ELASTICITY
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。

SET ROLE greensystem;

-- 1. 检测规则

UPDATE semantic.check_def SET description = '某月用量超过该对象该品种当年月度中位数 4 倍或不足 1/4，可能是单位填错（如 kWh 与万 kWh）、漏填或重复。按年比较，避免把扩产、投产前后的正常变化当成异常。', check_sql = $chk$
with m as (select node_id, energy_type_code, period_month, extract(year from period_month)::int as y, sum(quantity_std) q
             from fact.energy_activity where is_current and flow = 'consumption' group by 1, 2, 3),
med as (select node_id, energy_type_code, y, percentile_cont(0.5) within group (order by q) as med, count(*) n from m group by 1, 2, 3)
select n.code || '/' || m.energy_type_code || '/' || to_char(m.period_month, 'YYYY-MM') as subject,
       n.name || ' ' || to_char(m.period_month, 'YYYY-MM') || ' ' || m.energy_type_code || ' 用量为当年月度中位数的 '
         || round((m.q / med.med)::numeric, 2) || ' 倍' as title,
       jsonb_build_object('node', n.code, 'energy_type', m.energy_type_code, 'month', to_char(m.period_month, 'YYYY-MM'),
         'quantity', round(m.q, 2), 'year_median', round(med.med::numeric, 2), 'ratio', round((m.q / med.med)::numeric, 2)) as detail
  from m join med using (node_id, energy_type_code, y) join core.org_node n using (node_id)
 where med.n >= 6 and med.med > 0 and (m.q > 4 * med.med or m.q < med.med / 4)
$chk$ WHERE code = 'DQ_ENERGY_SPIKE';

UPDATE semantic.check_def SET description = '年度统计值的单位与基础量定义不同；按产品计量的基础量（如产品产量）检查同一产品是否混用了不同单位。', check_sql = $chk$
select s.metric_code || '/' || s.unit as subject,
       '基础量“' || m.name || '”有 ' || count(*) || ' 条记录用单位 ' || s.unit || '（定义为 ' || m.unit || '）' as title,
       jsonb_build_object('metric', s.metric_code, 'defined_unit', m.unit, 'stored_unit', s.unit, 'rows', count(*),
         'convertible', bool_and(u1.base_code is not null and u1.base_code = u2.base_code)) as detail
  from fact.statistic_value s join core.metric_def m on m.code = s.metric_code
  left join core.unit u1 on u1.code = s.unit left join core.unit u2 on u2.code = m.unit
 where s.is_current and s.unit <> m.unit and m.dim_kind is distinct from 'product'
 group by s.metric_code, s.unit, m.name, m.unit
union all
select s.metric_code || '/' || s.dim_code,
       '基础量“' || m.name || '”的产品“' || s.dim_code || '”使用了 ' || count(distinct s.unit) || ' 种单位',
       jsonb_build_object('metric', s.metric_code, 'product', s.dim_code, 'units', jsonb_agg(distinct s.unit))
  from fact.statistic_value s join core.metric_def m on m.code = s.metric_code
 where s.is_current and m.dim_kind = 'product'
 group by s.metric_code, s.dim_code, m.name
having count(distinct s.unit) > 1
$chk$ WHERE code = 'AMB_UNIT_MISMATCH';

UPDATE semantic.check_def SET description = '表中有年度的有效数据一半以上是模拟估值（estimated），这些年度的计算结果不能作为申报依据。每张表一张工单，列出各年度占比。', check_sql = $chk$
with t as (
  select 'fact.energy_activity' tbl, '能源活动数据' tbl_name, extract(year from period_month)::int yr, count(*) total,
         count(*) filter (where data_source in ('estimated','interpolated')) est
    from fact.energy_activity where is_current group by 3
  union all
  select 'fact.statistic_value', '年度统计数据', extract(year from period_start)::int, count(*),
         count(*) filter (where data_source in ('estimated','interpolated'))
    from fact.statistic_value where is_current group by 3)
select t.tbl as subject,
       t.tbl_name || ' 有 ' || count(*) || ' 个年度模拟估值占一半以上（' || string_agg(t.yr::text, '、' order by t.yr) || '）' as title,
       jsonb_build_object('table', t.tbl, 'years', jsonb_agg(jsonb_build_object('year', t.yr, 'rows', t.total, 'estimated_rows', t.est,
                          'estimated_pct', round(100.0 * t.est / t.total)) order by t.yr)) as detail
  from t where t.est::numeric / t.total > 0.5
 group by t.tbl, t.tbl_name
$chk$ WHERE code = 'COV_ESTIMATED';

UPDATE semantic.check_def SET description = '园区综合能耗同比变化超过 10%，并列出变化贡献最大的 3 个企业或公共设施。', check_sql = $chk$
with nodes as (select node_id, name from core.org_node where node_type in ('enterprise','public_area') and is_active),
rng as (select extract(year from min(period_month))::int a, extract(year from max(period_month))::int b from fact.energy_activity where is_current),
e as (select nd.name, g as y, coalesce(engine.metric_value('ENG_TCE', nd.node_id, g, 'GIP_2026'), 0) as tce
        from nodes nd cross join rng cross join generate_series(rng.a, rng.b) g),
park as (select y, sum(tce) as tce from e group by y),
d as (select c.y, c.name, c.tce - p.tce as delta from e c join e p on p.name = c.name and p.y = c.y - 1),
top as (select y, name, delta, row_number() over (partition by y order by abs(delta) desc) rn from d)
select 'XYEDZ/' || y.y as subject,
       '园区 ' || y.y || ' 年综合能耗同比 ' || case when y.tce >= p.tce then '+' else '' end || round(100 * (y.tce / p.tce - 1), 1) || '%，主要来自 '
         || (select string_agg(t.name || case when t.delta >= 0 then ' +' else ' ' end || round(t.delta) || ' tce', '、' order by t.rn)
               from top t where t.y = y.y and t.rn <= 3) as title,
       jsonb_build_object('year', y.y, 'tce', round(y.tce, 1), 'prev_tce', round(p.tce, 1),
         'top_contributors', (select jsonb_agg(jsonb_build_object('node', t.name, 'delta_tce', round(t.delta, 1),
                                 'share_of_change_pct', round(100 * t.delta / nullif(y.tce - p.tce, 0))) order by t.rn)
                                from top t where t.y = y.y and t.rn <= 3)) as detail
  from park y join park p on p.y = y.y - 1
 where p.tce > 0 and abs(y.tce / p.tce - 1) > 0.10
$chk$ WHERE code = 'INS_YOY';

-- 同比洞察的说明要按新的归因证据重写
UPDATE semantic.governance_issue SET ai_written = false WHERE check_code = 'INS_YOY' AND status = 'open';

-- 2. 永豪轩 2021–2022 年高企模拟记录作废
UPDATE core.enterprise_qualification q
   SET is_current = false,
       note = coalesce(q.note || '；', '') || '2026-10-20 作废：原件（建材目录 PDF 第 83 页）证实 2020–2022 年具备高企资格'
  FROM core.org_node n
 WHERE n.node_id = q.node_id AND n.code = 'E_YONGHAOXUAN' AND q.qual_type = 'high_tech'
   AND q.data_source = 'estimated' AND q.first_year BETWEEN 2021 AND 2022 AND q.is_current;

-- 3. 天一美家法人名称
UPDATE core.enterprise_profile e SET
  legal_name = '信阳天一美家实业有限公司', updated_at = now(),
  attributes = e.attributes || jsonb_build_object('legal_name_verified', true, 'former_label', e.legal_name,
    'legal_name_source', '建材目录 PDF 第 110 页；项目负责人 2026-10-20 确认本节点对应天一美家实业（产业园主体）',
    'scope_note', '天一红木实业、天一窗业为关联法人，未并入本节点；天一窗业的高企资格不计入本节点')
FROM core.org_node n WHERE n.node_id = e.node_id AND n.code = 'E_TIANYI';

-- 4. 推定公式批准
UPDATE core.formula
SET status = 'approved',
    reviewed_by = 'shellyzhou888-lgtm（项目负责人，2026-10-20 会话确认）',
    reviewed_at = now(),
    review_note = '推定公式（官方计算说明未找到），项目负责人确认按现有表达式批准；发现官方口径不同时新增修订版本'
WHERE revision = 1 AND status = 'draft'
  AND code IN ('F_OUTPUT_CAGR3','F_GREEN_FACTORY_SHARE','F_LEVEL2_SHARE','F_CO2_ELASTICITY');

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0024', '处理首批治理工单：修正三条检测规则并为同比洞察加归因；作废永豪轩 2021–2022 模拟高企记录；天一法人；批准 4 个推定公式');
