"""A polygon across +180/-180 must not turn into a band of service across the world."""
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
try:
    from osgeo import gdal,ogr
    from build_fcc_tiles import spatial_ref
    from build_fcc_alaska_tiles import normalize, pieces
except ImportError:
    gdal=None


@unittest.skipUnless(gdal,"GDAL required")
class DatelineTest(unittest.TestCase):
    def test_true_crossing_is_cut_into_two_local_parts(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp)
            src=tmp/"source.gpkg"
            ds=ogr.GetDriverByName("GPKG").CreateDataSource(str(src))
            layer=ds.CreateLayer("coverage",spatial_ref(4326),ogr.wkbPolygon)
            feature=ogr.Feature(layer.GetLayerDefn())
            before=ogr.CreateGeometryFromWkt("POLYGON ((179 52,-179 52,-179 53,179 53,179 52))")
            feature.SetGeometry(before)
            layer.CreateFeature(feature)
            feature=layer=ds=None
            result=normalize(src,tmp/"cut.gpkg")
            feature=result.GetLayer().GetNextFeature()
            shape=feature.GetGeometryRef()
            spans=[p.GetEnvelope()[:2] for p in pieces(shape)]
            self.assertEqual(len(spans),2)
            self.assertEqual(sorted(spans),[(-180.0,-179.0),(179.0,180.0)])
            for x,expected in [(179.5,True),(-179.5,True),(0,False),(-150,False),(150,False)]:
                self.assertEqual(shape.Intersects(ogr.CreateGeometryFromWkt(f"POINT ({x} 52.4)")),expected)


if __name__=="__main__":
    unittest.main()
