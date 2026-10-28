import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetch_osm_data  # noqa: E402


class Resp:
    def __init__(self, code, body=None):
        self.code, self.body = code, body or {'elements': []}

    def raise_for_status(self):
        if self.code >= 400:
            raise fetch_osm_data.requests.exceptions.HTTPError(f'{self.code} Server Error')

    def json(self):
        return self.body


class OverpassRetryTests(unittest.TestCase):
    def test_busy_server_is_retried_then_succeeds(self):
        calls = []
        def post(url, **kw):
            calls.append((url, kw['headers']['User-Agent']))
            return Resp(502) if len(calls) < 3 else Resp(200, {'elements': [{'type': 'node'}]})
        with patch.object(fetch_osm_data.requests, 'post', side_effect=post), patch.object(fetch_osm_data.time, 'sleep') as sleep:
            data = fetch_osm_data.fetch_osm_data('CO')
        self.assertEqual(len(data['elements']), 1)
        self.assertEqual(len(calls), 3)
        self.assertIn('kumi.systems', calls[2][0])
        self.assertTrue(all('KampTrail' in ua for _, ua in calls))
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [15, 30])

    def test_all_attempts_failing_raises_so_saved_data_is_kept(self):
        with patch.object(fetch_osm_data.requests, 'post', return_value=Resp(502)), patch.object(fetch_osm_data.time, 'sleep'):
            with self.assertRaises(RuntimeError):
                fetch_osm_data.fetch_osm_data('CO')


if __name__ == '__main__':
    unittest.main()
