"""园区月度综合能耗与碳排放预测（Chronos-2，PyTorch）。

为什么用 Chronos-2：
  - 每家企业只有 2021 年起约 60 个月的数据，从零训练深度模型（LSTM、TFT 等）样本太少、容易过拟合；
  - Chronos-2 是在大量真实时间序列上预训练的基础模型（Amazon，Apache-2.0），不需要训练即可预测（零样本），
    给出分位数区间，可同时预测多个对象并互相借鉴（cross learning），以后可加入产值计划等已知未来协变量；
  - 每次预测前用最近 12 个月做回测，与“去年同月”“去年同月 × 同比增速”两个基准比较，精度不如基准时要说明。

用法（在 packages/forecast 目录，使用 .venv 中的 Python）：
  python forecast.py backtest                 # 用截至前一年的数据预测最近 12 个月，输出误差
  python forecast.py run                      # 预测未来 12 个月，只打印
  python forecast.py run --write              # 预测并写入 fact.forecast（每个对象、能耗与碳排放各一组）
  python forecast.py roadmap [--write]        # 碳达峰路线图：2026 取 Chronos-2 预测，2027–2030 按基准 / 低碳情景外推

注意：当前园区数据绝大部分是模拟值，回测误差只说明方法可行，不代表真实数据上的精度。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2

MODEL_ID = "amazon/chronos-2"
QUANTILES = [0.1, 0.5, 0.9]
REPO = Path(__file__).resolve().parents[2]


def database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    for line in (REPO / ".env").read_text(encoding="utf-8-sig").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"').split("?")[0]
    raise SystemExit("缺少 DATABASE_URL（仓库根目录 .env）")


def load_series(conn, profile: str) -> pd.DataFrame:
    """园区与各企业、公共设施的月度综合能耗（tce，净受入）和碳排放（tCO2，指定口径），只取当前有效数据。"""
    sql = """
      with units as (select n.node_id, n.code from core.org_node n
                      where n.is_active and n.node_type in ('enterprise','public_area')),
      e as (select a.node_id, a.period_month,
                   sum(case a.flow when 'send_out' then -a.tce when 'consumption' then a.tce when 'receive' then a.tce else 0 end) tce,
                   coalesce(sum(a.tce) filter (where a.data_source in ('estimated','interpolated')), 0) / nullif(sum(a.tce), 0) est
              from fact.energy_activity a where a.is_current group by 1, 2),
      k as (select node_id, period_month, sum(co2_t) co2 from fact.carbon_emission
             where is_current and profile_code = %s group by 1, 2)
      select u.code as item_id, e.period_month as timestamp, e.tce::float as tce, coalesce(k.co2, 0)::float as co2, e.est::float as est
        from units u join e using (node_id) left join k using (node_id, period_month)
       order by 1, 2"""
    df = pd.read_sql(sql, conn, params=[profile])
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    park = df.groupby("timestamp", as_index=False).agg(tce=("tce", "sum"), co2=("co2", "sum"), est=("est", "mean"))
    park["item_id"] = "XYEDZ"
    return pd.concat([df, park], ignore_index=True)


def chronos_forecast(history: pd.DataFrame, horizon: int) -> pd.DataFrame:
    """返回 item_id, timestamp, target_name(tce/co2), q0.1, q0.5, q0.9。"""
    import torch
    from chronos import Chronos2Pipeline

    torch.set_num_threads(max(1, os.cpu_count() or 1))
    pipe = Chronos2Pipeline.from_pretrained(MODEL_ID, device_map="cpu")
    ctx = history[["item_id", "timestamp", "tce", "co2"]]
    pred = pipe.predict_df(ctx, id_column="item_id", timestamp_column="timestamp", target=["tce", "co2"],
                           prediction_length=horizon, quantile_levels=QUANTILES, cross_learning=True, freq="MS")
    pred = pred.rename(columns={str(q): f"q{q}" for q in QUANTILES})
    return pred[["item_id", "timestamp", "target_name"] + [f"q{q}" for q in QUANTILES]]


def baselines(history: pd.DataFrame, future_index: pd.DatetimeIndex) -> dict[str, pd.DataFrame]:
    """去年同月（季节朴素）与去年同月 × 近 12 个月同比增速。"""
    out = {"seasonal_naive": [], "seasonal_naive_growth": []}
    for (item, target), g in history.melt(id_vars=["item_id", "timestamp"], value_vars=["tce", "co2"],
                                           var_name="target_name").groupby(["item_id", "target_name"]):
        s = g.set_index("timestamp")["value"].asfreq("MS")
        last12, prev12 = s.iloc[-12:].sum(), s.iloc[-24:-12].sum()
        growth = last12 / prev12 if len(s) >= 24 and prev12 > 0 else 1.0
        for ts in future_index:
            ref = s.get(ts - pd.DateOffset(years=1))
            if ref is None or pd.isna(ref):
                continue
            out["seasonal_naive"].append((item, ts, target, ref))
            out["seasonal_naive_growth"].append((item, ts, target, ref * growth))
    return {k: pd.DataFrame(v, columns=["item_id", "timestamp", "target_name", "q0.5"]) for k, v in out.items()}


def errors(pred: pd.DataFrame, actual: pd.DataFrame, history: pd.DataFrame) -> pd.DataFrame:
    """每个对象、每个目标：MAPE（%）与 MASE（相对于历史季节朴素误差，<1 表示优于去年同月法）。"""
    act = actual.melt(id_vars=["item_id", "timestamp"], value_vars=["tce", "co2"], var_name="target_name", value_name="actual")
    m = pred.merge(act, on=["item_id", "timestamp", "target_name"])
    rows = []
    for (item, target), g in m.groupby(["item_id", "target_name"]):
        h = history[history.item_id == item].set_index("timestamp")[target].asfreq("MS")
        scale = (h - h.shift(12)).abs().mean()
        ok = g["actual"] > 0
        mape = float((abs(g.loc[ok, "q0.5"] - g.loc[ok, "actual"]) / g.loc[ok, "actual"]).mean() * 100) if ok.any() else np.nan
        mase = float(abs(g["q0.5"] - g["actual"]).mean() / scale) if scale and scale > 0 else np.nan
        cover = float(((g["actual"] >= g["q0.1"]) & (g["actual"] <= g["q0.9"])).mean()) if "q0.1" in g else np.nan
        rows.append((item, target, round(mape, 2), round(mase, 3), round(cover, 2) if not np.isnan(cover) else None, len(g)))
    return pd.DataFrame(rows, columns=["item_id", "target", "MAPE%", "MASE", "区间覆盖率", "月数"])


def backtest(conn, profile: str, horizon: int = 12):
    df = load_series(conn, profile)
    cutoff = df["timestamp"].max() - pd.DateOffset(months=horizon)
    hist, test = df[df.timestamp <= cutoff], df[df.timestamp > cutoff]
    hist = hist.groupby("item_id").filter(lambda g: len(g) >= 12)
    test = test[test.item_id.isin(hist.item_id.unique())]
    future = pd.date_range(cutoff + pd.DateOffset(months=1), periods=horizon, freq="MS")
    results = {"chronos-2": errors(chronos_forecast(hist, horizon), test, hist)}
    for name, p in baselines(hist, future).items():
        results[name] = errors(p, test, hist)
    summary = {}
    for name, r in results.items():
        park = r[r.item_id == "XYEDZ"].set_index("target")
        ent = r[r.item_id != "XYEDZ"]
        summary[name] = {
            "park_tce_MAPE%": park.loc["tce", "MAPE%"], "park_co2_MAPE%": park.loc["co2", "MAPE%"],
            "enterprise_tce_MAPE%_median": round(float(ent[ent.target == "tce"]["MAPE%"].median()), 2),
            "enterprise_MASE_median": round(float(ent["MASE"].median()), 3),
            "park_interval_coverage": park.loc["tce", "区间覆盖率"] if name == "chronos-2" else None,
        }
    print(f"回测：用 {hist.timestamp.min():%Y-%m}～{cutoff:%Y-%m} 预测 {future[0]:%Y-%m}～{future[-1]:%Y-%m}")
    print(pd.DataFrame(summary).T.to_string())
    print("\nChronos-2 各对象：")
    print(results["chronos-2"].sort_values(["target", "MAPE%"]).to_string(index=False))
    return summary


def run(conn, profile: str, horizon: int, write: bool):
    df = load_series(conn, profile)
    df = df.groupby("item_id").filter(lambda g: len(g) >= 12)
    bt = backtest(conn, profile, horizon)
    pred = chronos_forecast(df, horizon)
    park = pred[pred.item_id == "XYEDZ"].pivot(index="timestamp", columns="target_name", values="q0.5")
    print(f"\n园区未来 {horizon} 个月预测（中位数）：\n{park.round(1).to_string()}")
    if not write:
        return
    est = float(df[df.item_id == "XYEDZ"]["est"].mean())
    with conn:
        cur = conn.cursor()
        cur.execute("SET LOCAL ROLE green_app")
        cur.execute("""insert into fact.calc_run (run_type, version_id, period_from, period_to, params, status)
                       select 'forecast', version_id, %s, %s, %s, 'running' from core.standard_version where code = %s
                       returning run_id""",
                    (pred.timestamp.min().date(), pred.timestamp.max().date(),
                     json.dumps({"model": MODEL_ID, "quantiles": QUANTILES, "horizon": horizon, "profile": profile,
                                 "context_end": f"{df.timestamp.max():%Y-%m}", "backtest": bt,
                                 "estimated_share_of_history": round(est, 3),
                                 "note": "历史数据含模拟值时，预测只能说明方法，不代表园区真实走势"}, ensure_ascii=False),
                     profile))
        run_id = cur.fetchone()[0]
        kinds = {"tce": "energy_tce", "co2": "co2_t"}
        rows = [(run_id, r.item_id, kinds[r.target_name], r.timestamp.date(), max(r["q0.5"], 0), max(r["q0.1"], 0), max(r["q0.9"], 0))
                for _, r in pred.iterrows()]
        cur.executemany("""insert into fact.forecast (run_id, node_id, target_kind, target_code, period_month, value, lower_bound, upper_bound)
                           select %s, node_id, %s, null, %s, %s, %s, %s from core.org_node where code = %s""",
                        [(a, c, d, e, f, g, b) for a, b, c, d, e, f, g in rows])
        cur.execute("update fact.calc_run set status = 'succeeded', finished_at = now(), summary = %s where run_id = %s",
                    (json.dumps({"rows": len(rows), "objects": int(pred.item_id.nunique())}), run_id))
    print(f"\n已写入 fact.forecast：计算批次 {run_id}，{len(rows)} 行")


ROADMAP = {
    # 基准情景：能耗增速从 2026 年预测增速线性回落到 2030 年 4%；碳排放 / 能耗比每年下降 1%（电网逐步低碳化）
    "ROADMAP_BASE": {"growth_end": 0.04, "efficiency_pp": 0.0, "co2_factor_decline": 0.01,
                     "label": "基准情景：延续现有增长，电网逐步低碳化"},
    # 低碳情景：在基准增速上每年少 3 个百分点（节能策略），碳排放 / 能耗比每年下降 6%（绿电占比 2030 年提高到 40%、光伏扩容）
    "ROADMAP_LOWCARBON": {"growth_end": 0.04, "efficiency_pp": 0.03, "co2_factor_decline": 0.06,
                          "label": "低碳情景：节能策略 + 绿电 40% + 光伏扩容"},
}


def roadmap(conn, profile: str, write: bool, end_year: int = 2030):
    """园区年度能耗与碳排放路线图：2021–2025 实际，2026 取最新 Chronos-2 预测，2027–2030 按情景假设外推。"""
    df = load_series(conn, profile)
    park = df[df.item_id == "XYEDZ"].assign(year=lambda d: d.timestamp.dt.year).groupby("year")[["tce", "co2"]].sum()
    last_year = int(park.index.max())
    cur = conn.cursor()
    cur.execute("""select f.target_kind, sum(f.value)::float from fact.forecast f join core.org_node n using (node_id)
                    where n.code = 'XYEDZ' and f.scenario_code = 'baseline' and extract(year from f.period_month) = %s
                      and f.run_id = (select max(run_id) from fact.forecast g where g.node_id = f.node_id and g.scenario_code = 'baseline')
                    group by 1""", (last_year + 1,))
    fc = dict(cur.fetchall())
    if not fc:
        raise SystemExit(f"没有 {last_year + 1} 年的基准预测，请先运行 python forecast.py run --write")
    first = {"tce": fc["energy_tce"], "co2": fc["co2_t"]}
    g0 = first["tce"] / park.loc[last_year, "tce"] - 1
    peak_target = None
    cur.execute("select to_regclass('fact.target') is not null")
    if cur.fetchone()[0]:   # 目标表由迁移 0025 建立
        cur.execute("select value::float from fact.target t join core.org_node n using (node_id) "
                    "where n.code = 'XYEDZ' and t.is_current and t.target_kind = 'carbon_peak_t' order by year limit 1")
        peak_target = (cur.fetchone() or [None])[0]
    years = list(range(last_year + 1, end_year + 1))
    out = {}
    for code, s in ROADMAP.items():
        tce, co2 = [first["tce"]], [first["co2"]]
        factor = first["co2"] / first["tce"]
        for i, y in enumerate(years[1:], start=1):
            g = g0 + (s["growth_end"] - g0) * i / (len(years) - 1) - s["efficiency_pp"]
            tce.append(tce[-1] * (1 + max(g, -0.05)))
            factor *= 1 - s["co2_factor_decline"]
            co2.append(tce[-1] * factor)
        series = pd.DataFrame({"year": years, "tce": tce, "co2": co2})
        hist_co2 = list(park["co2"]) + co2
        peak_i = int(np.argmax(hist_co2))
        all_years = list(park.index) + years
        out[code] = {"label": s["label"], "series": series,
                     "peak_year": int(all_years[peak_i]) if all_years[peak_i] < end_year else None,
                     "peak_co2_t": round(float(max(hist_co2)), 1)}
        print(f"\n{code} {s['label']}")
        print(series.round(0).to_string(index=False))
        print(f"  达峰年份：{out[code]['peak_year'] or f'{end_year} 年前未达峰'}；峰值 {out[code]['peak_co2_t']:,.0f} tCO2"
              + (f"；模拟达峰上限 {peak_target:,.0f}" if peak_target else ""))
    if not write:
        return
    with conn:
        cur = conn.cursor()
        cur.execute("SET LOCAL ROLE green_app")
        cur.execute("""insert into fact.calc_run (run_type, version_id, period_from, period_to, params, status)
                       select 'forecast', version_id, %s, %s, %s, 'running' from core.standard_version where code = %s returning run_id""",
                    (f"{years[0]}-01-01", f"{end_year}-01-01",
                     json.dumps({"model": "scenario-roadmap", "first_year_from": "chronos-2 baseline", "profile": profile,
                                 "scenarios": {k: {**{kk: vv for kk, vv in ROADMAP[k].items()}, "peak_year": v["peak_year"], "peak_co2_t": v["peak_co2_t"]}
                                               for k, v in out.items()},
                                 "carbon_peak_target_t": peak_target,
                                 "note": "年度值记在每年 1 月（target_code = annual）；情景参数为模拟假设"}, ensure_ascii=False),
                     profile))
        run_id = cur.fetchone()[0]
        rows = []
        for code, v in out.items():
            for r in v["series"].itertuples():
                rows.append((run_id, "energy_tce", code, f"{r.year}-01-01", r.tce))
                rows.append((run_id, "co2_t", code, f"{r.year}-01-01", r.co2))
        cur.executemany("""insert into fact.forecast (run_id, node_id, target_kind, target_code, scenario_code, period_month, value)
                           select %s, node_id, %s, 'annual', %s, %s, %s from core.org_node where code = 'XYEDZ'""", rows)
        cur.execute("update fact.calc_run set status = 'succeeded', finished_at = now(), summary = %s where run_id = %s",
                    (json.dumps({"rows": len(rows)}), run_id))
    print(f"\n已写入路线图：计算批次 {run_id}，{len(rows)} 行")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["backtest", "run", "roadmap"])
    ap.add_argument("--horizon", type=int, default=12)
    ap.add_argument("--profile", default="GIP_2026")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    conn = psycopg2.connect(database_url())
    try:
        if a.command == "backtest":
            backtest(conn, a.profile, a.horizon)
        elif a.command == "roadmap":
            roadmap(conn, a.profile, a.write)
        else:
            run(conn, a.profile, a.horizon, a.write)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
