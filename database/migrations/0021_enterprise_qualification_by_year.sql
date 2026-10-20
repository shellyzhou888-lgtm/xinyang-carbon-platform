-- 0021 企业资格按年度建模（高新技术企业、规上企业），导入公开原件中的资格证据与法人名称
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。
--
-- 原来 core.enterprise_profile.is_high_tech 只有一个布尔值，计算任何年份都用它；证书却有有效期
-- （如信阳谷麦 GR202141000133 对应 2021–2023 年）。本迁移新增资格记录表，计算按“统计年份是否在有效年度内”取值。

SET ROLE greensystem;

-- 1. 资格记录 ---------------------------------------------------------------------------
CREATE TABLE core.enterprise_qualification (
  qual_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_id       bigint NOT NULL REFERENCES core.org_node(node_id),
  qual_type     text NOT NULL CHECK (qual_type IN ('high_tech','above_scale')),
  holds         boolean NOT NULL DEFAULT true,
  cert_no       text,
  issued_on     date,
  first_year    smallint NOT NULL,
  last_year     smallint NOT NULL,
  issuer        text,
  data_source   text NOT NULL CHECK (data_source IN ('measured','manual','estimated','interpolated')),
  source_title  text,
  source_url    text,
  source_page   text,
  document_id   bigint REFERENCES raw.document(document_id),
  batch_id      bigint REFERENCES raw.import_batch(batch_id),
  record_id     bigint REFERENCES raw.import_record(record_id),
  note          text,
  is_current    boolean NOT NULL DEFAULT true,
  created_by    text NOT NULL DEFAULT session_user,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (last_year >= first_year)
);
CREATE INDEX enterprise_qualification_lookup ON core.enterprise_qualification (node_id, qual_type, first_year, last_year) WHERE is_current;
COMMENT ON TABLE core.enterprise_qualification IS '企业资格履历：高新技术企业、规模以上工业企业。一行覆盖 first_year–last_year 各统计年度；holds=false 表示该年度确认不具备。计算时按年度取值（engine.qualified）';
COMMENT ON COLUMN core.enterprise_qualification.first_year IS '适用的第一个统计年度。高企按证书载明的税收优惠年度（发证当年起三个年度）';
COMMENT ON COLUMN core.enterprise_qualification.last_year IS '适用的最后一个统计年度';
COMMENT ON COLUMN core.enterprise_qualification.data_source IS 'manual=原件或公开名单核验的真实信息；estimated=模拟占位';
COMMENT ON COLUMN core.enterprise_qualification.source_page IS '原件页码（PDF 页 / 正文页）';
GRANT SELECT ON core.enterprise_qualification TO green_agent_ro;

-- 2. 按年度判断资格 ---------------------------------------------------------------------
-- 规则：真实记录（非 estimated）优先，其中“具备”优先于“不具备”；没有真实记录时用模拟记录；
-- 都没有时回退到企业档案的当前布尔值（旧数据兼容）。
CREATE FUNCTION engine.qualified(p_node bigint, p_type text, p_year int) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT bool_or(q.holds) FROM core.enterprise_qualification q
      WHERE q.is_current AND q.node_id = p_node AND q.qual_type = p_type
        AND p_year BETWEEN q.first_year AND q.last_year
        AND q.data_source <> 'estimated'
      HAVING count(*) > 0),
    (SELECT bool_or(q.holds) FROM core.enterprise_qualification q
      WHERE q.is_current AND q.node_id = p_node AND q.qual_type = p_type
        AND p_year BETWEEN q.first_year AND q.last_year
      HAVING count(*) > 0),
    (SELECT CASE p_type WHEN 'high_tech' THEN e.is_high_tech WHEN 'above_scale' THEN e.is_above_scale END
       FROM core.enterprise_profile e WHERE e.node_id = p_node),
    false)
$$;
COMMENT ON FUNCTION engine.qualified(bigint, text, int) IS '某企业某统计年度是否具备资格（high_tech / above_scale）。真实记录优先，其次模拟记录，最后回退企业档案布尔值';

