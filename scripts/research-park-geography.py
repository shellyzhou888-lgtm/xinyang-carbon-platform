"""Query public AMap POIs; credentials stay in the ignored web environment file.

Run: py -X utf8 scripts/research-park-geography.py
The response is a research candidate list, never an automatically approved boundary.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
QUERIES = [
    "万华生态板业", "万华无醛生态产业园", "现代筑美", "亚丹", "永豪轩",
    "天一美家", "百德", "谷麦光电", "今上半导体", "星原智能", "螓杰智能",
    "信阳国际家居产业小镇", "金牛产业集聚区", "金工大道智能产业园",
]


def main() -> None:
    config = {}
    for line in (ROOT / "apps/web/.env.local").read_text(encoding="utf-8-sig").splitlines():
        if line and not line.startswith("#") and "=" in line:
            name, value = line.split("=", 1)
            config[name.strip()] = value.strip().strip("\"'")
    key = config.get("AMAP_WEB_SERVICE_KEY")
    if not key:
        raise SystemExit("AMAP_WEB_SERVICE_KEY is missing")
    output = ROOT / "data/geography/amap-poi-research.json"
    records = json.loads(output.read_text(encoding="utf-8"))["records"] if output.exists() else []
    for keyword in sys.argv[1:] or QUERIES:
        query = urlencode({"key": key, "keywords": keyword, "city": "411500", "citylimit": "true", "offset": 8, "extensions": "all"})
        with urlopen("https://restapi.amap.com/v3/place/text?" + query, timeout=20) as response:
            data = json.load(response)
        records = [record for record in records if record["query"] != keyword]
        # Keep only the evidence needed for mapping; omit telephone numbers and photos.
        fields = ("id", "name", "address", "location", "entr_location", "type", "adname", "timestamp")
        pois = [{name: poi.get(name) for name in fields} for poi in data.get("pois", [])]
        records.append({"query": keyword, "status": data.get("status"), "info": data.get("info"), "pois": pois})
        print(keyword, data.get("info"), [(p.get("id"), p.get("name"), p.get("address"), p.get("location")) for p in data.get("pois", [])])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"provider": "AMap Web Service v3/place/text", "crs": "GCJ-02", "fetchedAt": datetime.now(timezone.utc).isoformat(), "records": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
