"""Product carbon trajectories for the park's two core industry chains.

Reads data/simulated/product-chains.json (simulated bill of materials, outputs and transport), takes background
factors from lab.lca_process (TianGong LCI computed with Brightway, see tiangong_lca.py) and park production from the
enterprise's scope 1 + 2 emissions in the park database, and writes one row per stage with its kgCO2e and the running
total (the carbon trajectory) to lab.product_chain / lab.product_chain_stage.

Usage (packages/lca):  .venv/Scripts/python product_chains.py [--write]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras

REPO = Path(__file__).resolve().parents[2]
CONFIG = REPO / "data" / "simulated" / "product-chains.json"


def connect():
    url = next(l.split("=", 1)[1].strip().strip('"').split("?")[0] for l in (REPO / ".env").read_text(encoding="utf-8-sig").splitlines() if l.startswith("DATABASE_URL="))
    return psycopg2.connect(url)


def tiangong_factor(cur, prefix: str):
    cur.execute("""select process_code, name_zh, region_code, ref_year, functional_unit, closure, gwp_kgco2e, tiangong_strict_kgco2e
                     from lab.lca_process where is_current and process_code like %s order by process_code limit 1""", (prefix + "%",))
    r = cur.fetchone()
    if not r: raise SystemExit(f"天工过程 {prefix} 不存在，先运行 tiangong_lca.py --write")
    code, name, region, year, fu, closure, bw, strict = r
    abnormal = bw is not None and strict and bw > 100 and bw > 50 * strict
    value, basis = (strict, "天工严格版（递归结果异常）") if abnormal else (bw, "Brightway 递归计算")
    return {"value": value, "basis": basis, "process_code": code, "process_name": name, "region": region, "year": year,
            "functional_unit": fu, "closure": closure, "brightway": bw, "strict": strict}


def enterprise_intensity(cur, code: str, year: int, output: dict):
    cur.execute("""select n.name, engine.metric_value('CO2_TOTAL', n.node_id, %s, 'GIP_2026')::float from core.org_node n where n.code = %s""", (year, code))
    name, co2 = cur.fetchone()
    return {"value": co2 * 1000 / output["value"], "basis": f"{name} {year} 年范围一+二排放 {co2:,.0f} t ÷ {output['value']:,.0f} {output['unit']}",
            "enterprise_name": name, "co2_t": co2, "output": output}


def compute(cur, cfg):
    year = cfg["year"]
    chains = []
    for chain in cfg["chains"]:
        running, rows = 0.0, []
        for seq, s in enumerate(chain["stages"], start=1):
            f = s["factor"]
            if f["kind"] == "tiangong":
                fac = tiangong_factor(cur, f["process"])
                unit = f["unit"]
            elif f["kind"] == "park_factor":
                fac = {"value": f["value"], "basis": f"园区核算因子（{f['energy']}）"}
                unit = f["unit"]
            else:
                out = cfg["simulated_outputs"][f["enterprise"]]
                fac = enterprise_intensity(cur, f["enterprise"], year, out)
                unit = f"kgCO2e/{out['unit']}"
            kg = s["amount"] * (fac["value"] or 0)
            running += kg
            rows.append({**s, "seq": seq, "factor_kind": f["kind"], "enterprise": s.get("enterprise") or f.get("enterprise"),
                         "factor_value": fac["value"], "factor_unit": unit, "factor": fac, "kgco2e": kg, "cumulative": running})
        milestones = []
        for m in chain["milestones"]:
            at = next(r for r in rows if r["code"] == m["after_stage"])
            milestones.append({**m, "cumulative_kgco2e": at["cumulative"]})
        chains.append({**chain, "total": running, "stages": rows, "milestones": milestones})
    return chains


def write(conn, cfg, chains):
    cur = conn.cursor()
    cur.execute((Path(__file__).parent / "schema-chains.sql").read_text(encoding="utf8"))
    cur.execute("""insert into raw.import_batch (source_type, source_name, status, row_count, estimation_method, estimation_inputs, model_name, note)
                   values ('estimated', 'data/simulated/product-chains.json', 'loaded', %s, %s, %s, 'product_chains.py + 天工/Brightway', '园区两条产业链产品碳轨迹试点（模拟物料清单）') returning batch_id""",
                (sum(len(c["stages"]) for c in chains), cfg["purpose"], json.dumps(cfg, ensure_ascii=False)))
    batch = cur.fetchone()[0]
    cur.execute("update lab.product_chain set is_current = false where is_current")
    cur.execute("update lab.product_chain_stage set is_current = false where is_current")
    for c in chains:
        cur.execute("""insert into lab.product_chain (chain_code, name, industry, functional_unit, year, total_kgco2e, milestones, factor_rule, batch_id)
                       values (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (c["code"], c["name"], c["industry"], c["functional_unit"], cfg["year"], c["total"], json.dumps(c["milestones"], ensure_ascii=False), cfg["factor_rule"], batch))
        psycopg2.extras.execute_values(cur, """insert into lab.product_chain_stage (chain_code, seq, stage_code, phase, name, enterprise_code, amount, unit,
            factor_kind, factor_value, factor_unit, factor_basis, process_code, process_name, kgco2e, cumulative_kgco2e, note, batch_id) values %s""",
            [(c["code"], r["seq"], r["code"], r["phase"], r["name"], r["enterprise"], r["amount"], r["unit"], r["factor_kind"], r["factor_value"], r["factor_unit"], r["factor"]["basis"], r["factor"].get("process_code"), r["factor"].get("process_name"),
              r["kgco2e"], r["cumulative"], r.get("note"), batch) for r in c["stages"]])
    conn.commit()
    print(f"wrote batch {batch}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    cfg = json.loads(CONFIG.read_text(encoding="utf8"))
    conn = connect()
    chains = compute(conn.cursor(), cfg)
    for c in chains:
        print(f"\n{c['name']} · {c['functional_unit']} · 合计 {c['total']:.2f} kgCO2e")
        for r in c["stages"]:
            print(f"  {r['seq']:2} {r['phase']:4} {r['name'][:22]:22} {r['amount']:>10} {r['unit']:6} × {r['factor_value']:.4g} {r['factor_unit']:14} = {r['kgco2e']:8.3f}  累计 {r['cumulative']:8.2f}  [{r['factor']['basis'][:28]}]")
    if a.write: write(conn, cfg, chains)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
