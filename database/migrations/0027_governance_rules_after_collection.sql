-- 0027 根据服务器 Agent 采集报告（2026-10-21）调整治理检测规则
--   1. DQ_STALE_CALC 只看写入了能源活动或统计数据的批次：碳价、产品碳足迹、目标预算等批次不参与指标计算，不再提示“需要重算”
--   2. 新增 DQ_CARBON_PRICE_OUTLIER：挂牌协议成交均价落在当日最低价 −5% / 最高价 +5% 之外，或大宗协议均价偏离收盘价 20% 以上，
--      按市场与月份各开一张工单，供人工对照原文复核（采集报告 2.5 节：24 天挂牌均价异常、9 天大宗均价偏离）
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。

SET ROLE greensystem;

UPDATE semantic.check_def SET
  description = '有写入能源活动或统计数据的导入批次在最近一次主版本指标计算之后入库，相关年份的结果可能已过期，需要重算（碳价、碳足迹、目标等批次不影响指标，不计入）。',
  check_sql = $chk$
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
   and (exists (select 1 from fact.energy_activity a where a.batch_id = b.batch_id)
        or exists (select 1 from fact.statistic_value s where s.batch_id = b.batch_id))
$chk$
WHERE code = 'DQ_STALE_CALC';

INSERT INTO semantic.check_def (code, name, category, risk, action_kind, description, check_sql) VALUES
('DQ_CARBON_PRICE_OUTLIER', '碳价成交均价与当日区间不符', 'dirty_data', 'low', NULL,
 '挂牌协议成交额 ÷ 成交量落在当日价格区间之外（±5%），或大宗协议均价偏离收盘价 20% 以上。可能是转载页录入误差；大宗为协议价，偏离不一定错误。请对照原文复核后确认或驳回。',
 $chk$
with d as (
  select market_code, trade_date, low_price, high_price, close_price,
         turnover_listed_yuan / nullif(volume_listed_t, 0) as listed_avg,
         turnover_block_yuan / nullif(volume_block_t, 0) as block_avg
    from fact.carbon_market_price where is_current),
f as (
  select *, case when listed_avg is not null and (listed_avg < low_price * 0.95 or listed_avg > high_price * 1.05) then 'listed' end as k1,
            case when block_avg is not null and close_price > 0 and abs(block_avg / close_price - 1) > 0.2 then 'block' end as k2
    from d)
select market_code || '/' || to_char(trade_date, 'YYYY-MM') as subject,
       market_code || ' ' || to_char(trade_date, 'YYYY-MM') || ' 有 ' || count(*) || ' 个交易日成交均价与当日价格区间明显不符' as title,
       jsonb_build_object('market', market_code, 'days', jsonb_agg(jsonb_build_object('date', trade_date, 'low', low_price, 'high', high_price,
         'close', close_price, 'listed_avg', round(listed_avg, 2), 'block_avg', round(block_avg, 2), 'type', coalesce(k1, k2)) order by trade_date)) as detail
  from f where k1 is not null or k2 is not null
 group by market_code, to_char(trade_date, 'YYYY-MM')
$chk$);

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0027', '导入晚于计算只看能源与统计批次；新增碳价成交均价异常检测');
