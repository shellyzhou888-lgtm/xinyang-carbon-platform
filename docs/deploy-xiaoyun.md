# 小云服务器部署

小云源码在私有仓库 [`xiaoyun-voice`](https://github.com/shellyzhou888-lgtm/xiaoyun-voice)，网站依赖在 `apps/web/package.json` 中固定为 `v1.0.0-beta.1-power-earth.4`。服务器安装网站依赖时必须具备该仓库的读取权限；源码和构建产物由安装过程取得，不需要把本机 `node_modules`、`backend/` 或语音运行数据提交到本仓库。

## 安装与构建

1. 在部署服务器配置该私有仓库的读取权限，使用与 `apps/web/package.json` 中 HTTPS Git 依赖兼容的 Git 凭据。先确认服务器上的 `git ls-remote https://github.com/shellyzhou888-lgtm/xiaoyun-voice.git refs/tags/v1.0.0-beta.1-power-earth.4` 成功。若使用 SSH deploy key，还需在服务器的 Git 配置中将该 HTTPS 仓库地址映射为 SSH 地址。不要把令牌写进仓库、依赖 URL 或构建日志。
2. 安装 Node.js 24 或更高版本及 Python 3.12 或更高版本。在 `packages/db-agent` 和 `apps/web` 各运行 `npm ci`。Git 依赖的 `prepare` 脚本会构建小云浏览器资源和后台。随后在 `apps/web` 运行 `npx xiaoyun init`，把完整 Worker、WASM 和音频资源复制到 `apps/web/public/xiaoyun/`。该目录是可再生构建资源，已被 Git 忽略；每次部署重新生成。
3. 在 `apps/web/.env.xiaoyun` 填写后台密钥和部署配置：`PORT=8766`、`HOST=127.0.0.1`、`VOICE_PROJECT_MODULE=./voice-project.mjs`、`ALLOWED_ORIGINS=https://网站域名`。按服务器情况设置 `PYTHON_EXECUTABLE` 和数据库连接环境变量。此文件含密钥，不提交 GitHub。若反向代理在另一台机器，需将 `HOST` 改为可被代理访问的内网地址，并限制网络入口。
4. 在构建网站**之前**设置 `NEXT_PUBLIC_XIAOYUN_BACKEND_URL=https://小云后台域名`（可放在 `apps/web/.env.production.local`）。这是浏览器可访问的公开 HTTPS 地址，不是服务器的 `127.0.0.1`。Next.js 会在构建时写入 `NEXT_PUBLIC_` 值，修改后需要重新构建网站。运行 `npm run build`，以独立常驻进程在 `apps/web` 运行 `npm run voice`，网站进程运行 `npm start`。

## HTTPS 与 WebSocket

将小云域名的 HTTPS 流量反向代理到 `127.0.0.1:8766`，并允许 WebSocket 升级。SDK 会连接该域名下的 `/voice`；健康检查是 `/api/health`。例如 Nginx 的小云域名站点可以使用：

```nginx
location / {
    proxy_pass http://127.0.0.1:8766;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

网站使用 HTTPS 时，小云地址也必须使用 HTTPS，浏览器才可建立 WSS 连接并使用麦克风。`ALLOWED_ORIGINS` 填网站的完整 origin（含协议与端口，如有），多个网站用英文逗号分隔。

## 验证

- 打开 `https://小云后台域名/api/health`，确认返回小云健康信息，`voiceReady` 为 `true`；复杂问数还需 `agentReady` 为 `true`。
- 打开网站，检查浏览器开发者工具中的 `wss://小云后台域名/voice` 是否成功升级并收到 `ready`。若为 403，检查 `ALLOWED_ORIGINS`；若连接失败，检查后台常驻进程、域名、TLS 和代理的 Upgrade 头。
- 用页面的文字入口 `window.xiaoyun.submitText('你好')` 验证连接，再用真实麦克风验证。业务数据库问答还需确认 `VOICE_PROJECT_MODULE`、数据库连接和项目 Skill 文件在服务器上可用。

将小云仓库推送到 GitHub 只解决服务器获取源码的问题；浏览器连接还取决于上述公开地址、后台进程和 WebSocket 代理。
