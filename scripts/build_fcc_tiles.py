#!/usr/bin/env python3
"""Build an immutable FCC outdoor LTE raster release from verified local inputs.

Usage: python3 scripts/build_fcc_tiles.py --plan plan.json --output NEW_DIRECTORY
Requires GDAL Python bindings and NumPy (Ubuntu: python3-gdal, python3-numpy).
Raw FCC archives and intermediate rasters stay outside the output directory.
"""
import argparse
import binascii
import hashlib
import json
import math
import os
import re
import shutil
import struct
import tempfile
import zipfile
import zlib
from collections import defaultdict
from datetime import date
from pathlib import Path

PROVIDERS = {"att": "130077", "t-mobile": "130403", "verizon": "131425"}
HALF_WORLD = 20037508.342789244
SIZE = 256
RGB = bytes((0, 0, 0, 112, 112, 112, 24, 96, 176))


def check(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def encode_png(samples):
    """One indexed, lossless 256px tile. Only zero is transparent."""
    def chunk(name, data):
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", binascii.crc32(name + data))

    view = memoryview(samples).cast("B")
    check(len(view) == SIZE * SIZE, "Wrong raster dimensions")
    scanlines = b"".join(b"\x00" + bytes(view[offset:offset + SIZE]) for offset in range(0, len(view), SIZE))
    return b"".join((b"\x89PNG\r\n\x1a\n", chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 3, 0, 0, 0)),
                     chunk(b"PLTE", RGB), chunk(b"tRNS", b"\x00\xff\xff"), chunk(b"IDAT", zlib.compress(scanlines, 6)),
                     chunk(b"IEND", b"")))


def tile_grid(bounds, zoom):
    west, south, east, north = bounds
    check(-180 <= west < east <= 180 and east - west < 180 and -85.05112878 < south < north < 85.05112878,
          "A region must be a bounded Web Mercator footprint without an antimeridian crossing")
    cells = 2 ** zoom
    def y(latitude):
        return cells * (1 - math.asinh(math.tan(math.radians(latitude))) / math.pi) / 2

    west_col = math.floor(cells * (west + 180) / 360)
    east_col = math.ceil(cells * (east + 180) / 360) - 1
    return west_col, math.floor(y(north)), east_col, math.ceil(y(south)) - 1


def spatial_ref(epsg):
    from osgeo import osr
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(epsg)
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return srs


def boundary_mask(info, region):
    from osgeo import ogr, osr
    path = Path(info["path"]).resolve(strict=True)
    expected = re.fullmatch(r"https://www2\.census\.gov/geo/tiger/TIGER(\d{4})/STATE/(tl_\1_us_state)\.zip", info["source"])
    check(expected and info["layer"] == expected[2], "Expected a Census TIGER/Line state boundary and release-matched layer")
    ds = ogr.Open("/vsizip/" + str(path))
    layer = ds.GetLayerByName(info["layer"])
    check(layer is not None, "Census state boundary layer missing")
    layer.SetAttributeFilter(f"STUSPS = '{region}'")
    check(layer.GetFeatureCount() == 1, f"Expected one Census boundary for {region}")
    feature = layer.GetNextFeature()
    fips = feature.GetFieldAsString("STATEFP")
    shape = feature.GetGeometryRef().Clone()
    source_srs = layer.GetSpatialRef().Clone()
    source_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    check(shape.Transform(osr.CoordinateTransformation(source_srs, spatial_ref(4326))) == 0,
          "Cannot transform state geometry")
    west, east, south, north = shape.GetEnvelope()
    check(re.fullmatch(r"\d{2}", fips) and not shape.IsEmpty(), "Invalid Census mask")

    result = ogr.GetDriverByName("Memory").CreateDataSource("")
    projected = result.CreateLayer("scope", spatial_ref(3857), geom_type=ogr.wkbUnknown)
    check(shape.Transform(osr.CoordinateTransformation(spatial_ref(4326), spatial_ref(3857))) == 0,
          "Cannot project state boundary")
    target = ogr.Feature(projected.GetLayerDefn())
    target.SetGeometry(shape)
    projected.CreateFeature(target)
    return result, fips, [west, south, east, north]


def quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'


