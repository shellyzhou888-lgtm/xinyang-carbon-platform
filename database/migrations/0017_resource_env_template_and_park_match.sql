-- 0017 资源环境年度统计模板；企业匹配支持园区/片区；按列指定附加维度（污染物种类）
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。

SET ROLE greensystem;

-- 1. 匹配对象扩展到园区、片区（园区整体上报的用地、用水等数据挂在园区节点上），并支持按节点编码匹配
CREATE OR REPLACE FUNCTION engine.resolve_node(p_credit text, p_name text) RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
DECLARE v_id bigint; v_cnt int;
BEGIN
  IF nullif(btrim(p_credit), '') IS NOT NULL THEN
    SELECT node_id INTO v_id FROM core.enterprise_profile WHERE credit_code = btrim(p_credit);
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  IF nullif(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION '缺少单位名称或统一社会信用代码';
  END IF;
  SELECT count(*), min(n.node_id) INTO v_cnt, v_id
  FROM core.org_node n LEFT JOIN core.enterprise_profile e USING (node_id)
  WHERE n.is_active AND n.node_type IN ('park','zone','enterprise','public_area')
    AND (e.legal_name = btrim(p_name) OR n.name = btrim(p_name) OR n.code = btrim(p_name));
  IF v_cnt = 0 THEN
    RAISE EXCEPTION '未找到“%”，请先在后台登记该企业/单位或填写统一社会信用代码', p_name;
  ELSIF v_cnt > 1 THEN
    RAISE EXCEPTION '名称“%”匹配到多个对象，请填写统一社会信用代码', p_name;
  END IF;
  RETURN v_id;
END $$;

-- 2. load_batch：字段映射的 transform 可指定附加维度 {"dim":"COD"}，用于一列对应一种污染物
-- 解析一个导入批次。每行单独成功或失败（失败行回滚该行写入并记录原因），不影响其他行。
CREATE OR REPLACE FUNCTION engine.load_batch(p_batch bigint) RETURNS jsonb
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
                                      coalesce(m.transform ->> 'dim',
                                               CASE WHEN f_dim IS NOT NULL THEN btrim(rec.payload ->> f_dim) ELSE '' END),
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


-- 3. 资源环境年度统计模板 -------------------------------------------------------------
INSERT INTO core.import_template (code, name, target, file_kind, sheet_name, header_row, description) VALUES
  ('PARK_ANNUAL_RESOURCE_ENV', '资源环境年度统计表', 'statistic_value', 'excel', '资源环境', 2,
   '模板文件 templates/park-annual-resource-environment_v1.xlsx；一行为一个单位（园区或企业）一年；园区整体上报值优先于企业加总');

INSERT INTO core.import_field_map (template_id, source_field, target_field, metric_code, unit_code, transform, is_required)
SELECT t.template_id, m.src, m.tgt, m.metric, m.unit, m.tf::jsonb, m.req
FROM core.import_template t,
(VALUES
  ('统一社会信用代码',                       'node_credit_code', NULL,                       NULL,   NULL, false),
  ('单位名称',                               'node_name',        NULL,                       NULL,   NULL, true),
  ('年份',                                   'period_year',      NULL,                       NULL,   NULL, true),
  ('工业用新鲜水量（m3）',                   'value',            'RES_FRESH_WATER',          'm3',   NULL, false),
  ('工业重复用水量（m3）',                   'value',            'RES_WATER_REUSED',         'm3',   NULL, false),
  ('工业用地面积（km2）',                    'value',            'RES_INDUSTRIAL_LAND',      'km2',  NULL, false),
  ('一般工业固体废物产生量（t）',            'value',            'RES_SW_GENERATED',         't',    NULL, false),
  ('一般工业固体废物综合利用量（t）',        'value',            'RES_SW_UTILIZED',          't',    NULL, false),
  ('综合利用往年贮存量（t）',                'value',            'RES_SW_STOCK_UTILIZED',    't',    NULL, false),
  ('工业废水排放量（t）',                    'value',            'ENV_WASTEWATER',           't',    NULL, false),
  ('化学需氧量排放量（t）',                  'value',            'ENV_POLLUTANT',            't',    '{"dim":"COD"}', false),
  ('氨氮排放量（t）',                        'value',            'ENV_POLLUTANT',            't',    '{"dim":"NH3N"}', false),
  ('二氧化硫排放量（t）',                    'value',            'ENV_POLLUTANT',            't',    '{"dim":"SO2"}', false),
  ('氮氧化物排放量（t）',                    'value',            'ENV_POLLUTANT',            't',    '{"dim":"NOX"}', false),
  ('新建工业建筑面积（m2）',                 'value',            'INF_NEW_IND_BLDG_AREA',    'm2',   NULL, false),
  ('其中绿色工业建筑面积（二星及以上，m2）', 'value',            'INF_NEW_IND_GREEN_AREA',   'm2',   NULL, false),
  ('新建公共建筑面积（m2）',                 'value',            'INF_NEW_PUB_BLDG_AREA',    'm2',   NULL, false),
  ('其中绿色公共建筑面积（二星及以上，m2）', 'value',            'INF_NEW_PUB_GREEN_AREA',   'm2',   NULL, false),
  ('余热余冷余压资源量（GJ）',               'value',            'ENG_WASTE_HEAT_AVAILABLE', 'GJ',   NULL, false),
  ('余热余冷余压回收利用量（GJ）',           'value',            'ENG_WASTE_HEAT_RECOVERED', 'GJ',   NULL, false),
  ('数据来源',                               'data_source',      NULL,                       NULL,
   '{"value_map":{"统计报表":"manual","环境统计":"manual","在线监测":"measured","企业台账":"manual"}}', true),
  ('备注',                                   'note',             NULL,                       NULL,   NULL, false)
) AS m(src, tgt, metric, unit, tf, req)
WHERE t.code = 'PARK_ANNUAL_RESOURCE_ENV';

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0017', '资源环境年度统计模板；企业匹配支持园区/片区与节点编码；字段映射可指定污染物维度');
