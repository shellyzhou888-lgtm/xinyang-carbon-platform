-- 1) 导入事件补全：raw.import_batch 新建即为 loaded 的批次（脚本导入、气象同步）此前不会生成发布事件，
--    语义目录治理因此没有被触发。新增 INSERT 触发器，与原 UPDATE 触发器共用判断。
-- 2) 企业目录入库：把网站企业目录（apps/web/data/enterprise-directory.json，2026-10-21 核验版）落为
--    core.enterprise_directory / core.enterprise_directory_source，供智能体查询；map_code 关联核算对象树中的企业。
--    对象树 core.org_node 不变（核算范围不受影响）。之后目录更新用 packages/ingest 的 npm run sync:directory 同步。
SET ROLE greensystem;

CREATE FUNCTION semantic.on_batch_inserted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('loaded','partially_loaded') THEN
    INSERT INTO semantic.publish_event (kind, ref_id) VALUES ('import', NEW.batch_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER import_batch_publish_insert AFTER INSERT ON raw.import_batch
  FOR EACH ROW EXECUTE FUNCTION semantic.on_batch_inserted();

CREATE TABLE core.enterprise_directory_source (
  source_id    text PRIMARY KEY,
  title        text NOT NULL,
  url          text,
  published    text CHECK (published ~ '^\d{4}(-\d{2}(-\d{2})?)?$')
);
COMMENT ON TABLE core.enterprise_directory_source IS '企业目录核验来源：公开报道、政府公告、政府采购与企业官网等';
COMMENT ON COLUMN core.enterprise_directory_source.title IS '来源标题（官方文件或公开报道名称）';
COMMENT ON COLUMN core.enterprise_directory_source.published IS '发布日期（按来源精度：年、年-月或年-月-日）';

CREATE TABLE core.enterprise_directory (
  entry_id     text PRIMARY KEY,
  name         text NOT NULL,
  entry_type   text NOT NULL CHECK (entry_type IN ('企业','品牌基地','历史企业','待核条目','项目')),
  area         text,
  business     text,
  map_code     text,
  featured     boolean NOT NULL DEFAULT false,
  evidence     text[] NOT NULL DEFAULT '{}',
  note         text,
  node_id      bigint REFERENCES core.org_node(node_id),
  reviewed_on  date,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.enterprise_directory IS '园区企业与项目目录：逐名可溯源的企业、品牌基地、历史企业与建设项目（不等于全部在营企业）';
COMMENT ON COLUMN core.enterprise_directory.name IS '企业法人名称、品牌基地或项目名称';
COMMENT ON COLUMN core.enterprise_directory.entry_type IS '条目类型：企业 / 品牌基地 / 历史企业（已不在营）/ 待核条目 / 项目';
COMMENT ON COLUMN core.enterprise_directory.area IS '所在片区（羊山片区=绿色家居产业园区，金牛物流片区=电子信息产业园区）';
COMMENT ON COLUMN core.enterprise_directory.business IS '产业方向';
COMMENT ON COLUMN core.enterprise_directory.map_code IS '网站地图点位编码；E_ 开头时与核算对象 core.org_node.code 一致';
COMMENT ON COLUMN core.enterprise_directory.node_id IS '对应核算对象（有能耗与碳排放数据的企业）；空表示目录条目尚无核算数据';
COMMENT ON COLUMN core.enterprise_directory.evidence IS '核验来源编号，见 core.enterprise_directory_source';
COMMENT ON COLUMN core.enterprise_directory.note IS '内部核验备注';
CREATE INDEX enterprise_directory_node_idx ON core.enterprise_directory (node_id);

INSERT INTO core.enterprise_directory_source (source_id, title, url, published) VALUES
  ($q$industry-2024$q$, $q$示范引领 放大优势：羊山新区信阳经开区以科技创新激发发展活力$q$, $q$https://www.hnxydj.gov.cn/s/youhuayingshanghuanjing/2024-02-02/8543.html$q$, $q$2024-02-02$q$),
  ($q$visit-2023$q$, $q$信阳市委书记到信阳经开区调研$q$, $q$https://www.henan.gov.cn/2023/05-30/2751977.html$q$, $q$2023-05-30$q$),
  ($q$catalog-2023$q$, $q$信阳市政府采购网公开供应商资料（以各条目正文为准）$q$, $q$https://xinyang.zfcg.henan.gov.cn/webfile/xinyang/rootfiles/2023/06/25/1686703640122773-1686703640125089.pdf$q$, $q$2023-06-25$q$),
  ($q$technology-2023$q$, $q$市科技局走访金牛物流产业集聚区电子信息智能产业园$q$, $q$https://www.xystrm.com/news/show.php?itemid=661$q$, $q$2023-08-16$q$),
  ($q$tianyi-2015$q$, $q$全省重点项目暨产业集聚区建设观摩团莅信观摩$q$, $q$https://www.henan.gov.cn/2015/04-02/268462.html$q$, $q$2015-04-02$q$),
  ($q$yadan-2023$q$, $q$亚丹生态科技（信阳）有限公司正式投产$q$, $q$https://www.henan.gov.cn/2023/08-07/2793273.html$q$, $q$2023-08-07$q$),
  ($q$peak-2024$q$, $q$匹克北方总部和信阳服装生产基地项目开工$q$, $q$https://ysxq.xinyang.gov.cn/2024/07-12/3248008.html$q$, $q$2024-07-12$q$),
  ($q$logistics-2025$q$, $q$国家开发银行调研信阳经开区商贸物流产业$q$, $q$https://www.xinyang.gov.cn/2025/04-23/599538.html$q$, $q$2025-04-23$q$),
  ($q$scale-2025$q$, $q$信阳日报：信阳经开区辖区55家规上工业企业$q$, $q$https://ribao.xyxww.com.cn/html/2025-03/20/content_153676.htm$q$, $q$2025-03-20$q$),
  ($q$service-2024$q$, $q$信阳晚报：羊山新区、信阳经开区辖区企业帮扶$q$, $q$https://wanbao.xyxww.com.cn/html/2024-01/15/content_137214.htm$q$, $q$2024-01-15$q$),
  ($q$industry-white-2022$q$, $q$信阳市工业企业白名单公开副本（用于核对法人全称，不单凭县区认定园区归属）$q$, $q$https://att.dahecube.com/f/220613/c760889745ee39b65cfa044c9f9807e7$q$, $q$2022-06-13$q$),
  ($q$kaiyuan-site$q$, $q$河南凯源智慧水务企业官网$q$, $q$https://www.kyzhwater.com/$q$, $q$2026-10-21$q$),
  ($q$factory-2024$q$, $q$信阳日报：经开区三家5G工厂的企业全称$q$, $q$https://ribao.xyxww.com.cn/html/2024-11/28/content_149595.htm$q$, $q$2024-11-28$q$),
  ($q$furniture-2023$q$, $q$信阳日报：经开区组织辖区家居企业参加物流推介会$q$, $q$https://ribao.xyxww.com.cn/html/2023-10/26/content_133470.htm$q$, $q$2023-10-26$q$),
  ($q$rights-2025$q$, $q$河南省科技型中小企业评价入库名单：权盛实业$q$, $q$https://xcoss.henan.gov.cn/typtfile/20250806/eaa9050c67054b42bb4b8c0a170e1eb6.pdf$q$, $q$2025-08-06$q$),
  ($q$estate-2023$q$, $q$深交所披露材料：信阳经开区产业投资有限公司参股今上半导体$q$, $q$https://reportdocs.static.szse.cn/UpFiles/rasinfodisc1/202312/RAS_202312_5022886E9F6E44DB8ADC3A400407F683.pdf$q$, $q$2023-12$q$),
  ($q$court-2026$q$, $q$全国企业破产重整案件信息网：左右鑫室破产清算案公告$q$, $q$https://pccz.court.gov.cn/pcajxxw/pcgg/ggxq?id=d6c47f639c674f018019bba692faeb05$q$, $q$2026-09-08$q$),
  ($q$outili-site$q$, $q$河南欧缇丽材料科技发展有限公司官网$q$, $q$https://hnotl.com/$q$, $q$2026-10-21$q$),
  ($q$yonghaoxuan-2025$q$, $q$信阳日报：信阳永豪轩家具有限公司在经开区绿色家居产业园$q$, $q$https://ribao.xyxww.com.cn/html/2025-12/11/content_164163.htm$q$, $q$2025-12-11$q$);

INSERT INTO core.enterprise_directory (entry_id, name, entry_type, area, business, map_code, featured, evidence, note) VALUES
  ($q$WANHUA$q$, $q$万华禾香集团股份有限公司（信阳基地）$q$, $q$企业$q$, $q$羊山片区$q$, $q$绿色家居$q$, $q$E_WANHUA$q$, true, ARRAY[$q$industry-2024$q$, $q$factory-2024$q$]::text[], $q$2024年信阳日报明确经开区5G工厂企业全称；此处为集团法人及信阳基地识别，不推定各产线由同一法人运营。$q$),
  ($q$ZHUMEI$q$, $q$河南省现代筑美家居有限公司$q$, $q$企业$q$, $q$羊山片区$q$, $q$绿色家居$q$, $q$E_ZHUMEI$q$, true, ARRAY[$q$industry-2024$q$, $q$catalog-2023$q$]::text[], $q$PDF第75页正文为家居有限公司，标题出现家具字样；以正文名称记录。$q$),
  ($q$YADAN$q$, $q$亚丹生态科技（信阳）有限公司$q$, $q$企业$q$, $q$羊山片区$q$, $q$绿色家居$q$, $q$E_YADAN$q$, true, ARRAY[$q$yadan-2023$q$]::text[], $q$政府投产报道明确该名称；不混用广州/许昌/荆门公司的法人名称。$q$),
  ($q$YONGHAOXUAN_OLD$q$, $q$信阳永豪轩家具有限公司$q$, $q$企业$q$, $q$羊山片区$q$, $q$绿色家居$q$, NULL, true, ARRAY[$q$catalog-2023$q$, $q$yonghaoxuan-2025$q$]::text[], $q$PDF第83页；与河南永豪轩智能家居股份有限公司的承继关系未取得确证，不直接合并。$q$),
  ($q$YONGHAOXUAN_INTELLIGENT$q$, $q$河南永豪轩智能家居股份有限公司$q$, $q$企业$q$, $q$羊山片区$q$, $q$绿色家居$q$, $q$E_YONGHAOXUAN$q$, true, ARRAY[$q$visit-2023$q$, $q$industry-2024$q$]::text[], $q$2023年调研报道使用永豪轩智能家居股份有限公司简称，全称另由公开POI印证；原数据库企业与该厂区的能耗绑定暂不展示。$q$),
  ($q$TIANYI$q$, $q$天一美家（信阳家居产业园）$q$, $q$品牌基地$q$, $q$羊山片区$q$, $q$绿色家居$q$, $q$E_TIANYI$q$, false, ARRAY[$q$tianyi-2015$q$]::text[], $q$公开报道能核实品牌产业园；集团品牌不等于园区内所有租户法人。$q$),
  ($q$BAIDE$q$, $q$信阳百德实业有限公司（百德门业）$q$, $q$企业$q$, $q$羊山片区$q$, $q$绿色家居$q$, $q$E_BAIDE$q$, true, ARRAY[$q$catalog-2023$q$, $q$visit-2023$q$]::text[], $q$PDF第85页及经开区实地调研报道。$q$),
  ($q$GUMAI$q$, $q$信阳市谷麦光电子科技有限公司（谷麦信阳基地）$q$, $q$企业$q$, $q$金牛物流片区$q$, $q$电子信息$q$, $q$E_GUMAI$q$, true, ARRAY[$q$industry-2024$q$, $q$factory-2024$q$]::text[], $q$2024年信阳日报明确5G工厂法人名称；地图仍为谷麦品牌园区POI，不把集团与子公司拆成虚构地块。$q$),
  ($q$JINSHANG$q$, $q$今上半导体（信阳）有限公司$q$, $q$企业$q$, $q$金牛物流片区$q$, $q$电子信息$q$, $q$E_JINSHANG$q$, true, ARRAY[$q$industry-2024$q$]::text[], $q$政府产业报道与公司官网相互印证。$q$),
  ($q$XINGYUAN$q$, $q$信阳星原智能科技有限公司$q$, $q$企业$q$, $q$金牛物流片区$q$, $q$电子信息$q$, $q$E_XINGYUAN$q$, true, ARRAY[$q$technology-2023$q$]::text[], $q$市科技局实地走访明确法人名称；另一篇报道中的星源科技不另建同名企业。$q$),
  ($q$QINJIE$q$, $q$河南螓杰智能科技有限公司$q$, $q$企业$q$, $q$金牛物流片区$q$, $q$电子信息$q$, $q$E_QINJIE$q$, true, ARRAY[$q$technology-2023$q$]::text[], $q$与星原、勤拓在同次金牛片区实地走访中出现。$q$),
  ($q$QINTUO$q$, $q$信阳勤拓精密科技有限公司$q$, $q$企业$q$, $q$金牛物流片区$q$, $q$电子信息$q$, $q$REG_QINTUO$q$, false, ARRAY[$q$technology-2023$q$]::text[], $q$市科技局2023年8月实地走访。$q$),
  ($q$OUTILI$q$, $q$河南欧缇丽材料科技发展有限公司$q$, $q$企业$q$, $q$羊山片区$q$, $q$绿色家居$q$, $q$REG_OUTILI$q$, false, ARRAY[$q$visit-2023$q$, $q$outili-site$q$]::text[], $q$2023年政府调研报道使用“材料科技有限公司”简称；企业官网明确为“材料科技发展有限公司”，并记录2026年复工。$q$),
  ($q$NUOYUAN$q$, $q$河南诺源涂料有限公司$q$, $q$企业$q$, $q$羊山片区$q$, $q$绿色家居$q$, $q$REG_NUOYUAN$q$, false, ARRAY[$q$catalog-2023$q$]::text[], $q$PDF第71页明确位于羊山新区国际家居小镇。$q$),
  ($q$DESHENG$q$, $q$信阳德胜家居有限公司$q$, $q$企业$q$, $q$羊山片区$q$, $q$绿色家居$q$, $q$REG_DESHENG$q$, false, ARRAY[$q$catalog-2023$q$]::text[], $q$PDF第88页明确位于信阳国际家居产业小镇，地图为德胜家具POI。$q$),
  ($q$ZUOYOU$q$, $q$河南省左右鑫室家具股份有限公司$q$, $q$历史企业$q$, $q$羊山片区$q$, $q$绿色家居$q$, $q$REG_ZUOYOU$q$, false, ARRAY[$q$catalog-2023$q$, $q$court-2026$q$]::text[], $q$2023年资料记录其在家居小镇；法院平台公告载明2026年7月20日破产清算获受理，故从当前企业计数中移出，保留历史记录。$q$),
  ($q$SONGDE_REVIEW$q$, $q$河南省颂德家居有限公司 / 领德名称待核$q$, $q$待核条目$q$, $q$羊山片区$q$, $q$绿色家居$q$, NULL, false, ARRAY[$q$catalog-2023$q$]::text[], $q$同份PDF目录为领德、PDF第73页正文为颂德，未消除矛盾，单列且不计入已核验企业。$q$),
  ($q$PEAK_PROJECT$q$, $q$匹克北方总部和信阳服装生产基地$q$, $q$项目$q$, $q$科创研发片区（规划图）$q$, $q$服装与总部研发$q$, NULL, false, ARRAY[$q$peak-2024$q$]::text[], $q$来源为2024年开工报道；用户PDF项目主体为信阳匹克体育用品有限公司。未将门店POI作为生产基地。$q$),
  ($q$XIYA_PROJECT$q$, $q$西亚电商物流园$q$, $q$项目$q$, $q$金牛物流片区（需进一步定位）$q$, $q$商贸物流$q$, NULL, false, ARRAY[$q$logistics-2025$q$]::text[], $q$2025年政府报道称赴信阳经开区实地查看，项目名称不等同于独立企业法人。$q$),
  ($q$BAIJIA_PROJECT$q$, $q$百家配送物流中心$q$, $q$项目$q$, $q$经开区（片区待核）$q$, $q$商贸物流$q$, NULL, false, ARRAY[$q$logistics-2025$q$]::text[], $q$仅记录政府报道项目名，不推定工商主体和地块范围。$q$),
  ($q$DABIESHAN_PROJECT$q$, $q$大别山物流园$q$, $q$项目$q$, $q$经开区（片区待核）$q$, $q$商贸物流$q$, NULL, false, ARRAY[$q$logistics-2025$q$]::text[], $q$仅记录政府报道项目名，未与其他同名物流园合并。$q$),
  ($q$COLDCHAIN_PROJECT$q$, $q$数智农业冷链产业园$q$, $q$项目$q$, $q$经开区（片区待核）$q$, $q$商贸物流$q$, NULL, false, ARRAY[$q$logistics-2025$q$]::text[], $q$政府实地调研项目，建设及运营状态需按后续资料更新。$q$),
  ($q$RUOBANG$q$, $q$河南若邦电子材料有限公司$q$, $q$企业$q$, $q$金牛物流片区$q$, $q$电子信息材料$q$, NULL, false, ARRAY[$q$scale-2025$q$, $q$industry-white-2022$q$]::text[], $q$2025年经开区报道明确走访若邦电子；2022年工业白名单核对法人名称。未取得2026年在营证明或可信Logo。$q$),
  ($q$CHUANGWEIDA$q$, $q$河南省创伟达通信设备有限公司$q$, $q$企业$q$, $q$金牛物流片区$q$, $q$电子信息与通信设备$q$, NULL, false, ARRAY[$q$service-2024$q$, $q$industry-white-2022$q$]::text[], $q$2024年辖区帮扶报道提及创伟达；公开工业白名单核对法人全称。未把广东或深圳同名企业Logo当作本厂区标识。$q$),
  ($q$KAIYUAN$q$, $q$河南凯源水务科技有限公司$q$, $q$企业$q$, $q$经开区（片区待核）$q$, $q$智慧水务与给排水设备$q$, NULL, false, ARRAY[$q$service-2024$q$, $q$scale-2025$q$, $q$kaiyuan-site$q$]::text[], $q$经开区报道明确将凯源水务列为辖区服务企业；官网核对法人全称与品牌标识，具体厂区片区待核。$q$),
  ($q$LINGSHI$q$, $q$信阳市灵石科技有限公司$q$, $q$企业$q$, $q$经开区关联（区位待核）$q$, $q$绿色建材与混凝土外加剂$q$, NULL, false, ARRAY[$q$scale-2025$q$]::text[], $q$2025年信阳日报将灵石科技列为经开区支持申报省级绿色工厂的辖区企业；公开登记地址在陆庙，厂区与经开区界址关系仍需管委会核对。$q$),
  ($q$YALIQI$q$, $q$信阳市亚力奇家居有限公司$q$, $q$企业$q$, $q$羊山片区（具体厂区待核）$q$, $q$绿色家居$q$, NULL, false, ARRAY[$q$furniture-2023$q$]::text[], $q$2023年信阳日报列为经开区组织的辖区家居企业参会者；未取得近期经营状态与可信Logo。$q$),
  ($q$QUANSHENG$q$, $q$信阳市权盛实业有限公司$q$, $q$企业$q$, $q$羊山片区$q$, $q$沙发与软体家具$q$, $q$REG_QUANSHENG$q$, false, ARRAY[$q$furniture-2023$q$, $q$catalog-2023$q$, $q$rights-2025$q$]::text[], $q$政府采购公开资料载明位于羊山新区家具小镇；2025年河南省科技型中小企业名单仍有该法人。$q$),
  ($q$PARK_INVESTMENT$q$, $q$信阳经开区产业投资有限公司$q$, $q$企业$q$, $q$经开区（办公地址待核）$q$, $q$园区投资与运营$q$, NULL, false, ARRAY[$q$estate-2023$q$]::text[], $q$深交所披露材料确认该公司由经开区管委会全资持有并参股今上半导体；属于园区运营主体，不计入制造业企业或55家规上工业企业。$q$);

UPDATE core.enterprise_directory e SET node_id = n.node_id, reviewed_on = DATE '2026-10-21'
  FROM core.org_node n WHERE n.code = e.map_code;
UPDATE core.enterprise_directory SET reviewed_on = DATE '2026-10-21' WHERE reviewed_on IS NULL;

RESET ROLE;

GRANT SELECT ON core.enterprise_directory, core.enterprise_directory_source TO green_agent_ro;
GRANT SELECT, INSERT, UPDATE ON core.enterprise_directory, core.enterprise_directory_source TO green_app;

SELECT semantic.refresh_catalog();
UPDATE semantic.table_doc SET topic_code = 'org', queryable = true, origin = 'ai_draft', review_status = 'draft', updated_at = now(),
       business_name = v.business_name, grain = v.grain, usage_notes = v.usage_notes, caveats = v.caveats, synonyms = v.synonyms
  FROM (VALUES
    ('core.enterprise_directory', '企业目录', '一个企业 / 品牌基地 / 项目一行',
     '问“园区有哪些企业”“某企业是否在园区”时查本表；有能耗数据的企业通过 node_id 关联 core.org_node。在营企业用 entry_type in (''企业'',''品牌基地'')。',
     ARRAY['目录为逐名可溯源条目，不等于全部在营企业（2025 年公开报道规上工业企业 55 家）','历史企业已不在营','项目不是企业'],
     ARRAY['企业名录','企业目录','园区企业','入驻企业','有哪些企业']),
    ('core.enterprise_directory_source', '企业目录来源', '一个核验来源一行',
     '按 enterprise_directory.evidence 中的编号关联；引用时说来源标题与发布日期。',
     ARRAY[]::text[], ARRAY['目录来源'])
  ) AS v(object, business_name, grain, usage_notes, caveats, synonyms)
 WHERE semantic.table_doc.object = v.object;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0032', '导入批次 INSERT 发布事件（脚本导入触发语义目录治理）；企业目录与来源入库并登记语义目录');
