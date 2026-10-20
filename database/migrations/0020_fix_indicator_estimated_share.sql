-- 0020 修正指标的估值占比：按公式全部输入变量计算（原实现只统计能耗与碳排放数据，统计台账类输入被记为 0）
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。

SET ROLE greensystem;

-- 公式输入中估值（模拟/插值）数据的占比。
--   能耗、碳排放类变量：按折标量（tce）加权
--   统计台账类变量：按数据条数
--   派生量（绿色工厂产值、高企产值）取决于工业总产值
-- 取各类中的最大值，宁可高估也不低估“含模拟数据”的程度。
CREATE OR REPLACE FUNCTION engine.inputs_estimated_share(p_vars text[], p_node bigint, p_year int, p_span int DEFAULT 0)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_energy numeric := 0; v_stat numeric := 0; v_metrics text[];
BEGIN
  IF p_vars && ARRAY['ENG_TCE','ENG_TERMINAL_TCE','ENG_CLEAN_TCE','ENG_RENEWABLE_TCE','CO2_TOTAL'] THEN
    SELECT coalesce(sum(abs(a.tce)) FILTER (WHERE a.data_source IN ('estimated','interpolated')), 0) / nullif(sum(abs(a.tce)), 0)
    INTO v_energy
    FROM fact.energy_activity a
    WHERE a.is_current AND extract(year FROM a.period_month) BETWEEN p_year - p_span AND p_year
      AND a.node_id IN (SELECT engine.accounting_nodes(p_node));
  END IF;

  v_metrics := array(SELECT unnest(p_vars)
                     EXCEPT SELECT unnest(ARRAY['ENG_TCE','ENG_TERMINAL_TCE','ENG_CLEAN_TCE','ENG_RENEWABLE_TCE','CO2_TOTAL']));
  IF v_metrics && ARRAY['ECO_GREEN_FACTORY_OUTPUT','ECO_HIGHTECH_OUTPUT'] THEN
    v_metrics := v_metrics || ARRAY['ECO_GROSS_OUTPUT'];
  END IF;
  IF cardinality(v_metrics) > 0 THEN
    SELECT count(*) FILTER (WHERE s.data_source IN ('estimated','interpolated'))::numeric / nullif(count(*), 0)
    INTO v_stat
    FROM fact.statistic_value s
    WHERE s.is_current AND s.metric_code = ANY (v_metrics)
      AND extract(year FROM s.period_start) BETWEEN p_year - p_span AND p_year
      AND (s.node_id = p_node OR s.node_id IN (SELECT engine.accounting_nodes(p_node)));
  END IF;

  RETURN greatest(coalesce(v_energy, 0), coalesce(v_stat, 0));
END $$;
GRANT EXECUTE ON FUNCTION engine.inputs_estimated_share(text[], bigint, int, int) TO green_app, green_etl;

