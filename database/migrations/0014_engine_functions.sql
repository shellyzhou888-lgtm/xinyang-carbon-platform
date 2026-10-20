-- 0014 导入解析与计算引擎函数
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。
-- 函数以调用者权限运行（SECURITY INVOKER）：网站账号（green_app）与数据管道（green_etl）各自受自身权限约束。

SET ROLE greensystem;

-- =====================================================================
-- 1. 基础工具
-- =====================================================================

-- 单位换算：同量纲内换算，量纲不同报错
CREATE FUNCTION engine.convert(p_q numeric, p_from text, p_to text) RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
  f_base text; f_mult numeric; t_base text; t_mult numeric;
BEGIN
  IF p_q IS NULL THEN RETURN NULL; END IF;
  IF p_from = p_to THEN RETURN p_q; END IF;
  SELECT coalesce(base_code, code), coalesce(to_base, 1) INTO f_base, f_mult FROM core.unit WHERE code = p_from;
  SELECT coalesce(base_code, code), coalesce(to_base, 1) INTO t_base, t_mult FROM core.unit WHERE code = p_to;
  IF f_base IS NULL OR t_base IS NULL THEN
    RAISE EXCEPTION '未登记的单位：% 或 %', p_from, p_to;
  END IF;
  IF f_base <> t_base THEN
    RAISE EXCEPTION '单位 % 不能换算为 %', p_from, p_to;
  END IF;
  RETURN p_q * f_mult / t_mult;
END $$;

-- 因子选择：只用已批准且有采用值的因子。
--   有指定口径且该口径存在时只在该口径内选；
--   优先生效期覆盖该日期的；否则取早于该日期的最近一条（year_fallback = true）；再否则取最早一条。
CREATE FUNCTION engine.pick_factor(p_kind text, p_energy text, p_at date, p_variant text DEFAULT NULL)
RETURNS TABLE (factor_id bigint, value numeric, unit text, variant text, valid_from date, year_fallback boolean)
LANGUAGE sql STABLE AS $$
  WITH c AS (
    SELECT f.* FROM core.factor f
    WHERE f.factor_kind = p_kind AND f.energy_type_code = p_energy
      AND f.status = 'approved' AND f.value IS NOT NULL
  ), v AS (
    SELECT * FROM c
    WHERE p_variant IS NULL
       OR c.variant = p_variant
       OR NOT EXISTS (SELECT 1 FROM c c2 WHERE c2.variant = p_variant)
  )
  SELECT v.factor_id, v.value, v.unit, v.variant, v.valid_from,
         NOT (p_at >= v.valid_from AND (v.valid_to IS NULL OR p_at <= v.valid_to))
  FROM v
  ORDER BY (p_at >= v.valid_from AND (v.valid_to IS NULL OR p_at <= v.valid_to)) DESC,
           (v.valid_from <= p_at) DESC,
           CASE WHEN v.valid_from <= p_at THEN v.valid_from END DESC NULLS LAST,
           v.valid_from ASC,
           (v.variant = 'default') DESC,
           v.factor_id
  LIMIT 1
$$;

-- 核算单元：汇总时只累加企业和公共区域；厂区、产线、设备的数据只用于分项与溯源。
-- 若查询对象本身是厂区、产线或设备，则只取该节点自身。
CREATE FUNCTION engine.accounting_nodes(p_node bigint) RETURNS SETOF bigint
LANGUAGE sql STABLE AS $$
  SELECT n.node_id
  FROM core.org_node p
  JOIN core.org_node n ON n.path <@ p.path
  WHERE p.node_id = p_node AND n.is_active
    AND p.node_type IN ('park','zone','public_area','enterprise')
    AND n.node_type IN ('enterprise','public_area')
  UNION
  SELECT p.node_id FROM core.org_node p
  WHERE p.node_id = p_node AND p.node_type IN ('site','line','equipment')
$$;