def validate_coverage(ds, layer, provider_id, record_count):
    from osgeo import ogr
    crs = layer.GetSpatialRef()
    check(crs and (crs.IsSame(spatial_ref(4326)) or crs.GetAuthorityCode(None) == "4326"),
          "Expected EPSG:4326 FCC raw coverage polygons")
    check(ogr.GT_Flatten(layer.GetGeomType()) in (ogr.wkbPolygon, ogr.wkbMultiPolygon), "Unexpected coverage geometry")
    fields = {f.GetName().lower() for f in layer.schema}
    check({"providerid", "brandname", "technology", "mindown", "minup", "environmnt"} <= fields, "Unexpected FCC fields")
    check(type(record_count) is int and record_count > 0 and layer.GetFeatureCount() == record_count,
          "Archive and FCC catalog feature counts disagree")
    # Both approved environment codes include outdoor stationary service.
    valid = f"providerid = {int(provider_id)} AND technology = 400 AND mindown = 5 AND minup = 1 AND environmnt IN (0, 1)"
    layer.SetAttributeFilter(valid)
    check(layer.GetFeatureCount() == record_count, "File contains other providers, speeds or modeling conditions")
    layer.SetAttributeFilter(None)
    table = quote_identifier(layer.GetName())
    geom = quote_identifier(layer.GetGeometryColumn())
    bad = ds.ExecuteSQL(f"SELECT COUNT(*) FROM {table} WHERE {geom} IS NULL OR ST_IsEmpty({geom}) <> 0", dialect="SQLITE")
    try:
        check(bad.GetNextFeature().GetFieldAsInteger64(0) == 0, "Missing source polygon")
    finally:
        ds.ReleaseResultSet(bad)
    brands = ds.ExecuteSQL(f"SELECT DISTINCT brandname FROM {table} ORDER BY brandname", dialect="SQLITE")
    try:
        result = [row.GetFieldAsString(0) for row in brands]
        check(result and all(result), "Missing carrier brand")
        return result
    finally:
        ds.ReleaseResultSet(brands)


def extract_source(carrier, fips, as_of, directory):
    archive = Path(carrier["archive"]).resolve(strict=True)
    digest = sha256(archive)
    check(digest == carrier["sha256"], "Mobile availability archive SHA-256 mismatch")
    check(type(carrier["fileId"]) is int and carrier["fileId"] > 0, "Expected a numeric FCC availability file ID")
    provider = PROVIDERS[carrier["id"]]
    check(str(carrier["providerId"]) == provider, "Carrier and FCC provider ID disagree")
    season = "J" if as_of.month == 6 else "D"
    prefix = f"bdc_{fips}_{provider}_4glte_mobile_broadband_{season}{as_of:%y}_".lower()
    # The catalog revision date can differ from the file's revision date.
    check(carrier["sourceFile"].lower().startswith(prefix), "Unexpected FCC catalog file, date, state, technology or provider")
    with zipfile.ZipFile(archive) as z:
        entries = [m for m in z.infolist() if not m.is_dir() and Path(m.filename).suffix.lower() == ".gpkg"]
        check(len(entries) == 1 and Path(entries[0].filename).name.lower().startswith(prefix), "Expected one matching raw GeoPackage")
        check(entries[0].file_size < shutil.disk_usage(directory).free, "Insufficient workspace for coverage geometry")
        path = directory / "coverage.gpkg"
        with z.open(entries[0]) as source, path.open("xb") as out:
            shutil.copyfileobj(source, out, length=1024 * 1024)
    return path, digest


def rasterize(ds, layer, band):
    from osgeo import gdal
    layer.ResetReading()
    check(gdal.RasterizeLayer(ds, [band], layer, burn_values=[1]) == 0, "Coverage rasterization failed")


def write_zoom(root, tmp, mask, cover, bounds, zoom):
    from osgeo import gdal
    import numpy as np
    x0, y0, x1, y1 = tile_grid(bounds, zoom)
    tile_width = 2 * HALF_WORLD / (2 ** zoom)
    pixel = tile_width / SIZE
    width, height = (x1 - x0 + 1) * SIZE, (y1 - y0 + 1) * SIZE
    name = str(tmp / "raster.tif")
    raster = gdal.GetDriverByName("GTiff").Create(name, width, height, 2, gdal.GDT_Byte,
        options=["TILED=YES", "BLOCKXSIZE=256", "BLOCKYSIZE=256", "COMPRESS=LZW", "SPARSE_OK=YES", "BIGTIFF=IF_SAFER"])
    raster.SetProjection(spatial_ref(3857).ExportToWkt())
    raster.SetGeoTransform((-HALF_WORLD + x0 * tile_width, pixel, 0, HALF_WORLD - y0 * tile_width, 0, -pixel))
    rasterize(raster, mask, 1)
    rasterize(raster, cover, 2)
    covered_pixels = 0
    for x in range(x0, x1 + 1):
        tile_dir = root / str(zoom) / str(x)
        tile_dir.mkdir(parents=True)
        for y in range(y0, y1 + 1):
            args = ((x - x0) * SIZE, (y - y0) * SIZE, SIZE, SIZE)
            scope = raster.GetRasterBand(1).ReadAsArray(*args)
            coverage = raster.GetRasterBand(2).ReadAsArray(*args)
            # A colored pixel must be in the reporting area even where service extends across a state line.
            samples = scope * (coverage + 1)
            covered_pixels += np.count_nonzero(samples == 2)
            (tile_dir / f"{y}.png").write_bytes(encode_png(samples))
    raster = None
    Path(name).unlink()
    return covered_pixels


