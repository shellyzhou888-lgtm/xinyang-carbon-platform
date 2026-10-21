# 数据库 Agent 与外部数据接入核查

核查日期：2026-10-21。本文区分代码已有能力、当前数据库状态和候选外部数据源；“官网有页面”不等于“提供可用的开放 API”。

## 数据库 Agent 的职责与边界

- 独立数据库 Agent（`packages/db-agent/src/agent.ts`、`tools.ts`）用 DeepSeek 理解问题，按需查询语义目录、规划关联、查询指标、能耗、碳排放、因子、覆盖率及治理工单，并记录会话和工具审计。其完整工具集还包括 Excel 导入、计算和受限写 SQL；写入受数据库角色、SQL 守卫和运行模式约束。
- 网页文字与小云语音目前共用 `packages/db-agent/src/manager.ts` 中的单个 Pi 总管。它先判断总览、能源、碳管理、综合诊断、企业名录、数据治理等任务范围，再直接选择相关只读数据库工具执行；不会连接或创建板块 Agent。这些入口不允许在对话中导入、重算或批准因子。
- 独立 Agent 本身不是定时采集器。数据同步应由确定性的连接器、调度任务和校验流程承担，Agent 负责解释数据、分析异常及辅助人工处理。

## 现在能否自动更新

结论：**高德天气与 NASA POWER 日值、小时值已接入并按本机 Windows 任务计划定时同步。**NASA POWER 没有分钟级接口。网页打开或提问本身仍不执行抓取；企业电表、光伏逆变器等现场实时采集尚未接通。

1. `apps/web/app/(platform)/admin/data/page.tsx` 明示网页上传表单尚未开放，企业能管、电网、光伏实时采集接口尚未接通。已入库数据可由动态页面在再次请求时读到，但这只是展示刷新。
2. Excel 导入流水线可保存原始文件、生成导入批次和原始记录、解析入业务表。`packages/ingest/src/ingest.ts` 支持在导入时指定计算；CLI 有 `--calc`。数据库 Agent 的 `import_excel` 工具导入后自动触发治理检查，**未自动调用** `engine.run_all`；需另行运行 `run_calculation` 才会更新能耗、碳核算及指标结果。
3. `raw.api_source` 有三个启用来源：`AMAP_WEATHER`、`NASA_POWER_DAILY` 与 `NASA_POWER_HOURLY`；`raw.api_sync_state` 记录逐请求分段的成功时间、哈希和错误。Windows 计划任务分别在本机整点与每日 02:00 运行 `scripts/run-weather-sync.ps1`。任务使用本机 SSH 隧道和被 Git 忽略的密钥文件；电脑关机或该账户未登录期间不能保证运行，恢复后补抓。
4. 既有 3 个 `source_type='api'` 批次来自 CEA、CCER、产品碳足迹公开网页的一次性采集；新增天气批次由 `weather-sync` 建立，原始 JSON 在 `raw.import_record`，标准化值在 `fact.weather_*`。天气参考数据不会伪装为实测能源活动；当前能源活动仍以估算数据为主。
5. 导入或计算后会在后台触发治理规则、生成问题记录；治理检查并不等于自动修复或自动审核。因子/公式变更尤其需要人工审核。

## 候选数据源

