# Mac 端 Blender 工程恢复与查看

2026-10-24。用户本轮选择“先打开工程，查看现有模型”。已在真实 Blender GUI 中通过 MCP 打开 `assets/blender-models/v2/park-assemblies-v2.blend`，默认展示绿色家居全景。模型仍为 v2；连接工具更新对应仓库 v0.53.2。

## 当前检查结果

| Blender Scene | 园区 | 建筑组装单元 | 场景对象 | 网格对象 | 查看相机 |
| --- | --- | ---: | ---: | ---: | ---: |
| ASSEMBLY_GH | 绿色家居 | 53 | 164 | 156 | 3 |
| ASSEMBLY_EI | 电子信息 | 57 | 179 | 173 | 3 |
| ASSEMBLY_IN | 科创部落 | 12 | 68 | 62 | 3 |
| ASSEMBLY_RD | 科创研发 | 26 | 105 | 99 | 3 |

四个场景均通过组装清单实例检查，没有缺失建筑、跨区网格或缺失全景／局部／顶视相机；均为 METRIC、单位比例 1。没有未打包的外部图片依赖。读取检查只改变当前窗口的场景、视角与显示模式，没有修改几何或保存工程。

总工程 SHA-256：`9191de5a0f90cf2709a957910372f0674637e54ac834e6c69582d2ec278e8c78`，与原 `assets/blender-models/v2/manifest.json` 完全一致。148 是概念组装单元数，不是已实测的现状建筑数；原有位置与尺寸待核限制仍适用。

## 本机环境

全部安装在项目的 `storage/tooling/blender-mcp/`，由 `.gitignore` 排除；没有把应用、缓存、运行日志或本机偏好文件上传仓库。

| 组件 | 版本／校验 | 项目内位置 |
| --- | --- | --- |
| Blender | 4.5.9 LTS / Apple Silicon | `runtime/Blender.app` |
| uv / uvx | 0.13.5 | `runtime/uv-aarch64-apple-darwin/` |
| Python | uv 管理的 3.11 | `python/` |
| MCP 服务端 | `mcp-for-blender==2.2.2` | `uv-cache/` |
| Blender 附加组件 | 同一安装包捆绑版本 / protocol 14 | `blender-user/scripts/addons/blender_mcp.py` |
| Blender 配置 | 项目独立目录 | `blender-user/config/` |

- 官方 Blender 镜像：[4.5.9 macOS arm64](https://download.blender.org/release/Blender4.5/blender-4.5.9-macos-arm64.dmg)，[官方校验表](https://download.blender.org/release/Blender4.5/blender-4.5.9.sha256)。下载 SHA-256 已核对为 `e3a3d7aac381fb4e4d05197f99cd8899484d7e8bc4497c134066e6733f372238`；应用通过 `codesign --verify --deep --strict`。
- uv：[官方 0.13.5 发行包](https://github.com/astral-sh/uv/releases/download/0.13.5/uv-aarch64-apple-darwin.tar.gz)，[校验表](https://github.com/astral-sh/uv/releases/download/0.13.5/uv-aarch64-apple-darwin.tar.gz.sha256)。SHA-256：`743f85035a1996ecb350659e01cd9faea9709829be09b1b4b03c73eaf3c9cd73`。
- MCP 插件 SHA-256：`229ee114f0504b486bdd24bbc8b08fa9b22112f5e831ef8b2e9cc507e9ccbbfe`，与上一轮 Windows 工具记录相同。上游：[MCP for Blender](https://github.com/ahujasid/mcp-for-blender)。它是社区插件，不是 Blender Foundation 官方产品。
- 通信路径为官方 Python MCP SDK `ClientSession` → stdio MCP 服务端 → Blender 附加组件，监听 `127.0.0.1:9876`。关闭遥测，启用 MCP safe mode。没有用离线 bpy 或直接 socket 指令打开、检查或修改场景。

## 当前修订工程

2026-10-25 起，最新待审阅源文件为 `assets/blender-models/v3/park-reference-v3.blend`，Scene 为 `V3_GH/EI/IN/RD`；旧 `ASSEMBLY_*` 仍保留。新增 [概念与模型对照](../assets/blender-models/v3/index.html) 与 [v3 修订记录](park-modeling-v3-review.md)。仅打开工程时，将下述 `FILE` 参数改为 v3 文件；不要误跑旧版构建脚本。新外观尚待确认，网站/GLB 仍为旧版。

## 下次打开

在项目根目录运行以下入口。脚本使用项目本地绝对路径定位程序，无需把 uv 加入全局 PATH。

```bash
bash scripts/blender-mcp-macos.sh start
```

启动入口只负责 GUI 与插件；首次初始化需等窗口出现及端口开始监听。存在监听时不再创建第二个实例，应先用 MCP 核对当前会话。`scripts/blender-mcp-bootstrap.py` 校验插件哈希并启用它，不含场景打开、建模、保存或渲染操作。

随后执行连接检查：

```bash
bash scripts/blender-mcp-macos.sh call \
  --code scripts/blender/00-connection-check.py \
  --label mac-connection-check --user-prompt '先打开工程，查看现有模型'
```

确认当前文件没有需要保存的编辑后，通过独立 MCP 调用打开总工程：

```bash
bash scripts/blender-mcp-macos.sh call \
  --code scripts/blender/assembly-v2-open.py \
  --define '{"FILE":"/Users/shelly/Documents/develop project/10.13 greensystem/assets/blender-models/v2/park-assemblies-v2.blend"}' \
  --label mac-open-master --user-prompt '先打开工程，查看现有模型'
```

目录迁移后调整 `FILE` 为总工程的真实绝对路径。打开工程与后续检查必须分成两次调用，等待 Blender 完成上下文切换。

```bash
bash scripts/blender-mcp-macos.sh call \
  --code scripts/blender/assembly-v2-inspect.py \
  --data assets/blender-models/v2/assembly-layout.json \
  --label mac-inspect-master --user-prompt '先打开工程，查看现有模型'
```

在 Blender 顶部 Scene 下拉框切换 `ASSEMBLY_GH/EI/IN/RD`。每区已有 `*_CAM_overview`、`*_CAM_detail`、`*_CAM_plan` 三台相机。原有全景、局部与总平面渲染可从 [v2 模型目录](../assets/blender-models/v2/index.html) 查看。

本轮本地调用证据位于 `storage/tooling/blender-mcp/audit/macos-20261024-*.json`；初次后台启动未保持进程及 GUI 初始化期间的两次连接失败也保留。随后通过 macOS `open` 启动 GUI，第三次连接成功，完成打开、检查与 MCP `look` 视口截图。截图在 `storage/tooling/blender-mcp/session-20261024/`，是当前视口验证，不替代原交付渲染或新一轮模型批准。

重新安装时须先从上述官方地址取得并校验发行包，在同一项目工具目录解包，使用本地 uvx 安装固定的 `mcp-for-blender==2.2.2`，再将其捆绑 `blender_mcp/bundled/addon.py` 复制为上述 `blender_mcp.py`。引导脚本拒绝哈希不匹配的插件；不要把新版本直接覆盖到这个固定版本环境。
