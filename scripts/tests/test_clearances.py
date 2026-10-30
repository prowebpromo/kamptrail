import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import build_clearances as clearances
from build_agency_states import PreparedState


class Boundaries:
    def __init__(self, polygon, state):
        self.polygon, self.state = polygon, state

    def classify_many(self, points):
        return {tuple(p): {'state': self.state if self.polygon.relation(*p) == 1 else None,
                'reason': 'contained' if self.polygon.relation(*p) == 1 else 'boundary_ambiguous',
                'candidates': [self.state]} for p in points}


class ClearanceTests(unittest.TestCase):
    def test_units_and_unknowns(self):
        for raw, value in [('3.8', 3.8), ('3 m', 3), ('6\'7"', 2.0066), ("12'", 3.6576)]:
            self.assertAlmostEqual(clearances.parse_height(raw), value)
        for raw in ['none', 'default', '3,8', '3.8m', '3.8;4.2', '3 @ (wet)', '4|5', '13 ft', '6\'12"', '-4', '0', '101']:
            self.assertIsNone(clearances.parse_height(raw), raw)

    def test_all_geometry_vertices_must_be_contained_including_dateline(self):
        polygon = PreparedState({'type': 'Polygon', 'coordinates': [[[179, 50], [-179, 50], [-179, 52], [179, 52], [179, 50]]]})
        boundaries = Boundaries(polygon, 'AK')
        geometry = {'type': 'LineString', 'coordinates': [[179.5, 51], [-179.5, 51]]}
        self.assertEqual(clearances.select_geometry(geometry, boundaries, 'AK')['state'], 'AK')
        geometry['coordinates'].append([0, 51])
        self.assertIsNone(clearances.select_geometry(geometry, boundaries, 'AK')['state'])
        island = PreparedState({'type': 'Polygon', 'coordinates': [[[-156, 19], [-155, 19], [-155, 20], [-156, 20], [-156, 19]]]})
        self.assertEqual(clearances.select_geometry({'type': 'Point', 'coordinates': [-155.5, 19.5]}, Boundaries(island, 'HI'), 'HI')['state'], 'HI')
        self.assertIsNone(clearances.select_geometry({'type': 'Point', 'coordinates': [-156, 19.5]}, Boundaries(island, 'HI'), 'HI')['state'])

    @unittest.skipUnless(importlib.util.find_spec('osmium'), 'Optional pinned native parser is unavailable')
    def test_native_exact_namespaces_full_geometry_unknowns_and_quarantine(self):
        import osmium
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pbf = root / 'pilot.osm.pbf'
            header = osmium.io.Header()
            header.set('osmosis_replication_timestamp', '2025-01-01T00:00:00Z')
            with osmium.SimpleWriter(str(pbf), header=header) as writer:
                for oid, point, tags in [(1, (-71.4, 41.8), {'maxheight': 'none', 'barrier': 'height_restrictor'}), (2, (-71.401, 41.801), {}),
                                         (3, (-71.402, 41.802), {}), (4, (-71.4, 42.1), {}),
                                         (5, (-71.403, 41.803), {'maxheight:conditional': '3 @ (wet)', 'barrier': 'height_restrictor'})]:
                    writer.add_node(osmium.osm.mutable.Node(id=oid, version=1, timestamp='2025-01-01T00:00:00Z', location=point, tags=tags))
                for oid, nodes, tags in [(1, [2, 3], {'maxheight': '13\'6"', 'maxheight:physical': '4.8'}),
                                          (2, [3, 4], {'maxheight': '4'}), (3, [2, 3], {'maxheight': '3', 'disused': 'yes'})]:
                    tags['highway'] = 'service'
                    writer.add_way(osmium.osm.mutable.Way(id=oid, version=2, timestamp='2025-01-01T00:00:00Z', nodes=nodes, tags=tags))
                writer.add_relation(osmium.osm.mutable.Relation(id=1, version=1, timestamp='2025-01-01T00:00:00Z', members=[('w', 1, '')], tags={'maxheight': '4', 'highway': 'service'}))
            metadata = {'url': clearances.URLS['RI'], 'resolved_url': clearances.URLS['RI'].replace('latest', '250101'),
                        'sha256': hashlib.sha256(pbf.read_bytes()).hexdigest(), 'bytes': pbf.stat().st_size, 'retrieved_at': '2025-01-02T00:00:00Z'}
            data, report = clearances.extract(pbf, metadata, root)
            self.assertEqual({r['id'] for r in data['records']}, {'osm:node:1', 'osm:node:5', 'osm:way:1'})
            way = next(r for r in data['records'] if r['osm_type'] == 'way')
            self.assertEqual(way['geometry']['coordinates'], [[-71.401, 41.801], [-71.402, 41.802]])
            self.assertAlmostEqual(way['metres']['maxheight'], 4.1148)
            self.assertEqual(way['metres']['maxheight:physical'], 4.8)
            self.assertEqual(report['quarantined'], 2)
            self.assertEqual(report['statistics']['lifecycle_excluded'], 1)
            before = pbf.read_bytes()
            with self.assertRaisesRegex(ValueError, 'receipt'):
                clearances.extract(pbf, {**metadata, 'sha256': 'a' * 64}, root)
            self.assertEqual(pbf.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
