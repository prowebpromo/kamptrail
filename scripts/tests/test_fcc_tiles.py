import binascii
import math
import struct
import sys
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_fcc_tiles as build

try:
    from osgeo import gdal, ogr, osr
    import numpy
except ImportError:
    gdal = None


class TileEncodingTests(unittest.TestCase):
    def test_palette_and_unknown_are_distinct(self):
        pixels = bytes((0, 1, 2, 0)) * (build.SIZE ** 2 // 4)
        png = build.encode_png(pixels)
        chunks = {}
        i = 8
        while i < len(png):
            length = struct.unpack(">I", png[i:i + 4])[0]
            kind = png[i + 4:i + 8]
            data = png[i + 8:i + 8 + length]
            self.assertEqual(binascii.crc32(kind + data), struct.unpack(">I", png[i + 8 + length:i + 12 + length])[0])
            chunks[kind] = data
            i += length + 12
        self.assertEqual(chunks[b"PLTE"], bytes((0, 0, 0, 112, 112, 112, 24, 96, 176)))
        self.assertEqual(chunks[b"tRNS"], bytes((0, 255, 255)))
        scanlines = zlib.decompress(chunks[b"IDAT"])
        self.assertEqual(scanlines[:5], b"\x00\x00\x01\x02\x00")

    def test_bounds_and_dateline(self):
        self.assertEqual(build.tile_grid([-90, 0, 0, 66.5], 2), (1, 1, 1, 1))
        with self.assertRaisesRegex(ValueError, "antimeridian"):
            build.tile_grid([-175, 40, 171, 60], 2)


@unittest.skipUnless(gdal, "GDAL and NumPy required for the integration fixture")
class GeometryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.boundary = self.boundary_zip()
        self.providers = [self.carrier(key) for key in build.PROVIDERS]
        self.plan = {"asOf": "2026-06-30", "retrievedAt": "2026-11-20", "release": "2026-06-30-test",
                     "minZoom": 8, "maxZoom": 8, "regions": [{"id": "RI", "boundary": self.boundary,
                                                               "carriers": self.providers}]}

    @staticmethod
    def geometry(x1, y1, x2, y2):
        return ogr.CreateGeometryFromWkt(f"POLYGON (({x1} {y1},{x2} {y1},{x2} {y2},{x1} {y2},{x1} {y1}))")

    def boundary_zip(self):
        layername = "tl_2025_us_state"
        db = ogr.GetDriverByName("ESRI Shapefile").CreateDataSource(str(self.root / (layername + ".shp")))
        layer = db.CreateLayer(layername, build.spatial_ref(4269), ogr.wkbPolygon)
        for name in ("STUSPS", "STATEFP"):
            layer.CreateField(ogr.FieldDefn(name, ogr.OFTString))
        f = ogr.Feature(layer.GetLayerDefn())
        f.SetField("STUSPS", "RI")
        f.SetField("STATEFP", "44")
        f.SetGeometry(self.geometry(-71.9, 41.2, -71.1, 41.9))
        layer.CreateFeature(f)
        f = layer = db = None
        archive = self.root / "boundary.zip"
        with zipfile.ZipFile(archive, "w") as z:
            for p in self.root.glob(layername + ".*"):
                z.write(p, p.name)
        return {"source": "https://www2.census.gov/geo/tiger/TIGER2025/STATE/tl_2025_us_state.zip",
                "path": str(archive), "layer": layername}

    def carrier(self, carrier_id):
        provider_id = build.PROVIDERS[carrier_id]
        name = f"bdc_44_{provider_id}_4GLTE_mobile_broadband_J26_24oct2026"
        path = self.root / f"{name}.gpkg"
        db = ogr.GetDriverByName("GPKG").CreateDataSource(str(path))
        layer = db.CreateLayer("mobile", build.spatial_ref(4326), ogr.wkbPolygon)
        for field in ("providerid", "technology", "mindown", "minup", "environmnt"):
            layer.CreateField(ogr.FieldDefn(field, ogr.OFTInteger))
        layer.CreateField(ogr.FieldDefn("brandname", ogr.OFTString))
        for x1, x2, env in [(-71.8, -71.6, 0), (-71.5, -71.3, 1)]:
            row = ogr.Feature(layer.GetLayerDefn())
            for key, value in {"providerid": int(provider_id), "technology": 400, "mindown": 5, "minup": 1,
                               "environmnt": env, "brandname": carrier_id}.items():
                row.SetField(key, value)
            row.SetGeometry(self.geometry(x1, 41.1, x2, 41.8))
            layer.CreateFeature(row)
        row = layer = db = None
        archive = path.with_suffix(".zip")
        with zipfile.ZipFile(archive, "w") as z:
            z.write(path, path.name)
        return {"id": carrier_id, "providerId": provider_id, "fileId": 123, "recordCount": 2, "sourceFile": name.replace("24oct", "10nov"),
                "archive": str(archive), "sha256": build.sha256(archive)}

    def get_pixel(self, out, lon, lat):
        z = 8
        x = math.floor((lon + 180) / 360 * 2 ** z * 256)
        y = math.floor((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2 ** z * 256)
        filename = out / self.plan["release"] / "att" / "RI" / str(z) / str(x // 256) / f"{y // 256}.png"
        ds = gdal.Open(str(filename))
        return ds.GetRasterBand(1).ReadRaster(x % 256, y % 256, 1, 1)[0]

    def test_two_environments_exact_state_scope_and_complete_bbox(self):
        out = self.root / "published"
        manifest = build.build(self.plan, out)
        region = manifest["carriers"][0]["regions"][0]
        self.assertEqual(manifest["schema"], 1)
        self.assertEqual(region["source"]["providerId"], "130077")
        self.assertEqual(region["source"]["records"], 2)
        self.assertEqual(self.get_pixel(out, -71.7, 41.5), 2)  # outdoor only
        self.assertEqual(self.get_pixel(out, -71.4, 41.5), 2)  # both outdoor and vehicle
        self.assertEqual(self.get_pixel(out, -71.2, 41.5), 1)  # in state, no modeled polygon
        self.assertEqual(self.get_pixel(out, -71.7, 41.17), 0)  # outside state despite intersecting coverage
        x0, y0, x1, y1 = build.tile_grid(region["bounds"], 8)
        self.assertEqual(len(list(out.rglob("*.png"))), 3 * (x1 - x0 + 1) * (y1 - y0 + 1))
        self.assertFalse(list(out.rglob("*.gpkg")))
        with self.assertRaises(FileExistsError):
            build.build(self.plan, out)

    def test_missing_carrier_failed_inputs_never_publish(self):
        out = self.root / "missing"
        self.plan["regions"][0]["carriers"] = []
        with self.assertRaisesRegex(ValueError, "Missing, duplicate"):
            build.build(self.plan, out)
        self.assertFalse(out.exists())
        self.plan["regions"][0]["carriers"] = self.providers[:1]
        manifest = build.build(self.plan, out)
        self.assertEqual([c["id"] for c in manifest["carriers"]], ["att"])
        self.assertFalse((out / self.plan["release"] / "verizon").exists())

    def test_mismatched_count_and_hash_abort(self):
        carrier = self.providers[0]
        carrier["recordCount"] += 1
        out = self.root / "mismatch"
        with self.assertRaisesRegex(ValueError, "counts disagree"):
            build.build(self.plan, out)
        carrier["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            build.build(self.plan, out)
        self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
