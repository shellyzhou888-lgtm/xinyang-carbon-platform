# packages/lca · 天工 LCI + Brightway 产品碳足迹

把服务器上的天工 LCI 数据（`D:\10.19数据集\carbon databases\02_碳足迹`，20261019 版）导入 Brightway 2.5，计算每个过程的气候变化足迹（IPCC GWP100），再组合园区两条产业链的产品碳轨迹，结果写回园区数据库。网页只读取结果，不在网页里做 LCA 计算。

## 环境

Brightway 不支持 Python 3.14 预览版，这里用 uv 建 Python 3.12 环境：

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt
```

Brightway 的项目库放在 `%LOCALAPPDATA%\XinyangCarbonPlatform\brightway`（纯 ASCII 路径）。

## 数据

从服务器复制到 `storage/lca/tiangong-20261019/`（已被 Git 忽略）：

| 文件 | 来源 |
|---|---|
| `processes.csv` | `01_天工_LCI清单/00_总清单/全站过程总清单.csv` |
| `exchanges.csv` | `01_天工_LCI清单/00_总清单/全站投入产出总清单.csv` |
| `flow_factors.json.gz`、`methods_list.json` | `05_LCA方法与因子/` |
| `strict_footprint.csv` | `02_天工_严格版碳足迹/全站LCI碳足迹_20261019.csv`（只用于对照） |

## 运行

```bash
.venv/Scripts/python tiangong_lca.py --write            # 导入并计算全部过程，写 lab.lca_process、lab.lca_contribution（约 10 分钟）
.venv/Scripts/python tiangong_lca.py --write --reuse    # 复用上次计算结果（storage/lca/results.pkl），只重写数据库
.venv/Scripts/python product_chains.py --write          # 按 data/simulated/product-chains.json 计算两条产业链碳轨迹
```

两步都会新建一条 `raw.import_batch` 记录，旧结果置为 `is_current = false`。写库后在 `packages/db-agent` 运行 `npm run govern -- --if-changed --trigger import`。

## 方法要点

- 每个天工过程是一个 Brightway 活动，参考流为产出；投入按“中国 → 省级 → 全球、同区取最新年份”链接到生产该产品的过程，找不到生产者的投入截断，并记录闭合程度（`closure`）。
- 带气候变化特征化因子的基本流构成生物圈；共产品与废物输出截断，与天工严格版一致。
- 天工严格版只算一级供应链，Brightway 递归后得到完整上游（例如河南电网电力：严格版 0.0006，递归 0.237 kgCO2e/MJ）。
- 个别过程因源数据单位不一致导致递归结果异常（如钢材几百 kgCO2e/kg）；产业链取值时，结果大于 100 kgCO2e/kg 且超过严格版 50 倍的改用严格版，并在阶段说明中注明。
- 园区生产段不用天工数据，取园区数据库中企业的范围一 + 二排放 ÷ 产量；物料清单、产量与运输距离目前为模拟值。