-- 3. 高新技术企业产值改为按年度资格汇总 ---------------------------------------------------
CREATE OR REPLACE FUNCTION engine.metric_value(p_code text, p_node bigint, p_year int, p_profile text, p_dim text DEFAULT '')
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
    -- 统计年度内具备高新技术企业资格的企业工业总产值之和（按 engine.qualified 逐年判断）
    FOR nid IN SELECT e.node_id FROM core.enterprise_profile e
               WHERE e.node_id IN (SELECT engine.accounting_nodes(p_node))
                 AND engine.qualified(e.node_id, 'high_tech', p_year) LOOP
      x := engine.node_stat('ECO_GROSS_OUTPUT', nid, p_year, '');
      IF x IS NOT NULL THEN total := coalesce(total, 0) + x; n := n + 1; END IF;
    END LOOP;
    IF n = 0 AND engine.stat_value('ECO_GROSS_OUTPUT', p_node, p_year, '') IS NOT NULL THEN RETURN 0; END IF;
    RETURN total;
  END IF;

  RETURN engine.stat_value(p_code, p_node, p_year, p_dim);
END $$;

-- 4. 导入时同时写资格记录（年度统计表“是否规上 / 是否高企 / 证书编号”三列） ------------------------
CREATE OR REPLACE FUNCTION engine.load_batch(p_batch bigint) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  b raw.import_batch; t core.import_template; rec raw.import_record; m record;
  f_credit text; f_name text; f_period text; f_source text; f_note text; f_dim text; f_unit text;
  v_node bigint; v_month date; v_year int; v_src text; v_txt text; v_q numeric; v_flow text; v_unit text;
  v_attrs jsonb; v_res text; v_written int; v_map jsonb; v_bool boolean; v_qtype text;
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
            -- 0021：同时写该统计年度的资格记录；同一企业、年度、来源重复导入时旧记录作废（保留历史）
            v_qtype := CASE m.target_field WHEN 'enterprise_profile.is_above_scale' THEN 'above_scale'
                                           WHEN 'enterprise_profile.is_high_tech' THEN 'high_tech' END;
            IF v_qtype IS NOT NULL THEN
              UPDATE core.enterprise_qualification SET is_current = false
               WHERE is_current AND node_id = v_node AND qual_type = v_qtype AND batch_id IS NOT NULL
                 AND first_year = v_year AND last_year = v_year AND data_source = v_src;
              INSERT INTO core.enterprise_qualification
                (node_id, qual_type, holds, cert_no, first_year, last_year, data_source, batch_id, record_id, note)
              VALUES (v_node, v_qtype, v_bool,
                      CASE WHEN v_qtype = 'high_tech' THEN
                        (SELECT nullif(btrim(coalesce(rec.payload ->> fm.source_field, '')), '') FROM core.import_field_map fm
                          WHERE fm.template_id = t.template_id AND fm.target_field = 'enterprise_profile.high_tech_cert_no' LIMIT 1)
                      END,
                      v_year, v_year, v_src, p_batch, rec.record_id, rec.payload ->> f_note);
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


