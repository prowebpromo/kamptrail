import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetch_rest_areas as rest


class Boundaries:
    def __init__(self, state='TX'):
        self.state = state

    def classify_many(self, points):
        return {tuple(c): {'state': self.state} for c in points}


def page(change=None):
    rows = []
    for i in range(50):
        row = [f'<a href="/discover/rest-areas-travel-information-centers/safety-rest-area-list/test-{i}.html">County {i} Northbound</a>', 'IH 35 - Northbound', '12', '30.9', '-97.56']
        if i == 0 and change:
            change(row)
        rows.append('<tr>' + ''.join('<td>' + c + '</td>' for c in row) + '</tr>')
    return ('<table><tr>' + ''.join('<th>' + h + '</th>' for h in rest.HEADERS) + '</tr>' + ''.join(rows) + '</table>').encode()


class RestAreas(unittest.TestCase):
    def test_exact_official_rows_keep_direction_and_do_not_grant_permission(self):
        rows, excluded, count = rest.parse_list(page(), Boundaries())
        self.assertEqual((len(rows), len(excluded), count), (50, 0, 50))
        self.assertEqual(len({r['id'] for r in rows}), 50)
        self.assertTrue(all(r['permission'] == 'unknown' for r in rows))
        self.assertEqual(rows[0]['coordinates'], [-97.56, 30.9])
        self.assertIn('Northbound', rows[0]['name'])

    def test_information_centers_are_not_laundered_into_rest_area_scope(self):
        raw = page(lambda r: r.__setitem__(0, 'Texas Travel Information Center at Example'))
        rows, excluded, count = rest.parse_list(raw, Boundaries())
        self.assertEqual((len(rows), len(excluded), count), (49, 1, 50))

    def test_wrong_headers_and_truncated_table_fail(self):
        for raw in [page().replace(b'Latitude', b'Unreviewed field'), b'<table></table>', b'x' * (rest.LIMIT + 1)]:
            with self.assertRaises(ValueError):
                rest.parse_list(raw, Boundaries())

    def test_unapproved_detail_link_and_duplicate_identity_fail(self):
        for href in ['https://example.org/rest-area.html', '//evil.example/source.html', '/discover/rest-areas-travel-information-centers/safety-rest-area-list/test.html?secret=x']:
            with self.assertRaises(ValueError):
                rest.parse_list(page(lambda r: r.__setitem__(0, f'<a href="{href}">County</a>')), Boundaries())
        raw = page().replace(b'test-1.html', b'test-0.html').replace(b'County 1 Northbound', b'County 0 Northbound')
        with self.assertRaises(ValueError):
            rest.parse_list(raw, Boundaries())

    def test_invalid_and_ambiguous_state_geometry_fail(self):
        for boundaries in [Boundaries('OK'), Boundaries(None)]:
            with self.assertRaises(ValueError):
                rest.parse_list(page(), boundaries)
        with self.assertRaises(ValueError):
            rest.parse_list(page(lambda r: r.__setitem__(3, 'nan')), Boundaries())

    def test_source_failure_and_unreviewed_shrink_preserve_prior(self):
        with self.assertRaises(ValueError):
            rest.fetch('https://example.org/')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'TX.json'
            first = {'records': list(range(100)), 'source': {'retrieved_at': '2026-01-01T00:00:00Z'}}
            rest.write(path, first)
            with self.assertRaises(ValueError):
                rest.write(path, {'records': [1], 'source': {'retrieved_at': '2026-01-02T00:00:00Z'}})
            self.assertEqual(json.loads(path.read_text()), first)


if __name__ == '__main__':
    unittest.main()
