#!/usr/bin/env python3
"""Compare candidate XYZ pixels to points tested against the original FCC and Census vectors."""
import argparse
import hashlib
import io
import json
import math
import random
import shutil
import sqlite3
from itertools import chain
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


def pacific(x, y, z=None):
    """Use continuous longitudes around 180, independently of GDAL's cut geometry."""
    if hasattr(x, "__iter__"):
        return [v + 360 if v < 0 else v for v in x], y
    return (x + 360 if x < 0 else x), y


def state_lonlat(lon, lat, alaska):
    return Point(*pacific(lon, lat)) if alaska else Point(lon, lat)


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
    state = transform(project, polygons[0])
    if region["id"] == "AK":
        state = transform(pacific, state)
    return prep(state), file_hash(path)


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


def classify_samples(collection, state, source, lon_lats, geom_cache, crossing=(), alaska=False):
    """Query geometries directly in native lon/lat. Include both stationary-capable modes."""
    points = [Point(*xy) for xy in lon_lats]
    mask_points = [state_lonlat(*xy, alaska) for xy in lon_lats] if alaska else points
    inside = [state.covers(p) for p in mask_points]
    if not any(inside):
        return ["missing"] * len(points)
    covered = [False] * len(points)
    xs, ys = zip(*lon_lats)
    # An unsplit ring from 179E to 179W can exclude its own interior at 179.9
    # from its native bounding box. Include every such original feature separately.
    seen = set()
    for feature in chain(collection.filter(bbox=(min(xs), min(ys), max(xs), max(ys))), crossing):
        if feature.id in seen:
            continue
        seen.add(feature.id)
        row = {k.lower():v for k,v in feature["properties"].items()}
        require(str(row["providerid"]) == str(source["providerId"]), "Unexpected provider in provider archive")
        if (int(row["technology"]) != 400 or float(row["mindown"]) != 5 or
            float(row["minup"]) != 1 or int(row["environmnt"]) not in (0, 1)):
            continue
        fid = feature.id
        cached = geom_cache.get(fid)
        if cached is None:
            original = shape(feature["geometry"])
            wraps = alaska and original.bounds[2] - original.bounds[0] > 180
            cached = (prep(transform(pacific, original) if wraps else original), wraps)
            if len(geom_cache) >= 128:
                geom_cache.pop(next(iter(geom_cache)))
            geom_cache[fid] = cached
        geom, wraps = cached
        for i, point in enumerate(mask_points if wraps else points):
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


