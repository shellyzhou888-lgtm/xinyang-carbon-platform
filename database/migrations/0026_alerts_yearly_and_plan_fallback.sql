-- 0026 预警与策略推荐两处改进（2026-10-20）
--   1. 月度同比预警改为每年每项一条：列出偏离超过阈值的月份、最大偏离月份，根因按全年变化量排序（原来每年 24 条）
--   2. 策略推荐的节能量、减碳量：当年没有实际值（如 2026 年只有预测）时，用上一年实际值估算，并在 params.basis_year 记明
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。执行后重新运行 engine.evaluate_alerts（旧预警自动置为已解决）。

SET ROLE greensystem;

CREATE OR REPLACE FUNCTION engine.evaluate_alerts(p_year int, p_node_code text DEFAULT 'XYEDZ') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_park bigint; v_run bigint; v_profile text; r core.alert_rule; m date; v_now numeric; v_prev numeric; v_dev numeric;
  v_alert bigint; v_root jsonb; v_budget record; v_months int; v_actual numeric; v_basis text; n_alert int := 0; n_plan int := 0;
  e record; ind record; v_cats text[];
  v_metric text; v_months_json jsonb; v_max numeric; v_max_month date;
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
      -- 每年每项一条：列出同比偏离超过阈值的月份；根因按全年变化量排序
      v_metric := CASE WHEN r.code = 'ENERGY_DEVIATION_10' THEN 'ENG_TCE' ELSE 'CO2_TOTAL' END;
      v_months_json := '[]'::jsonb; v_max := 0; v_max_month := NULL;
      FOR m IN SELECT generate_series(make_date(p_year, 1, 1), make_date(p_year, 12, 1), interval '1 month')::date LOOP
        v_now := engine.energy_metric(v_metric, v_park, m, m, v_profile);
        v_prev := engine.energy_metric(v_metric, v_park, (m - interval '1 year')::date, (m - interval '1 year')::date, v_profile);
        CONTINUE WHEN v_now IS NULL OR v_prev IS NULL OR v_prev = 0;
        v_dev := (v_now / v_prev - 1) * 100;
        CONTINUE WHEN abs(v_dev) <= coalesce((r.condition ->> 'gt')::numeric, 10);
        v_months_json := v_months_json || jsonb_build_array(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'deviation_pct', round(v_dev, 1),
                                                                               'observed', round(v_now, 1), 'baseline', round(v_prev, 1)));
        IF abs(v_dev) > abs(v_max) THEN v_max := v_dev; v_max_month := m; END IF;
      END LOOP;
      IF jsonb_array_length(v_months_json) > 0 THEN
        v_now := engine.energy_metric(v_metric, v_park, make_date(p_year, 1, 1), make_date(p_year, 12, 1), v_profile);
        v_prev := engine.energy_metric(v_metric, v_park, make_date(p_year - 1, 1, 1), make_date(p_year - 1, 12, 1), v_profile);
        SELECT jsonb_agg(x ORDER BY abs((x ->> 'delta')::numeric) DESC) INTO v_root FROM (
          SELECT jsonb_build_object('node', n.code, 'name', n.name, 'delta', round(d.delta, 1),
                                    'share_pct', round(100 * d.delta / nullif(v_now - v_prev, 0), 1)) AS x
            FROM (SELECT u, coalesce(engine.energy_metric(v_metric, u, make_date(p_year, 1, 1), make_date(p_year, 12, 1), v_profile), 0)
                          - coalesce(engine.energy_metric(v_metric, u, make_date(p_year - 1, 1, 1), make_date(p_year - 1, 12, 1), v_profile), 0) AS delta
                    FROM engine.accounting_nodes(v_park) u) d
            JOIN core.org_node n ON n.node_id = d.u
           ORDER BY abs(d.delta) DESC LIMIT 3) t;
        INSERT INTO fact.alert_event (rule_id, node_id, period_start, severity, message, observed_value, baseline_value, root_cause, run_id)
        VALUES (r.rule_id, v_park, make_date(p_year, 1, 1), r.severity,
                format('%s %s 年有 %s 个月%s同比偏离超过 %s%%（最大 %s%s%%，%s）', p_node_code, p_year, jsonb_array_length(v_months_json),
                       CASE WHEN r.code = 'ENERGY_DEVIATION_10' THEN '综合能耗' ELSE '碳排放' END,
                       coalesce(r.condition ->> 'gt', '10'), CASE WHEN v_max > 0 THEN '+' ELSE '' END, round(v_max, 1), to_char(v_max_month, 'YYYY-MM')),
                v_now, v_prev,
                jsonb_build_object('months', v_months_json, 'top_contributors', v_root,
                                   'annual_change_pct', round((v_now / nullif(v_prev, 0) - 1) * 100, 1)), v_run);
        n_alert := n_alert + 1;
      END IF;

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
           t.parameters || jsonb_build_object('expected_co2_reduction_t', t.co2_cut, 'basis_year', t.basis_y, 'simulated_parameters', coalesce(t.parameters -> 'simulated', 'false'::jsonb)),
           t.saving, 'proposed'
      FROM (
        SELECT u.*, row_number() OVER (ORDER BY coalesce(u.co2_cut, 0) + coalesce(u.saving, 0) * 2.5 DESC) AS rn
          FROM (
            SELECT n.node_id, s.strategy_id, s.parameters,
                   round(coalesce(engine.metric_value('ENG_TCE', n.node_id, p_year, v_profile), engine.metric_value('ENG_TCE', n.node_id, p_year - 1, v_profile))
                         * (s.parameters ->> 'saving_rate')::numeric, 1) AS saving,
                   CASE WHEN engine.metric_value('ENG_TCE', n.node_id, p_year, v_profile) IS NULL THEN p_year - 1 ELSE p_year END AS basis_y,
                   round(coalesce(engine.metric_value('CO2_TOTAL', n.node_id, p_year, v_profile), engine.metric_value('CO2_TOTAL', n.node_id, p_year - 1, v_profile)) * coalesce((s.parameters ->> 'carbon_reduction_rate')::numeric,
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

COMMENT ON FUNCTION engine.evaluate_alerts(int, text) IS '执行预警规则，生成预警（含根因贡献）与策略推荐；同比预警每年每项一条；同一规则同一年度旧的未处理预警置为已解决';

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0026', '同比预警按年合并并列出超阈值月份；无当年实际值时策略节能量按上一年估算');