| 优先级 | 数据源 | 已核实接口性质 | 本项目用途 | 接入前提 |
| --- | --- | --- | --- | --- |
| P0 | 企业能管系统、电网计量、光伏逆变器、充电桩等业务系统 | 厂商或业主授权的私有接口；目前未取得统一公开 API 文档 | 用真实逐时/逐月读数替代估算值，是园区核算准确性的关键 | 明确系统厂商、授权、测点与企业编码、单位、时区、补传与修订规则 |
| P1 | [NASA POWER Daily/Hourly API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) | 官方开放的历史至近实时太阳辐照与气象时间序列 API，支持 JSON/CSV | 光伏资源评估、历史辐照训练数据、能耗模型历史气象协变量 | 园区坐标、参数与分辨率匹配；不能当作未来天气预报或电表实测值 |
| P1 | [高德天气 Web Service](https://lbs.amap.com/api/webservice/guide/api/weatherinfo) | 有正式文档的实况和短期天气预报 API | 当前温湿度、天气现象与未来数日昼夜温度，用于短期能耗分析 | Web Service Key、行政区编码、配额；普通天气接口不含太阳辐照度 |
| P1 | [全国碳市场 CEA 每日行情](https://overview.cneeex.com/c/2026-08-11/498128.shtml) | 官方公开网页；未核实开放 API | 碳价与交易量参考 | 交易所页面有发布/转载声明；先确认自动采集和平台展示许可，再建立带出处的定时同步 |
| P1 | [全国自愿减排 CCER 每日行情](https://www.ccer.com.cn/wcm/ccer/html/2502lshq/index.html) | 官方公开网页；未核实开放 API | CCER 市场价格、成交量参考 | 核对网站使用条款与自动采集权限；避免称作已接通 API |
| P2 | [国家温室气体排放因子数据库（第二版）](https://www.mee.gov.cn/ywgz/ydqhbh/wsqtkz/202603/t20260301_1145117.shtml) | 官方因子查询网站；未核实开放 API | 建立因子版本、来源、适用年份和行业口径 | 先核对权威原文和授权，人工审核后再启用新因子；不得静默覆盖现有计算因子 |
| P2 | [中国天气 SmartWeatherAPI](https://www.weather.com.cn/wzfw/smart/weatherapi.shtml) | 官方 Web API，须提交申请获批 | 更丰富的预报、预警数据 | 申请接口使用资格，评估是否比高德/NASA 更有价值 |

注意：电力**碳足迹因子**和电力消费**二氧化碳排放因子**用途、口径可能不同，不应自动互换。市场行情也不是园区自身排放活动数据。

## 高德天气与 NASA POWER 的实测取舍（2026-10-21）

- 使用新提供的高德 Web Service Key 对平桥区 `411503` 分别请求 `extensions=base`、`extensions=all`，两者均返回 `status=1`、`infocode=10000`。实况有天气、气温、湿度、风向/风力与发布时间；预报实际返回当天加未来三天共 4 天，字段为昼夜天气、温度、风向/风力。调用期间未在文件、日志或 Git 中保存 Key。
- [高德天气接口文档](https://lbs.amap.com/api/webservice/guide/api/weatherinfo)中没有辐照度（GHI/DNI/DHI）、日照时数、云量或逐时太阳辐照预报；仅凭“晴/多云”无法做可靠的定量光伏发电预测。短期空调与供暖负荷分析可先用高德温度，但需要持续收集才能积累历史训练样本。
- [NASA POWER](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) 在园区附近坐标的一次公开 API 请求验证了 `ALLSKY_SFC_SW_DWN`（单位 kWh/m²/日）、`T2M`（°C）和 `WS10M`（m/s）历史日值。其[太阳与气象数据发布延迟](https://power.larc.nasa.gov/docs/faqs/data/)约为 5–7 天和 2–3 天，适合历史资源评估与训练/校验，不提供未来四天的辐照预报；网格数据也不能代替现场辐照计和逆变器读数。
- 当前 `packages/forecast/forecast.py` 的 Chronos-2 月度能耗/碳排放预测只读取历史能耗与碳排放，不使用气象协变量；项目也没有独立的光伏逐日/逐时发电预测模型。因此两类气象 API **虽已入库，但尚未参与预测计算**。如果只做当前天气展示或几天内温度影响说明，高德足够；若要做可信的光伏预测，仍需未来辐照预报源与实际光伏发电量，并开发/回测对应模型。对 12 个月能耗预测，未来天气未知，应使用气候常年值或情景假设，不能把高德 4 天预报外推一年。

### NASA POWER 无需申请 Key 的调用示例

[NASA 官方入门说明](https://power.larc.nasa.gov/docs/tutorials/api-getting-started/)中的“Try it out”是填查询参数并执行，不是申请账号。2026-10-21 在浏览器直接打开下列请求，未提供任何凭据即返回成功的 JSON 数据：

```text
https://power.larc.nasa.gov/api/temporal/daily/point?parameters=ALLSKY_SFC_SW_DWN,T2M,WS10M&community=RE&longitude=114.12&latitude=32.22&start=20251001&end=20251003&format=JSON
```

- `parameters`：`ALLSKY_SFC_SW_DWN` 为全天候水平面太阳短波辐照量（返回单位 kWh/m²/日），`T2M` 为 2 米气温（°C），`WS10M` 为 10 米风速（m/s）；`community=RE` 表示可再生能源场景。
- `longitude`、`latitude`：此处为园区附近的演示点，不是已经核准的园区中心 WGS84 坐标。正式接入前应选定园区或光伏站 WGS84 坐标；不要直接把高德地图 GCJ-02 坐标当作精确采样点。
- `start`、`end`：历史日期，格式为 `YYYYMMDD`；`format=JSON` 便于程序解析。若用官方交互页面，依次填同样的值并按“Execute”，无需注册或填写 API Key。

### 更多可用字段与时间范围（2026-10-21 验证）

NASA 的[参数字典](https://power.larc.nasa.gov/docs/tutorials/parameters/)和 [Manager 参数目录](https://power.larc.nasa.gov/docs/services/api/system/manager/)按使用场景、日/小时尺度列出可用参数。在上述演示地点与日期，一次 Daily API 请求实测以下 **13 个参数均有返回**；[官方限制](https://power.larc.nasa.gov/docs/services/api/temporal/daily/)为单点单次最多 20 个参数。

| 用途 | 参数 | 返回单位 | 说明 |
| --- | --- | --- | --- |
| 光伏核心 | `ALLSKY_SFC_SW_DWN`、`ALLSKY_SFC_SW_DNI`、`ALLSKY_SFC_SW_DIFF` | kWh/m²/日 | 水平面总辐照（GHI）、法向直射（DNI）、散射辐照；估算组件面辐照需另有倾角/朝向 |
| 光伏辅助 | `CLRSKY_SFC_SW_DWN`、`CLOUD_AMT` | kWh/m²/日、% | 晴空基准辐照和云量，用于解释实际辐照偏低的天气原因 |
| 光伏及能耗 | `T2M`、`T2M_MAX`、`T2M_MIN`、`RH2M`、`WS10M` | °C、%、m/s | 平均/最高/最低气温、相对湿度、风速；气温与风速还影响组件温度 |
| 能耗辅助 | `PRECTOTCORR`、`CDD18_3`、`HDD18_3` | mm/日、°C·日 | 降水、18.3°C 基准的制冷/采暖度日；度日主要解释空调和采暖负荷，不能直接解释工艺能耗 |

**时间范围需要分开理解：**旧浏览器演示请求 `start=20251001&end=20251003` 只取 2025-10-01 至 2025-10-03 **3 天**；正式同步另行从 2021-01-01 回填至各字段最近有效日期。NASA [Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/)总体覆盖 1981 年至近实时，但[气象源](https://power.larc.nasa.gov/docs/methodology/communities/)可追溯至 1981 年、太阳辐照源一般从 1984 年开始，且具体字段可能更晚；[Hourly API](https://power.larc.nasa.gov/docs/services/api/temporal/hourly/)从 2001 年至近实时。以 2026-10-21 的现场查询为例，该地点最后有效的 `ALLSKY_SFC_SW_DWN` 为 2026-10-16，`T2M` 为 2026-10-18；近实时末日会随发布进度变化。NASA 的近实时数据不是未来预报。

**各字段最新有效日期（2026-10-21，114.12°E、32.22°N）：**`T2M`、`T2M_MAX`、`T2M_MIN`、`RH2M`、`WS10M`、`PRECTOTCORR`、`CDD18_3`、`HDD18_3` 均到 **2026-10-18**；`ALLSKY_SFC_SW_DWN` 到 **2026-10-16**；`CLRSKY_SFC_SW_DWN` 到 **2026-10-11**；`ALLSKY_SFC_SW_DNI`、`ALLSKY_SFC_SW_DIFF`、`CLOUD_AMT` 均只到 **2026-07-30**。这是逐字段排除 `-999` 缺测占位后的结果；请求的 `end` 日期或 JSON 中出现的日期不能视作都有有效数据。接入时应逐字段记录实际可用末日与缺测情况，不能假设所有太阳辐照字段都只有常规的数日延迟。

### 小时级接入与分钟级边界

[NASA POWER Hourly API](https://power.larc.nasa.gov/docs/services/api/temporal/hourly/) 返回逐小时平均值；本项目已验证并接入 `ALLSKY_SFC_SW_DWN`、`ALLSKY_SFC_SW_DNI`、`ALLSKY_SFC_SW_DIFF`、`CLOUD_AMT`、`T2M`、`RH2M`、`WS10M`、`PRECTOTCORR`。小时太阳辐照单位为 `Wh/m²`，降水为 `mm/hour`，温湿度、风速为 `°C`、`%`、`m/s`。请求显式指定 `time-standard=UTC`，在 `fact.weather_hourly.period_at` 保存带时区时间戳；`-999` 缺测不入库，异常值标为 `suspect`，原始 JSON 留在 `raw.import_record`。

示例：

```text
https://power.larc.nasa.gov/api/temporal/hourly/point?parameters=ALLSKY_SFC_SW_DWN,T2M,RH2M,WS10M&community=RE&longitude=114.12&latitude=32.22&start=20261015&end=20261015&format=JSON&time-standard=UTC
```

NASA POWER 官方时间序列接口提供小时、日、月等粒度，**不提供分钟级气象值**。不能把小时值插值成“真实分钟值”。分钟级实时监测需要园区现场气象站、辐照计等测点及其采集接口；TimescaleDB 可以用于存储高频数据，但启用扩展本身不会产生分钟观测。小时值是历史至近实时网格参考数据，不能代替未来逐小时辐照预报。

### 已落地的自动同步与处理

- 首轮导入（2026-10-21）：NASA 从 2021-01-01 回填 13 个参数，排除 `-999` 后在 `fact.weather_daily` 得到 **27,207** 条日值；高德 `411503` 实况与未来 4 天预报分别进入 `fact.weather_live`、`fact.weather_forecast`，随接口发布继续积累快照。每次响应另存 `raw.import_batch` 与 `raw.import_record`，不会混入能源活动或碳排放实测表。
- 高德每小时整点检查两种接口，按 `reporttime` 和响应内容去重，保留历次实况与预报版本。NASA 每天按自然年查询 12 个日值参数；年初至 4 月还检查上一自然年，以接住发布滞后的太阳辐照字段。降水 `PRECTOTCORR` 单独按月拉取小时值，完整 24 小时求和为 mm/日，日常复查最近 6 个月。响应哈希不变时跳过写入，变更时按“日期+参数”幂等更新；每字段的最新响应日、最新可信日和异常数见 `mart.weather_parameter_latest`，状态见 `mart.weather_sync_health`。总管 Agent 的 `get_weather_data` 可读取这些状态与数据。
- NASA 小时数据按月拉取，日常至少复查最近 6 个月；若太阳辐照/云量的末时更早，则从最早末时的前一个月开始复查，以接住滞后发布。数据按“UTC 小时+参数”幂等更新；逐参数有效末时与异常数见 `mart.weather_hourly_parameter_latest`。总管 Agent 的 `get_weather_data` 同时提供最新 24 条逐参数小时值。小时事实表保留为普通 PostgreSQL 索引表，尚未启用 TimescaleDB。
- 2026-10-21 已回填 2021-01 起 **398,976** 条有效小时值（8 参数，`suspect=0`），70 个逐月原始响应批次均已保存。逐小时辐照/云量最新到 2026-07-31 23:00 UTC；温湿度、风速、降水到 2026-10-19 23:00 UTC。现有本机每日任务会继续更新这些数据，但不能消除 NASA 上游的发布延迟。
- 质量核验发现 NASA 长区间日接口对部分降水日给出 **24 倍**数值，例如 2026-06-19 返回 1130.4 mm/日，而小时值求和为 47.1 mm/日。已用小时求和重算 2025-10 至 2026-10 的降水；2026-07-02 的小时响应含异常值，转用同日单日接口的 1.82 mm/日。标准化表目前 **27,207 条均为 `ok`**；原始异常响应与纠正响应均保留，`fact.weather_daily.derivation` 标识直接日值或小时求和。后续若来源数据超出合理范围仍标为 `suspect`，分析时需排除待复核值。
- 调度运行在当前 Windows 用户会话，依赖电脑开机、用户已登录、外网可用和 SSH 数据库隧道可建立；它不能让 NASA 提前发布新数据。日志保存在被 Git 忽略的 `storage/logs/weather-sync.log`。重新安装：`powershell -File scripts/install-weather-tasks.ps1`；手工补抓：在 `packages/ingest` 运行 `npm run sync:weather -- --backfill`。调度结果可用 `Get-ScheduledTaskInfo` 核对。若要无人登录仍持续更新，应将同一连接器迁移到常驻服务器的任务调度。

## 建议的自动更新链路

按优先级先做企业能源实测数据接入，再做气象与市场参考数据。每个连接器应执行：按计划拉取 → 保存原始响应及来源/发布时间/校验值 → 幂等解析并校验单位、时间和对象编码 → 写入导入批次与事实表（保留修订历史）→ 对受影响年份执行计算 → 运行治理检查 → 告警并在页面显示最近同步时间及数据质量。因子更新单独进入待审流程，批准后才重算。Pi Agent 可读取这些同步状态、解释异常和建议处理，但不应承担无人值守的抓取与写库调度。

本次仅核查与提出接入顺序，未新增连接器、调度任务或外部账号。