CREATE FUNCTION engine.parse_number(p_txt text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text := regexp_replace(coalesce(p_txt, ''), '[,，\s]', '', 'g');
BEGIN
  IF s = '' THEN RETURN NULL; END IF;
  IF s !~ '^-?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$' THEN
    RAISE EXCEPTION '“%”不是有效数字', p_txt;
  END IF;
  RETURN s::numeric;
END $$;

-- 期间解析：2025-03、2025/3、2025年3月、2025-03-01T00:00:00 等
CREATE FUNCTION engine.parse_month(p_txt text) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m text[];
BEGIN
  m := regexp_match(btrim(coalesce(p_txt, '')), '^(\d{4})\D+(\d{1,2})');
  IF m IS NULL OR m[2]::int NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION '“%”不是有效年月（应为 YYYY-MM）', p_txt;
  END IF;
  RETURN make_date(m[1]::int, m[2]::int, 1);
END $$;

CREATE FUNCTION engine.parse_year(p_txt text) RETURNS int
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m text[];
BEGIN
  m := regexp_match(btrim(coalesce(p_txt, '')), '^(\d{4})');
  IF m IS NULL THEN RAISE EXCEPTION '“%”不是有效年份', p_txt; END IF;
  RETURN m[1]::int;
END $$;

-- =====================================================================
-- 2. 导入：原始行 → 事实表
-- =====================================================================

-- 企业匹配：先统一社会信用代码，后企业名称（企业档案法定名称或对象树名称）
CREATE FUNCTION engine.resolve_node(p_credit text, p_name text) RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
DECLARE v_id bigint; v_cnt int;
BEGIN
  IF nullif(btrim(p_credit), '') IS NOT NULL THEN
    SELECT node_id INTO v_id FROM core.enterprise_profile WHERE credit_code = btrim(p_credit);
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  IF nullif(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION '缺少企业名称或统一社会信用代码';
  END IF;
  SELECT count(*), min(n.node_id) INTO v_cnt, v_id
  FROM core.org_node n LEFT JOIN core.enterprise_profile e USING (node_id)
  WHERE n.is_active AND n.node_type IN ('enterprise','public_area')
    AND (e.legal_name = btrim(p_name) OR n.name = btrim(p_name));
  IF v_cnt = 0 THEN
    RAISE EXCEPTION '未找到企业“%”，请先在后台登记企业或填写统一社会信用代码', p_name;
  ELSIF v_cnt > 1 THEN
    RAISE EXCEPTION '企业名称“%”匹配到多个对象，请填写统一社会信用代码', p_name;
  END IF;
  RETURN v_id;
END $$;

-- 能源活动写入：同一节点、月份、品种、流向、用途只保留一条当前数据；旧数据置为历史
-- 返回：inserted / replaced / unchanged / kept_real（估值不覆盖真实数据）
CREATE FUNCTION engine.upsert_energy(p_node bigint, p_month date, p_energy text, p_flow text, p_use text,
                                     p_q numeric, p_unit text, p_source text, p_batch bigint, p_record bigint, p_note text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE old record; new_id bigint;
BEGIN
  SELECT activity_id, quantity, unit, data_source INTO old
  FROM fact.energy_activity
  WHERE node_id = p_node AND period_month = p_month AND energy_type_code = p_energy
    AND flow = p_flow AND use_type = p_use AND is_current
  FOR UPDATE;
  IF FOUND THEN
    IF p_source IN ('estimated','interpolated') AND old.data_source IN ('measured','manual') THEN
      RETURN 'kept_real';
    END IF;
    IF old.quantity = p_q AND old.unit = p_unit AND old.data_source = p_source THEN
      RETURN 'unchanged';
    END IF;
    UPDATE fact.energy_activity SET is_current = false WHERE activity_id = old.activity_id;
  END IF;
  INSERT INTO fact.energy_activity (node_id, period_month, energy_type_code, flow, use_type, quantity, unit,
                                    data_source, batch_id, record_id, note)
  VALUES (p_node, p_month, p_energy, p_flow, p_use, p_q, p_unit, p_source, p_batch, p_record, p_note)
  RETURNING activity_id INTO new_id;
  IF old.activity_id IS NOT NULL THEN
    UPDATE fact.energy_activity SET superseded_by = new_id WHERE activity_id = old.activity_id;
    RETURN 'replaced';
  END IF;
  RETURN 'inserted';
END $$;

-- 统计台账写入，规则同上
CREATE FUNCTION engine.upsert_stat(p_node bigint, p_ptype text, p_pstart date, p_metric text, p_dim text,
                                   p_value numeric, p_unit text, p_source text, p_batch bigint, p_record bigint,
                                   p_attrs jsonb)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE old record; new_id bigint;
BEGIN
  SELECT stat_id, value, unit, data_source INTO old
  FROM fact.statistic_value
  WHERE node_id = p_node AND period_type = p_ptype AND period_start = p_pstart
    AND metric_code = p_metric AND dim_code = coalesce(p_dim, '') AND is_current
  FOR UPDATE;
  IF FOUND THEN
    IF p_source IN ('estimated','interpolated') AND old.data_source IN ('measured','manual') THEN
      RETURN 'kept_real';
    END IF;
    IF old.value = p_value AND old.unit = p_unit AND old.data_source = p_source THEN
      RETURN 'unchanged';
    END IF;
    UPDATE fact.statistic_value SET is_current = false WHERE stat_id = old.stat_id;
  END IF;
  INSERT INTO fact.statistic_value (node_id, period_type, period_start, metric_code, dim_code, value, unit,
                                    data_source, batch_id, record_id, attributes)
  VALUES (p_node, p_ptype, p_pstart, p_metric, coalesce(p_dim, ''), p_value, p_unit, p_source, p_batch, p_record,
          coalesce(p_attrs, '{}'::jsonb))
  RETURNING stat_id INTO new_id;
  IF old.stat_id IS NOT NULL THEN
    UPDATE fact.statistic_value SET superseded_by = new_id WHERE stat_id = old.stat_id;
    RETURN 'replaced';
  END IF;
  RETURN 'inserted';
END $$;

-- 解析一个导入批次。每行单独成功或失败（失败行回滚该行写入并记录原因），不影响其他行。
CREATE FUNCTION engine.load_batch(p_batch bigint) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  b raw.import_batch; t core.import_template; rec raw.import_record; m record;
  f_credit text; f_name text; f_period text; f_source text; f_note text; f_dim text; f_unit text;
  v_node bigint; v_month date; v_year int; v_src text; v_txt text; v_q numeric; v_flow text; v_unit text;
  v_attrs jsonb; v_res text; v_written int; v_map jsonb; v_bool boolean;
  n_ok int := 0; n_err int := 0; n_skip int := 0;
  results jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO b FROM raw.import_batch WHERE batch_id = p_batch FOR UPDATE;
  IF b.batch_id IS NULL THEN RAISE EXCEPTION '批次 % 不存在', p_batch; END IF;
  SELECT * INTO t FROM core.import_template WHERE template_id = b.template_id;
  IF t.template_id IS NULL THEN
    UPDATE raw.import_batch SET status = 'raw_only' WHERE batch_id = p_batch;
    RETURN jsonb_build_object('batch_id', p_batch, 'status', 'raw_only');
  END IF;

  -- 公共字段对应的列名
  SELECT max(source_field) FILTER (WHERE target_field = 'node_credit_code'),
         max(source_field) FILTER (WHERE target_field = 'node_name'),
         max(source_field) FILTER (WHERE target_field IN ('period_month','period_year')),
         max(source_field) FILTER (WHERE target_field = 'data_source'),
         max(source_field) FILTER (WHERE target_field = 'note'),
         max(source_field) FILTER (WHERE target_field = 'dim_code'),
         max(source_field) FILTER (WHERE target_field = 'unit')
  INTO f_credit, f_name, f_period, f_source, f_note, f_dim, f_unit
  FROM core.import_field_map WHERE template_id = t.template_id;

  FOR rec IN SELECT * FROM raw.import_record WHERE batch_id = p_batch AND parse_status = 'pending' ORDER BY row_no LOOP
    BEGIN
      v_written := 0;
      v_node := engine.resolve_node(rec.payload ->> f_credit, rec.payload ->> f_name);

      -- 数据来源：模板下拉值映射；未填时按批次来源推断
      SELECT transform -> 'value_map' INTO v_map FROM core.import_field_map
      WHERE template_id = t.template_id AND target_field = 'data_source';
      v_src := v_map ->> btrim(coalesce(rec.payload ->> f_source, ''));
      IF v_src IS NULL THEN
        IF nullif(btrim(coalesce(rec.payload ->> f_source, '')), '') IS NOT NULL THEN
          RAISE EXCEPTION '数据来源“%”不在下拉选项中', rec.payload ->> f_source;
        END IF;
        v_src := CASE b.source_type WHEN 'estimated' THEN 'estimated' WHEN 'api' THEN 'measured' ELSE 'manual' END;
      END IF;

      IF t.target = 'energy_activity' THEN
        v_month := engine.parse_month(rec.payload ->> f_period);
        FOR m IN SELECT * FROM core.import_field_map
                 WHERE template_id = t.template_id AND energy_type_code IS NOT NULL ORDER BY map_id LOOP
          v_q := engine.parse_number(rec.payload ->> m.source_field);
          CONTINUE WHEN v_q IS NULL;
          IF v_q < 0 THEN RAISE EXCEPTION '“%”不能为负数', m.source_field; END IF;
          v_q := v_q * coalesce((m.transform ->> 'multiply')::numeric, 1);
          v_flow := coalesce(m.transform ->> 'flow', 'consumption');
          v_res := engine.upsert_energy(v_node, v_month, m.energy_type_code, v_flow, 'fuel', v_q, m.unit_code,
                                        v_src, p_batch, rec.record_id, rec.payload ->> f_note);
          results := jsonb_set(results, ARRAY[v_res], to_jsonb(coalesce((results ->> v_res)::int, 0) + 1));
          v_written := v_written + 1;
        END LOOP;

      ELSIF t.target = 'statistic_value' THEN
        v_year := engine.parse_year(rec.payload ->> f_period);
        -- 附加属性列（attributes.xxx）
        SELECT coalesce(jsonb_object_agg(substr(target_field, 12), rec.payload ->> source_field)
                        FILTER (WHERE nullif(btrim(coalesce(rec.payload ->> source_field, '')), '') IS NOT NULL), '{}'::jsonb)
        INTO v_attrs
        FROM core.import_field_map WHERE template_id = t.template_id AND target_field LIKE 'attributes.%';
        -- 行内单位（产品产量表）
        v_unit := nullif(btrim(coalesce(rec.payload ->> f_unit, '')), '');
        IF f_unit IS NOT NULL AND v_unit IS NOT NULL AND NOT EXISTS (SELECT 1 FROM core.unit WHERE code = v_unit) THEN
          RAISE EXCEPTION '计量单位“%”未登记，请联系管理员添加', v_unit;
        END IF;
        IF f_dim IS NOT NULL AND nullif(btrim(coalesce(rec.payload ->> f_dim, '')), '') IS NULL THEN
          RAISE EXCEPTION '缺少“%”', f_dim;
        END IF;

        FOR m IN SELECT fm.*, md.unit AS metric_unit FROM core.import_field_map fm
                 JOIN core.metric_def md ON md.code = fm.metric_code
                 WHERE fm.template_id = t.template_id ORDER BY fm.map_id LOOP
          v_q := engine.parse_number(rec.payload ->> m.source_field);
          CONTINUE WHEN v_q IS NULL;
          v_q := v_q * coalesce((m.transform ->> 'multiply')::numeric, 1);
          v_res := engine.upsert_stat(v_node, 'year', make_date(v_year, 1, 1), m.metric_code,
                                      CASE WHEN f_dim IS NOT NULL THEN btrim(rec.payload ->> f_dim) ELSE '' END,
                                      v_q, coalesce(v_unit, m.unit_code, m.metric_unit), v_src, p_batch, rec.record_id, v_attrs);
          results := jsonb_set(results, ARRAY[v_res], to_jsonb(coalesce((results ->> v_res)::int, 0) + 1));
          v_written := v_written + 1;
        END LOOP;

        -- 企业档案字段（是否规上、是否高企、高企证书编号）
        FOR m IN SELECT * FROM core.import_field_map
                 WHERE template_id = t.template_id AND target_field LIKE 'enterprise_profile.%' LOOP
          v_txt := nullif(btrim(coalesce(rec.payload ->> m.source_field, '')), '');
          CONTINUE WHEN v_txt IS NULL;
          INSERT INTO core.enterprise_profile (node_id, legal_name)
          SELECT n.node_id, n.name FROM core.org_node n WHERE n.node_id = v_node
          ON CONFLICT (node_id) DO NOTHING;
          IF m.target_field = 'enterprise_profile.high_tech_cert_no' THEN
            UPDATE core.enterprise_profile SET high_tech_cert_no = v_txt, updated_at = now() WHERE node_id = v_node;
          ELSE
            v_bool := (m.transform -> 'value_map' ->> v_txt)::boolean;
            IF v_bool IS NULL THEN RAISE EXCEPTION '“%”应填写 是 或 否', m.source_field; END IF;
            IF m.target_field = 'enterprise_profile.is_above_scale' THEN
              UPDATE core.enterprise_profile SET is_above_scale = v_bool, updated_at = now() WHERE node_id = v_node;
            ELSIF m.target_field = 'enterprise_profile.is_high_tech' THEN
              UPDATE core.enterprise_profile SET is_high_tech = v_bool, updated_at = now() WHERE node_id = v_node;
            END IF;
          END IF;
          v_written := v_written + 1;
        END LOOP;
      ELSE
        RAISE EXCEPTION '模板目标 % 暂不支持自动解析', t.target;
      END IF;

      UPDATE raw.import_record
      SET parse_status = CASE WHEN v_written > 0 THEN 'ok' ELSE 'skipped' END,
          error_message = CASE WHEN v_written > 0 THEN NULL ELSE '该行没有可写入的数值' END,
          target_table = t.target
      WHERE record_id = rec.record_id;
      IF v_written > 0 THEN n_ok := n_ok + 1; ELSE n_skip := n_skip + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE raw.import_record SET parse_status = 'error', error_message = SQLERRM WHERE record_id = rec.record_id;
      n_err := n_err + 1;
    END;
  END LOOP;

  UPDATE raw.import_batch
  SET status = CASE WHEN n_err = 0 THEN 'loaded' WHEN n_ok > 0 THEN 'partially_loaded' ELSE 'rejected' END,
      row_count = n_ok + n_err + n_skip, error_count = n_err
  WHERE batch_id = p_batch;

  RETURN jsonb_build_object('batch_id', p_batch, 'rows_ok', n_ok, 'rows_error', n_err, 'rows_skipped', n_skip,
                            'values', results,
                            'errors', (SELECT coalesce(jsonb_agg(jsonb_build_object('row', row_no, 'error', error_message) ORDER BY row_no), '[]'::jsonb)
                                       FROM raw.import_record WHERE batch_id = p_batch AND parse_status = 'error'));
END $$;

-- =====================================================================
-- 3. 计算：折标准煤、碳排放
-- =====================================================================

CREATE FUNCTION engine.calc_energy(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  r record; f record; v_q numeric; v_run bigint; n_ok int := 0; n_miss int := 0;
  missing jsonb := '{}'::jsonb;
BEGIN
  INSERT INTO fact.calc_run (run_type, period_from, period_to)
  VALUES ('energy', p_from, p_to) RETURNING run_id INTO v_run;

  FOR r IN SELECT a.activity_id, a.energy_type_code, a.quantity, a.unit, a.period_month, t.default_unit
           FROM fact.energy_activity a JOIN core.energy_type t ON t.code = a.energy_type_code
           WHERE a.is_current AND a.period_month BETWEEN p_from AND p_to LOOP
    v_q := engine.convert(r.quantity, r.unit, r.default_unit);
    SELECT * INTO f FROM engine.pick_factor('std_coal', r.energy_type_code, r.period_month, NULL);
    IF f.factor_id IS NULL THEN
      UPDATE fact.energy_activity SET quantity_std = v_q, tce = NULL, std_coal_factor_id = NULL
      WHERE activity_id = r.activity_id;
      missing := jsonb_set(missing, ARRAY[r.energy_type_code], to_jsonb(coalesce((missing ->> r.energy_type_code)::int, 0) + 1));
      n_miss := n_miss + 1;
      CONTINUE;
    END IF;
    -- 折标系数单位为 kgce/X：先把用量换算到 X，再 ÷1000 得到 tce
    UPDATE fact.energy_activity
    SET quantity_std = v_q,
        tce = engine.convert(v_q, r.default_unit, split_part(f.unit, '/', 2)) * f.value / 1000,
        std_coal_factor_id = f.factor_id
    WHERE activity_id = r.activity_id;
    n_ok := n_ok + 1;
  END LOOP;

  UPDATE fact.calc_run
  SET status = 'succeeded', finished_at = now(),
      warnings = CASE WHEN n_miss > 0 THEN jsonb_build_array(jsonb_build_object(
                   'warning', '以下能源没有已批准的折标准煤系数，未计入综合能耗', 'rows_by_energy', missing))
                 ELSE '[]'::jsonb END,
      summary = jsonb_build_object('rows_converted', n_ok, 'rows_missing_factor', n_miss)
  WHERE run_id = v_run;
  RETURN jsonb_build_object('run_id', v_run, 'rows_converted', n_ok, 'rows_missing_factor', n_miss, 'missing_by_energy', missing);
END $$;

-- 碳核算（910 号文附件4 口径）：燃料燃烧 + 电力净受入 + 热力净受入；送出、上网记负值；
-- 用作原料的能源和可再生燃料（生物质、沼气）不计燃烧排放。因子按 p_profile 对应标准版本的偏好选择。
CREATE FUNCTION engine.calc_carbon(p_profile text, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_ver core.standard_version; r record; f record; ncv record; v_run bigint;
  v_sign int; v_cat text; v_co2 numeric; v_pref text; v_num text; v_den text;
  n_ok int := 0; n_skip int := 0; n_miss int := 0;
  missing jsonb := '{}'::jsonb; fallback jsonb := '{}'::jsonb; v_key text;
BEGIN
  SELECT * INTO v_ver FROM core.standard_version WHERE code = p_profile;
  IF v_ver.version_id IS NULL THEN RAISE EXCEPTION '标准版本 % 不存在', p_profile; END IF;

  INSERT INTO fact.calc_run (run_type, version_id, period_from, period_to, params)
  VALUES ('carbon', v_ver.version_id, p_from, p_to, jsonb_build_object('profile', p_profile, 'factor_preferences', v_ver.factor_preferences))
  RETURNING run_id INTO v_run;

  -- 对应的能源活动已被替换的结果，置为历史
  UPDATE fact.carbon_emission e SET is_current = false
  FROM fact.energy_activity a
  WHERE e.activity_id = a.activity_id AND e.is_current AND NOT a.is_current AND e.profile_code = p_profile;

  FOR r IN SELECT a.*, t.category, t.default_unit
           FROM fact.energy_activity a JOIN core.energy_type t ON t.code = a.energy_type_code
           WHERE a.is_current AND a.period_month BETWEEN p_from AND p_to LOOP
    IF r.use_type = 'raw_material' OR r.category IN ('renewable_fuel','water','other') OR r.flow = 'generation' THEN
      n_skip := n_skip + 1;
      CONTINUE;
    END IF;
    v_sign := CASE WHEN r.flow IN ('send_out','feed_in') THEN -1 ELSE 1 END;
    v_cat := CASE r.category WHEN 'electricity' THEN 'indirect_electricity'
                             WHEN 'heat' THEN 'indirect_heat'
                             ELSE 'fuel_combustion' END;
    v_pref := v_ver.factor_preferences ->> r.energy_type_code;
    v_co2 := NULL;

    SELECT * INTO f FROM engine.pick_factor('co2_per_unit', r.energy_type_code, r.period_month, v_pref);
    IF f.factor_id IS NOT NULL THEN
      v_num := split_part(f.unit, '/', 1);
      v_den := split_part(f.unit, '/', 2);
      v_co2 := engine.convert(r.quantity_std, r.default_unit, v_den) * f.value
               * CASE v_num WHEN 'kgCO2' THEN 0.001 WHEN 'tCO2' THEN 1 END * v_sign;
    ELSE
      -- 回退：低位发热量 × 单位热值排放因子
      SELECT * INTO f FROM engine.pick_factor('co2_per_tj', r.energy_type_code, r.period_month, v_pref);
      SELECT * INTO ncv FROM engine.pick_factor('ncv', r.energy_type_code, r.period_month, v_pref);
      IF f.factor_id IS NOT NULL AND ncv.factor_id IS NOT NULL THEN
        v_co2 := engine.convert(r.quantity_std, r.default_unit, split_part(ncv.unit, '/', 2)) * ncv.value * 1e-9 * f.value * v_sign;
      END IF;
    END IF;

    IF v_co2 IS NULL OR r.quantity_std IS NULL THEN
      missing := jsonb_set(missing, ARRAY[r.energy_type_code], to_jsonb(coalesce((missing ->> r.energy_type_code)::int, 0) + 1));
      n_miss := n_miss + 1;
      CONTINUE;
    END IF;

    IF f.year_fallback THEN
      v_key := r.energy_type_code || ':' || f.variant || ':' || extract(year FROM r.period_month) || '→' || extract(year FROM f.valid_from);
      fallback := jsonb_set(fallback, ARRAY[v_key], to_jsonb(coalesce((fallback ->> v_key)::int, 0) + 1));
    END IF;

    UPDATE fact.carbon_emission SET is_current = false
    WHERE profile_code = p_profile AND activity_id = r.activity_id AND is_current;
    INSERT INTO fact.carbon_emission (run_id, profile_code, node_id, period_month, category, energy_type_code, activity_id,
                                      activity_quantity, factor_id, co2_t, estimated_share)
    VALUES (v_run, p_profile, r.node_id, r.period_month, v_cat, r.energy_type_code, r.activity_id,
            r.quantity_std, f.factor_id, v_co2,
            CASE WHEN r.data_source IN ('estimated','interpolated') THEN 1 ELSE 0 END);
    n_ok := n_ok + 1;
  END LOOP;

  UPDATE fact.calc_run
  SET status = 'succeeded', finished_at = now(),
      warnings = (CASE WHEN n_miss > 0 THEN jsonb_build_array(jsonb_build_object(
                    'warning', '以下能源缺少已批准的排放因子或折标结果，未计入碳排放', 'rows_by_energy', missing))
                  ELSE '[]'::jsonb END)
              || (CASE WHEN fallback <> '{}'::jsonb THEN jsonb_build_array(jsonb_build_object(
                    'warning', '该年份尚无已发布的因子，暂用最近一年的因子（能源:口径:数据年份→因子年份）', 'rows', fallback))
                  ELSE '[]'::jsonb END),
      summary = jsonb_build_object('rows_calculated', n_ok, 'rows_not_applicable', n_skip, 'rows_missing_factor', n_miss)
  WHERE run_id = v_run;

  RETURN jsonb_build_object('run_id', v_run, 'profile', p_profile, 'rows_calculated', n_ok,
                            'rows_not_applicable', n_skip, 'rows_missing_factor', n_miss,
                            'missing_by_energy', missing, 'factor_year_fallback', fallback);
END $$;

-- =====================================================================
-- 4. 基础量取值
-- =====================================================================

-- 能源与碳汇总：只累加核算单元；无数据返回 NULL（区别于 0）
CREATE FUNCTION engine.energy_metric(p_code text, p_node bigint, p_from date, p_to date, p_profile text)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE v numeric; n int;
BEGIN
  IF p_code = 'CO2_TOTAL' THEN
    SELECT sum(e.co2_t), count(*) INTO v, n
    FROM fact.carbon_emission e
    WHERE e.is_current AND e.profile_code = p_profile AND e.period_month BETWEEN p_from AND p_to
      AND e.node_id IN (SELECT engine.accounting_nodes(p_node));
  ELSE
    SELECT sum(CASE a.flow WHEN 'send_out' THEN -a.tce WHEN 'consumption' THEN a.tce WHEN 'receive' THEN a.tce ELSE 0 END),
           count(*) FILTER (WHERE a.tce IS NOT NULL)
    INTO v, n
    FROM fact.energy_activity a JOIN core.energy_type t ON t.code = a.energy_type_code
    WHERE a.is_current AND a.period_month BETWEEN p_from AND p_to
      AND a.node_id IN (SELECT engine.accounting_nodes(p_node))
      AND (p_code IN ('ENG_TCE','ENG_TERMINAL_TCE')
           OR (p_code = 'ENG_CLEAN_TCE' AND t.is_clean)
           OR (p_code = 'ENG_RENEWABLE_TCE' AND t.is_renewable));
    IF p_code IN ('ENG_CLEAN_TCE','ENG_RENEWABLE_TCE') AND n = 0 THEN
      -- 有能源数据但没有清洁/可再生能源时返回 0，而不是“缺数据”
      SELECT count(*) INTO n FROM fact.energy_activity a
      WHERE a.is_current AND a.period_month BETWEEN p_from AND p_to AND a.tce IS NOT NULL
        AND a.node_id IN (SELECT engine.accounting_nodes(p_node));
      IF n > 0 THEN RETURN 0; END IF;
    END IF;
  END IF;
  RETURN CASE WHEN n > 0 THEN v END;
END $$;

-- 单个节点自身的年度统计值：优先年度数据，其次按月汇总
CREATE FUNCTION engine.node_stat(p_code text, p_node bigint, p_year int, p_dim text)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE v numeric; agg text; n int;
BEGIN
  SELECT value INTO v FROM fact.statistic_value
  WHERE node_id = p_node AND metric_code = p_code AND dim_code = coalesce(p_dim, '')
    AND period_type = 'year' AND period_start = make_date(p_year, 1, 1) AND is_current;
  IF v IS NOT NULL THEN RETURN v; END IF;
  SELECT aggregation INTO agg FROM core.metric_def WHERE code = p_code;
  SELECT CASE agg WHEN 'avg' THEN avg(value) WHEN 'max' THEN max(value)
                  WHEN 'last' THEN (array_agg(value ORDER BY period_start DESC))[1]
                  ELSE sum(value) END, count(*)
  INTO v, n
  FROM fact.statistic_value
  WHERE node_id = p_node AND metric_code = p_code AND dim_code = coalesce(p_dim, '')
    AND period_type = 'month' AND extract(year FROM period_start) = p_year AND is_current;
  RETURN CASE WHEN n > 0 THEN v END;
END $$;

-- 统计量：节点自身有数据（如园区上报值）优先；否则累加下属核算单元
CREATE FUNCTION engine.stat_value(p_code text, p_node bigint, p_year int, p_dim text DEFAULT '')
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE v numeric; total numeric; n int := 0; x numeric; nid bigint;
BEGIN
  v := engine.node_stat(p_code, p_node, p_year, p_dim);
  IF v IS NOT NULL THEN RETURN v; END IF;
  FOR nid IN SELECT engine.accounting_nodes(p_node) LOOP
    CONTINUE WHEN nid = p_node;
    x := engine.node_stat(p_code, nid, p_year, p_dim);
    IF x IS NOT NULL THEN total := coalesce(total, 0) + x; n := n + 1; END IF;
  END LOOP;
  RETURN CASE WHEN n > 0 THEN total END;
END $$;

-- 基础量统一入口
CREATE FUNCTION engine.metric_value(p_code text, p_node bigint, p_year int, p_profile text, p_dim text DEFAULT '')
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE v numeric; total numeric; n int := 0; nid bigint; x numeric;
BEGIN
  IF p_code IN ('ENG_TCE','ENG_TERMINAL_TCE','ENG_CLEAN_TCE','ENG_RENEWABLE_TCE','CO2_TOTAL') THEN
    RETURN engine.energy_metric(p_code, p_node, make_date(p_year, 1, 1), make_date(p_year, 12, 1), p_profile);
  END IF;

  IF p_code = 'ECO_GREEN_FACTORY_OUTPUT' THEN
    v := engine.node_stat(p_code, p_node, p_year, '');
    IF v IS NOT NULL THEN RETURN v; END IF;
    -- 省级及以上绿色工厂（获评年份不晚于统计年份）的工业总产值之和
    FOR nid IN SELECT DISTINCT h.node_id FROM core.honor h
               WHERE h.honor_type = 'green_factory' AND h.level IN ('national','provincial')
                 AND h.counts_for_indicator AND coalesce(h.year, 0) <= p_year
                 AND h.node_id IN (SELECT engine.accounting_nodes(p_node)) LOOP
      x := engine.node_stat('ECO_GROSS_OUTPUT', nid, p_year, '');
      IF x IS NOT NULL THEN total := coalesce(total, 0) + x; n := n + 1; END IF;
    END LOOP;
    -- 有总产值数据但没有绿色工厂时为 0
    IF n = 0 AND engine.stat_value('ECO_GROSS_OUTPUT', p_node, p_year, '') IS NOT NULL THEN RETURN 0; END IF;
    RETURN total;
  END IF;

  IF p_code = 'ECO_HIGHTECH_OUTPUT' THEN
    v := engine.node_stat(p_code, p_node, p_year, '');
    IF v IS NOT NULL THEN RETURN v; END IF;
    FOR nid IN SELECT e.node_id FROM core.enterprise_profile e
               WHERE e.is_high_tech AND e.node_id IN (SELECT engine.accounting_nodes(p_node)) LOOP
      x := engine.node_stat('ECO_GROSS_OUTPUT', nid, p_year, '');
      IF x IS NOT NULL THEN total := coalesce(total, 0) + x; n := n + 1; END IF;
    END LOOP;
    IF n = 0 AND engine.stat_value('ECO_GROSS_OUTPUT', p_node, p_year, '') IS NOT NULL THEN RETURN 0; END IF;
    RETURN total;
  END IF;

  RETURN engine.stat_value(p_code, p_node, p_year, p_dim);
END $$;

-- =====================================================================
-- 5. 公式求值
-- =====================================================================
-- 表达式记法：基础量编码；cagr(X, n) n 年年均增长率；lag(X, n) n 年前的值；
-- avg_dim(X, 维度类型) 对该维度（如污染物）逐一求值后取平均；参数名（如 period_years）从 p_params 取值。
-- 返回 {"value": 数值或 null, "inputs": {"编码@年份[#维度]": 值}, "missing": [...]}

CREATE FUNCTION engine.eval_expr(p_expr text, p_node bigint, p_year int, p_profile text,
                                 p_params jsonb DEFAULT '{}'::jsonb, p_dim text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  e text := p_expr; pos int; fname text; depth int; i int; ch text; args text[]; argstart int; close_pos int;
  n int; a jsonb; b jsonb; va numeric; vb numeric; v numeric; res numeric; v_key text; tok text;
  inputs jsonb := '{}'::jsonb; missing jsonb := '[]'::jsonb; dims text[]; d text; acc numeric; cnt int;
  pk text; pv text; check_e text;
BEGIN
  -- 1) 逐个展开函数调用（由左至右，嵌套调用递归求值）
  LOOP
    pos := regexp_instr(e, '(cagr|lag|avg_dim)\(');
    EXIT WHEN pos = 0;
    fname := substring(e FROM pos FOR strpos(substr(e, pos), '(') - 1);
    depth := 0; args := '{}'; argstart := pos + length(fname) + 1; close_pos := NULL;
    FOR i IN (pos + length(fname)) .. length(e) LOOP
      ch := substr(e, i, 1);
      IF ch = '(' THEN
        depth := depth + 1;
      ELSIF ch = ')' THEN
        depth := depth - 1;
        IF depth = 0 THEN
          args := args || btrim(substr(e, argstart, i - argstart));
          close_pos := i;
          EXIT;
        END IF;
      ELSIF ch = ',' AND depth = 1 THEN
        args := args || btrim(substr(e, argstart, i - argstart));
        argstart := i + 1;
      END IF;
    END LOOP;
    IF close_pos IS NULL THEN RAISE EXCEPTION '公式括号不匹配：%', p_expr; END IF;

    v := NULL;
    IF fname IN ('cagr','lag') THEN
      n := CASE WHEN args[2] ~ '^\d+$' THEN args[2]::int ELSE (p_params ->> args[2])::int END;
      IF n IS NULL OR n <= 0 THEN RAISE EXCEPTION '% 的年数参数无效：%', fname, args[2]; END IF;
    END IF;

    IF fname = 'lag' THEN
      a := engine.eval_expr(args[1], p_node, p_year - n, p_profile, p_params, p_dim);
      v := (a ->> 'value')::numeric;
      inputs := inputs || (a -> 'inputs'); missing := missing || (a -> 'missing');
    ELSIF fname = 'cagr' THEN
      a := engine.eval_expr(args[1], p_node, p_year, p_profile, p_params, p_dim);
      b := engine.eval_expr(args[1], p_node, p_year - n, p_profile, p_params, p_dim);
      inputs := inputs || (a -> 'inputs') || (b -> 'inputs');
      missing := missing || (a -> 'missing') || (b -> 'missing');
      va := (a ->> 'value')::numeric; vb := (b ->> 'value')::numeric;
      IF va IS NOT NULL AND vb IS NOT NULL AND va > 0 AND vb > 0 THEN
        v := power(va / vb, 1.0 / n) - 1;
      END IF;
    ELSIF fname = 'avg_dim' THEN
      SELECT array_agg(DISTINCT s.dim_code) INTO dims
      FROM fact.statistic_value s JOIN core.metric_def md ON md.code = s.metric_code
      WHERE md.dim_kind = args[2] AND s.is_current AND s.dim_code <> ''
        AND (s.node_id = p_node OR s.node_id IN (SELECT engine.accounting_nodes(p_node)));
      acc := 0; cnt := 0;
      FOREACH d IN ARRAY coalesce(dims, '{}'::text[]) LOOP
        a := engine.eval_expr(args[1], p_node, p_year, p_profile, p_params, d);
        inputs := inputs || (a -> 'inputs'); missing := missing || (a -> 'missing');
        IF (a ->> 'value') IS NOT NULL THEN acc := acc + (a ->> 'value')::numeric; cnt := cnt + 1; END IF;
      END LOOP;
      IF cnt > 0 THEN v := acc / cnt; ELSE missing := missing || to_jsonb(args[2] || ' 维度无数据'); END IF;
    END IF;

    e := substr(e, 1, pos - 1) || CASE WHEN v IS NULL THEN 'NULL::numeric' ELSE '(' || v::text || ')' END || substr(e, close_pos + 1);
  END LOOP;

  -- 2) 参数替换
  FOR pk, pv IN SELECT j.key, j.value FROM jsonb_each_text(p_params) AS j LOOP
    e := regexp_replace(e, '\m' || pk || '\M', '(' || pv || ')', 'g');
  END LOOP;

  -- 3) 基础量替换
  FOR tok IN SELECT DISTINCT m[1] FROM regexp_matches(e, '\m([A-Z][A-Z0-9_]{2,})\M', 'g') AS m LOOP
    CONTINUE WHEN tok = 'NULL';
    IF NOT EXISTS (SELECT 1 FROM core.metric_def WHERE code = tok) THEN
      RAISE EXCEPTION '公式中的变量 % 不是已登记的基础量', tok;
    END IF;
    v := engine.metric_value(tok, p_node, p_year, p_profile,
                             CASE WHEN (SELECT dim_kind FROM core.metric_def WHERE code = tok) IS NOT NULL THEN p_dim ELSE '' END);
    v_key := tok || '@' || p_year || CASE WHEN p_dim <> '' AND (SELECT dim_kind FROM core.metric_def WHERE code = tok) IS NOT NULL
                                        THEN '#' || p_dim ELSE '' END;
    inputs := inputs || jsonb_build_object(v_key, v);
    IF v IS NULL THEN missing := missing || to_jsonb(v_key); END IF;
    e := regexp_replace(e, '\m' || tok || '\M', CASE WHEN v IS NULL THEN 'NULL::numeric' ELSE '(' || v::text || ')' END, 'g');
  END LOOP;

  -- 4) 安全检查：只允许数字、运算符、括号、NULL::numeric 与 power
  check_e := regexp_replace(e, '(NULL::numeric|\mpower\M)', '', 'g');
  IF check_e !~ '^[0-9.\s()+*/,-]*$' THEN
    RAISE EXCEPTION '公式展开后含非法内容：%', e;
  END IF;

  BEGIN
    EXECUTE 'SELECT (' || e || ')::numeric' INTO res;
  EXCEPTION WHEN division_by_zero OR invalid_argument_for_power_function OR numeric_value_out_of_range THEN
    res := NULL;
    missing := missing || to_jsonb('计算错误：' || SQLERRM);
  END;

  RETURN jsonb_build_object('value', res, 'inputs', inputs, 'missing', missing);
END $$;

-- =====================================================================
-- 6. 指标计算
-- =====================================================================

-- 判定基准：本指标自身的基准（满足适用条件）优先；没有时沿版本对照继承 2024 版引领值
CREATE FUNCTION engine.resolve_benchmark(p_indicator bigint, p_node bigint, p_year int, p_profile text)
RETURNS TABLE (benchmark_id bigint, value numeric, value_text text, comparator text, inherited boolean, source_doc text)
LANGUAGE plpgsql STABLE AS $$
DECLARE b record; mv numeric;
BEGIN
  FOR b IN SELECT * FROM core.indicator_benchmark ib WHERE ib.indicator_id = p_indicator
           ORDER BY array_position(ARRAY['lead_value','zero_carbon_target','industry_advanced','custom','baseline','industry_average'],
                                   ib.benchmark_type), ib.benchmark_id LOOP
    IF b.applies_when IS NOT NULL THEN
      mv := engine.metric_value(b.applies_when ->> 'metric', p_node, p_year, p_profile, '');
      CONTINUE WHEN mv IS NULL
        OR (b.applies_when ? 'min' AND mv < (b.applies_when ->> 'min')::numeric)
        OR (b.applies_when ? 'max' AND mv >= (b.applies_when ->> 'max')::numeric);
    END IF;
    RETURN QUERY SELECT b.benchmark_id, b.value, b.value_text, b.comparator, false, b.source_doc;
    RETURN;
  END LOOP;

  RETURN QUERY
  SELECT ib.benchmark_id, ib.value, ib.value_text, ib.comparator, true, ib.source_doc
  FROM core.indicator_mapping mp
  JOIN core.indicator_def fd ON fd.indicator_id = mp.from_indicator_id
  JOIN core.standard_version fv ON fv.version_id = fd.version_id AND fv.code = 'GIP_2024'
  JOIN core.indicator_benchmark ib ON ib.indicator_id = fd.indicator_id AND ib.benchmark_type = 'lead_value'
  WHERE mp.to_indicator_id = p_indicator AND mp.relation IN ('same','renamed','narrowed')
  LIMIT 1;
END $$;

-- 能源与碳数据中估值数据（AI 估值、插值）所占比例，按折标量计
CREATE FUNCTION engine.estimated_share(p_node bigint, p_year int) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN sum(abs(a.tce)) > 0
              THEN coalesce(sum(abs(a.tce)) FILTER (WHERE a.data_source IN ('estimated','interpolated')), 0) / sum(abs(a.tce))
              ELSE 0 END
  FROM fact.energy_activity a
  WHERE a.is_current AND extract(year FROM a.period_month) = p_year
    AND a.node_id IN (SELECT engine.accounting_nodes(p_node))
$$;

-- 计算某标准版本下某节点某年度的指标。
-- p_preview = true：允许使用草稿公式，结果只返回、不写入（用于公式审核前的试算）。
CREATE FUNCTION engine.calc_indicators(p_version text, p_node_code text, p_year int,
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

  FOR d IN SELECT i.*, f.code AS f_code, f.revision AS f_rev, f.expression, f.status AS f_status
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
    v_est := CASE WHEN d.expression ~ '\m(ENG_|CO2_)' THEN engine.estimated_share(v_node, p_year) ELSE 0 END;

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

-- 一键执行：折标 → 碳核算 → 指标（年均增长率需要往前 n 年的数据，因此从 p_year - period_years 开始计算）
CREATE FUNCTION engine.run_all(p_version text, p_node_code text, p_year int, p_preview boolean DEFAULT false,
                               p_params jsonb DEFAULT '{"period_years":3}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  y0 int := p_year - coalesce((p_params ->> 'period_years')::int, 3);
  e jsonb; c jsonb; i jsonb;
BEGIN
  e := engine.calc_energy(make_date(y0, 1, 1), make_date(p_year, 12, 1));
  c := engine.calc_carbon(p_version, make_date(y0, 1, 1), make_date(p_year, 12, 1));
  i := engine.calc_indicators(p_version, p_node_code, p_year, p_preview, p_params);
  RETURN jsonb_build_object('energy', e, 'carbon', c, 'indicators', i);
END $$;

-- =====================================================================
-- 7. 执行权限
-- =====================================================================
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA engine TO green_app, green_etl;

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0014', '导入解析与计算引擎：load_batch、calc_energy、calc_carbon、指标公式求值与 calc_indicators、run_all');