-- 5. 回填：把以往导入（模拟批次与公开数据批次）中逐年填写的“是否规上 / 是否高企”转为资格记录 --------------
--    必须在下面修改法人名称之前执行，因为匹配企业时会用到导入时的名称。
WITH f AS (
  SELECT template_id,
         max(source_field) FILTER (WHERE target_field = 'node_credit_code') AS f_credit,
         max(source_field) FILTER (WHERE target_field = 'node_name') AS f_name,
         max(source_field) FILTER (WHERE target_field IN ('period_month','period_year')) AS f_period,
         max(source_field) FILTER (WHERE target_field = 'data_source') AS f_source,
         max(source_field) FILTER (WHERE target_field = 'note') AS f_note,
         max(source_field) FILTER (WHERE target_field = 'enterprise_profile.is_high_tech') AS f_ht,
         max(source_field) FILTER (WHERE target_field = 'enterprise_profile.is_above_scale') AS f_as,
         max(source_field) FILTER (WHERE target_field = 'enterprise_profile.high_tech_cert_no') AS f_cert,
         (array_agg(transform -> 'value_map') FILTER (WHERE target_field = 'data_source'))[1] AS src_map,
         (array_agg(transform -> 'value_map') FILTER (WHERE target_field = 'enterprise_profile.is_high_tech'))[1] AS bool_map
  FROM core.import_field_map
  GROUP BY template_id
  HAVING count(*) FILTER (WHERE target_field IN ('enterprise_profile.is_high_tech','enterprise_profile.is_above_scale')) > 0
), r AS (
  SELECT rec.record_id, rec.batch_id,
         engine.resolve_node(rec.payload ->> f.f_credit, rec.payload ->> f.f_name) AS node_id,
         engine.parse_year(rec.payload ->> f.f_period) AS yr,
         coalesce(f.src_map ->> btrim(coalesce(rec.payload ->> f.f_source, '')),
                  CASE b.source_type WHEN 'estimated' THEN 'estimated' WHEN 'api' THEN 'measured' ELSE 'manual' END) AS src,
         nullif(btrim(coalesce(rec.payload ->> f.f_ht, '')), '') AS ht,
         nullif(btrim(coalesce(rec.payload ->> f.f_as, '')), '') AS ab,
         nullif(btrim(coalesce(rec.payload ->> f.f_cert, '')), '') AS cert,
         rec.payload ->> f.f_note AS note, f.bool_map
  FROM raw.import_record rec
  JOIN raw.import_batch b USING (batch_id)
  JOIN f ON f.template_id = b.template_id
  WHERE rec.parse_status = 'ok' AND b.status IN ('loaded','partially_loaded')
), u AS (
  SELECT node_id, 'high_tech' AS qt, (bool_map ->> ht)::boolean AS holds, cert, yr, src, batch_id, record_id, note FROM r WHERE ht IS NOT NULL
  UNION ALL
  SELECT node_id, 'above_scale', (bool_map ->> ab)::boolean, NULL, yr, src, batch_id, record_id, note FROM r WHERE ab IS NOT NULL
)
INSERT INTO core.enterprise_qualification
  (node_id, qual_type, holds, cert_no, first_year, last_year, data_source, batch_id, record_id, note)
SELECT DISTINCT ON (node_id, qt, yr, src) node_id, qt, holds, cert, yr, yr, src, batch_id, record_id, note
FROM u WHERE holds IS NOT NULL
ORDER BY node_id, qt, yr, src, record_id DESC;

-- 6. 登记原件（文件本体在本机数据湖 storage/research/，不进 Git） -------------------------------
INSERT INTO raw.document (storage_key, original_name, mime_type, size_bytes, sha256, doc_kind, note) VALUES
  ('storage/research/2026-10-20/gumai-2022-prospectus.pdf', '谷麦光电科技股份有限公司招股说明书（申报稿）.pdf', 'application/pdf', 9130828,
   '50a0671538e726bb31f8f40144094ffe7d594da652796c6357c1aa92de7f0351', 'evidence',
   'S01 深交所 2022-08 披露。https://reportdocs.static.szse.cn/UpFiles/rasinfodisc1/202208/RAS_202208_000182A5A26A383F970B05143F7CA03F.pdf'),
  ('storage/research/2026-10-20/yonghaoxuan-gov-procurement.pdf', '信阳市绿色建材供应商及本地特色建材产品目录.pdf', 'application/pdf', 5091520,
   '4793666c2e30d34c8dbf0a3cfed7fc0b2211c4004b7a5ec6cd1d19b0920a7f95', 'evidence',
   'S02 河南省政府采购网信阳分网 2023-06 上传。https://xinyang.zfcg.henan.gov.cn/webfile/xinyang/rootfiles/2023/06/25/1686703640122773-1686703640125089.pdf'),
  ('storage/research/2026-10-20/henan-2024-hightech-first-batch.pdf', '河南省认定机构2024年认定报备的第一批高新技术企业名单.pdf', 'application/pdf', 384844,
   '2165791bbba5a386484b5cc0b3ae8a51c2f3a6a0f12386886ac0469e4ed1ca3d', 'evidence',
   'S03 中小企业网托管的名单原文。https://www.sme.com.cn/api/pub/download/file/sme_file_1731468047537.pdf');

