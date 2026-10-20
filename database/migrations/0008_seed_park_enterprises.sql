-- 0008 参考数据：园区对象树骨架、公开资料中已确认的企业档案与荣誉
-- 执行身份：postgres 连接后 SET ROLE greensystem。事务由执行脚本控制。
-- 来源见 docs/园区企业公开信息.md；坐标、部分法人全称未查到，留空待园区提供。

SET ROLE greensystem;

-- 1. 园区、片区、公共区域 ------------------------------------------------------
INSERT INTO core.org_node (node_type, code, name, attributes) VALUES
  ('park', 'XYEDZ', '信阳经济技术开发区',
   '{"level":"省级","planned_area_km2":15.6,"management":"与羊山新区实行双轮驱动管理",
     "source":"信阳日报 2023-09-19"}');

INSERT INTO core.org_node (parent_id, node_type, code, name, function_tag, remark, attributes)
SELECT p.node_id, t.node_type, t.code, t.name, t.func, t.remark, t.attrs::jsonb
FROM core.org_node p,
(VALUES
  ('zone',        'Z_HOME',   '绿色家居片区（家居小镇）',   'production',     '羊山新区家居小镇',
   '{"park_category":"green_home"}'),
  ('zone',        'Z_ELEC',   '电子信息片区（金牛园区）',   'production',     '金牛园区电子科技园；并入经开区的批复文件待核实',
   '{"park_category":"electronics"}'),
  ('zone',        'Z_INNOV',  '智慧岛与科创部落',           'office',         '科创研发片区',
   '{"park_category":"service"}'),
  ('public_area', 'P_PUBLIC', '园区公共设施',               'infrastructure', '管委会办公、公共照明、泵站、交通等，待细分',
   '{}')
) AS t(node_type, code, name, func, remark, attrs)
WHERE p.code = 'XYEDZ';

-- 2. 企业节点 ---------------------------------------------------------------
INSERT INTO core.org_node (parent_id, node_type, code, name, industry_code, function_tag, remark)
SELECT z.node_id, 'enterprise', t.code, t.name, t.ind, 'production', t.remark
FROM (VALUES
  ('Z_HOME', 'E_WANHUA',    '万华生态（信阳）',       '202', '无醛秸秆生态板；年产 70 万 m3 产业园 2022 年投产'),
  ('Z_HOME', 'E_ZHUMEI',    '现代筑美（信阳基地）',   'C21', '碧桂园旗下整家定制家居；法人全称待核实'),
  ('Z_HOME', 'E_YADAN',     '亚丹生态（信阳）',       'C21', '生态定制家居，2023-08-06 投产'),
  ('Z_HOME', 'E_YONGHAOXUAN','永豪轩家具',            'C21', '河南省家具出口领先企业'),
  ('Z_HOME', 'E_TIANYI',    '天一美家（信阳基地）',   'C21', '门窗、红木家具；法人全称待核实'),
  ('Z_HOME', 'E_BAIDE',     '百德木门（信阳基地）',   'C20', '木门；法人全称待核实'),
  ('Z_ELEC', 'E_GUMAI',     '谷麦光电（信阳）',       '397', 'LED 光源、背光源、光学器件'),
  ('Z_ELEC', 'E_JINSHANG',  '今上半导体（信阳）',     '397', '半导体分立器件、集成电路'),
  ('Z_ELEC', 'E_XINGYUAN',  '星原智能',               'C39', '通信与智能终端设备'),
  ('Z_ELEC', 'E_QINJIE',    '螓杰智能',               'C39', '所在片区待核实')
) AS t(zone, code, name, ind, remark)
JOIN core.org_node z ON z.code = t.zone;

-- 3. 企业档案（只填公开资料可确认的字段）-----------------------------------------
INSERT INTO core.enterprise_profile
  (node_id, legal_name, credit_code, parent_company, founded_on, registered_capital_wan, address, main_products,
   is_high_tech, high_tech_cert_no, source_url, attributes)
