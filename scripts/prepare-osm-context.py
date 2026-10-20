"""Prepare a bounded OSM context extract, never a cadastral boundary.

Run with Python 3 (standard library). Downloaded XML remains in ignored storage/.
Only selected map tags are redistributed; OSM editor account metadata is omitted.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
BBOX = [114.04, 32.15, 114.16, 32.25]  # WGS84 context around the ten sample POIs
RAW = ROOT / "storage/research/geography/osm-context-raw.osm"
URL = "https://api.openstreetmap.org/api/0.6/map?bbox=" + ",".join(map(str, BBOX))
ALLOWED = {"name", "name:zh", "ref", "highway", "building", "landuse", "height", "building:levels", "width", "surface", "oneway"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="Refresh the small XML extract once; otherwise use local XML")
    args = parser.parse_args()
    if args.download:
        RAW.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(URL, headers={"User-Agent": "XinyangCarbonPlatform/0.15 geography research"})
        with urllib.request.urlopen(request, timeout=60) as response:
            content = response.read()
        ET.fromstring(content)  # Do not replace the cache with an HTTP error page.
        RAW.write_bytes(content)
    root = ET.parse(RAW).getroot()
    nodes = {n.attrib["id"]: (float(n.attrib["lon"]), float(n.attrib["lat"])) for n in root.findall("node")}
    ways = {w.attrib["id"]: w for w in root.findall("way")}
    features = []
    skipped = []

    def tags(element):
        return {tag.attrib["k"]: tag.attrib["v"] for tag in element.findall("tag")}

    def positions(way):
        refs = [n.attrib["ref"] for n in way.findall("nd")]
        if any(ref not in nodes for ref in refs):
            raise ValueError("incomplete node references")
        return [nodes[ref] for ref in refs]

    def add(element, geometry, kind):
        properties = tags(element)
        if properties.get("landuse") == "military" or "military" in properties:
            return  # Outside the park modelling scope.
        properties = {k: v for k, v in properties.items() if k in ALLOWED}
        properties.update(osmId=f"{element.tag}/{element.attrib['id']}", kind=kind, notLegalBoundary=True)
        if kind == "building":
            properties["heightStatus"] = "tagged" if "height" in properties or "building:levels" in properties else "unavailable"
        features.append({"type": "Feature", "geometry": geometry, "properties": properties})

    def rings(parts):
        result = []
        while parts:
            ring = parts.pop()
            while ring[0] != ring[-1]:
                for index, part in enumerate(parts):
                    if ring[-1] == part[0]:
                        ring += part[1:]
                    elif ring[-1] == part[-1]:
                        ring += part[-2::-1]
                    elif ring[0] == part[-1]:
                        ring = part[:-1] + ring
                    elif ring[0] == part[0]:
                        ring = part[:0:-1] + ring
                    else:
                        continue
                    parts.pop(index)
                    break
                else:
                    raise ValueError("incomplete polygon ring")
            result.append(ring)
        return result

    def contains(ring, point):
        x, y = point
        inside = False
        for a, b in zip(ring, ring[1:]):
            if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
                inside = not inside
        return inside

    # Multipolygon members must be assembled before clipping; never close incomplete rings.
    multipolygons = [r for r in root.findall("relation") if tags(r).get("type") == "multipolygon" and ("building" in tags(r) or "landuse" in tags(r))]
    represented_members = set()
    for relation in multipolygons:
        try:
            outer, inner = [], []
            members = []
            for member in relation.findall("member"):
                if member.attrib["type"] != "way":
                    continue
                members.append(member.attrib["ref"])
                line = positions(ways[member.attrib["ref"]])
                (inner if member.attrib.get("role") == "inner" else outer).append(line)
            outer_result = rings(outer)
            if not outer_result:
                raise ValueError("no complete outer ring")
            polygons = [[ring] for ring in outer_result]
            for hole in rings(inner):
                owners = [polygon for polygon in polygons if contains(polygon[0], hole[0])]
                if len(owners) != 1:
                    raise ValueError("ambiguous inner ring")
                owners[0].append(hole)
            geometry = {"type": "MultiPolygon", "coordinates": polygons} if len(polygons) > 1 else {"type": "Polygon", "coordinates": polygons[0]}
            add(relation, geometry, "building" if "building" in tags(relation) else "landuse")
            represented_members.update(members)
        except (KeyError, ValueError) as error:
            skipped.append(f"relation/{relation.attrib['id']}: {error}")
    for identity, way in ways.items():
        properties = tags(way)
        kind = next((key for key in ("highway", "building", "landuse") if key in properties), None)
        if not kind or (identity in represented_members and kind != "highway"):
            continue
        try:
            coords = positions(way)
            if kind == "highway":
                geometry = {"type": "LineString", "coordinates": coords}
            elif len(coords) >= 4 and coords[0] == coords[-1]:
                geometry = {"type": "Polygon", "coordinates": [coords]}
            else:
                raise ValueError("unclosed area")
            add(way, geometry, "road" if kind == "highway" else kind)
        except (KeyError, ValueError) as error:
            skipped.append(f"way/{identity}: {error}")
    # Collection coordinates follow RFC 7946 WGS84, not the AMap POI coordinate system.
    collection = {"type": "FeatureCollection", "features": features}
    public = ROOT / "apps/web/public/geography"
    public.mkdir(parents=True, exist_ok=True)
    (public / "osm-context-wgs84.geojson").write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    counts = Counter(f["properties"]["kind"] for f in features)
    summary = {
        "preparedAt": datetime.now(timezone.utc).isoformat(), "sourceUrl": URL,
        "downloadedAt": datetime.fromtimestamp(RAW.stat().st_mtime, timezone.utc).isoformat(),
        "coordinateSystem": "EPSG:4326", "queryBbox": BBOX, "scope": "Context bounding box around ten sample enterprise POIs. Complete OSM way geometries retained, not geometrically clipped to this bbox or the official development zone boundary.",
        "license": "ODbL-1.0", "attribution": "© OpenStreetMap contributors", "licenseUrl": "https://www.openstreetmap.org/copyright",
        "counts": dict(counts), "buildingsWithHeightOrLevels": sum(f["properties"].get("heightStatus") == "tagged" for f in features),
        "industrialLandusePolygons": sum(f["properties"].get("landuse") == "industrial" for f in features),
        "skipped": skipped, "notLegalBoundary": True,
        "limitations": ["Road counts are OSM way segments, not distinct streets.", "Landuse describes mapped use, not ownership or enterprise cadastral parcels.", "Absent building heights are not replaced by measured-looking values.", "No enterprise ownership association has been inferred."]
    }
    (public / "osm-context-manifest.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
