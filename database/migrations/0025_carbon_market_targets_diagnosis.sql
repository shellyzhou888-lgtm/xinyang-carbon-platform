-- 0025 碳市场价格、产品碳足迹参考值、目标与预算、储能与充电计量、预警—根因—策略推荐
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。
--
-- 数据来源约定：碳价、产品碳足迹由服务器上的 Agent 按 docs/prompts/server-agent-carbon-market-and-footprint.md 从公开渠道导入（data_source = manual）；
-- 目标、预算、厂区/产线分项、储能与充电等暂无真实数据，用模拟数据（data_source = estimated）。

SET ROLE greensystem;

-- 1. 碳市场与价格 ------------------------------------------------------------------------------
CREATE TABLE core.carbon_market (
  code         text PRIMARY KEY,
  name         text NOT NULL,
  operator     text,
  price_unit   text NOT NULL DEFAULT '元/吨',
  launched_on  date,
  source_url   text,
  note         text
);
COMMENT ON TABLE core.carbon_market IS '碳市场字典：全国碳排放权交易市场（CEA）、全国温室气体自愿减排交易市场（CCER）等';

INSERT INTO core.carbon_market (code, name, operator, launched_on, source_url, note) VALUES
  ('CEA',  '全国碳排放权交易市场（碳排放配额）', '上海环境能源交易所', '2021-07-16', 'https://www.cneeex.com/',
   '每日发布《全国碳市场每日综合价格行情及成交信息》：开盘、最高、最低、收盘价，挂牌协议与大宗协议成交量和成交额'),
  ('CCER', '全国温室气体自愿减排交易市场（核证自愿减排量）', '北京绿色交易所', '2024-01-22', 'https://www.ccer.com.cn/',
   '2024-01-22 重启，2025-03-07 首批项目减排量开始交易；每日发布成交量、成交额、成交均价');

