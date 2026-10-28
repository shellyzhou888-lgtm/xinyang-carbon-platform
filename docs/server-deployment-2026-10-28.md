# 2026-10-28 服务器生产更新

访问入口：<https://218.197.118.49:8443/>。服务器原版本 `v0.42.2` 已更新为 `v0.63.2`，保留原登录账户、数据库和语音凭据。

## 实际部署位置

- 应用运行在 Windows，使用既有 `administrator@218.197.118.49:2222` 管理入口；`yingzi:22` 的 WSL 环境并未部署本网站，本轮只做自检，随后断开。
- 部署根目录：`C:\Users\Administrator\WorkBuddy\10.13xinyang_carbon_platform`。
- 当前发行目录：`releases\v0.63.2`。稳定入口 `app` 是指向该目录的 Junction；网站、语音与原数据任务仍通过稳定入口访问。
- 原站完整目录保留为 `app-backup-v0.42.2-20261028-134350`；原网站启动脚本保留为 `deploy\start-web-before-v0.63.2-20261028-134350.bat`。未批量删除旧文件。
- 复用既有计划任务 `XinyangCarbonWeb`、`XinyangCarbonVoice`、`XinyangCarbonHttps`，均已恢复运行。网站端口 `3001`，语音后台仅监听 `127.0.0.1:8766`，HTTPS 入口 `8443`。

## 发布内容与配置

- 使用本仓库已提交的应用、业务包、迁移参考、数据、模板、政策和运行脚本准备源码发行包；不发布本机未提交的 Blender 工程或实验修改。
- 将服务器原 `.env`、`apps/web/.env.local`、`apps/web/.env.xiaoyun` 留在服务器上复制到新发行目录；停服务后复制上传文件与小云本机状态，再切换目录入口。未把服务器私钥或凭据下载、写进 Git 或输出。
- 在服务器内复制既有 Windows 依赖，核对直接依赖版本与当前锁文件匹配，并将 `@xinyang/db-agent` Junction 指向新发行目录；没有上传 Mac 的原生依赖。
- 合并服务器原有地图修正：按 Host 和合法的 `x-forwarded-proto` 生成地图代理 origin，避免 HTTPS 网站拿到 `http://0.0.0.0:3001`。
- `deploy/windows-start-web.bat` 是安装到部署根目录 `deploy/start-web.bat` 的网站启动模板：沿用 Node 24，生产启动前执行数据库连接检查和碳价同步启动器，异常退出后重启。
- 服务器数据库直接使用本机 `5432`，启动器会跳过开发机 SSH 隧道；碳价同步使用 `packages/ingest` 的现有批次记录与事务锁通道。本轮没有直接 SQL 导入、迁移或改表。

## 验证与边界

1. 服务器 `npm run build` 和构建内 TypeScript 检查成功。
2. 临时端口 `13001` 检查通过后再切换生产；正式 HTTPS 入口的健康接口、首页、能源数字孪生/能效对标、碳排分析/减排管理、诊断定位、企业名录、后台数据、地图配置及语音资源共 11 项检查返回成功。
3. 验证更新内容“年度排放额度使用率”出现在碳排分析；正式 HTTPS 地图配置返回正确公网 origin。
4. 新发行目录内数据库真实查询、网页与语音 DeepSeek 最小请求、千问 `session.updated`、项目 WebSocket `ready`、地图 SDK 访问均通过；生产 `wss://218.197.118.49:8443/voice` 返回项目 `ready`。
5. 从开发机使用经授权 SSH 获取的原 CA 公共证书验证正式 HTTPS 登录页返回 200；没有关闭证书校验或安装全局信任。原站仍使用园区内部 CA，新设备需信任该园区根证书。私钥不提供下载。
6. 未开启用户麦克风，未声称完成真实收音/播放测试；页面检查以认证后的 HTTP 渲染和协议握手为准，未执行浏览器视觉回归。

服务器验证明细保存在当前发行目录的 `storage/deployment-verification.json` 与 `storage/runtime/connections-check.json`；部署指针在部署根目录 `deploy/active-release.json`，启动日志在 `logs/`。公开的 `/deployment.json` 仅记录版本、源码提交和构建标识。

## 回退

先停止本项目的网站和语音计划任务，保留新发行目录和新增上传/会话状态。将稳定入口 `app` 的 Junction **改名保留**，把上述旧站备份目录改名回 `app`，再从已保存的 `.bat` 备份恢复 `deploy/start-web.bat` 并启动这两个任务。不要递归删除 Junction；本次未改数据库结构，回退不应回滚或删除业务数据。若新发行的碳价进程仍在运行，只核对并停止其 `storage/automation/carbon-market-sync.json` 中对应的本项目进程，不批量停止 Node 或其他项目。
