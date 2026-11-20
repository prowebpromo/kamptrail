"""Independent regression checks for Pacific longitude and sparse native pixels."""
import importlib.util
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

try:
    import fiona
    from shapely.geometry import Polygon, mapping, box
    from shapely.ops import transform
    from shapely.prepared import prep
    import pyproj
    from PIL import Image
except ImportError:
    fiona = None


@unittest.skipUnless(fiona, "The FCC qualification geospatial runtime is required")
class DatelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[1] / "acceptance" / "check-fcc-tiles.py"
        spec = importlib.util.spec_from_file_location("accept_fcc", path)
        cls.qa = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.qa)

    def test_wrapped_source_covers_both_sides_and_excludes_greenwich(self):
        raw = Polygon([(179,51), (-179,51), (-179,53), (179,53), (179,51)])
        # This reflects an RTree explicitly excluding points outside a polygon's
        # native [-179,179] envelope. Both checked points are outside that bbox.
        no_native_hits = SimpleNamespace(filter=lambda **kw: iter(()))
        class Feature(dict):
            id = "1"
        original = Feature(geometry=mapping(raw), properties={
            "providerid":130077, "technology":400, "mindown":5, "minup":1, "environmnt":1})
        state = prep(transform(self.qa.pacific, raw))
        checks = self.qa.classify_samples(no_native_hits,state,{"providerId":"130077"},
            [(179.9,52),(-179.9,52),(0,52)],{},[original],True)
        self.assertEqual(checks, ["covered","covered","missing"])

    def test_sparse_region_uncovered_and_missing_are_distinct(self):
        scope = prep(box(-72,41,-71,42))
        empty = SimpleNamespace(filter=lambda **kw: iter(()))
        self.assertEqual(self.qa.classify_samples(empty,scope,{"providerId":"130077"},
            [(-71.5,41.5),(-75,41.5)],{}), ["uncovered","missing"])

    def test_overlapping_and_wrapping_footprints_are_rejected(self):
        boxes = [[-180,50,-130,72],[170,50,180,56]]
        self.assertEqual(self.qa.validated_footprints({"footprints":boxes},True),boxes)
        for bad in ([[-179,50,179,72],[170,50,180,56]], [boxes[0],boxes[0]], [boxes[1]]):
            with self.assertRaises(ValueError):
                self.qa.validated_footprints({"footprints":bad},True)


if __name__ == "__main__":
    unittest.main()