CREATE TABLE fact.carbon_market_price (
  price_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market_code        text NOT NULL REFERENCES core.carbon_market(code),
  trade_date         date NOT NULL,
  open_price         numeric(12,4),
  high_price         numeric(12,4),
  low_price          numeric(12,4),
  close_price        numeric(12,4),
  avg_price          numeric(12,4),                 -- 成交均价（CCER 只发布均价）
  volume_t           numeric(18,2),                 -- 当日总成交量（吨）
  turnover_yuan      numeric(20,2),                 -- 当日总成交额（元）
  volume_listed_t    numeric(18,2),                 -- 挂牌协议成交量
  turnover_listed_yuan numeric(20,2),
  volume_block_t     numeric(18,2),                 -- 大宗协议成交量
  turnover_block_yuan numeric(20,2),
  source_title       text,
  source_url         text,
  retrieved_at       timestamptz,
  data_source        text NOT NULL DEFAULT 'manual' CHECK (data_source IN ('measured','manual','estimated','interpolated')),
  batch_id           bigint REFERENCES raw.import_batch(batch_id),
  is_current         boolean NOT NULL DEFAULT true,
  superseded_by      bigint REFERENCES fact.carbon_market_price(price_id),
  note               text,
  created_by         text NOT NULL DEFAULT session_user,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX carbon_market_price_current ON fact.carbon_market_price (market_code, trade_date) WHERE is_current;
COMMENT ON TABLE fact.carbon_market_price IS '碳市场每日行情（公开渠道，data_source=manual）。同一市场同一交易日只有一行当前有效；更正时新增一行并把旧行置为失效';

-- 2. 产品碳足迹参考值 ----------------------------------------------------------------------------
CREATE TABLE core.product_footprint_ref (
  ref_id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_name      text NOT NULL,
  product_category  text,                          -- 产品类别（CPCD 采用联合国 CPC 分类）
  functional_unit   text NOT NULL,                 -- 功能单位，如 1 m3、1 件、1 kWh
  value             numeric(20,6) NOT NULL,        -- 碳足迹数值
  unit              text NOT NULL,                 -- 如 kgCO2e/m3
  boundary          text CHECK (boundary IN ('cradle_to_gate','cradle_to_grave','gate_to_gate','other')),
  region            text,
  data_year         smallint,
  stages            jsonb,                         -- 生命周期各阶段排放（原料、生产、运输、使用、废弃）
  quality_stars     smallint CHECK (quality_stars BETWEEN 1 AND 5),
  method_standard   text,                          -- ISO 14067、PAS 2050、GB/T 24067 等
  database_name     text,                          -- CPCD、EPD、文献等
  source_title      text NOT NULL,
  source_url        text,
  source_page       text,
  retrieved_at      timestamptz,
  applicable_nodes  text[] NOT NULL DEFAULT '{}',  -- 可参照的园区企业编码
  data_source       text NOT NULL DEFAULT 'manual' CHECK (data_source IN ('measured','manual','estimated','interpolated')),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  reviewed_by       text,
  reviewed_at       timestamptz,
  batch_id          bigint REFERENCES raw.import_batch(batch_id),
  is_current        boolean NOT NULL DEFAULT true,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.product_footprint_ref IS '产品碳足迹参考值（公开数据库、EPD、文献），用于与园区企业厂内碳强度对照；需人工审核（status）后才作为正式参考';

-- 3. 目标与预算 ---------------------------------------------------------------------------------
CREATE TABLE fact.target (
  target_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_id        bigint NOT NULL REFERENCES core.org_node(node_id),
  target_kind    text NOT NULL CHECK (target_kind IN ('energy_budget_tce','carbon_budget_t','energy_intensity','carbon_intensity',
                                                      'carbon_peak_t','green_power_share','renewable_share')),
  year           smallint NOT NULL,
  value          numeric(20,6) NOT NULL,
  unit           text NOT NULL,
  scenario_code  text NOT NULL DEFAULT 'plan',
  basis          text,                             -- 依据或测算方法
  data_source    text NOT NULL CHECK (data_source IN ('measured','manual','estimated','interpolated')),
  batch_id       bigint REFERENCES raw.import_batch(batch_id),
  is_current     boolean NOT NULL DEFAULT true,
  superseded_by  bigint REFERENCES fact.target(target_id),
  created_by     text NOT NULL DEFAULT session_user,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX target_current ON fact.target (node_id, target_kind, year, scenario_code) WHERE is_current;
COMMENT ON TABLE fact.target IS '园区与企业年度目标、用能与碳排放预算、达峰目标；当前为模拟值（estimated），取得正式文件后替换';

-- 4. 储能与充电计量的基础量 ------------------------------------------------------------------------
INSERT INTO core.metric_def (code, name, unit, category, aggregation, description) VALUES
  ('ENG_STORAGE_CHARGE',    '储能充电量', 'kWh', 'energy', 'sum', '储能系统从电网或光伏充入的电量（月度）'),
  ('ENG_STORAGE_DISCHARGE', '储能放电量', 'kWh', 'energy', 'sum', '储能系统放出的电量（月度），与充电量之比为往返效率'),
  ('ENG_EV_CHARGE',         '充电桩充电量', 'kWh', 'energy', 'sum', '园区公共充电桩充电量（月度）');

-- 5. 预警规则补充 --------------------------------------------------------------------------------
UPDATE core.alert_rule SET condition = '{"op":"ytd_actual_gt_budget","source":"fact.target","kinds":["energy_budget_tce","carbon_budget_t"]}',
       description = '年初至今实际值（或无实际值时的预测值）超过按月份折算的年度预算（fact.target）'
 WHERE code = 'BUDGET_OVERRUN';
INSERT INTO core.alert_rule (code, name, target_kind, target_code, condition, severity, description) VALUES
  ('INTENSITY_HIGH', '企业单位产值能耗明显偏高', 'metric', 'ENG_TCE',
   '{"op":"ratio_to_park_avg","gt":2}', 'info', '企业综合能耗 / 工业总产值超过园区平均 2 倍'),
  ('INDICATOR_NOT_ACHIEVED', '评价指标未达标', 'indicator', NULL,
   '{"op":"not_achieved","version":"primary","strategy_categories":{"I04":["efficiency","waste_heat","management"],"I05":["clean_energy","green_power"],"I06":["efficiency","process"],"I16":["efficiency"],"I17":["efficiency","clean_energy","green_power"],"I18":["clean_energy","green_power"]}}',
   'warning', '主评价版本中已算出且未达到判定基准的指标；按指标类型推荐策略');

-- 6. 预警 → 根因 → 策略推荐 ------------------------------------------------------------------------
-- 逐条执行启用的规则，生成 fact.alert_event（root_cause 为下级对象贡献度排序），并按企业所属产业和策略参数
-- 生成 fact.strategy_plan 推荐（expected_tce_saving = 企业年能耗 × 策略节能率）。重复运行时，同一规则、对象、期间旧的未处理预警置为已解决。
CREATE FUNCTION engine.evaluate_alerts(p_year int, p_node_code text DEFAULT 'XYEDZ') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_park bigint; v_run bigint; v_profile text; r core.alert_rule; m date; v_now numeric; v_prev numeric; v_dev numeric;
  v_alert bigint; v_root jsonb; v_budget record; v_months int; v_actual numeric; v_basis text; n_alert int := 0; n_plan int := 0;
  e record; ind record; v_cats text[];
BEGIN
  SELECT node_id INTO v_park FROM core.org_node WHERE code = p_node_code;
  IF v_park IS NULL THEN RAISE EXCEPTION '对象 % 不存在', p_node_code; END IF;
  SELECT code INTO v_profile FROM core.standard_version WHERE is_primary;
  INSERT INTO fact.calc_run (run_type, version_id, period_from, period_to, params, status)
  SELECT 'diagnosis', version_id, make_date(p_year, 1, 1), make_date(p_year, 12, 1), jsonb_build_object('node', p_node_code), 'running'
    FROM core.standard_version WHERE is_primary RETURNING run_id INTO v_run;

  FOR r IN SELECT * FROM core.alert_rule WHERE enabled AND code <> 'DATA_GAP_MONTH' LOOP
    -- 同一规则、同一年度此前未处理的预警作废（以本次结果为准）
    UPDATE fact.alert_event SET status = 'resolved', resolved_at = now()
     WHERE rule_id = r.rule_id AND status = 'open' AND extract(year FROM period_start) = p_year;

    IF r.code IN ('ENERGY_DEVIATION_10', 'CARBON_DEVIATION_10') THEN
      FOR m IN SELECT generate_series(make_date(p_year, 1, 1), make_date(p_year, 12, 1), interval '1 month')::date LOOP
        IF r.code = 'ENERGY_DEVIATION_10' THEN
          v_now := engine.energy_metric('ENG_TCE', v_park, m, m, v_profile);
          v_prev := engine.energy_metric('ENG_TCE', v_park, (m - interval '1 year')::date, (m - interval '1 year')::date, v_profile);
        ELSE
          v_now := engine.energy_metric('CO2_TOTAL', v_park, m, m, v_profile);
          v_prev := engine.energy_metric('CO2_TOTAL', v_park, (m - interval '1 year')::date, (m - interval '1 year')::date, v_profile);
        END IF;
        CONTINUE WHEN v_now IS NULL OR v_prev IS NULL OR v_prev = 0;
        v_dev := (v_now / v_prev - 1) * 100;
        CONTINUE WHEN abs(v_dev) <= coalesce((r.condition ->> 'gt')::numeric, 10);
        -- 根因：各核算单元同比变化量，按贡献排序取前 3
        SELECT jsonb_agg(x ORDER BY abs((x ->> 'delta')::numeric) DESC) INTO v_root FROM (
          SELECT jsonb_build_object('node', n.code, 'name', n.name, 'delta', round(d.delta, 1),
                                    'share_pct', round(100 * d.delta / nullif(v_now - v_prev, 0), 1)) AS x
            FROM (SELECT u, coalesce(engine.energy_metric(CASE WHEN r.code = 'ENERGY_DEVIATION_10' THEN 'ENG_TCE' ELSE 'CO2_TOTAL' END, u, m, m, v_profile), 0)
                          - coalesce(engine.energy_metric(CASE WHEN r.code = 'ENERGY_DEVIATION_10' THEN 'ENG_TCE' ELSE 'CO2_TOTAL' END, u,
                                                          (m - interval '1 year')::date, (m - interval '1 year')::date, v_profile), 0) AS delta
                    FROM engine.accounting_nodes(v_park) u) d
            JOIN core.org_node n ON n.node_id = d.u
           ORDER BY abs(d.delta) DESC LIMIT 3) t;
        INSERT INTO fact.alert_event (rule_id, node_id, period_start, severity, message, observed_value, baseline_value, root_cause, run_id)
        VALUES (r.rule_id, v_park, m, r.severity,
                format('%s %s %s同比%s%s%%', p_node_code, to_char(m, 'YYYY-MM'),
                       CASE WHEN r.code = 'ENERGY_DEVIATION_10' THEN '综合能耗' ELSE '碳排放' END,
                       CASE WHEN v_dev > 0 THEN '增加' ELSE '减少' END, round(abs(v_dev), 1)),
                v_now, v_prev, jsonb_build_object('top_contributors', v_root), v_run);
        n_alert := n_alert + 1;
      END LOOP;

    ELSIF r.code = 'BUDGET_OVERRUN' THEN
      FOR v_budget IN SELECT * FROM fact.target WHERE is_current AND node_id = v_park AND year = p_year AND scenario_code = 'plan'
                        AND target_kind IN ('energy_budget_tce', 'carbon_budget_t') LOOP
        SELECT count(DISTINCT a.period_month) INTO v_months FROM fact.energy_activity a
         WHERE a.is_current AND a.node_id IN (SELECT engine.accounting_nodes(v_park)) AND extract(year FROM a.period_month) = p_year;
        IF v_months > 0 THEN
          v_actual := engine.energy_metric(CASE v_budget.target_kind WHEN 'energy_budget_tce' THEN 'ENG_TCE' ELSE 'CO2_TOTAL' END,
                                           v_park, make_date(p_year, 1, 1), make_date(p_year, v_months, 1), v_profile);
          v_basis := format('1–%s 月实际', v_months);
        ELSE
          -- 无实际值：用最近一次预测的全年中位数
          SELECT sum(f.value), 12 INTO v_actual, v_months FROM fact.forecast f
           WHERE f.node_id = v_park AND f.scenario_code = 'baseline' AND extract(year FROM f.period_month) = p_year
             AND f.target_kind = CASE v_budget.target_kind WHEN 'energy_budget_tce' THEN 'energy_tce' ELSE 'co2_t' END
             AND f.run_id = (SELECT max(run_id) FROM fact.forecast WHERE node_id = v_park AND scenario_code = 'baseline');
          v_basis := '全年预测';
        END IF;
        CONTINUE WHEN v_actual IS NULL OR v_actual <= v_budget.value * v_months / 12.0;
        INSERT INTO fact.alert_event (rule_id, node_id, period_start, severity, message, observed_value, baseline_value, root_cause, run_id)
        VALUES (r.rule_id, v_park, make_date(p_year, v_months, 1), CASE WHEN v_actual > v_budget.value * v_months / 12.0 * 1.05 THEN 'critical' ELSE r.severity END,
                format('%s %s年%s %s 超出预算 %s%%', p_node_code, p_year, v_basis,
                       CASE v_budget.target_kind WHEN 'energy_budget_tce' THEN '综合能耗' ELSE '碳排放' END,
                       round((v_actual / (v_budget.value * v_months / 12.0) - 1) * 100, 1)),
                v_actual, v_budget.value * v_months / 12.0,
                jsonb_build_object('budget_annual', v_budget.value, 'months', v_months, 'basis', v_basis, 'target_id', v_budget.target_id), v_run);
        n_alert := n_alert + 1;
      END LOOP;

    ELSIF r.code = 'INTENSITY_HIGH' THEN
      FOR e IN
        WITH x AS (SELECT n.node_id, n.code, n.name, engine.metric_value('ENG_TCE', n.node_id, p_year, v_profile) tce,
                          engine.stat_value('ECO_GROSS_OUTPUT', n.node_id, p_year, '') out_wan
                     FROM core.org_node n WHERE n.node_type = 'enterprise' AND n.is_active
                      AND n.node_id IN (SELECT engine.accounting_nodes(v_park))),
             p AS (SELECT sum(tce) / nullif(sum(out_wan), 0) avg_int FROM x WHERE tce IS NOT NULL AND out_wan > 0)
        SELECT x.*, x.tce / x.out_wan AS intensity, p.avg_int FROM x, p
         WHERE x.out_wan > 0 AND x.tce / x.out_wan > coalesce((r.condition ->> 'gt')::numeric, 2) * p.avg_int
      LOOP
        INSERT INTO fact.alert_event (rule_id, node_id, period_start, severity, message, observed_value, baseline_value, root_cause, run_id)
        VALUES (r.rule_id, e.node_id, make_date(p_year, 1, 1), r.severity,
                format('%s %s年单位产值能耗 %s tce/万元，为园区平均的 %s 倍', e.name, p_year, round(e.intensity, 4), round(e.intensity / e.avg_int, 1)),
                e.intensity, e.avg_int, jsonb_build_object('tce', round(e.tce, 1), 'gross_output_wan', e.out_wan), v_run);
        n_alert := n_alert + 1;
      END LOOP;

    ELSIF r.code = 'INDICATOR_NOT_ACHIEVED' THEN
      FOR ind IN SELECT d.code, d.name, v.value, b.comparator, b.value AS bench
                   FROM fact.indicator_value v JOIN core.indicator_def d USING (indicator_id)
                   JOIN core.standard_version sv ON sv.version_id = d.version_id
                   LEFT JOIN core.indicator_benchmark b ON b.benchmark_id = v.benchmark_id
                  WHERE sv.is_primary AND v.is_current AND v.node_id = v_park AND v.achieved = false
                    AND v.period_start = make_date(p_year, 1, 1) LOOP
        INSERT INTO fact.alert_event (rule_id, node_id, period_start, severity, message, observed_value, baseline_value, root_cause, run_id)
        VALUES (r.rule_id, v_park, make_date(p_year, 1, 1), r.severity,
                format('%s %s %s 未达标：%s（基准 %s %s）', p_year, ind.code, ind.name, round(ind.value, 4), ind.comparator, round(ind.bench, 4)),
                ind.value, ind.bench, jsonb_build_object('indicator', ind.code,
                  'strategy_categories', r.condition -> 'strategy_categories' -> ind.code), v_run);
        n_alert := n_alert + 1;
      END LOOP;
    END IF;
  END LOOP;

  -- 策略推荐：对本次每条预警，在责任对象（企业预警为该企业；园区预警为贡献最大的企业或全部企业）上匹配策略，
  -- 只使用参数中给出节能率（saving_rate）的策略；预期节能量 = 对象年综合能耗 × 节能率。
  FOR e IN
    SELECT a.alert_id, a.node_id, ar.code AS rule_code, a.root_cause FROM fact.alert_event a JOIN core.alert_rule ar USING (rule_id)
     WHERE a.run_id = v_run
  LOOP
    v_cats := CASE WHEN e.rule_code = 'INDICATOR_NOT_ACHIEVED'
                   THEN ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(e.root_cause -> 'strategy_categories') = 'array'
                                                                    THEN e.root_cause -> 'strategy_categories' ELSE '[]'::jsonb END))
                   ELSE ARRAY['efficiency','waste_heat','clean_energy','green_power','management','process'] END;
    CONTINUE WHEN cardinality(v_cats) = 0;
    -- 节能类策略（saving_rate）给出节能量 tce；绿电、清洁能源类（carbon_reduction_rate）给出减碳量 tCO2，记在 params。
    -- 同一次运行中同一企业同一策略只推荐一次（多条月度预警指向同一原因时不重复）。
    INSERT INTO fact.strategy_plan (node_id, strategy_id, alert_id, params, expected_tce_saving, status)
    SELECT t.node_id, t.strategy_id, e.alert_id,
           t.parameters || jsonb_build_object('expected_co2_reduction_t', t.co2_cut, 'basis_year', p_year, 'simulated_parameters', coalesce(t.parameters -> 'simulated', 'false'::jsonb)),
           t.saving, 'proposed'
      FROM (
        SELECT u.*, row_number() OVER (ORDER BY coalesce(u.co2_cut, 0) + coalesce(u.saving, 0) * 2.5 DESC) AS rn
          FROM (
            SELECT n.node_id, s.strategy_id, s.parameters,
                   round(engine.metric_value('ENG_TCE', n.node_id, p_year, v_profile) * (s.parameters ->> 'saving_rate')::numeric, 1) AS saving,
                   round(engine.metric_value('CO2_TOTAL', n.node_id, p_year, v_profile) * coalesce((s.parameters ->> 'carbon_reduction_rate')::numeric,
                         (s.parameters ->> 'saving_rate')::numeric), 1) AS co2_cut
              FROM core.org_node n
              JOIN core.industry i ON i.code = n.industry_code
              JOIN core.strategy s ON s.applicable_category IN ('all', i.park_category)
             WHERE n.node_type = 'enterprise' AND n.is_active
               AND n.node_id IN (SELECT engine.accounting_nodes(e.node_id))
               AND (e.rule_code NOT IN ('ENERGY_DEVIATION_10','CARBON_DEVIATION_10')
                    OR n.code IN (SELECT x ->> 'node' FROM jsonb_array_elements(e.root_cause -> 'top_contributors') x LIMIT 1))
               AND s.category = ANY (v_cats)
               AND coalesce(s.parameters ->> 'saving_rate', s.parameters ->> 'carbon_reduction_rate') IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM fact.strategy_plan sp JOIN fact.alert_event ae ON ae.alert_id = sp.alert_id
                                WHERE ae.run_id = v_run AND sp.node_id = n.node_id AND sp.strategy_id = s.strategy_id)) u
      ) t
     WHERE t.rn <= 3 AND coalesce(t.co2_cut, 0) + coalesce(t.saving, 0) > 0;
    n_plan := n_plan + (SELECT count(*) FROM fact.strategy_plan WHERE alert_id = e.alert_id)::int;
  END LOOP;

  UPDATE fact.calc_run SET status = 'succeeded', finished_at = now(), summary = jsonb_build_object('alerts', n_alert, 'plans', n_plan)
   WHERE run_id = v_run;
  RETURN jsonb_build_object('run_id', v_run, 'alerts', n_alert, 'strategy_plans', n_plan);
