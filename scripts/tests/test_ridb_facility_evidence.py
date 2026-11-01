import json
import os
import sys
import threading
import unittest
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import fetch_ridb_facility_evidence as ev  # noqa: E402


class Response:
    def __init__(self, data, status=200):
        self.data, self.status = data, status

    def raise_for_status(self):
        if self.status >= 400:
            raise RuntimeError(f'HTTP {self.status}')

    def json(self):
        return self.data


def fake(records, campsites, fail=()):
    calls = []

    def get(url, params):
        calls.append((url, dict(params)))
        fid = url.split('/facilities/')[1].split('/')[0]
        if fid in fail:
            return Response({}, 500)
        if url.endswith('/campsites'):
            rows = campsites.get(fid, [])
            off = params['offset']
            return Response({'RECDATA': rows[off:off + params['limit']]})
        return Response(records.get(fid, {}))
    return get, calls


NOW = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)


class IdTests(unittest.TestCase):
    def test_accepts_spaces_commas_and_dedupes(self):
        self.assertEqual(ev.parse_ids(' 233178, 255232 233178 '), ['233178', '255232'])

    def test_rejects_non_digits_empty_and_too_many(self):
        for bad in ('12a', '../1', '1;rm', '12345678901'):
            with self.assertRaises(ValueError):
                ev.parse_ids(bad)
        with self.assertRaises(ValueError):
            ev.parse_ids('   ')
        with self.assertRaises(ValueError):
            ev.parse_ids(' '.join(str(i) for i in range(1, 102)))


class EvidenceTests(unittest.TestCase):
    def test_raw_fields_keep_missing_null_and_blank_distinct(self):
        get, _ = fake({'1': {'FacilityID': '1', 'FacilityName': 'A', 'FacilityTypeDescription': '', 'LastUpdatedDate': None}}, {})
        entry = ev.run(['1'], get, NOW)['facilities']['1']
        self.assertEqual(entry['status'], 'ok')
        self.assertEqual(entry['fields']['FacilityTypeDescription'], '')
        self.assertIsNone(entry['fields']['LastUpdatedDate'])
        self.assertEqual(entry['fields']['Reservable'], {'missing': True})

    def test_campsites_paginate_and_count_overnight_separately(self):
        rows = [{'FacilityID': '2', 'TypeOfUse': 'Overnight', 'CampsiteType': 'STANDARD NONELECTRIC'}] * 60 + [{'FacilityID': 2, 'TypeOfUse': 'Day', 'CampsiteType': 'PICNIC'}] * 3
        get, calls = fake({'2': {'FacilityID': '2', 'FacilityTypeDescription': 'Campground'}}, {'2': rows})
        entry = ev.run(['2'], get, NOW)['facilities']['2']
        self.assertEqual(entry['campsites']['total'], 63)
        self.assertEqual(entry['campsites']['overnight'], 60)
        self.assertEqual(entry['campsites']['by_type_of_use'], {'Day': 3, 'Overnight': 60})
        self.assertEqual([c[1]['offset'] for c in calls if c[0].endswith('/campsites')], [0, 50])

    def test_one_failure_is_recorded_without_hiding_others(self):
        get, _ = fake({'3': {'FacilityID': '3'}}, {}, fail=('4',))
        out = ev.run(['3', '4'], get, NOW)
        self.assertEqual(out['facilities']['3']['status'], 'ok')
        self.assertEqual(out['facilities']['4']['status'], 'error')
        self.assertEqual(out['retrieved_at'], '2026-11-01T12:00:00Z')
        self.assertEqual(out['facilities']['3']['retrieved_at'], '2026-11-01T12:00:00Z')

    def test_empty_record_is_not_found(self):
        get, _ = fake({}, {})
        self.assertEqual(ev.run(['5'], get, NOW)['facilities']['5']['status'], 'not_found')

    def test_output_is_labelled_review_evidence(self):
        get, _ = fake({'6': {'FacilityID': '6'}}, {})
        out = ev.run(['6'], get, NOW)
        self.assertEqual(out['kind'], 'review evidence, not published data')
        json.dumps(out)


