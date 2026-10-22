"""TianGong LCI → Brightway 2.5 → climate-change footprints written back to the park database.

Input (copied from the server's D:\\10.19数据集\\carbon databases\\02_碳足迹, release 20261019, into
storage/lca/tiangong-20261019/, git-ignored):
  processes.csv          全站过程总清单 (5,572 ILCD process datasets: name, region, year, industry)
  exchanges.csv          全站投入产出总清单 (every input / output with flow UUID, amount, reference flag)
  flow_factors.json.gz   LCIA characterisation factors keyed "flowUUID:DIRECTION"
  strict_footprint.csv   TianGong's own "strict" results, kept only for comparison

Model:
  - Every process becomes a Brightway activity; its reference flow is the production exchange.
  - An input flow is linked to the process that produces it as reference product (preference CN > CN-xx > GLO > others,
    then the newest reference year). Inputs with no producer are cut off and counted (closure share).
  - Elementary flows with a climate-change factor (IPCC 100-year, TianGong method 6209b35f…) form the biosphere.
  - Co-products and waste outputs are cut off (no allocation) - the same simplification as TianGong's strict results.
  - One factorised LCA gives the footprint per reference unit for every process; contribution analysis splits it into
    direct emissions, electricity / energy, materials, transport and other upstream.

Output (schema lab, tables created if missing, each run is one raw.import_batch; earlier rows become is_current = false):
  lab.lca_process    one row per TianGong process with metadata, closure share and the computed footprint
  lab.lca_contribution  top upstream contributors of each process, grouped

Usage (packages/lca):  .venv/Scripts/python tiangong_lca.py [--write] [--reuse]
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "storage" / "lca" / "tiangong-20261019"
# Brightway keeps its own project store; an ASCII-only path avoids issues with the non-ASCII repository path.
BW_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "XinyangCarbonPlatform" / "brightway"
BW_DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("BRIGHTWAY2_DIR", str(BW_DIR))
import bw2calc as bc  # noqa: E402
import bw2data as bd  # noqa: E402

CLIMATE = "6209b35f-9447-40b5-b68c-a1099e3674a0"   # 气候变化（IPCC 100 年基准模型），kg CO2-eq
PROJECT, TECH, BIO = "xinyang-tiangong", "tiangong-20261019", "tiangong-ghg"
METHOD = ("TianGong", "climate change", "IPCC GWP100")
RELEASE = "20261019"


def region_rank(code: str) -> int:
    code = code or ""
    if code == "CN": return 0
    if code.startswith("CN-"): return 1
    if code == "GLO": return 2
    return 3


def group_of(industry: str, name: str) -> str:
    """Contribution group of an upstream process (shown on the lifecycle page)."""
    n = name or ""
    if industry == "D35" or any(k in n for k in ("电力", "电网", "交流电", "热力", "蒸汽")): return "电力与热力"
    if industry in ("B05", "B06", "C19") or any(k in n for k in ("天然气", "柴油", "汽油", "煤", "燃料")): return "化石燃料"
    if industry and industry.startswith("H49") or any(k in n for k in ("运输", "卡车", "货车", "铁路")): return "运输"
    if industry in ("C20", "C21", "C22"): return "化工与塑料"
    if industry in ("C24", "C25", "B07"): return "金属"
    if industry in ("A01", "A02", "C16", "C17"): return "农林与木材纸品"
    return "其他上游"


def load():
    pr = pd.read_csv(DATA / "processes.csv", dtype=str).fillna("")
    ex = pd.read_csv(DATA / "exchanges.csv", dtype=str).fillna("")
    ex["数量"] = pd.to_numeric(ex["数量"], errors="coerce").fillna(0.0)
    ff = json.load(gzip.open(DATA / "flow_factors.json.gz", "rt", encoding="utf8"))
    cf = {}
    for key, v in ff.items():
        for f in v.get("factor", []):
            if f["key"] == CLIMATE:
                val = float(f["value"])
                if val != 0: cf[key] = val
    pr["code"] = pr["过程ID"] + "_" + pr["版本"]
    ex["code"] = ex["过程ID"] + "_" + ex["版本"]
    return pr, ex, cf


def build(pr: pd.DataFrame, ex: pd.DataFrame, cf: dict[str, float]):
    bd.projects.set_current(PROJECT)
    meta = pr.set_index("code")
    ref = ex[ex["是否参考流"] == "是"]
    ref_amount = ref.groupby("code")["数量"].first()
    ref_flow = ref.groupby("code")["流ID"].first()
    ref_flow_name = ref.groupby("code")["流名称"].first()

    # Provider per product flow
    cand = defaultdict(list)
    for code, flow in ref_flow.items():
        m = meta.loc[code]
        cand[flow].append((region_rank(m["地区代码"]), -int(m["参考年份"] or 0), code))
    provider = {flow: sorted(c)[0][2] for flow, c in cand.items()}

    bio_data, tech_data = {}, {}
    stats = {}
    for code, rows in ex.groupby("code"):
        m = meta.loc[code]
        amt = float(ref_amount.get(code, 0) or 0)
        if amt == 0: amt = 1.0
        exchanges = [{"input": (TECH, code), "amount": abs(amt), "type": "production"}]
        n_in = n_linked = n_elem = 0
        for _, r in rows.iterrows():
            if r["是否参考流"] == "是": continue
            direction = "INPUT" if r["方向"] == "投入" else "OUTPUT"
            key = f"{r['流ID']}:{direction}"
            if key in cf:
                bio_data[(BIO, key)] = {"name": r["流名称"] or r["英文流名称"], "type": "emission", "unit": "kg", "direction": direction}
                exchanges.append({"input": (BIO, key), "amount": float(r["数量"]), "type": "biosphere"})
                n_elem += 1
                continue
            if direction == "INPUT":
                n_in += 1
                p = provider.get(r["流ID"])
                if p and p != code and float(r["数量"]) != 0:
                    exchanges.append({"input": (TECH, p), "amount": float(r["数量"]), "type": "technosphere"})
                    n_linked += 1
        tech_data[(TECH, code)] = {
            "name": m["产品名称"], "reference product": ref_flow_name.get(code, ""), "location": m["地区代码"],
            "unit": "unit", "industry": m["行业代码"], "exchanges": exchanges,
        }
        stats[code] = {"ref_amount": amt, "n_inputs": n_in, "n_linked": n_linked, "n_elementary": n_elem}

    if BIO in bd.databases: del bd.databases[BIO]
    if TECH in bd.databases: del bd.databases[TECH]
    bd.Database(BIO).write(bio_data)
    bd.Database(TECH).write(tech_data)
    method = bd.Method(METHOD)
    method.register(unit="kg CO2-eq", description="TianGong LCIA 气候变化 IPCC GWP100")
    method.write([((BIO, key), val) for (_, key) in bio_data for val in [cf[key]]])
    return stats


def compute(pr: pd.DataFrame, stats: dict):
    db = bd.Database(TECH)
    acts = list(db)
    first = acts[0]
    lca = bc.LCA({first: 1}, METHOD)
    lca.lci(factorize=True)
    lca.lcia()
    cmat = lca.characterization_matrix @ lca.biosphere_matrix          # per process direct kg CO2-eq per unit activity
    direct_per_activity = np.asarray(cmat.sum(axis=0)).ravel()
    meta = pr.set_index("code")
    results, contributions = {}, {}
    rev = {v: k for k, v in lca.dicts.activity.items()}
    for i, act in enumerate(acts):
        lca.redo_lci({act.id: 1})
        supply = lca.supply_array
        per_act = direct_per_activity * supply
        total = float(per_act.sum())
        own = lca.dicts.activity[act.id]
        direct = float(per_act[own])
        groups = defaultdict(float)
        top = np.argsort(-np.abs(per_act))[:8]
        tops = []
        for j in top:
            if per_act[j] == 0: continue
            code = bd.get_node(id=rev[j])["code"]
            m = meta.loc[code]
            g = "直接排放" if j == own else group_of(m["行业代码"], m["产品名称"])
            tops.append({"code": code, "name": m["产品名称"], "group": g, "kg": float(per_act[j])})
        for j in np.nonzero(per_act)[0]:
            if j == own: groups["直接排放"] += float(per_act[j]); continue
            code = bd.get_node(id=rev[j])["code"]
            m = meta.loc[code]
            groups[group_of(m["行业代码"], m["产品名称"])] += float(per_act[j])
        results[act["code"]] = {"total": total, "direct": direct, "groups": dict(groups)}
        contributions[act["code"]] = tops
        if i % 500 == 0: print(f"  {i}/{len(acts)}", flush=True)
    return results, contributions


def write(pr, stats, results, contributions, strict):
    import psycopg2
    url = next(l.split("=", 1)[1].strip().strip('"').split("?")[0] for l in (REPO / ".env").read_text(encoding="utf-8-sig").splitlines() if l.startswith("DATABASE_URL="))
    conn = psycopg2.connect(url)
    cur = conn.cursor()
    cur.execute((Path(__file__).parent / "schema.sql").read_text(encoding="utf8"))
    cur.execute("""insert into raw.import_batch (source_type, source_name, status, row_count, model_name, note, estimation_inputs)
                   values ('file_upload', %s, 'loaded', %s, 'brightway25 (bw2data 4.8 / bw2calc 3.1)', %s, %s) returning batch_id""",
                (f"天工 LCI 全站数据 {RELEASE}", len(pr), "天工 LCI 导入并用 Brightway 计算气候变化（IPCC GWP100）足迹；共产品/废物输出截断，无生产者的投入截断",
                 json.dumps({"release": RELEASE, "method": list(METHOD), "linking": "CN > CN-xx > GLO > 其他，同区取最新参考年份"}, ensure_ascii=False)))
    batch = cur.fetchone()[0]
    cur.execute("update lab.lca_process set is_current = false where is_current")
    cur.execute("update lab.lca_contribution set is_current = false where is_current")
    rows = []
    for _, r in pr.iterrows():
        code = r["code"]; s = stats.get(code, {}); res = results.get(code, {}); st = strict.get(r["过程ID"], {})
        n_in, n_link = s.get("n_inputs", 0), s.get("n_linked", 0)
        closure = "complete" if n_in == n_link else ("none" if n_link == 0 and n_in > 0 else "partial")
        rows.append((code, r["过程ID"], r["版本"], r["产品名称"], r["英文名称"], r["地区代码"], r["地区名称"], r["行业代码"],
                     int(r["参考年份"] or 0) or None, r["数据集类型"], s.get("ref_amount"), st.get("unit"), n_in, n_link, s.get("n_elementary", 0),
                     closure, res.get("total"), res.get("direct"), json.dumps(res.get("groups", {}), ensure_ascii=False),
                     st.get("value"), st.get("status"), batch))
    psycopg2.extras.execute_values(cur, """insert into lab.lca_process (process_code, process_uuid, version, name_zh, name_en, region_code, region_name,
        industry_code, ref_year, dataset_type, ref_amount, functional_unit, n_inputs, n_linked_inputs, n_ghg_flows, closure,
        gwp_kgco2e, gwp_direct_kgco2e, gwp_groups, tiangong_strict_kgco2e, tiangong_strict_status, batch_id) values %s""", rows, page_size=1000)
    crow = [(code, k + 1, t["code"], t["name"], t["group"], t["kg"], batch) for code, tops in contributions.items() for k, t in enumerate(tops)]
    psycopg2.extras.execute_values(cur, """insert into lab.lca_contribution (process_code, rank, contributor_code, contributor_name, contributor_group, kgco2e, batch_id)
        values %s""", crow, page_size=2000)
    conn.commit()
    print(f"wrote batch {batch}: {len(rows)} processes, {len(crow)} contributions")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--reuse", action="store_true", help="reuse storage/lca/results.pkl from the last compute")
    a = ap.parse_args()
    pr, ex, cf = load()
    print(f"processes {len(pr)}, exchanges {len(ex)}, climate factors {len(cf)}")
    cache = REPO / "storage" / "lca" / "results.pkl"
    if a.reuse and cache.exists():
        import pickle
        stats, results, contributions = pickle.loads(cache.read_bytes())
        print("reused", cache)
    else:
        stats = build(pr, ex, cf)
        results, contributions = compute(pr, stats)
        import pickle
        cache.write_bytes(pickle.dumps((stats, results, contributions)))
    strict_df = pd.read_csv(DATA / "strict_footprint.csv", dtype=str).fillna("")
    strict = {r["过程ID"]: {"value": float(r["最终碳足迹"] or 0), "status": r["结果状态"], "unit": r["功能单位"]} for _, r in strict_df.iterrows()}
    vals = np.array([v["total"] for v in results.values()])
    print(f"computed {len(vals)}: median {np.median(vals):.4g}, >1e4: {(vals > 1e4).sum()}, negative: {(vals < 0).sum()}")
    if a.write:
        import psycopg2.extras  # noqa: F401
        write(pr, stats, results, contributions, strict)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