def build_region(carrier, region, fips, as_of, scope, bounds, zooms, output, tmp):
    from osgeo import ogr
    path, digest = extract_source(carrier, fips, as_of, tmp)
    ds = ogr.Open(str(path))
    check(ds.GetLayerCount() == 1, "Expected a single FCC coverage layer in the GeoPackage")
    layer = ds.GetLayer(0)
    brands = validate_coverage(ds, layer, carrier["providerId"], carrier["recordCount"])
    covered_pixels = 0
    for zoom in zooms:
        covered_pixels += write_zoom(output, tmp, scope.GetLayer(0), layer, bounds, zoom)
    check(covered_pixels > 0, "No modeled coverage raster pixels intersect the declared reporting area")
    src = {"fileId": carrier["fileId"], "providerId": str(carrier["providerId"]), "asOf": as_of.isoformat(),
           "sourceFile": carrier["sourceFile"], "sha256": digest, "records": carrier["recordCount"], "brands": brands}
    return {"id": region, "bounds": bounds, "minZoom": zooms[0], "maxZoom": zooms[-1], "source": src}


def build(plan, output):
    from osgeo import gdal, ogr
    gdal.UseExceptions()
    ogr.UseExceptions()
    as_of = date.fromisoformat(plan["asOf"])
    retrieved = date.fromisoformat(plan["retrievedAt"])
    check((as_of.month, as_of.day) in ((6, 30), (12, 31)) and as_of <= retrieved, "Invalid FCC dates")
    release = plan["release"]
    check(isinstance(release, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", release), "Invalid release identifier")
    low, high = plan["minZoom"], plan["maxZoom"]
    check(type(low) is int and type(high) is int and 0 <= low <= high <= 14, "Invalid native zoom range")
    zooms = range(low, high + 1)
    output = Path(output).absolute()
    if output.exists():
        raise FileExistsError("Build into a fresh private staging directory")
    output.parent.mkdir(exist_ok=True, parents=True)
    check(bool(plan["regions"]), "No verified source regions")
    layers = defaultdict(list)
    region_ids = set()
    boundary_hashes = {}
    with tempfile.TemporaryDirectory(prefix=".fcc-tiles-", dir=output.parent) as temp:
        stage = Path(temp) / "public"
        stage.mkdir()
        for region in plan["regions"]:
            region_id = region["id"]
            check(re.fullmatch(r"[A-Z]{2}", region_id) and region_id not in region_ids, "Invalid or duplicate region ID")
            region_ids.add(region_id)
            mask, fips, bounds = boundary_mask(region["boundary"], region_id)
            carrier_ids = [c["id"] for c in region["carriers"]]
            check(carrier_ids and set(carrier_ids) <= set(PROVIDERS) and len(carrier_ids) == len(set(carrier_ids)),
                  "Missing, duplicate or unsupported carrier input")
            boundary_file = Path(region["boundary"]["path"]).resolve()
            if boundary_file not in boundary_hashes:
                boundary_hashes[boundary_file] = sha256(boundary_file)
            for carrier in region["carriers"]:
                carrier_id = carrier["id"]
                tile_root = stage / release / carrier_id / region_id
                with tempfile.TemporaryDirectory(prefix="geo-", dir=temp) as work:
                    entry = build_region(carrier, region_id, fips, as_of, mask, bounds, zooms, tile_root, Path(work))
                entry["boundary"] = {"source": region["boundary"]["source"], "sha256": boundary_hashes[boundary_file]}
                layers[carrier_id].append(entry)
                print(f"Built {region_id} {carrier_id}, {carrier['recordCount']} verified source polygons", flush=True)
        manifest = {"schema": 1, "release": release, "asOf": as_of.isoformat(), "retrievedAt": retrieved.isoformat(),
                    "technology": "4G LTE", "environment": "Outdoor stationary",
                    "attribution": "Source: FCC National Broadband Map, provider-reported mobile availability. State boundaries: U.S. Census Bureau.",
                    "carriers": [{"id": k, "regions": sorted(layers[k], key=lambda r: r["id"])} for k in sorted(layers)]}
        (stage / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
        # Never update deployed data in place; the publisher switches the manifest after uploading and verifying tiles.
        os.rename(stage, output)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(json.loads(args.plan.read_text(encoding="utf-8")), args.output)


if __name__ == "__main__":
    main()
