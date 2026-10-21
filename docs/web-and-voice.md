# 网站与小云语音接入说明

文档版本：v1.4（2026-10-21）

本文说明单个 Pi 总管 Agent 如何接入 Next.js 网站 `apps/web` 和小云语音助手（`@xiaoyun/voice`），识别业务板块并直接使用相关工具查询同一个数据库。

总览已加入高德/L7地图与ECharts-GL企业3D能耗视图；小云形象改为吸碳云朵动图。高德本机环境变量、企业坐标来源与红线缺口见[地图与来源说明](park-map-and-sources.md)。

## 1. 整体结构

```text
浏览器 http://localhost:3001（Next.js）
 ├─ 总览页（服务端组件）──── getParkOverview() ──────────────┐
 ├─ 右侧对话框 ── POST /api/agent（SSE）─────────────┐
 └─ 小云组件 ── WebSocket ── 小云后台 :8766 ────┤
                    千问实时语音 ── ask_platform_manager ┤
                                                   ▼
                                 单个 Pi 总管（DeepSeek）
                                                   ↓
                              按任务选择只读数据库工具 → PostgreSQL greensystem
```

- **网站对话**（文字）：每个浏览器会话在服务器内存里保存一个 Pi 总管；它判断问题所属板块，并直接调用总览、能源、碳管理、综合诊断、企业名录或数据治理相关数据库工具；审计记录 `channel='web'`、`agent_name='platform_manager'`。
- **语音**：千问负责听说与页面动作，园区业务问题通过 `ask_platform_manager` 调用同一个 Pi 总管；审计记录 `channel='voice'`、`agent_name='platform_manager'`。
- 总管只有一个 Agent 实例，不创建板块专家，也不调用已部署的板块 Agent。板块清单用于指导工具选择；跨板块问题由同一个总管直接调用多个相关工具并汇总。网页与语音共用 `packages/db-agent/src/manager.ts` 的工具选择规则。

## 2. 为什么这样拆

| 设计 | 原因 |
| --- | --- |
| Agent 跑在服务端（Route Handler），浏览器只收文字流 | 数据库密码和 DeepSeek Key 只在服务器读取；浏览器拿不到。 |
| SSE 流式返回 | Pi 的 `message_update` 事件逐字转发，用户不用等整段答案。 |
| 总管工具只读 | 语音误识别和未实现确认弹窗都不能触发导入、重算、审核或写 SQL；管理操作走现有有权限流程。 |
| `ask_platform_manager` 设为直达工具（voiceDirect） | 千问将完整园区业务问题交给共享总管，不需要在语音层复制板块工具选择规则。 |
| 页面动作只注册 `switch_year` | 只注册网页上真实存在的按钮功能；语音切年份与点击顶部年份按钮效果相同。 |

## 3. 本机启动

前提：SSH 隧道已打开（localhost:15432），仓库根目录 `.env` 中已有 `DATABASE_URL` 与 `DEEPSEEK_API_KEY`。

1. 安装依赖（首次）：在 `apps/web` 运行 `npm install`，然后运行 `npx xiaoyun init` 复制小云浏览器资源到 `public/xiaoyun` 并生成 `.env.xiaoyun`。
2. 填写 `apps/web/.env.xiaoyun`（已被 .gitignore 忽略，不会上传）：

   | 键 | 值 |
   | --- | --- |
   | `DASHSCOPE_API_KEY` | 千问（阿里云百炼）Key |
   | `QWEN_REALTIME_URL` | 千问实时语音地址。使用 `sk-ws-` 开头的工作空间 Key 时填该工作空间的专属地址 `wss://<工作空间域名>.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime`；不填则用公共地址 `wss://dashscope.aliyuncs.com/api-ws/v1/realtime` |
   | `DEEPSEEK_API_KEY` | DeepSeek Key |
   | `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
   | `DEEPSEEK_MODEL` | `deepseek-v4-flash` |
   | `PYTHON_EXECUTABLE` | `C:\Users\53472\anaconda3\python.exe`（需 3.12+） |
   | `VOICE_PROJECT_MODULE` | `./voice-project.mjs` |
   | `PORT` | `8766` |
   | `ALLOWED_ORIGINS` | `http://localhost:3001,http://127.0.0.1:3001` |

   Key 不要加 `NEXT_PUBLIC_` 前缀，否则会被打包进浏览器代码。
3. 网页文字对话读取仓库根目录 `.env` 的 `DEEPSEEK_API_KEY`（或启动时的环境变量），请在根目录 `.env` 中补上这一行。
4. 启动小云后台：在 `apps/web` 运行 `npm run voice`（等于 `xiaoyun start --env .env.xiaoyun`）。
   - 小云后台用 dotenv 读取 `.env.xiaoyun`，**已存在的进程环境变量优先**。若启动脚本向进程注入了旧 Key，会覆盖文件里的新 Key；换 Key 后请直接用 `npm run voice` 启动，并用 `http://127.0.0.1:8766/api/health` 确认 `voiceReady`、`agentReady` 均为 `true`。
   - 语音接不通时依次检查：8766 端口是否在监听（后台进程停止后网页不会报错，只是不出现小云）；`.env.xiaoyun` 中两个 Key 是否为空；千问 Key 与 `QWEN_REALTIME_URL` 是否属于同一工作空间。
