# 网站与小云语音接入说明

文档版本：v1.1（2026-10-20）

本文说明数据库 Agent 如何接入 Next.js 网站 `apps/web`，以及如何通过小云语音助手（`@xiaoyun/voice`）用语音查询同一个数据库。

总览已加入高德/L7地图与ECharts-GL企业3D能耗视图；小云形象改为吸碳云朵动图。高德本机环境变量、企业坐标来源与红线缺口见[地图与来源说明](park-map-and-sources.md)。

## 1. 整体结构

```text
浏览器 http://localhost:3001（Next.js）
 ├─ 总览页（服务端组件）──── getParkOverview() ──────────────┐
 ├─ 右侧对话框 ── POST /api/agent（SSE 流式）── createDbAgent() ─┤── PostgreSQL greensystem
 └─ 小云组件（浏览器 SDK）── WebSocket ── 小云后台 :8766          │   （SSH 隧道 localhost:15432）
                                         ├─ Qwen 实时语音（千问）  │
                                         └─ DeepSeek / Pi ── voice-project.mjs 项目工具 ─┘
```

- **网站对话**（文字）：每个浏览器会话在服务器内存里建一个 Pi Agent，工具与命令行版完全相同（12 个），审计记录 `channel='web'`。
- **语音**：小云后台用千问实时模型听说、分流；需要查库时，由小云自带的 DeepSeek/Pi Harness 调用我们注册的“项目工具”。审计记录 `channel='voice'`、`agent_name='xiaoyun_voice'`。
- 两边共用 `packages/db-agent` 里的同一套工具代码，因此口径一致。

## 2. 为什么这样拆

| 设计 | 原因 |
| --- | --- |
| Agent 跑在服务端（Route Handler），浏览器只收文字流 | 数据库密码和 DeepSeek Key 只在服务器读取；浏览器拿不到。 |
| SSE 流式返回 | Pi 的 `message_update` 事件逐字转发，用户不用等整段答案。 |
| 语音只开放只读工具 + `run_calculation` | 语音可能听错，不能让一句误识别的话导入文件或改库。导入、写 SQL 只在网页/命令行里做。 |
| `query_sql` 改名 `park_query_sql` | 小云把 `query_sql` 保留给自己的 SQLite 工具，同名会冲突。 |
| `park_overview` 设为直达工具（voiceDirect） | “园区整体情况怎么样”这类问题由千问直接调用、马上播报，不必启动后台任务。 |
| 页面动作只注册 `switch_year` | 只注册网页上真实存在的按钮功能；语音切年份与点击顶部年份按钮效果相同。 |

## 3. 本机启动

前提：SSH 隧道已打开（localhost:15432），仓库根目录 `.env` 中已有 `DATABASE_URL` 与 `DEEPSEEK_API_KEY`。

1. 安装依赖（首次）：在 `apps/web` 运行 `npm install`，然后运行 `npx xiaoyun init` 复制小云浏览器资源到 `public/xiaoyun` 并生成 `.env.xiaoyun`。
2. 填写 `apps/web/.env.xiaoyun`（已被 .gitignore 忽略，不会上传）：

   | 键 | 值 |
   | --- | --- |
   | `DASHSCOPE_API_KEY` | 千问（阿里云百炼）Key |
   | `DEEPSEEK_API_KEY` | DeepSeek Key |
   | `DEEPSEEK_MODEL` | `deepseek-v4-flash` |
   | `PYTHON_EXECUTABLE` | `C:\Users\53472\anaconda3\python.exe`（需 3.12+） |
   | `VOICE_PROJECT_MODULE` | `./voice-project.mjs` |
   | `PORT` | `8766` |
   | `ALLOWED_ORIGINS` | `http://localhost:3001,http://127.0.0.1:3001` |

   Key 不要加 `NEXT_PUBLIC_` 前缀，否则会被打包进浏览器代码。
