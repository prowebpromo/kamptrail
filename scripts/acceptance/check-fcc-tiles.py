#!/usr/bin/env python3
"""Compare candidate XYZ pixels to points tested against the original FCC and Census vectors."""
import argparse
import hashlib
import io
import json
import math
import random
import shutil
import tempfile
import zipfile
from collections import Counter
from pathlib import Path

import fiona
from PIL import Image
from pyproj import CRS, Transformer
from shapely.geometry import Point, shape
from shapely.ops import transform
from shapely.prepared import prep

PALETTE = {
    (24, 96, 176, 255): "covered",
    (112, 112, 112, 255): "uncovered",
    (0, 0, 0, 0): "missing",
}
CARRIERS = {"att", "t-mobile", "verizon"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def wgs84(pixel_x, pixel_y, zoom):
    edge = 256 * 2**zoom
    return (pixel_x * 360 / edge - 180,
            math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * pixel_y / edge)))))


def tile_xy(lon, lat, zoom):
    size = 2**zoom
    lat = max(-85.05112878, min(85.05112878, lat))
    return (max(0, min(size - 1, math.floor((lon + 180) / 360 * size))),
            max(0, min(size - 1, math.floor((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * size))))


def jurisdiction(region):
    boundary = region["boundary"]
    path = Path(boundary["path"]).resolve()
    uri = "zip://" + path.as_posix() if zipfile.is_zipfile(path) else str(path)
    with fiona.open(uri, layer=boundary["layer"]) as source:
        crs = CRS.from_user_input(source.crs_wkt or source.crs)
        project = Transformer.from_crs(crs, 4326, always_xy=True).transform
        polygons = [shape(row["geometry"]) for row in source
                    if row["properties"]["STUSPS"] == region["id"]]
    require(len(polygons) == 1, f"Expected exactly one Census polygon for {region['id']}")
    return prep(transform(project, polygons[0])), file_hash(path)


def inspect_archive(source, private_dir):
    archive = Path(source["archive"])
    require(file_hash(archive) == source["sha256"], "Raw archive checksum mismatch")
    target = Path(private_dir) / "raw.gpkg"
    with zipfile.ZipFile(archive) as package:
        gpkg = [entry for entry in package.infolist() if entry.filename.lower().endswith(".gpkg")]
        require(len(gpkg) == 1, "Expected one provider GeoPackage in source archive")
        with package.open(gpkg[0]) as original, target.open("wb") as dest:
            shutil.copyfileobj(original, dest, length=1024 * 1024)
    return target


def classify_samples(collection, state, source, lon_lats, geom_cache):
    """Query geometries directly in native lon/lat. Include both stationary-capable modes."""
    points = [Point(*xy) for xy in lon_lats]
    inside = [state.covers(p) for p in points]
    if not any(inside):
        return ["missing"] * len(points)
    covered = [False] * len(points)
    xs, ys = zip(*lon_lats)
    for feature in collection.filter(bbox=(min(xs), min(ys), max(xs), max(ys))):
        row = {k.lower():v for k,v in feature["properties"].items()}
        require(str(row["providerid"]) == str(source["providerId"]), "Unexpected provider in provider archive")
        if (int(row["technology"]) != 400 or float(row["mindown"]) != 5 or
            float(row["minup"]) != 1 or int(row["environmnt"]) not in (0, 1)):
            continue
        fid = feature.id
        geom = geom_cache.get(fid)
        if geom is None:
            geom = prep(shape(feature["geometry"]))
            if len(geom_cache) >= 128:
                geom_cache.pop(next(iter(geom_cache)))
            geom_cache[fid] = geom
        for i, point in enumerate(points):
            if inside[i] and not covered[i] and geom.covers(point):
                covered[i] = True
        if all(c or not available for c, available in zip(covered, inside)):
            break
    return [("covered" if positive else "uncovered") if valid else "missing"
            for positive, valid in zip(covered, inside)]


def tiles_for(bounds, zoom):
    west, south, east, north = bounds
    left, top = tile_xy(west, north, zoom)
    right, bottom = tile_xy(east, south, zoom)
    for x in range(left, right + 1):
        for y in range(top, bottom + 1):
            yield x, y


def candidates(image, rng):
    # The systematic checks have no knowledge of the renderer's predicted class.
    fixed = [(x, y) for x in (24, 128, 231) for y in (24, 128, 231)]
    yield from fixed
    # Add an interior witness for each actual class, including narrow coverage gaps.
    colors = {pixel for _, pixel in image.getcolors(256 * 256)}
    for color in PALETTE:
        if color not in colors:
            continue
        for _ in range(1500):
            x, y = rng.randint(1,254), rng.randint(1,254)
            if image.getpixel((x,y)) == color:
                yield x, y
                break


def verify_carrier(root, manifest, region, source, declared, state, raw):
    zoom = declared["maxZoom"]
    tile_dirs = list(tiles_for(declared["bounds"], zoom))
    rng = random.Random(f"{manifest['release']}:{region['id']}:{source['id']}")
    if len(tile_dirs) > 36:
        edges = (tile_dirs[0], tile_dirs[-1])
        tile_dirs = list(dict.fromkeys([*edges, *rng.sample(tile_dirs, 34)]))
    counts = Counter()
    witnesses = {}
    seen_classes = set()
    uncertain = 0
    failures = []
    geom_cache = {}
    with fiona.open(raw) as collection:
        require(CRS.from_user_input(collection.crs_wkt or collection.crs).to_epsg() == 4326,
                "Raw coverage CRS is not the expected EPSG:4326")
        require(len(collection) == int(source["recordCount"]), "FCC catalog count differs from source")
        for x, y in tile_dirs:
            relative = f"{manifest['release']}/{source['id']}/{region['id']}/{zoom}/{x}/{y}.png"
            data = (root / relative).read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            with Image.open(io.BytesIO(data)) as original:
                require(original.size == (256,256), f"Wrong tile dimensions in {relative}")
                image = original.convert("RGBA")
            colors = {color for _,color in image.getcolors(256*256)}
            require(colors <= PALETTE.keys(), f"Undocumented color in {relative}")
            seen_classes.update(PALETTE[c] for c in colors)
            for px, py in candidates(image, rng):
                center_x, center_y = 256*x + px + .5, 256*y + py + .5
                probes = [wgs84(center_x+dx, center_y+dy, zoom) for dx,dy in (
                    (0,0), (-.4,-.4), (.4,-.4), (-.4,.4), (.4,.4))]
                expected = classify_samples(collection, state, source, probes, geom_cache)
                if len(set(expected)) != 1:
                    uncertain += 1
                    continue
                actual = PALETTE[image.getpixel((px,py))]
                if actual != expected[0]:
                    failures.append((relative, px, py, actual, expected[0]))
                    if len(failures) >= 5:
                        raise ValueError(f"Source/raster disagreements: {failures}")
                counts[expected[0]] += 1
                if actual == expected[0] and actual not in witnesses:
                    witnesses[actual] = {"lon": probes[0][0],"lat": probes[0][1],
                                         "tile": relative,"sha256": digest,"pixel": [px,py],"zoom": zoom}
    require(not failures, f"Source/raster disagreements: {failures}")
    require(counts["covered"] > 0, f"No source-confirmed covered sample for {source['id']}")
    require(counts["missing"] > 0, f"No outside-scope sample for {source['id']}")
    require("uncovered" not in seen_classes or counts["uncovered"] > 0,
            f"No verified uncovered witness for {source['id']} despite mapped gray pixels")
    return {"region": region["id"],"carrier": source["id"],"fileId": source["fileId"],
            "sourceSHA256": source["sha256"],"records": int(source["recordCount"]),
            "tilesCompared": len(tile_dirs),"matches": dict(counts),
            "boundaryPixelsSkipped": uncertain,"witnesses": witnesses}


def verify(plan, area):
    manifest = json.loads((area/"manifest.json").read_text())
    require(manifest["schema"] == 1 and manifest["release"] == plan["release"], "Manifest release mismatch")
    require(manifest["asOf"] == plan["asOf"], "Filing date mismatch")
    entries = {(c["id"],r["id"]):r for c in manifest["carriers"] for r in c["regions"]}
    results = []
    for region in plan["regions"]:
        state, boundary_hash = jurisdiction(region)
        for source in region["carriers"]:
            require(source["id"] in CARRIERS, "Unknown carrier id")
            declared = entries[(source["id"],region["id"])]
            require(declared["boundary"]["sha256"] == boundary_hash, "Boundary provenance mismatch")
            require(declared["source"]["sha256"] == source["sha256"], "Manifest archive hash mismatch")
            require(str(declared["source"]["fileId"]) == str(source["fileId"]), "Manifest file ID mismatch")
            require(str(declared["source"]["providerId"]) == str(source["providerId"]), "Manifest provider ID mismatch")
            with tempfile.TemporaryDirectory() as tmp:
                raw = inspect_archive(source, tmp)
                results.append(verify_carrier(area, manifest, region, source, declared, state, raw))
    require(results, "No source-to-tile checks ran")
    return {"result":"PASS","release":manifest["release"],"asOf":manifest["asOf"],"checks":results}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True, help="Directory containing manifest.json")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = verify(json.loads(args.plan.read_text()), args.input)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Confirmed source and tile pixels for {len(report['checks'])} carrier/region inputs.")
