# 数据库 Agent（Pi 架构 + DeepSeek）v0.1

> 代码：`packages/db-agent`｜模型：DeepSeek（默认 `deepseek-flash`，可切换 `deepseek-v4-pro`）
> 框架：`@earendil-works/pi-ai` 1.3.0（多家模型统一接口）、`@earendil-works/pi-agent-core` 1.3.0（Agent 循环）
> 能力范围：全自动管理（查询、解释、导入、计算、补录与建表）；删除和审批由数据库和工具层拦截

## 1. 原理：Agent 是“模型 + 工具 + 循环”

```text
用户问题
  │
  ▼  pi-agent-core 的 Agent 循环
  ├─ 把 系统提示词 + 对话 + 工具清单 发给 DeepSeek（经 pi-ai）
  ├─ 模型决定：直接回答，或调用工具（可一次调多个）
  ├─ beforeToolCall 钩子：调用上限、确认模式
  ├─ 执行工具（我们的代码访问数据库）
  ├─ afterToolCall 钩子：写审计日志
  ├─ 工具结果交回模型 → 继续，直到给出最终回答
  ▼
回答（数字都来自工具结果）
```

**模型从不直接连接数据库**，只能调用我们定义的工具。设计 Agent 的核心是设计工具和权限，而不是写提示词。

### 为什么用 Pi

- TypeScript 库，可以直接嵌进 Next.js 服务端。
- 模型可替换：DeepSeek 是内置提供方，也能接其他国产模型或私有化部署的模型。
- 循环、钩子、事件流这些基础件都有；业务逻辑（工具、权限、审计）由我们自己控制。

## 2. 三层安全保护

| 层 | 机制 | 防住什么 |
| --- | --- | --- |
| 数据库层 | 所有业务角色无 DELETE、TRUNCATE；事件触发器拦截删表、删列 | 无论 SQL 怎么写，都删不掉数据 |
| 工具层 | 每次调用一个独立事务，`SET LOCAL ROLE` 切到最小角色；查询类工具使用只读事务；SQL 先做语句检查 | 查询误写数据、越权读取、多语句注入 |
| 审计层 | `agent.session / message / tool_call` 记录每次提问、回答、工具调用（参数、数据库角色、耗时、成败）；数据变更另由 `audit.change_log` 触发器记录 | 事后追溯 Agent 说过什么、改过什么 |

### 工具与数据库角色

| 工具 | 作用 | 数据库角色 | 事务 |
| --- | --- | --- | --- |
| `search_catalog` | 检索语义目录：相关表、字段说明与剖析、口径陷阱、合规关联、已验证示例、相关治理工单（v0.13 起取代 get_schema_overview） | green_app | 只读 |
| `plan_joins` | 在已审核关联图中规划连接路径，提示“先聚合再连接” | green_app | 只读 |
| `query_metric` | 按指标层标准口径取基础量（综合能耗、碳排放、产值、高企产值等），含模拟占比 | green_app | 只读 |
| `list_governance_issues` | 查看数据治理工单与洞察 | green_app | 只读 |
| `find_entities` | 查园区、片区、企业编码与荣誉 | green_app | 只读 |
| `get_energy_summary` | 能耗汇总（按年、月、品种、企业），含估值占比 | green_app | 只读 |
| `get_carbon_summary` | 碳排放汇总（按口径），含因子年份回退提示 | green_app | 只读 |
| `get_indicators` | 全部指标逐项状态（达标、未达标、无基准、公式待审核、缺数据、待录入）与汇总 | green_app | 只读 |
| `explain_indicator` | 公式、出处页码、判定基准、版本对照、计算输入 | green_app | 只读 |
| `get_factors` | 因子数值、口径、出处、审核状态 | green_app | 只读 |
| `get_data_coverage` | 真实与模拟数据底账、最近导入批次 | green_app | 只读 |
| `query_sql` | 模型自写 SQL（单条 SELECT，限 200 行、5 秒）；先按执行计划校验 is_current、碳排放口径、关联图、一对多求和，失败最多修复两次；成功的查询成为候选问答对 | **green_agent_ro**（读 mart、core、fact、semantic） | 只读 |
| `run_calculation` | 折标 → 碳核算 → 指标（只用已批准公式；可预览） | green_app | 写 |
| `import_excel` | 按模板导入 Excel（可试运行、可标记估值） | green_app | 写 |
| `execute_write_sql` | INSERT/UPDATE；CREATE TABLE/VIEW/INDEX、ALTER TABLE ADD | green_app / **green_ddl** | 写 |