3. 网页文字对话读取仓库根目录 `.env` 的 `DEEPSEEK_API_KEY`（或启动时的环境变量），请在根目录 `.env` 中补上这一行。
4. 启动小云后台：在 `apps/web` 运行 `npm run voice`（等于 `xiaoyun start --env .env.xiaoyun`）。
5. 启动网站：在 `apps/web` 运行 `npm run dev`（会先自动构建 `packages/db-agent`），打开 http://localhost:3001 。

端口说明：本机 3000 和 8765 已被另一个项目（另一套小云后台和网站）占用，因此本项目用 3001 / 8766，两套互不影响。改端口时要同时改 `.env.xiaoyun` 的 `PORT`、`ALLOWED_ORIGINS`，`components/VoiceAssistant.tsx` 的 `BACKEND_URL`，以及 `package.json` 的 `--port`。

## 3.1 本机测试记录（2026-10-20）

| 测试 | 结果 |
| --- | --- |
| 总览页读取数据库 | 2025 年 83,890 tce、288,428 tCO₂、增加值 177,874 万元、19 项中 6 项达标，与命令行 Agent 一致；显示模拟数据提示条 |
| 网页文字对话 | 流式输出；调用 get_energy_summary、get_carbon_summary、get_indicators；Markdown 表格正常显示；审计记录 channel=web |
| 小云直达工具 | “2025年园区整体能碳情况怎么样？”→ 千问直接调用 park_overview 并播报 |
| 小云页面动作 | “把页面切换到2024年”→ 执行 switch_year，网页切到 2024 |
| 小云后台分析（DeepSeek/Pi） | “单位工业增加值能耗为什么没达标、哪几家企业能耗最高”→ 调用 get_indicators、explain_indicator(I04)、按企业汇总能耗等约 20 次工具，全部成功；结论“0.4716 tce/万元，能源产出率 2.12，低于 3.0 基准，含模拟数据”；审计记录 channel=voice |

文字测试用小云公开的 `submitText`，与语音走同一条会话；麦克风需要在浏览器里实际说话验证。

## 4. 文件说明

| 文件 | 作用 |
| --- | --- |
| `apps/web/app/page.tsx` | 总览：综合能耗、碳排放、增加值、已达标指标、荣誉；含模拟数据时显示提示条 |
| `apps/web/app/api/agent/route.ts` | 文字对话接口，SSE 事件：start / text / tool_start / tool_end / done / error |
| `apps/web/lib/server.ts` | 服务端单例：连接池、按会话缓存 Agent |
| `apps/web/components/ChatPanel.tsx` | 右侧对话框 |
| `apps/web/components/VoiceAssistant.tsx` | 挂载小云，注册 `switch_year`，年份变化时 `updateContext` |
| `apps/web/voice-project.mjs` | 小云后台项目模块（id `xinyang-park`），注册数据库工具和 Skill |
| `apps/web/app/admin/page.tsx` | 数据治理页（/admin）：治理工单、语义目录、问答对、关联图的审核（v0.13 起） |
| `apps/web/voice/skills/park-energy-carbon/SKILL.md` | 告诉 Pi 什么问题用哪个工具、怎么回答 |
| `packages/db-agent/src/voice-tools.ts` | 把数据库工具转换为小云项目工具，并写审计 |
| `packages/db-agent/src/overview.ts` | 总览查询，网页和语音共用 |

## 5. 已知限制

- 网页对话的写操作：`AGENT_WRITE_MODE=confirm` 时网页没有确认弹窗，因此会拒绝写操作；需要写入时用命令行，或改为 `auto`。
- 对话记忆保存在 Next.js 进程内存里，重启服务后清空（审计表里仍有完整记录）。
- 麦克风只能在 localhost 或 HTTPS 下使用；部署到别的机器需要 HTTPS 和同源代理。
- 目前大部分能耗与统计数据为模拟值，网页与语音都会提示“仅供演示”。
