# 交接说明：碳管理与诊断页面可用的新数据（交给负责网站页面的会话）

> 使用方法：把下面“正文”发给正在开发 `apps/web`（`/diagnosis`、`/carbon`、`/energy` 页面）的会话。数据层由另一个会话维护，页面由你维护；请只改页面与 `apps/web` 下的文件，数据结构有问题时提出，不要直接改 `packages/db-agent/src/carbon-management.ts` 以外的数据库函数。

---

## 正文

数据库已执行迁移 0025、0026，并写入了模拟数据（`data_source = estimated`）。请用下面的数据完善页面，页面上要明确标注“模拟数据，仅供演示”。

### 1. 取数接口

`@xinyang/db-agent` 已导出 `getCarbonManagementData(year)`（只读，类型 `CarbonManagementData`，见 `packages/db-agent/src/carbon-management.ts`）。在 `apps/web/lib/server.ts` 中像 `charts()`、`management()` 一样包一层即可。返回：

| 字段 | 内容 | 建议放在 |
| --- | --- | --- |
| `plans` | 当年预警对应的**策略推荐**：预警、严重度、企业、策略、类别、节能量 `tce_saving`（tCO2 减排见 `co2_reduction_t`）、`simulated` | `/diagnosis?tab=strategies`：改为按企业或预警分组显示推荐清单，节能量和减碳量都显示，`simulated = true` 时标“参数为模拟值”；策略库保留为次要区块 |
| `budget` | 用能、碳排放的月度实际值、累计值与预算累计线（`annual_budget` 为年度预算） | 预算对比折线：累计实际 vs 累计预算，超出部分标红 |
| `targets` | 年度目标：用能/碳预算、能耗/碳排放强度、绿电与可再生能源占比、达峰上限，含 `basis` 说明 | 目标卡片或表格，显示依据 |
| `roadmap` | 碳达峰路线图：`actual`（2021 起实际）+ `scenarios`（`ROADMAP_BASE` 基准、`ROADMAP_LOWCARBON` 低碳，2026–2030 年度值、达峰年份与峰值） | `/carbon` 或 `/diagnosis?tab=forecast`：柱 + 线，标出达峰年份和目标上限（`targets` 中 `carbon_peak_t`） |
| `carbon_price` | CEA、CCER 最新价与月度均价、成交量 | 碳资产区块；当前为空（等待服务器导入），空时显示“暂无行情数据” |
| `footprint_refs` | 产品碳足迹参考值（`status = draft` 时标“待审核”） | 产品碳足迹区块；当前为空 |
| `storage` | 储能充放电、充电桩月度电量 | 清洁能源区块 |
| `available` | 迁移未执行时为 `false` | — |

### 1.1 碳资产与产品碳足迹对照（v0.24.0 起）

- `getCarbonAsset(2021, 2026)`：各年 CEA 年均价、CCER 加权均价，园区与各企业的碳排放、碳成本敞口（万元）、占产值比例、CCER 抵销可节省；`assumptions` 为必须在页面显示的测算假设（企业未纳入全国碳市场，此为敞口测算）。建议放在 `/carbon` 碳资产区块：碳价走势 + 碳成本柱图 + 企业排名。
- `getFootprintComparison(year)`：有产品产量的企业的厂内碳强度与适用参考值（含 `ratio_pct`、`status`、`boundary`），以及缺数据的企业清单；`notes` 说明边界差异，页面必须显示，不要把比例写成“优于行业”。

### 2. 预警的新结构（0026 起）

- **只默认显示 `status = 'open'` 的预警。** 每次重新运行诊断时，旧预警会被置为 `resolved`（2025 年目前有 9 条 open、62 条 resolved）；`management()` 的 `alerts` 查询没有按状态筛选，页面会把已解决的一起列出。请改为只取 open，已解决的折叠到“历史记录”。
- 同比预警改为**每年每项一条**（不再每月一条）。`root_cause` 结构：`{ months: [{month, deviation_pct, observed, baseline}], top_contributors: [{node, name, delta, share_pct}], annual_change_pct }`。请把 `months` 画成小柱图或表格、`top_contributors` 画成贡献条，不要直接显示 JSON。
- 预算预警 `root_cause`：`{ budget_annual, months, basis, target_id }`；`basis` 为“1–12 月实际”或“全年预测”。
- 强度预警（`INTENSITY_HIGH`）的观测值和基线是 tce/万元，量级 0.1–0.3，当前页面按整数格式显示成“0.3 / 0.1”，请保留 4 位小数。
- 指标未达标预警 `root_cause.strategy_categories` 为推荐的策略类别。

### 3. 能流桑基图

`fact.energy_transfer` 已有万华、谷麦、今上的“企业 → 厂区 → 产线”分摊（电 kWh、天然气 m³、热力 GJ，每月一行，`allocation_rule` 以“模拟分项”开头），现有 `management()` 的 `transfers` 已能读到。建议按能源品种分别画桑基图（不同单位不能相加），或先折成 tce 再合并。

### 4. 不要做的事

- 不要在页面上编造节能量、价格或目标；没有数据时显示空状态。
- 不要修改数据库结构或写数据；需要新字段时提出需求。