END $$;
COMMENT ON FUNCTION engine.evaluate_alerts(int, text) IS '执行预警规则，生成预警（含根因贡献）与策略推荐；同一规则同一年度旧的未处理预警置为已解决';

-- 7. 语义目录 -----------------------------------------------------------------------------------
INSERT INTO semantic.table_doc (object, topic_code, layer, business_name, description, grain, usage_notes, caveats, synonyms, queryable, origin) VALUES
('core.carbon_market', 'carbon', 'reference', '碳市场', '碳市场字典：CEA 全国碳排放配额、CCER 核证自愿减排量', '一行 = 一个市场', '', ARRAY[]::text[], ARRAY['碳市场','碳交易'], true, 'human_seed'),
('fact.carbon_market_price', 'carbon', 'fact', '碳市场每日行情',
 '全国碳市场（CEA）与自愿减排市场（CCER）每日价格、成交量、成交额，来自交易所公开发布', '一行 = 一个市场 × 一个交易日',
 'CEA 用收盘价 close_price；CCER 只有成交均价 avg_price。月度价格用当月成交额 / 成交量加权', ARRAY['必须筛选 is_current','CEA 与 CCER 价格不能混用'],
 ARRAY['碳价','碳价格','配额价格','CCER价格','碳资产'], true, 'human_seed'),