5. 启动网站：在 `apps/web` 运行 `npm run dev`（会先自动构建 `packages/db-agent`），打开 http://localhost:3001 。未登录访问任何页面都会跳转到 `/login`。
   - 开发服务器运行期间若修改了 `packages/db-agent/src` 的导出，先在 `packages/db-agent` 运行 `npm run build`，再重启网站开发服务器；`predev` 只在启动时构建一次，旧的 `dist/index.mjs` 会导致“Export ... doesn't exist in target module”。
6. 登录账户写在 `apps/web/.env.local`（不提交 Git）：`AUTH_USERNAME`、`AUTH_PASSWORD`、`AUTH_SECRET`。修改后重启网站。这是本机演示用的单账户签名 Cookie 会话（12 小时），多用户部署需改为用户表。

### 3.2 连接状态与常见“数据连接异常”（2026-10-21）

顶栏右侧的状态胶囊每分钟调用 `GET /api/health`，点击可查看三项：

| 项 | 判断方式 | 不可用时的处理 |
| --- | --- | --- |
| 园区数据库 | 服务端执行一次只读 `SELECT 1`（`packages/db-agent` 的 `ping()`），6 秒超时 | 打开 SSH 隧道 `scripts/start-db-tunnel.ps1`；账号错误时检查根目录 `.env` 的 `DATABASE_URL` |
| AI 数据助手 | 服务端是否读取到 `DEEPSEEK_API_KEY`（只返回是否配置，不返回 Key） | 在根目录 `.env` 加 `DEEPSEEK_API_KEY=sk-…` 后重启网站；页面数据不受影响 |
| 小云语音 | 浏览器探测 `127.0.0.1:8766`（页面加载和手动重新检测时） | 在 `apps/web` 运行 `npm run voice`，并在 `.env.xiaoyun` 填写两个 Key |

2026-10-21 排查结论：隧道与数据库正常（应用查询约 0.2–0.4 秒）；文字助手报错是因为正在运行的网站进程没有 `DEEPSEEK_API_KEY`（根目录 `.env` 与 `.env.xiaoyun` 中都没有保存 Key）；语音 WebSocket 报错是因为小云后台未启动。小云组件现在先探测后台，离线时不挂载，避免浏览器反复重连报错。

端口说明：本机 3000 和 8765 已被另一个项目（另一套小云后台和网站）占用，因此本项目用 3001 / 8766，两套互不影响。改端口时要同时改 `.env.xiaoyun` 的 `PORT`、`ALLOWED_ORIGINS`，`components/VoiceAssistant.tsx` 的 `BACKEND_URL`，以及 `package.json` 的 `--port`。

## 3.1 本机测试记录（2026-10-20）

| 测试 | 结果 |
| --- | --- |
| 总览页读取数据库 | 2025 年 83,890 tce、288,428 tCO₂、增加值 177,874 万元、19 项中 6 项达标，与命令行 Agent 一致；显示模拟数据提示条 |
| 网页文字对话 | 原有数据库 Agent 测试记录；共享总管上线后的端到端记录见本次版本日志 |
| 小云直达工具 | 原有 `park_overview` 测试记录；当前入口已改为 `ask_platform_manager` |
| 小云页面动作 | “把页面切换到2024年”→ 执行 switch_year，网页切到 2024 |
| 小云后台分析（DeepSeek/Pi） | 原有单数据库 Agent 测试记录；当前业务分析由共享总管直接调用数据库工具 |

文字测试用小云公开的 `submitText`，与语音走同一条会话；麦克风需要在浏览器里实际说话验证。

## 4. 文件说明

| 文件 | 作用 |
| --- | --- |
| `apps/web/app/page.tsx` | 总览：综合能耗、碳排放、增加值、已达标指标、荣誉；含模拟数据时显示提示条 |
| `apps/web/app/api/agent/route.ts` | 总管文字对话接口，SSE 事件：start / text / tool_start / tool_end / done / error |
| `packages/db-agent/src/manager.ts` | 单个 Pi 总管、板块工具指引和双入口共用调用函数 |
| `apps/web/lib/server.ts` | 服务端单例：连接池、按会话缓存 Agent |
| `apps/web/components/ChatPanel.tsx` | 右侧对话框 |
| `apps/web/components/VoiceAssistant.tsx` | 挂载小云，注册 `switch_year`，年份变化时 `updateContext` |
| `apps/web/voice-project.mjs` | 小云后台项目模块（id `xinyang-park`），只注册总管入口和 Skill |
| `apps/web/app/admin/page.tsx` | 数据治理页（/admin）：治理工单、语义目录、问答对、关联图的审核（v0.13 起） |
| `apps/web/voice/skills/park-energy-carbon/SKILL.md` | 告诉 Pi 什么问题用哪个工具、怎么回答 |
| `packages/db-agent/src/voice-tools.ts` | 将总管入口适配为小云直达工具 |
| `packages/db-agent/src/overview.ts` | 总览查询，网页和语音共用 |

## 5. 已知限制

- 共享总管目前只读；导入、重算与审批需经现有有权限的管理流程，不受 `AGENT_WRITE_MODE=auto` 影响。
- 对话记忆保存在 Next.js 进程内存里，重启服务后清空（审计表里仍有完整记录）。
- 麦克风只能在 localhost 或 HTTPS 下使用；部署到别的机器需要 HTTPS 和同源代理。
- 目前大部分能耗与统计数据为模拟值，网页与语音都会提示“仅供演示”。
