# 园区能碳管理平台

本仓库保存信阳经开区能碳管理平台的建设方案、实施方案、系统架构设计、数据接入技术方案，以及相关需求和参考资料。

## 主要文件

| 路径 | 内容 |
| --- | --- |
| `docs/platform-architecture-and-indicators.md` | **当前开发依据**：平台功能、架构、指标体系（2024/2025/2026/零碳园区） |
| `docs/db-agent.md` | 数据库 Agent（Pi + DeepSeek）：原理、三层安全、工具与角色、使用方法、测试记录 |
| `docs/semantic-catalog-and-governance.md` | 语义目录、数据治理工单与语义增强查询：针对 Text-to-SQL 三类问题的做法、检测规则、审批流程 |
| `docs/web-and-voice.md` | 网站（Next.js）与小云语音接入：结构、为什么这样拆、本机启动、测试记录 |
| `docs/data-inventory.md` | **数据清单**：哪些数据已导入（真实/公开）、哪些是模拟估值、哪些尚缺，以及当前计算结果 |
| `docs/public-data-replacement-assessment.md` | 模拟数据公开来源替换评估：已核验身份、待取证数值、10 家企业采集重点、资源环境来源与口径限制 |
| `docs/import-and-calculation-engine.md` | 导入解析与计算引擎：流程、核算规则、用法、验证结果、已知简化 |
| `docs/national-ghg-factor-database-assessment.md` | 国家温室气体排放因子数据库第二版：本项目可用资料、口径差异与接入顺序 |
| `docs/database-schema-design.md` | 数据库表结构、角色权限、数据湖设计、已入库参考数据 |
| `docs/park-enterprises-public-info.md` | 经开区片区构成、企业公开信息与大屏荣誉标识（带来源） |
| `docs/database-connection-and-permissions.md` | 数据库连接、SSH 隧道、账户与权限记录 |
| `docs/multi-project-db-and-db-agent.md` | 多项目分库与数据库 Agent 方案 |
| `reference/park-energy-carbon-model.docx` | 园区能碳管理模型：数据清单、能耗与碳核算公式、折标系数与排放因子（核心参考） |
| `reference/requirements-notes.doc` | 需求整理（会议纪要与前后端分工） |
| `reference/park-system-ui-fields.doc` | 园区系统界面字段清单 |
| `reference/competitor-dashboard-screenshots.pptx` | 竞品大屏截图 |
| `reference/early-plans/` | 早期方案：总稿、实施方案、系统架构、框架先行数据接入（已被 docs 中的梳理文档取代，仅供参考） |
| `policies/` | 政策原文，文件名为“年份_文号_内容_区分点”；`policies/green-industrial-park/` 含 2024 版（31 项，省级获评依据）、2025 版（17 项，含分值）、2026 版（19 项，现行申报版）三版园区评价要求 |
| `policies/factors/` | 官方排放因子原文：2021、2023 年电力二氧化碳排放因子公告附件，生态环境部钢铁行业核算指南（附表 A.1 燃料参数） |
| `data/simulated/` | 模拟占位数据：假设文件 `assumptions.json` 与按模板生成的 Excel（以 estimated 导入） |
| `data/public/` | 公开渠道获得的真实数值（按模板整理） |
| `templates/` | 数据导入 Excel 模板（由 `scripts/generate_import_templates.py` 从数据库配置生成） |
| `apps/web/` | 网站（Next.js 16）：能碳总览、数据库 Agent 对话框、小云语音助手；`npm run voice` + `npm run dev`，http://localhost:3001 |
| `packages/db-agent/` | 数据库 Agent（TypeScript，Pi 架构）：`npm run chat`；同时供网站和小云语音调用 |
| `packages/ingest/` | Excel 导入工具（TypeScript）：解析模板 → 入湖 → 调用数据库引擎；`npm run ingest` / `npm run calc` |
| `database/migrations/` | 数据库迁移 SQL（结构与参考数据） |
| `scripts/` | 隧道、凭据、权限检查、迁移执行脚本 |

## 版本管理

仓库当前版本见 [`VERSION`](VERSION)，每次任务的修改内容见 [`CHANGELOG.md`](CHANGELOG.md)。版本采用 `MAJOR.MINOR.PATCH`，每次任务完成后更新版本、记录改动、提交并推送 GitHub，同时创建对应版本标签。具体执行约定见 [`AGENTS.md`](AGENTS.md)。

## 数据库连接

PostgreSQL 的开发连接、账户分工和权限检查步骤见 [`docs/database-connection-and-permissions.md`](docs/database-connection-and-permissions.md)。本地连接串使用 `.env`，仓库只保存 [`.env.example`](.env.example)；网站服务端使用应用账户，管理操作单独使用管理员账户。

表结构设计与迁移见 [`docs/database-schema-design.md`](docs/database-schema-design.md)，迁移文件在 `database/migrations/`，用 `scripts/apply-migrations.ps1` 执行（先加 `-DryRun` 试跑）。

多个项目的分库与数据库 Agent 设计见 [`docs/multi-project-db-and-db-agent.md`](docs/multi-project-db-and-db-agent.md)。