SELECT n.node_id, t.legal, t.credit, t.parent, t.founded, t.capital, t.addr, t.products, t.hightech, t.cert, t.url, t.attrs::jsonb
FROM (VALUES
  ('E_WANHUA', '万华生态板业（信阳）有限公司', '91411500664697189K', '万华生态板业股份有限公司', DATE '2007-08-08', NULL::numeric, NULL,
   '禾香板等秸秆无醛生态板', NULL::boolean, NULL, 'https://baike.baidu.com/item/万华生态板业（信阳）有限公司/1085274',
   '{"investment_wan":200000,"capacity_m3_per_year":700000}'),
  ('E_ZHUMEI', '现代筑美家居（信阳基地）', NULL, '碧桂园集团', NULL, NULL, '羊山新区家居小镇',
   '橱柜、浴室柜、木门、地板等整家定制家居', NULL, NULL, 'http://wap.baoxiaofeng.com/news/136740.html',
   '{"legal_name_verified":false,"site_area_mu":1000}'),
  ('E_YADAN', '亚丹生态科技（信阳）有限公司', NULL, '亚丹生态家居（广东）有限公司（51%）、信阳经开区产业投资有限公司（49%）', DATE '2023-03-21', 4081.63,
   '信阳市羊山新区家居小镇纬北五路西段', '生态定制家居', NULL, NULL, 'https://news.qq.com/rain/a/20230809A09NOX00',
   '{"investment_wan":100000,"production_start":"2023-08-06"}'),
  ('E_YONGHAOXUAN', '信阳永豪轩家具有限公司', NULL, NULL, DATE '2013-12-06', 1000, '信阳市羊山新区',
   '家居产品生产销售与进出口', NULL, NULL, 'http://wap.baoxiaofeng.com/news/136740.html', '{}'),
  ('E_TIANYI', '天一美家（信阳基地）', NULL, '广东天一美家家居集团有限公司', NULL, NULL, '信阳家居小镇',
   '门窗、红木家具', NULL, NULL, 'http://m.gdtymj.com/about-1.html',
   '{"legal_name_verified":false,"site_area_mu":500,"investment_wan":120000}'),
  ('E_BAIDE', '百德木门（信阳基地）', NULL, NULL, NULL, NULL, '信阳家居小镇', '木门', NULL, NULL,
   'https://www.plseng.com/2018/0613/246894.shtml', '{"legal_name_verified":false,"site_area_mu":150}'),
  ('E_GUMAI', '信阳市谷麦光电子科技有限公司', '91411502MA3XG3BLXL', '谷麦光电科技股份有限公司（100%）', DATE '2016-12-06', 8000,
   '信阳市浉河区金牛产业集聚区富强路1号', 'SMD/CSP LED、导光板、背光源、光学透镜', NULL, NULL,
   'https://i.gasgoo.com/supplier/35325933', '{}'),
  ('E_JINSHANG', '今上半导体（信阳）有限公司', NULL, NULL, NULL, NULL, '金牛集聚区电子信息智能产业园',
   '半导体分立器件、集成电路、显示器件', NULL, NULL,
   'https://app.dahecube.com/nweb/news/20221205/147443n471b1456025.htm?artid=147443',
   '{"investment_wan":100000,"production_start":"2022-03","output_2022_wan":27500}'),
  ('E_XINGYUAN', '信阳星原智能科技有限公司', '91411500MA9K66WY2J', NULL, DATE '2021-09-08', 3000,
   '河南省信阳市羊山新区新申街道金工大道智能产业园2号、4号厂房', '通信设备、移动终端、可穿戴设备、显示器件', NULL, NULL,
   'https://m.qcc.com/firm/83b60c83d27f2e92d1a3ba351b81b3a7.html', '{}'),
  ('E_QINJIE', '河南螓杰智能科技有限公司', NULL, NULL, NULL, NULL, NULL, NULL, true, 'GR202341000426',
   'https://gyhxxhj.xinyang.gov.cn/2024/12-16/258154.html', '{}')
) AS t(code, legal, credit, parent, founded, capital, addr, products, hightech, cert, url, attrs)
JOIN core.org_node n ON n.code = t.code;

-- 4. 荣誉 -------------------------------------------------------------------
INSERT INTO core.honor (node_id, honor_type, level, title, year, issuer, source_url, counts_for_indicator, show_on_screen)
SELECT n.node_id, t.htype, t.lvl, t.title, t.yr, t.issuer, t.url, t.counts, true
FROM (VALUES
  ('XYEDZ',      'green_park',          'provincial', '2024 年度河南省省级绿色工业园区', 2024::smallint, '河南省工业和信息化厅',
   'https://www.cnblogs.com/iso27001/p/18315787', false),
  ('Z_HOME',     'industry_cluster',    'provincial', '河南省中小企业特色产业集群（信阳经开区绿色家居产业集群）', 2023, '河南省工业和信息化厅',
   'http://wap.baoxiaofeng.com/news/136740.html', false),
  ('E_GUMAI',    'green_factory',       'provincial', '2024 年度河南省省级绿色工厂', 2024, '河南省工业和信息化厅',
   'https://www.cnblogs.com/iso27001/p/18315787', true),
  ('E_XINGYUAN', 'green_factory',       'provincial', '2024 年度河南省省级绿色工厂', 2024, '河南省工业和信息化厅',
   'https://www.cnblogs.com/iso27001/p/18315787', true),
  ('E_XINGYUAN', 'zero_carbon_factory', 'provincial', '河南省第一批“零碳”工厂', 2024, '河南省工业和信息化厅',
   'https://gyhxxhj.xinyang.gov.cn/2024/12-16/258154.html', false),
  ('E_QINJIE',   'zero_carbon_factory', 'provincial', '河南省第一批“零碳”工厂', 2024, '河南省工业和信息化厅',
   'https://gyhxxhj.xinyang.gov.cn/2024/12-16/258154.html', false),
  ('E_QINJIE',   'high_tech',           'national',   '高新技术企业（GR202341000426）', 2023, '河南省认定机构',
   'http://www.innocom.gov.cn/', false),
  ('E_GUMAI',    'little_giant',        'national',   '国家级专精特新“小巨人”企业（谷麦光电）', NULL, '工业和信息化部',
   'http://wap.baoxiaofeng.com/news/136740.html', false),
  ('E_WANHUA',   'smart_factory',       'national',   '国家级 5G 工厂（万华禾香）', 2024, '工业和信息化部',
   NULL, false)
) AS t(code, htype, lvl, title, yr, issuer, url, counts)
JOIN core.org_node n ON n.code = t.code;

RESET ROLE;

INSERT INTO audit.schema_migration (version, description)
VALUES ('0008', '参考数据：园区对象树骨架、10 家企业档案与荣誉（公开资料）');
