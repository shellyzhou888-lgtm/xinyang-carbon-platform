# 碳市场行情自动更新

日期：2026-10-27 · 仓库版本：v0.61.0

## 来源与展示口径

- CEA：上海环境能源交易所公开分时页 https://shyx.cneeex.com/quotshown.html 。读取该页使用的 prodinf.json、kline.json，采用交易所提供的交易日期、最后有效成交分钟与价格；无有效分时则显示已发布收盘价。最近 180 条 hiskline.json 提供历史收盘价，不回写早期存在区间矛盾的公开记录。
- CCER：优先 https://www.ccer.com.cn/wcm/ccer/html/2502lshq/index.html 的每日公告。当前服务器请求返回 403，回退 https://www.ccn.ac.cn/cets 中明确注明北京绿色交易所来源的公开转载；页面显示“转载日行情”，提供实际链接与日期。成交均价不是盘中价格，不承诺秒级更新。
- 校验日期、数值、成交量/额与均价关系，异常不替代有效行情；不会用检查时刻冒充成交时间。休市保留最近交易日，回退数据带状态说明。
- CEA 历史数组第六项是挂牌成交量，不是市场总成交量；入库时分别处理，保留已有协议交易量等未由本来源提供的字段。

## 页面与后台运行

已登录页面每 60 秒请求 `/api/carbon-market`，不可见时暂停，重新可见时检查。服务端合并并发请求、缓存 60 秒；一次源请求最多等待 8 秒。最新行情与最近 90 个交易日走势不受所选核算年份影响。年度碳成本敞口仍使用对应年度均价。

`apps/web` 的 `npm run dev` / `npm start` 会启动 `scripts/start-carbon-market-sync.mjs`，复用已在运行的同步进程。同步进程每 5 分钟检查；同一数据库用事务级互斥锁防止并发重复导入。

```sh
npm run sync:carbon --prefix packages/ingest -- --dry-run
npm run sync:carbon --prefix packages/ingest
npm run sync:carbon --prefix packages/ingest -- --watch
npm run test:carbon --prefix packages/ingest
```

后台日志和进程信息位于 Git 忽略的 `storage/automation/carbon-market-sync.log` 与 `.json`，进程由当前运行环境负责持续运行；电脑关机或进程退出后需重启网站以启动同步。生产环境应由既有进程管理器守护网站/同步进程。

## 入库与审计

分时数据只用于展示，不冒充最终收盘价写入日表。当日 16:00（上海时区）以后才接纳当日日行情。增量回看最近已入库日期前 7 天，只写有变化的记录；来源、取得时间、原始响应保存在 `raw.import_batch` / `raw.import_record`。修正行采用旧记录 `is_current=false` 加新行，记录 `superseded_by`；不删除业务记录。已有官方 CCER 记录不会被转载覆盖。

有变化才触发现有 `governAfterLoad("import")`，刷新语义目录并跑检测。来源失败不清空数据库，后台和页面分别记录提示。

## 本次验证

8 项解析/异常测试通过；web、ingest、db-agent 类型检查通过。实际导入批次 429 写入 6 条新增/修正日行情，保留历史版本；重复执行 changed=0。治理运行 203 完成 17 项检测，无失败项、无新增发现。后台启动器重复调用确认复用进程。

浏览器保持页面打开，检查时间从 21:03:44 自动更新至 21:04:50（北京时间），期间没有手动刷新页面；接口未登录访问为 401。