-- 计算某标准版本下某节点某年度的指标。
-- p_preview = true：允许使用草稿公式，结果只返回、不写入（用于公式审核前的试算）。
CREATE OR REPLACE FUNCTION engine.calc_indicators(p_version text, p_node_code text, p_year int,
                                       p_preview boolean DEFAULT false,
                                       p_params jsonb DEFAULT '{"period_years":3}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ver core.standard_version; v_node bigint; v_run bigint; d record; r jsonb; v numeric; bm record;
  v_ach boolean; v_norm numeric; v_score numeric; v_est numeric; old_id bigint; new_id bigint;
  items jsonb := '[]'::jsonb; warns jsonb := '[]'::jsonb; n_ok int := 0; n_null int := 0; n_skip int := 0;
BEGIN
  SELECT * INTO v_ver FROM core.standard_version WHERE code = p_version;
  IF v_ver.version_id IS NULL THEN RAISE EXCEPTION '标准版本 % 不存在', p_version; END IF;
  SELECT node_id INTO v_node FROM core.org_node WHERE code = p_node_code;
  IF v_node IS NULL THEN RAISE EXCEPTION '节点 % 不存在', p_node_code; END IF;

  IF NOT p_preview THEN
    INSERT INTO fact.calc_run (run_type, version_id, period_from, period_to, node_scope, params)
    SELECT 'indicator', v_ver.version_id, make_date(p_year, 1, 1), make_date(p_year, 12, 31), n.path, p_params
    FROM core.org_node n WHERE n.node_id = v_node
    RETURNING run_id INTO v_run;
  END IF;

  FOR d IN SELECT i.*, f.code AS f_code, f.revision AS f_rev, f.expression, f.status AS f_status, f.variables AS f_vars
           FROM core.indicator_def i LEFT JOIN core.formula f ON f.formula_id = i.formula_id
           WHERE i.version_id = v_ver.version_id AND i.level = 2
           ORDER BY i.seq LOOP
    IF d.handling NOT IN ('calc','deep_calc') OR d.expression IS NULL THEN
      n_skip := n_skip + 1;
      items := items || jsonb_build_object('code', d.code, 'name', d.name, 'status', '录入/自证类指标，不由公式计算');
      CONTINUE;
    END IF;
    IF d.f_status <> 'approved' AND NOT p_preview THEN
      n_skip := n_skip + 1;
      warns := warns || jsonb_build_object('indicator', d.code, 'warning', '公式 ' || d.f_code || ' 尚未审核批准，未计算');
      items := items || jsonb_build_object('code', d.code, 'name', d.name, 'status', '公式待审核');
      CONTINUE;
    END IF;

    r := engine.eval_expr(d.expression, v_node, p_year, p_version, p_params);
    v := (r ->> 'value')::numeric;
    SELECT * INTO bm FROM engine.resolve_benchmark(d.indicator_id, v_node, p_year, p_version);

    v_ach := NULL; v_norm := NULL; v_score := NULL;
    IF v IS NOT NULL AND bm.value IS NOT NULL THEN
      v_ach := CASE bm.comparator WHEN '>=' THEN v >= bm.value WHEN '<=' THEN v <= bm.value END;
      v_norm := CASE WHEN d.direction = 'positive' AND bm.value <> 0 THEN v / bm.value
                     WHEN d.direction IN ('negative','elastic') AND v > 0 THEN bm.value / v END;
    END IF;
    IF v_ver.scoring_method = 'weighted_score' AND v_ach THEN
      v_score := d.score;   -- 官方计分细则未公布：暂按达到判定基准得满分
    END IF;
    -- 估值占比：按公式全部输入变量（能耗、碳排放、统计台账），跨年公式包含基准年
    v_est := engine.inputs_estimated_share(d.f_vars, v_node, p_year,
               CASE WHEN d.expression ~ '\m(cagr|lag)\(' THEN coalesce((p_params ->> 'period_years')::int, 3) ELSE 0 END);

    IF v IS NULL THEN n_null := n_null + 1; ELSE n_ok := n_ok + 1; END IF;
    items := items || jsonb_build_object(
      'code', d.code, 'name', d.name, 'unit', d.unit, 'value', v,
      'benchmark', bm.value, 'comparator', bm.comparator, 'benchmark_inherited', bm.inherited,
      'achieved', v_ach, 'normalized', v_norm, 'score', v_score, 'estimated_share', v_est,
      'formula', d.f_code, 'formula_status', d.f_status, 'missing', r -> 'missing');

    IF NOT p_preview AND v IS NOT NULL THEN
      UPDATE fact.indicator_value SET is_current = false
      WHERE indicator_id = d.indicator_id AND node_id = v_node AND period_type = 'year'
        AND period_start = make_date(p_year, 1, 1) AND is_current
      RETURNING value_id INTO old_id;
      INSERT INTO fact.indicator_value (indicator_id, node_id, period_type, period_start, period_end, value,
                                        normalized, score, achieved, benchmark_id, run_id, input_snapshot, estimated_share)
      VALUES (d.indicator_id, v_node, 'year', make_date(p_year, 1, 1), make_date(p_year, 12, 31), v,
              v_norm, v_score, v_ach, bm.benchmark_id, v_run,
              jsonb_build_object('formula', d.f_code, 'revision', d.f_rev, 'expression', d.expression,
                                 'inputs', r -> 'inputs', 'missing', r -> 'missing',
                                 'benchmark_inherited', bm.inherited, 'benchmark_source', bm.source_doc,
                                 'params', p_params),
              v_est)
      RETURNING value_id INTO new_id;
      IF old_id IS NOT NULL THEN
        UPDATE fact.indicator_value SET superseded_by = new_id WHERE value_id = old_id;
      END IF;
      old_id := NULL;
    ELSIF NOT p_preview AND v IS NULL THEN
      warns := warns || jsonb_build_object('indicator', d.code, 'warning', '缺少输入数据，未得出结果', 'missing', r -> 'missing');
    END IF;
  END LOOP;

  IF NOT p_preview THEN
    UPDATE fact.calc_run SET status = 'succeeded', finished_at = now(), warnings = warns,
           summary = jsonb_build_object('calculated', n_ok, 'no_data', n_null, 'skipped', n_skip)
    WHERE run_id = v_run;
  END IF;

  RETURN jsonb_build_object('run_id', v_run, 'preview', p_preview, 'version', p_version, 'node', p_node_code,
                            'year', p_year, 'calculated', n_ok, 'no_data', n_null, 'skipped', n_skip,
                            'warnings', warns, 'items', items);
END $$;


RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0020', '指标估值占比按公式全部输入计算（含统计台账与跨年基准年）');
