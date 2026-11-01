import json
import os
import sys
import unittest
from datetime import datetime, timezone

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
        rows = [{'TypeOfUse': 'Overnight', 'CampsiteType': 'STANDARD NONELECTRIC'}] * 60 + [{'TypeOfUse': 'Day', 'CampsiteType': 'PICNIC'}] * 3
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