-- 7. 原件核验的资格记录 ---------------------------------------------------------------------
INSERT INTO core.enterprise_qualification
  (node_id, qual_type, holds, cert_no, issued_on, first_year, last_year, issuer, data_source,
   source_title, source_url, source_page, document_id, note)
SELECT n.node_id, v.qual_type, true, v.cert_no, v.issued_on::date, v.first_year, v.last_year, v.issuer, 'manual',
       d.original_name, substring(d.note from 'https?://\S+'), v.source_page, d.document_id, v.note
FROM (VALUES
  ('E_GUMAI', 'high_tech', 'GR201841000519', '2018-09-12', 2018, 2020, '河南省科学技术厅、河南省财政厅、国家税务总局河南省税务局',
   'gumai-2022-prospectus.pdf', 'PDF 第 239 页（正文 1-1-238）', '招股书载明 2018–2020 年企业所得税按 15% 缴纳'),
  ('E_GUMAI', 'high_tech', 'GR202141000133', '2021-10-28', 2021, 2023, '河南省科学技术厅、河南省财政厅、国家税务总局河南省税务局',
   'gumai-2022-prospectus.pdf', 'PDF 第 155 页（正文 1-1-154）资质表；PDF 第 239 页（正文 1-1-238）', '复审取得，招股书载明 2021–2023 年按 15% 税率'),
  ('E_GUMAI', 'high_tech', 'GR202441001763', NULL, 2024, 2026, '河南省认定机构（2024 年第一批认定报备）',
   'henan-2024-hightech-first-batch.pdf', 'PDF 第 59 页，序号 1763', '名单载明企业名称与证书编号；发证日期名单未列，按认定当年起三个年度'),
  ('E_YONGHAOXUAN', 'high_tech', NULL, NULL, 2020, 2022, NULL,
   'yonghaoxuan-gov-procurement.pdf', 'PDF 第 83 页（目录正文第 81 页）', '目录载明“2020 年 12 月被评为高新技术企业”，证书编号未列；2023 年续认未取得官方原件'),
  ('E_YONGHAOXUAN', 'above_scale', NULL, NULL, 2016, 2016, NULL,
   'yonghaoxuan-gov-procurement.pdf', 'PDF 第 83 页（目录正文第 81 页）', '目录载明 2016 年“被评为国家规模以上企业”；不代表 2021 年后各年度状态')
) AS v(code, qual_type, cert_no, issued_on, first_year, last_year, issuer, file, source_page, note)
JOIN core.org_node n ON n.code = v.code
JOIN raw.document d ON d.storage_key = 'storage/research/2026-10-20/' || v.file;

-- 螓杰：此前已作为真实信息导入证书编号，这里按有效期补成三个年度
INSERT INTO core.enterprise_qualification
  (node_id, qual_type, holds, cert_no, first_year, last_year, issuer, data_source, source_title, source_url, note)
SELECT n.node_id, 'high_tech', true, 'GR202341000426', 2023, 2025, '河南省认定机构', 'manual',
       '河南省认定机构 2023 年认定报备的第一批高新技术企业备案名单', 'http://www.innocom.gov.cn/',
       '证书有效期三年，按 2023–2025 年度适用'
FROM core.org_node n WHERE n.code = 'E_QINJIE';

-- 8. 企业档案：法人名称与说明 ---------------------------------------------------------------
UPDATE core.enterprise_profile e SET
  high_tech_cert_no = 'GR202441001763', updated_at = now(),
  attributes = e.attributes || '{"high_tech_certificates": ["GR201841000519 (2018–2020)", "GR202141000133 (2021–2023)", "GR202441001763 (2024–2026)"]}'::jsonb
