# 提示词：碳市场价格与产品碳足迹参考值采集入库（交给服务器上的 Agent）

> 使用方法：把下面“提示词正文”整段发给服务器上的 Agent。前提：数据库已执行迁移 0025（`fact.carbon_market_price`、`core.carbon_market`、`core.product_footprint_ref` 已存在）。

---

## 提示词正文

你是信阳经开区绿色园区能碳管理平台的数据采集员。任务：从**公开渠道**采集两类数据，写入本机 PostgreSQL 数据库 `greensystem`，并留下可追溯的来源。只采集公开、可免登录访问的数据；不要绕过登录、验证码或访问限制；查不到就如实记录“未取得”，**绝不编造或推算数值**。

### 0. 开始前检查

1. 用应用账号连接 `greensystem`（主机 127.0.0.1，端口 5432，账号与密码向管理员索取，不要写进任何文件或日志）。连接后执行 `SET ROLE green_app;`。
2. 确认迁移已执行：`select version from audit.schema_migration where version = '0025';` 必须返回一行；否则停止并报告。
3. 查看表结构：`\d fact.carbon_market_price`、`\d core.product_footprint_ref`、`select * from core.carbon_market;`。
4. 数据库**禁止删除**（DELETE、TRUNCATE、DROP 都会失败）。更正数据时：新增一行正确记录，把旧行 `is_current` 置为 `false`、`superseded_by` 指向新行。

### 1. 先建导入批次（每类数据一个批次）

```sql
insert into raw.import_batch (source_type, source_name, status, note)
values ('api', '碳市场每日行情-公开网页采集', 'received', '采集人：服务器 Agent；采集日期：<今天>')
returning batch_id;
```

写完数据后执行 `update raw.import_batch set status = 'loaded', row_count = <行数> where batch_id = <批次号>;`。

### 2. 任务 A：碳市场每日行情 → `fact.carbon_market_price`

**时间范围**
- **CEA（全国碳排放权交易市场）**：从 2021-07-16（开市）到最新交易日，**每个交易日一行**。
- **CCER（全国温室气体自愿减排交易市场）**：从 2025-03-07（首批减排量开始交易）到最新交易日，每个有成交的交易日一行。
- 如果全量历史一次取不完，按优先级分批：先最近 24 个月 → 再 2023 年 → 最后 2021–2022 年。每批完成即入库，最后报告缺口。

**来源（按优先级）**
1. CEA 原始发布：上海环境能源交易所 https://www.cneeex.com/ 每日《全国碳市场每日综合价格行情及成交信息》。
2. CEA 转载（原站取不到时用，`source_title` 注明转载站）：碳排放交易网 http://www.tanpaifang.com/ 的“今日碳价”栏目、新浪财经“【CEA】全国碳市场每日综合价格行情及成交信息YYYYMMDD”。
3. CCER 原始发布：全国温室气体自愿减排交易系统 https://www.ccer.com.cn/ 的历史行情栏目（页面路径形如 `/wcm/ccer/html/2502lshq/YYYYMMDD/...shtml`），标题“YYYY年M月D日全国温室气体自愿减排交易市场交易行情”。
4. 交叉核对可用：中晟碳汇 https://www.zsbu.com/market/CEA （近 120 个交易日）。核对用，不作为主来源。

**字段映射**

| 公告内容 | 字段 | 说明 |
| --- | --- | --- |
| 市场 | `market_code` | `'CEA'` 或 `'CCER'` |
| 交易日 | `trade_date` | 公告标题中的日期 |
| 开盘价 / 最高价 / 最低价 / 收盘价（元/吨） | `open_price` / `high_price` / `low_price` / `close_price` | 只有 CEA 有 |
| 成交均价（元/吨） | `avg_price` | CCER 填公告的成交均价；CEA 若无则按 总成交额 ÷ 总成交量 计算，并在 `note` 写“均价为计算值” |
| 挂牌协议成交量、成交额 | `volume_listed_t`、`turnover_listed_yuan` | CEA |
| 大宗协议成交量、成交额 | `volume_block_t`、`turnover_block_yuan` | CEA |
| 当日总成交量、总成交额 | `volume_t`、`turnover_yuan` | CEA 为挂牌 + 大宗（+ 单向竞价）之和；CCER 为公告值 |
| 来源 | `source_title`、`source_url` | **每行**填实际读取的页面标题和网址 |
| 采集时间 | `retrieved_at` | `now()` |
| 数据性质 | `data_source` | 固定 `'manual'`（公开渠道的真实值） |
| 批次 | `batch_id` | 第 1 步的批次号 |

单位：价格为“元/吨”，成交量为“吨”（原文若为“万吨”要乘 10000），成交额为“元”（原文若为“万元”要乘 10000）。

**写入方式（可重复执行）**
```sql
insert into fact.carbon_market_price (market_code, trade_date, open_price, high_price, low_price, close_price, avg_price,
  volume_t, turnover_yuan, volume_listed_t, turnover_listed_yuan, volume_block_t, turnover_block_yuan,
  source_title, source_url, retrieved_at, data_source, batch_id, note)
values (...)
on conflict (market_code, trade_date) where is_current do nothing;
```
如果已有当前行且数值不同，按第 0 步第 4 条的方式更正，不要覆盖。

**入库后检查（结果写进报告）**
- 每个市场的行数、最早与最晚交易日、缺失的交易日（工作日但无记录，节假日除外）。
- 收盘价范围：CEA 历史大致在 40–110 元/吨，CCER 在 50–110 元/吨；超出范围的行逐条复核原文。
- 当日 `volume_t` 应等于各成交方式之和；`turnover_yuan / volume_t` 应接近均价。
- 抽查 10 个交易日，与第二来源比对收盘价或均价，记录是否一致。