class IdentityTests(unittest.TestCase):
    def test_facility_record_id_mismatch_fails_and_is_not_evidence(self):
        get, calls = fake({'11': {'FacilityID': '22', 'FacilityTypeDescription': 'Campground'}}, {'11': []})
        entry = ev.run(['11'], get, NOW)['facilities']['11']
        self.assertEqual(entry['status'], 'error')
        self.assertIn('Identity mismatch', entry['error'])
        self.assertEqual(entry['decision'], 'pending')
        self.assertNotIn('fields', entry)
        self.assertNotIn('campsites', entry)
        self.assertFalse(any(c[0].endswith('/campsites') for c in calls))

    def test_foreign_parent_campsite_is_rejected_counted_and_not_totalled(self):
        rows = [{'FacilityID': '11', 'TypeOfUse': 'Overnight'}, {'FacilityID': '33', 'TypeOfUse': 'Overnight'},
                {'TypeOfUse': 'Overnight'}]
        get, _ = fake({'11': {'FacilityID': '11'}}, {'11': rows})
        entry = ev.run(['11'], get, NOW)['facilities']['11']
        self.assertEqual(entry['status'], 'error')
        self.assertEqual(entry['decision'], 'pending')
        self.assertNotIn('campsites', entry)
        self.assertNotIn('fields', entry)
        self.assertEqual(entry['campsites_rejected']['count'], 2)
        self.assertEqual(entry['campsites_rejected']['accepted_not_counted'], 1)
        self.assertEqual(len(entry['campsites_rejected']['reasons']), 2)

    def test_matching_ids_succeed(self):
        get, _ = fake({'11': {'FacilityID': ' 11 '}}, {'11': [{'FacilityID': 11, 'TypeOfUse': 'Overnight'}]})
        entry = ev.run(['11'], get, NOW)['facilities']['11']
        self.assertEqual(entry['status'], 'ok')
        self.assertEqual(entry['campsites']['total'], 1)
        self.assertEqual(entry['campsites_rejected']['count'], 0)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.server.seen.append((self.path, self.headers.get('apikey')))
        target = self.server.routes.get(self.path.split('?')[0])
        if target is None:
            self.send_response(404)
            self.end_headers()
        elif isinstance(target, str):
            self.send_response(302)
            self.send_header('Location', target)
            self.end_headers()
        else:
            body = json.dumps(target).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)


class RedirectTests(unittest.TestCase):
    def serve(self, routes):
        server = HTTPServer(('127.0.0.1', 0), Handler)
        server.routes, server.seen = routes, []
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close(), thread.join(5)))
        return server, f'http://127.0.0.1:{server.server_address[1]}'

    def run_one(self, base, key='dummy-key'):
        orig = ev.BASE_URL
        ev.BASE_URL = base
        try:
            return ev.run(['11'], ev.make_get(key, timeout=5), NOW)['facilities']['11']
        finally:
            ev.BASE_URL = orig

    def test_cross_origin_redirect_never_receives_apikey_and_fails(self):
        second, second_base = self.serve({'/facilities/11': {'FacilityID': '11'}})
        first, first_base = self.serve({'/facilities/11': second_base + '/facilities/11'})
        entry = self.run_one(first_base)
        self.assertEqual(entry['status'], 'error')
        self.assertIn('cross-origin', entry['error'])
        self.assertEqual(entry['decision'], 'pending')
        self.assertEqual(second.seen, [])
        self.assertEqual(first.seen[0][1], 'dummy-key')

    def test_same_origin_redirect_is_followed(self):
        server, base = self.serve({'/facilities/11': '/moved/11', '/moved/11': {'FacilityID': '11'},
                                   '/moved/11/campsites': {'RECDATA': []}})
        server.routes['/facilities/11/campsites'] = {'RECDATA': []}
        entry = self.run_one(base)
        self.assertEqual(entry['status'], 'ok')
        self.assertTrue(all(key == 'dummy-key' for _, key in server.seen))

    def test_redirect_loop_stops_after_five_hops(self):
        server, base = self.serve({'/facilities/11': '/a'})
        server.routes['/a'] = '/facilities/11'
        entry = self.run_one(base)
        self.assertEqual(entry['status'], 'error')
        self.assertEqual(len(server.seen), 6)

    def test_origin_compare_includes_scheme_host_and_port(self):
        self.assertEqual(ev.origin_of('https://a.example/x'), ev.origin_of('https://A.example:443/y'))
        for other in ('http://a.example/x', 'https://b.example/x', 'https://a.example:8443/x'):
            self.assertNotEqual(ev.origin_of('https://a.example/x'), ev.origin_of(other))


class WorkflowSafetyTests(unittest.TestCase):
    def test_workflow_is_dispatch_only_read_only_and_artifact_only(self):
        import yaml
        path = os.path.join(os.path.dirname(__file__), '..', '..', '.github', 'workflows', 'review-ridb-facility-evidence.yml')
        with open(path, encoding='utf-8') as handle:
            text = handle.read()
        wf = yaml.safe_load(text)
        triggers = wf.get('on', wf.get(True))
        self.assertEqual(list(triggers), ['workflow_dispatch'])
        self.assertEqual(wf['permissions'], {'contents': 'read'})
        steps = wf['jobs']['fetch']['steps']
        run = next(s for s in steps if s.get('name') == 'Fetch evidence')
        # Inputs reach the shell only through the environment, never interpolated into the script.
        self.assertNotIn('${{', run['run'])
        self.assertEqual(run['env']['FACILITY_IDS'], '${{ inputs.facility_ids }}')
        self.assertNotIn('git commit', text)
        self.assertNotIn('git push', text)
        self.assertTrue(any(s.get('uses', '').startswith('actions/upload-artifact') for s in steps))


if __name__ == '__main__':
    unittest.main()
