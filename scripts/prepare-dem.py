"""Prepare the authenticated, free GDEM V3 download without retaining login data.

Requires Pillow. Raw and clipped GeoTIFFs stay in ignored storage; only a coarse
height grid, preview and provenance manifest are published for later terrain work.
"""
import hashlib
import array
import io
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile

from PIL import Image, TiffImagePlugin

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "storage/geography/incoming/ASTGTMV003_N32E114.zip"
OUTPUT = ROOT / "storage/geography/processed"
PUBLIC = ROOT / "apps/web/public/geography"
BOUNDS = (114.04, 32.15, 114.16, 32.25)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with ZipFile(ARCHIVE) as archive:
        if archive.testzip() is not None:
            raise ValueError("DEM archive CRC check failed")
        image = Image.open(io.BytesIO(archive.read("ASTGTMV003_N32E114_dem.tif")))
        image.load()
    tags = image.tag_v2
    pixels = array.array("i", image.tobytes())
    source_width = image.width
    sx, sy, _ = tags[33550]
    _, _, _, ox, oy, _ = tags[33922]
    west, south, east, north = BOUNDS
    left, top = math.floor((west-ox)/sx), math.floor((oy-north)/sy)
    right, bottom = math.ceil((east-ox)/sx), math.ceil((oy-south)/sy)
    crop = image.crop((left, top, right, bottom))
    geotags = TiffImagePlugin.ImageFileDirectory_v2()
    for key in (33550, 34735, 34736, 34737):
        if key in tags:
            geotags[key] = tags[key]
    geotags[33922] = (0.0, 0.0, 0.0, ox+left*sx, oy-top*sy, 0.0)
    # Uncompressed TIFF avoids platform-dependent libtiff codecs during preparation.
    crop.save(OUTPUT / "xinyang-dem-wgs84.tif", tiffinfo=geotags, compression="raw")
    print("GeoTIFF clipped", flush=True)
    # Sample nearest source cell at a regular 3-cell interval (roughly 90m).
    xs, ys = list(range(0, crop.width, 3)), list(range(0, crop.height, 3))
    heights = [[pixels[(top+y)*source_width+left+x] for x in xs] for y in ys]
    print("Height grid sampled", flush=True)
    grid = {
        "coordinateSystem": "EPSG:4326", "width": len(xs), "height": len(ys),
        "originCellCenter": [ox+(left+.5)*sx, oy-(top+.5)*sy],
        "stepDegrees": [sx*3, -sy*3], "unit": "m", "rowsNorthToSouth": True,
        "sampling": "nearest original cell, every 3 source cells; not the original 30m resolution",
        "heights": heights,
    }
    (PUBLIC / "dem-height-grid-wgs84.json").write_text(json.dumps(grid, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    clipped = [pixels[(top+y)*source_width+left+x] for y in range(crop.height) for x in range(crop.width)]
    low, high = min(clipped), max(clipped)
    preview_bytes = bytearray()
    for y in range(crop.height):
        for x in range(crop.width):
            elevation = clipped[y*crop.width+x]
            t = (elevation-low)/max(1,high-low)
            preview_bytes.extend((int(25+178*t), int(81+117*t), int(67+72*t)))
    preview = Image.frombytes("RGB", crop.size, bytes(preview_bytes))
    preview.resize((866,722), Image.Resampling.BILINEAR).save(PUBLIC / "dem-elevation-preview.png")
    manifest = {
        "dataset": "ASTER GDEM V3 30m", "tile": "ASTGTMV003_N32E114", "feeYuan": 0,
        "source": "https://www.gscloud.cn/sources/index?pid=302",
        "access": "User logged into official portal manually; free download; no authentication data stored",
        "preparedAt": datetime.now(timezone.utc).isoformat(),
        "archiveBytes": ARCHIVE.stat().st_size, "archiveSha256": hashlib.sha256(ARCHIVE.read_bytes()).hexdigest(),
        "coordinateSystem": "EPSG:4326", "requestedBounds": list(BOUNDS),
        "clippedSize": list(crop.size), "sourcePixelDegrees": [sx, sy],
        "clippedBounds": [ox+left*sx, oy-bottom*sy, ox+right*sx, oy-top*sy],
        "minimumM": low, "maximumM": high,
        "publicGridSize": [len(xs), len(ys)], "publicGridStride": 3,
        "status": "downloaded and prepared; not yet rendered as a 3D terrain mesh in the AMap view",
        "limitations": ["30m terrain cannot resolve factory buildings, property boundaries or roof geometry", "Public grid remains WGS84; align terrain vertices through an approved display-coordinate conversion before AMap overlay", "Height datum not verified from this tile metadata", "Preview shows relative elevation, not satellite imagery"],
    }
    (PUBLIC / "dem-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({"crop": crop.size, "grid": [len(xs), len(ys)], "rangeM": [low, high], "feeYuan": 0}))


if __name__ == "__main__":
    main()
