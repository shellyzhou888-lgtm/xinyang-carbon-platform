# 小云服务器部署

小云源码在公开仓库 [`xiaoyun-voice`](https://github.com/shellyzhou888-lgtm/xiaoyun-voice)，网站依赖在 `apps/web/package.json` 中固定为 `v1.0.0-beta.1-power-earth.4`。该标签现可公开读取，服务器安装网站依赖无需小云仓库凭据；源码和构建产物由安装过程取得，不需要把本机 `node_modules`、`backend/` 或语音运行数据提交到本仓库。

## 安装与构建

1. 在部署服务器确认 `git ls-remote https://github.com/shellyzhou888-lgtm/xiaoyun-voice.git refs/tags/v1.0.0-beta.1-power-earth.4` 成功。小云仓库现可公开读取；不要把令牌写进仓库、依赖 URL 或构建日志。
2. 安装 Node.js 24 或更高版本及 Python 3.12 或更高版本。在 `packages/db-agent` 和 `apps/web` 各运行 `npm ci`。Git 依赖的 `prepare` 脚本会构建小云浏览器资源和后台。随后在 `apps/web` 运行 `npx xiaoyun init`，把完整 Worker、WASM 和音频资源复制到 `apps/web/public/xiaoyun/`。该目录是可再生构建资源，已被 Git 忽略；每次部署重新生成。
3. 在 `apps/web/.env.xiaoyun` 填写后台密钥和部署配置：`PORT=8766`、`HOST=127.0.0.1`、`VOICE_PROJECT_MODULE=./voice-project.mjs`、`ALLOWED_ORIGINS=https://服务器局域网IP`。按服务器情况设置 `PYTHON_EXECUTABLE` 和数据库连接环境变量。此文件含密钥，不提交 GitHub。若反向代理在另一台机器，需将 `HOST` 改为可被代理访问的内网地址，并限制网络入口。
4. 运行 `npm run build`，以独立常驻进程在 `apps/web` 运行 `npm run voice`，网站进程运行 `npm start`。同源部署时，网页默认把当前 HTTPS 站点作为小云后台地址，不需要设置 `NEXT_PUBLIC_XIAOYUN_BACKEND_URL`；若旧部署配置了 `http://127.0.0.1:8766`，先移除该值并重新构建。只有小云使用另一个 HTTPS 域名时，才在**构建网站前**设置该变量，并在修改后重新构建。

## 局域网 IP：HTTPS 与 WebSocket

浏览器的麦克风接口要求安全上下文。访问另一台机器的 `http://IP:3001` 不满足要求，无法通过修改网页或小云 SDK 绕过。请用服务器固定局域网 IP 建立可信任的 `https://IP` 入口。[Caddy 配置模板](../deploy/Caddyfile.lan.example) 将 `/voice` WebSocket 和 `/api/health` 转发给小云 `127.0.0.1:8766`，其余请求转发给 Next.js `127.0.0.1:3001`。Caddy 会处理 WebSocket 升级。

1. 在服务器安装 Caddy，复制模板为实际 Caddyfile，将 `192.168.1.10` 换成服务器固定局域网 IP。确保客户端可访问服务器的 443 端口；3001 和 8766 可只向本机开放。用 `caddy validate --config /etc/caddy/Caddyfile` 检查后启动或重载 Caddy。
2. 模板使用 `tls internal`。Caddy 生成的根证书在 Linux systemd 默认位置 `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`。将**根证书文件**安装到每台访问设备的受信任根证书存储；某些浏览器还需在自己的证书存储中导入。不要复制 `root.key`，不要用浏览器的“不安全仍继续”代替信任证书。
3. 在所有设备上访问 `https://服务器局域网IP`，不要再使用 `http://IP:3001`。在浏览器控制台确认 `window.isSecureContext === true`，然后测试麦克风。

若已有正式域名和受信任的 HTTPS 证书，可以用该域名代替 IP 与内部 CA，并把 `/voice` 和 `/api/health` 路由到 8766、其余路径路由到 3001。`ALLOWED_ORIGINS` 填浏览器访问网站的完整 origin（含协议与端口，如有），多个地址用英文逗号分隔。HTTPS 网页连接另一个小云域名时，该域名也必须是 HTTPS/WSS。

## 验证

- 打开 `https://服务器局域网IP/api/health`，确认返回小云健康信息，`voiceReady` 为 `true`；复杂问数还需 `agentReady` 为 `true`。
- 打开网站，检查浏览器开发者工具中的 `wss://服务器局域网IP/voice` 是否成功升级并收到 `ready`。若为 403，检查 `ALLOWED_ORIGINS`；若连接失败，检查后台常驻进程、证书信任和代理路由。
- 用页面的文字入口 `window.xiaoyun.submitText('你好')` 验证连接，再用真实麦克风验证。业务数据库问答还需确认 `VOICE_PROJECT_MODULE`、数据库连接和项目 Skill 文件在服务器上可用。

将小云仓库推送到 GitHub 只解决服务器获取源码的问题；浏览器连接还取决于上述公开地址、后台进程和 WebSocket 代理。

参考：[MDN 的麦克风安全上下文要求](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)、[Caddy 内部 CA](https://caddyserver.com/docs/caddyfile/directives/tls#internal)、[Caddy 为其他设备配置信任](https://caddyserver.com/docs/running)。