FROM core.org_node n WHERE n.node_id = e.node_id AND n.code = 'E_GUMAI';

UPDATE core.enterprise_profile e SET
  legal_name = '河南省现代筑美家居有限公司', updated_at = now(),
  attributes = e.attributes || jsonb_build_object('legal_name_verified', true, 'former_label', e.legal_name,
                 'legal_name_source', '信阳市绿色建材供应商及本地特色建材产品目录 PDF 第 75 页（正文第 73 页）；碧桂园集团子公司')
FROM core.org_node n WHERE n.node_id = e.node_id AND n.code = 'E_ZHUMEI';

UPDATE core.enterprise_profile e SET
  legal_name = '信阳百德实业有限公司', parent_company = coalesce(e.parent_company, '北京润成创展木业有限责任公司（百德木门）'), updated_at = now(),
  attributes = e.attributes || jsonb_build_object('legal_name_verified', true, 'former_label', e.legal_name,
                 'legal_name_source', '信阳市绿色建材供应商及本地特色建材产品目录 PDF 第 85 页（正文第 83 页）')
FROM core.org_node n WHERE n.node_id = e.node_id AND n.code = 'E_BAIDE';

UPDATE core.enterprise_profile e SET updated_at = now(),
  attributes = e.attributes || jsonb_build_object(
    'related_legal_entities', jsonb_build_array('信阳天一美家实业有限公司', '信阳天一红木实业有限公司', '信阳天一窗业有限公司（天一美家全资子公司，高新技术企业）'),
    'scope_note', '本节点覆盖哪些法人/厂区尚未确认；天一窗业的高企资格不能直接赋给本节点。来源：建材目录 PDF 第 7、108、110 页')
FROM core.org_node n WHERE n.node_id = e.node_id AND n.code = 'E_TIANYI';

UPDATE core.enterprise_profile e SET updated_at = now(),
  founded_on = coalesce(e.founded_on, '2013-01-01'::date),
  attributes = e.attributes || jsonb_build_object(
    'site_area_mu', 232, 'building_area_m2', 125000, 'founded_year', 2013,
    'employees_on_post_undated', 689,
    'profile_source', '建材目录 PDF 第 83 页（正文第 81 页）；在岗人数未标统计时点，不作为年末从业人数')
FROM core.org_node n WHERE n.node_id = e.node_id AND n.code = 'E_YONGHAOXUAN';

-- 9. 荣誉（高新技术企业证书；过期的不上大屏） ------------------------------------------------
INSERT INTO core.honor (node_id, honor_type, level, title, year, issuer, doc_no, source_url, counts_for_indicator, show_on_screen, evidence_document_id)
SELECT n.node_id, 'high_tech', 'national', v.title, v.year, v.issuer, v.doc_no, substring(d.note from 'https?://\S+'), false, v.show, d.document_id
FROM (VALUES
  ('E_GUMAI', '高新技术企业（GR202141000133）', 2021, '河南省科学技术厅等', 'GR202141000133', false, 'gumai-2022-prospectus.pdf'),
  ('E_GUMAI', '高新技术企业（GR202441001763）', 2024, '河南省认定机构', 'GR202441001763', true, 'henan-2024-hightech-first-batch.pdf'),
  ('E_YONGHAOXUAN', '高新技术企业（2020 年认定）', 2020, NULL, NULL, false, 'yonghaoxuan-gov-procurement.pdf')
) AS v(code, title, year, issuer, doc_no, show, file)
JOIN core.org_node n ON n.code = v.code
JOIN raw.document d ON d.storage_key = 'storage/research/2026-10-20/' || v.file;

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0021', '企业资格按年度建模（core.enterprise_qualification、engine.qualified），导入谷麦/永豪轩/螓杰资格原件与筑美、百德法人名称');