('core.product_footprint_ref', 'carbon', 'reference', '产品碳足迹参考值',
 '公开数据库（CPCD 等）、EPD 与文献中的产品碳足迹数值，含功能单位、系统边界、数据年份与质量', '一行 = 一个产品的一个参考值',
 '与企业厂内碳强度比较时注意系统边界：参考值多为“摇篮到大门”，厂内核算只含生产环节', ARRAY['status = approved 才可作为正式参考','不同功能单位不能直接比较'],
 ARRAY['产品碳足迹','碳足迹','LCA','生命周期'], true, 'human_seed'),
('fact.target', 'evaluation', 'fact', '目标与预算',
 '园区与企业年度用能、碳排放预算，能耗与碳排放强度目标，达峰目标，绿电与可再生能源占比目标', '一行 = 一个对象 × 一个目标类型 × 一个年度 × 一个情景',
 '当前为模拟值，取得正式文件后替换', ARRAY['必须筛选 is_current','data_source = estimated 为模拟目标'],
 ARRAY['预算','目标','达峰','用能预算','碳预算'], true, 'human_seed');
SELECT semantic.refresh_catalog();

-- 8. 权限：服务器上的导入 Agent 使用应用账号（SET ROLE green_app）；ETL 角色也可写碳价与碳足迹参考值
GRANT SELECT, INSERT, UPDATE ON core.carbon_market, core.product_footprint_ref TO green_etl;
GRANT SELECT ON core.carbon_market, core.product_footprint_ref, fact.carbon_market_price, fact.target TO green_agent_ro;

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0025', '碳市场价格、产品碳足迹参考值、目标与预算、储能与充电基础量、预警—根因—策略推荐函数');