### Agent 不做的事

- **审核和批准因子、公式**：纪要要求 AI 生成的公式必须人工校验。写工具会拦截修改审核状态的语句，Agent 只能列出待批准条目，请人工处理。
- **删除**：数据库层禁止。修正数据时新增一行，并把旧行标记为失效。
- **审核语义目录与治理工单**：表/字段说明、关联边、问答对、工单的审批只在网站“数据治理”页（/admin）由管理员完成；写工具拦截对 semantic 的修改。

语义目录、治理检测和查询校验的原理见 [semantic-catalog-and-governance.md](semantic-catalog-and-governance.md)。

## 3. 文件结构

| 文件 | 内容 |
| --- | --- |
| `src/config.ts` | 从环境变量或 `.env` 读取配置；Key 不写进代码 |
| `src/db.ts` | 三种执行方式：`readOnly`、`sandboxSql`、`write` |
| `src/sql-guard.ts` | 只读 SQL、写 SQL 的语句检查 |
| `src/tools.ts` | 12 个工具（TypeBox 定义参数，模型据此生成调用） |
| `src/prompt.ts` | 系统提示词：业务背景、回答规则、写操作规则 |
| `src/audit.ts` | 会话与工具调用日志 |
| `src/agent.ts` | 组装 Pi Agent，挂上 beforeToolCall 和 afterToolCall 钩子 |
| `src/cli.ts` | 命令行对话 |
| `test/tools-smoke.ts` | 不调用模型，直接测试工具与拦截规则 |

## 4. 使用

1. 在仓库根目录 `.env` 中加一行（`.env` 不会提交 git）：

   ```text
   DEEPSEEK_API_KEY=sk-...
   ```

2. 可选配置（见 `.env.example`）：
   - `DEEPSEEK_MODEL`：`deepseek-flash` 或 `deepseek-v4-pro`
   - `AGENT_WRITE_MODE`：`auto` 全自动 / `confirm` 每次写操作在终端确认 / `off` 只读
   - `AGENT_THINKING`、`AGENT_MAX_TOOL_CALLS`、`AGENT_SQL_ROW_LIMIT`、`AGENT_SQL_TIMEOUT_MS`

3. 运行（需先开 SSH 隧道）：

   ```bash
   cd packages/db-agent
   npm run chat
   ```

   也可以直接带一个问题运行一次：`npm run chat -- "2025年园区碳排放多少？"`。

   对话中可用的命令：
   - `/model pro`、`/model flash`：切换模型
   - `/reset`：清空上下文
   - `/exit`：退出

## 5. 测试记录（2026-10-20，deepseek-flash）

| 问题 | 工具调用 | 结果 |
| --- | --- | --- |
| 2025 年园区碳排放，按类别拆分，真实还是模拟 | get_carbon_summary ×2 | 288,427.73 t，类别占比正确；说明 100% 模拟；提示电力因子回退 2023 年 |
| 能源产出率怎么算、出处、为什么没达标 | explain_indicator、get_indicators | 公式、PDF 第 55 页出处、基准沿用 2024 引领值、输入数值都正确，并算出达标所需的增加值或能耗 |
| 万华 2024 年各能源用量 | find_entities → get_energy_summary | 先查编码再查数，实物量与折标正确 |
| 重算 2025 年指标并说明达标项 | run_calculation → get_indicators | 执行写操作并汇报结果 |
| 把公式 F_LEVEL2_SHARE 直接批准 | explain_indicator（失败后改用 query_sql） | **拒绝批准**，列出待批准条目和出处，建议先预览 |
| 哪些达标、能否申报 | get_indicators、get_data_coverage | 6 项达标，明确说明估值占比 100%、不能直接申报 |

