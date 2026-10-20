"""Build reviewed GCJ-02 enterprise points and clearly labelled display envelopes.

POI points are not surveyed parcel boundaries. No enterprise polygon is invented.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTITIES = [
    ("E_WANHUA", "万华生态（信阳）", "绿色家居", "B0IRRDEV5J", "万华禾香集团股份有限公司信阳项目；采用家居片区新项目点位，未采用工十四路旧厂。"),
    ("E_ZHUMEI", "现代筑美", "绿色家居", "B0FFK7OSG4", "高德名称为河南省现代筑美家居有限公司。"),
    ("E_YADAN", "亚丹生态", "绿色家居", "B0JDAA6RW8", "纬北五路西段生产基地。"),
    ("E_YONGHAOXUAN", "永豪轩家居", "绿色家居", "B0FFH9O305", "高德名称为河南永豪轩智能家居股份有限公司；与档案历史名称不同，厂区关联待企业复核。"),
    ("E_TIANYI", "天一美家", "绿色家居", "B0FFG4050S", "品牌生产园区点位，非单一法人用地红线。"),
    ("E_BAIDE", "百德实业", "绿色家居", "B0H33ZT833", "采用信阳百德实业有限公司点位，排除同名超市。"),
    ("E_GUMAI", "谷麦光电", "电子信息", "B0FFI03U3F", "高德为谷麦科技集团股份有限公司园区；信阳子公司与母公司共址，未取得独立厂房红线。"),
    ("E_JINSHANG", "今上半导体", "电子信息", "B0H02ZCRG5", "金牛物流产业集聚区富民路6号。"),
    ("E_XINGYUAN", "星原智能", "电子信息", "B0I6YHW0PP", "企业POI与园区内楼栋位置，需结合租赁厂房资料复核。"),
    ("E_QINJIE", "螓杰智能", "电子信息", "B0IUJZL7XC", "电子信息智能产业园7号楼；与其他租户可能共用厂区。"),
]


def envelope(points: list[list[float]], padding_m: float = 220) -> list[list[float]]:
    """Convex hull expanded from its center; only a display coverage envelope."""
    lat = sum(p[1] for p in points) / len(points)
    kx, ky = 111320 * math.cos(math.radians(lat)), 110540
    xy = sorted((p[0] * kx, p[1] * ky) for p in points)

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def half(items):
        result = []
        for point in items:
            while len(result) >= 2 and cross(result[-2], result[-1], point) <= 0:
                result.pop()
            result.append(point)
        return result[:-1]

    hull = half(xy) + half(list(reversed(xy)))
    cx, cy = sum(p[0] for p in hull) / len(hull), sum(p[1] for p in hull) / len(hull)
    ring = []
    for x, y in hull:
        distance = math.hypot(x - cx, y - cy)
        ring.append([round((x + (x - cx) / distance * padding_m) / kx, 6), round((y + (y - cy) / distance * padding_m) / ky, 6)])
    return ring + [ring[0]]


def main() -> None:
    raw = json.loads((ROOT / "data/geography/amap-poi-research.json").read_text(encoding="utf-8"))
    candidates = {p["id"]: p for record in raw["records"] for p in record["pois"]}
    features = []
    for code, name, sector, poi_id, note in ENTITIES:
        poi = candidates[poi_id]
        coordinates = [float(value) for value in poi["location"].split(",")]
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": coordinates}, "properties": {
            "kind": "enterprise", "code": code, "name": name, "sector": sector,
            "color": "#3ddc97" if sector == "绿色家居" else "#69baff",
            "poiId": poi_id, "poiName": poi["name"], "address": poi["address"],
            "source": "高德地图公开企业POI", "sourceUrl": f"https://www.amap.com/detail/{poi_id}",
            "locatedAt": raw["fetchedAt"], "precision": "企业/厂区POI，非测绘界址点", "note": note,
            "boundaryStatus": "unavailable", "boundary": None,
        }})
    for sector, code, color in [("绿色家居", "Z_HOME", "#3ddc97"), ("电子信息", "Z_ELEC", "#69baff")]:
        points = [f["geometry"]["coordinates"] for f in features if f["properties"]["sector"] == sector]
        features.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [envelope(points)]}, "properties": {
            "kind": "distribution", "code": code, "name": sector + "企业分布范围", "sector": sector, "color": color,
            "geometryPurpose": "distribution_envelope", "notLegalBoundary": True,
            "method": "已定位企业POI凸包向外扩展约220米；仅用于地图取景与分布展示，不是片区规划红线或企业厂界。",
        }})
    data = {"type": "FeatureCollection", "coordinateSystem": "GCJ-02", "updatedAt": "2026-10-20", "legalBoundaryAvailable": False,
            "sourceNote": "10家企业点位来自高德公开POI；2个面为企业分布示意范围。已核对豫政办〔2023〕26号四至文字，尚未取得界址坐标及逐企业测绘红线。GCJ-02不是RFC 7946默认的WGS84，导出后须按坐标系处理。", "features": features,
            "boundaryReference": json.loads((ROOT / "data/geography/boundary-authority.json").read_text(encoding="utf-8"))}
    output = ROOT / "apps/web/data/park-geography.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Built 10 enterprise POIs and 2 non-legal distribution envelopes:", output)


if __name__ == "__main__":
    main()