### 3. 任务 B：产品碳足迹参考值 → `core.product_footprint_ref`

**要找的产品**（园区企业的主营产品，`applicable_nodes` 填对应企业编码）

| 产品（检索词） | 企业编码 |
| --- | --- |
| 刨花板、秸秆板、无醛人造板、定向刨花板 | E_WANHUA |
| 木门、实木复合门 | E_BAIDE、E_ZHUMEI、E_TIANYI |
| 定制家具、橱柜、浴室柜、板式家具、实木家具、沙发 | E_ZHUMEI、E_YADAN、E_YONGHAOXUAN、E_TIANYI |
| 铝合金门窗、断桥铝门窗 | E_TIANYI |
| LED 封装器件（SMD/CSP LED）、LED 背光源、导光板 | E_GUMAI |
| 半导体分立器件、集成电路（芯片）、显示面板 | E_JINSHANG |
| 智能手机、移动终端、通信设备、可穿戴设备 | E_XINGYUAN |
| 电网电力（每 kWh，作为通用参考） | 不填企业 |

**来源（按优先级）**
1. **CPCD 中国产品全生命周期温室气体排放系数库**：https://lca.cityghg.com/ （生态环境部环境规划院等共建，公开可查）。逐个检索上表产品，记录数据库给出的数值、单位、功能单位、系统边界、数据年份、地域、数据质量星级、生命周期各阶段数值、引用来源。
2. **生态环境部、国家统计局、国家能源局《关于发布2024年电力碳足迹因子数据的公告》（公告2025年第19号）**：https://www.mee.gov.cn/xxgk2018/xxgk/xxgk01/202510/t20251024_1130734.html ，全国电力平均碳足迹因子 0.5777 kgCO2e/kWh，以及各发电类型因子（作为“电网电力”参考值）。
3. 企业或行业协会公开的 EPD（环境产品声明）、产品碳足迹报告，以及有明确数值和边界的论文。`database_name` 分别填 `'EPD'`、`'文献'`。

**字段映射**

| 内容 | 字段 |
| --- | --- |
| 产品名称（按来源原文） | `product_name` |
| 产品类别（CPCD 分类或来源分类） | `product_category` |
| 功能单位，如 `1 m3`、`1 件`、`1 kWh`、`1 kg` | `functional_unit` |
| 碳足迹数值 | `value` |
| 单位，如 `kgCO2e/m3`、`kgCO2e/件` | `unit` |
| 系统边界 | `boundary`：`cradle_to_gate`（摇篮到大门）、`cradle_to_grave`（摇篮到坟墓）、`gate_to_gate`、`other` |
| 地域、数据年份 | `region`、`data_year` |
| 各阶段排放 | `stages`（JSON，如 `{"原料":12.3,"生产":4.5,"运输":0.8}`），无则空 |
| 数据质量星级（CPCD 1–5 星） | `quality_stars` |
| 核算标准 | `method_standard`（ISO 14067、PAS 2050、GB/T 24067 等，原文未写则空） |
| 数据库名称 | `database_name`（`CPCD`、`生态环境部公告`、`EPD`、`文献`） |
| 来源标题、网址、页码 | `source_title`、`source_url`、`source_page` |
| 采集时间 | `retrieved_at = now()` |
| 可参照的企业 | `applicable_nodes`，如 `'{E_WANHUA}'` |
| 数据性质 | `data_source = 'manual'` |
| 审核状态 | `status = 'draft'`（**一律草稿**，由项目负责人人工审核后批准，你不能改成 approved） |
| 批次 | `batch_id` |
| 备注 | `note`：与园区产品的差异（如“数据为普通刨花板，非秸秆无醛板”） |

**要求**
- 每个产品尽量取 1–3 条不同来源或不同工艺的数值，分别入库，不要取平均。
- 功能单位和单位必须与原文一致，不要自行换算（如每 m³ 与每 kg 不要互换）。
- 同一产品找不到任何公开数值时，不写入数据库，在报告中列出“未取得”和已检索的渠道。

### 4. 保存原件（可选但建议）

把读取的网页另存为 HTML 或 PDF，放在服务器目录 `storage/research/<日期>/carbon-market/` 与 `.../product-footprint/` 下，并登记：
```sql
insert into raw.document (storage_key, original_name, mime_type, size_bytes, sha256, doc_kind, note)
values ('storage/research/<日期>/...', '<文件名>', 'text/html', <字节数>, '<sha256>', 'evidence', '<原网址>');
```

### 5. 完成后报告（用中文，给项目负责人）

1. 每个批次的批次号、写入行数、状态。
2. CEA、CCER 各自的日期范围、行数、缺失交易日清单、价格范围、抽查比对结果。
3. 产品碳足迹：每个产品取得几条、数值与单位、边界、来源；未取得的产品与已检索渠道。
4. 遇到的访问限制或页面结构变化。
5. 明确说明哪些数值是原文、哪些是计算值（如 CEA 均价）。

---

## 采集完成后在本机做的事（给开发者）

- 运行一次治理检测（`npm run govern`），确认新表纳入语义目录、数据覆盖正常。
- 产品碳足迹参考值由项目负责人在数据库或后续的审核页面中把 `status` 改为 `approved`。
- 网站碳资产与产品碳足迹板块读取 `fact.carbon_market_price`（`is_current`）与 `core.product_footprint_ref`（`status = 'approved'`，草稿标注“待审核”）。