### 测试中发现并修复的问题

1. **指标状态靠模型推断，出现误判**：原 `get_indicators` 只返回有值的指标，模型把“已算出但无基准”的指标误判为“未算出”，并漏掉了录入类指标。改为工具逐项给出明确状态和汇总计数。原则是：**能由程序确定的事，不留给模型推断**。
2. **估值占比只统计了能耗数据**：引擎原先只按能耗和碳排放计算估值占比，统计台账类输入记为 0，导致 Agent 把模拟数据说成“真实数据”。迁移 0020 改为按公式全部输入计算（含跨年基准年），并重算了所有结果。这说明**Agent 的可信度取决于底层工具的正确性**：要拿数据库实际情况去核对 Agent 的回答。
3. **偶尔用英文说明过程**：提示词改为“所有输出一律使用中文”。

## 6. 后续

- **接入网站**：在 Next.js API 路由中调用 `createDbAgent()`，用事件流（`message_update`、`tool_execution_*`）推送到前端对话侧栏。
- **小云语音**：语音转文字后调用同一个 Agent；回答可另行生成适合朗读的短句版本。
- **多 Agent**：工具集稳定后，可拆出“查询解释”和“数据管理”两个 Agent，由总控 Agent 调度。
- **会话持久化**：目前每次运行都是新会话，可从 `agent.message` 恢复上下文。
- **安全**：本 Key 曾在聊天中出现，测试完成后建议在 DeepSeek 后台作废并更换。

## 7. 交互框架优化（参考 HarnessSQL，arXiv 2610.12274，2026-10-21）

论文结论：数据库 Agent 的效果很大程度取决于它运行的“交互框架”（harness）——给哪些工具、返回什么观察、怎么约束重复与失败——而不只是模型本身；专用、收窄的 SQL 框架明显优于通用框架；训练数据应保留完整交互轨迹（推理、工具调用、执行反馈、修正），并用执行结果验证。

本项目调用 DeepSeek 接口，不做模型训练，因此只取不需要训练的部分，按最轻量方式实现：

| 论文做法 | 本项目现状 / 本次改动 |
| --- | --- |
| 收窄的 SQL 专用工具集（列表、结构、执行、提交） | 已具备：语义目录检索、连接规划、带计划校验的 SQL 执行，固定工具承担常见问题。不改 |
| 观察截断、执行错误结构化反馈 | 已具备：结果超长截断、校验错误含原因与修改建议、空结果提示。不改 |
| **重复调用提醒**（未训练模型 58.8% 的轨迹有重复调用） | **新增**：同一问题中与已成功调用完全相同的工具调用（参数顺序、空白不同也视为相同）不再执行，返回“结果已在上文”的提醒；失败后的重试不受影响。网页 / 命令行与小云语音都生效，被拦截次数记入审计 |
| 保留完整交互轨迹、只用执行验证过的轨迹训练 | **新增**：每次回答的完整轨迹（模型输出、工具调用、工具返回）写入 `storage/trajectories/日期.jsonl`（本机，不进 Git，`AGENT_TRAJECTORY_LOG=off` 可关闭），附成功执行的 SQL 指纹；`npm run trajectories` 统计交互行为（平均调用数、出错、重复拦截、SQL 修复比例），并把含“已批准问答对”SQL 的轨迹导出为 `verified.jsonl`，将来微调小模型时直接使用 |
| 校验清单：单条只读、表与字段存在、可执行、非空、按预算终止 | 已具备：语句检查 + 执行计划校验 + 试执行 + 每问 20 次调用上限 + SQL 最多修复两次 |

测试：问“2025 年 CEA 碳价月度均价走势”，Agent 用 2 次工具调用（检索目录 → 一次通过校验的 SQL）给出逐月结果，轨迹已写入并可统计。
