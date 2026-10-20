"""Place traced planning polygons on the satellite view as an approximate illustration.

Two manual landmarks cannot establish surveyed accuracy. See the registration
manifest for the unstated project CRS assumption and lack of independent checks.
"""
import cmath
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RADIUS = 6378137


def mercator(position):
    lon, lat = map(math.radians, position)
    return complex(RADIUS*lon, RADIUS*math.log(math.tan(math.pi/4+lat/2)))


def geographic(point):
    return [round(math.degrees(point.real/RADIUS), 7), round(math.degrees(2*math.atan(math.exp(point.imag/RADIUS))-math.pi/2), 7)]


def main():
    traced = json.loads((ROOT / "apps/web/data/planning-boundaries.json").read_text(encoding="utf-8"))
    registration = json.loads((ROOT / "data/geography/planning-registration.json").read_text(encoding="utf-8"))
    first, second = registration["controls"]
    pixel = lambda p: complex(p[0], -p[1])
    origin = pixel(first["pixel"])
    target = mercator(first["displayCoordinate"])
    factor = (mercator(second["displayCoordinate"])-target)/(pixel(second["pixel"])-origin)
    convert = lambda p: geographic(target+factor*(pixel(p)-origin))
    features = []
    for area in traced["areas"]:
        polygons = [[convert(point) for point in ring] for ring in area["polygons"]]
        assert all(ring[0] == ring[-1] for ring in polygons)
        features.append({"type":"Feature", "geometry":{"type":"MultiPolygon", "coordinates":[[ring] for ring in polygons]}, "properties":{
            "id":area["id"], "name":area["name"], "areaKm2":area["areaKm2"], "color":area["color"],
            "labelPosition":convert(area["label"]), "precision":"approximate_planning_illustration", "legalBoundary":False}})
    output = {"type":"FeatureCollection", "coordinateSystem":"GCJ-02", "source":traced["source"],
              "registration":registration, "metersPerImagePixel":round(abs(factor), 3),
              "rotationDegrees":round(math.degrees(cmath.phase(factor)), 3), "features":features}
    (ROOT / "apps/web/data/planning-overlay.json").write_text(json.dumps(output,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"areas":len(features),"polygons":sum(len(f["geometry"]["coordinates"]) for f in features),"approximate":True}))


if __name__ == "__main__":
    main()