def point_pixel(lon, lat, zoom):
    edge = 256 * 2**zoom
    x = min(edge - 1, max(0, math.floor((lon + 180) * edge / 360)))
    y = min(edge - 1, max(0, math.floor(
        (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) * edge / 2)))
    return (x // 256, y // 256), (x % 256, y % 256)


def original_points(raw, collection, zoom, alaska):
    """Seed additional native pixels from up to 20 original provider features, independent of raster colors."""
    anchors = {}
    with sqlite3.connect(raw.resolve().as_uri() + "?mode=ro&immutable=1", uri=True) as db:
        layers = db.execute("select table_name from gpkg_geometry_columns").fetchall()
        require(len(layers) == 1, "Expected a single original coverage geometry layer")
        table = '"' + layers[0][0].replace('"', '""') + '"'
        columns = list(db.execute("pragma table_info(" + table + ")"))
        ids = [col[1] for col in columns if col[5] == 1]
        require(len(ids) == 1, "Missing GeoPackage feature identifier")
        pk = '"' + ids[0].replace('"', '""') + '"'
        lo, hi = db.execute(f"select min({pk}), max({pk}) from {table}").fetchone()
        if lo is None:
            return anchors
        seeds = sorted({lo + (hi-lo)*i//19 for i in range(20)})
        for seed in seeds:
            row = db.execute(f"select {pk} from {table} where {pk}>=? order by {pk} limit 1", (seed,)).fetchone()
            feature = collection[int(row[0])]
            original = shape(feature["geometry"])
            if alaska and original.bounds[2] - original.bounds[0] > 180:
                original = transform(pacific, original)
            point = original.representative_point()
            lon = point.x - 360 if point.x > 180 else point.x
            tile, pixel = point_pixel(lon, point.y, zoom)
            anchors.setdefault(tile, set()).add(pixel)
    return anchors


def validated_footprints(declared, alaska):
    if not alaska:
        return [declared["bounds"]]
    boxes = declared.get("footprints")
    require(isinstance(boxes, list) and len(boxes) == 2, "Alaska must declare both sides of the dateline")
    for w,s,e,n in boxes:
        require(-180 <= w < e <= 180 and 0 < e-w < 180 and 0 < s < n <= 85.05112878
                and (e <= 0 or w >= 0), "Invalid Alaska reporting footprint")
    require({box[0] >= 0 for box in boxes} == {False, True}, "Alaska footprints repeat a hemisphere")
    return boxes


def verify_carrier(root, manifest, region, source, declared, state, raw):
    zoom = declared["maxZoom"]
    alaska = region["id"] == "AK"
    boxes = validated_footprints(declared, alaska)
    rng = random.Random(f"{manifest['release']}:{region['id']}:{source['id']}")
    tile_dirs = []
    extents = set()
    for box in boxes:
        footprint = list(tiles_for(box, zoom))
        extents.update(footprint)
        budget = 36 // len(boxes)
        selected = footprint if len(footprint) <= budget else [
            footprint[0], footprint[-1], *rng.sample(footprint, budget - 2)]
        tile_dirs.extend(selected)
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
        anchors = original_points(raw, collection, zoom, alaska)
        tile_dirs = list(dict.fromkeys([*tile_dirs, *(tile for tile in anchors if tile in extents)]))
        # A polygon crossing the longitude discontinuity necessarily intersects
        # the Greenwich meridian in its original planar representation.
        crossing = list(collection.filter(bbox=(-0.01, 0, 0.01, 85))) if alaska else []
        matched_hemispheres = Counter()
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
            for px, py in dict.fromkeys([*candidates(image, rng), *sorted(anchors.get((x,y), ()))]):
                center_x, center_y = 256*x + px + .5, 256*y + py + .5
                probes = [wgs84(center_x+dx, center_y+dy, zoom) for dx,dy in (
                    (0,0), (-.4,-.4), (.4,-.4), (-.4,.4), (.4,.4))]
                expected = classify_samples(collection, state, source, probes, geom_cache, crossing, alaska)
                if len(set(expected)) != 1:
                    uncertain += 1
                    continue
                actual = PALETTE[image.getpixel((px,py))]
                if actual != expected[0]:
                    failures.append((relative, px, py, actual, expected[0]))
                    if len(failures) >= 5:
                        raise ValueError(f"Source/raster disagreements: {failures}")
                counts[expected[0]] += 1
                matched_hemispheres["east" if probes[0][0] >= 0 else "west"] += 1
                if actual == expected[0] and actual not in witnesses:
                    witnesses[actual] = {"lon": probes[0][0],"lat": probes[0][1],
                                         "tile": relative,"sha256": digest,"pixel": [px,py],"zoom": zoom}
    require(not failures, f"Source/raster disagreements: {failures}")
    require(sum(counts.values()) > 0, "No stable native pixel was verified")
    if alaska:
        require(all(matched_hemispheres[side] for side in ("east", "west")), "A dateline footprint received no checks")
    unobserved = {kind: ("present in sampled tiles, no stable witness verified" if kind in seen_classes
                         else "not present in sampled native tiles") for kind in PALETTE.values() if not counts[kind]}
    return {"region": region["id"],"carrier": source["id"],"fileId": source["fileId"],
            "sourceSHA256": source["sha256"],"records": int(source["recordCount"]),
            "tilesCompared": len(tile_dirs),"matches": dict(counts),
            "boundaryPixelsSkipped": uncertain,"witnesses": witnesses,"unobservedClasses": unobserved,
            "stableSamplesByHemisphere": dict(matched_hemispheres)}


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
