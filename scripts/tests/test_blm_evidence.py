"""Regression fixtures from bounded BLM layer 8 reads on 2026-10-29."""
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetch_blm_recreation as blm


FREE_SITES = (
    ('2079', 'Hawkins Reservoir Campground', 42.51167, -112.33155),
    ('15021', 'Graves Creek Campground', 43.04361111, -111.9111111),
    ('202084', 'Cutthroat Trout Campground', 43.0221, -111.5121),
    ('202085', 'Sage Hen Flats Campground', 43.02041422, -111.82644831),
    ('202067', 'Morgans Bridge Campground', 43.05983, -111.92713),
)
NO_FEE = 'There are no fees associated with this site.'
# Original source sentences and HTML paragraph separators, including unrelated
# amenity numbers; none of those numbers may become an inferred nightly price.
DESCRIPTIONS = {
    '2079': 'This site is adjacent to the Hawkins Reservoir that has opportunities for fishing and boating. <p> Campground rules and regulations are posted at the site. There are no dumpsters on site, visitors must pack in and out their trash. <p>Campsites: 10 developed sites--- At this time, there is not a reservation system in place for the campsites. Campsites are on a first come first serve basis. There are no fees associated with this site. <p>This site is equipped with 2 vault toilets, 2 parking lots, picnic tables, boat ramp & dock and shelters. Access to BLM and Forest Service OHV trails exist.',
    '15021': 'This BLM managed site located along the Blackfoot River that has opportunities for fishing, camping, and non-motorized boating. Campground rules and regulations are posted at the site. Visitors are asked to follow to the “Leave No Trace” principles; pack in - pack out. <p>Campsites: 5 developed sites--- At this time, there is not a reservation system in place for the campsites. Campsites are on a first come first serve basis. <p>This site is equipped with vault toilets, picnic tables, fire rings, horse shoe pit, undeveloped put-in/take-out <p>There are no fees associated with this site.',
    '202084': 'This BLM managed site located along the Blackfoot River that has opportunities for fishing, camping, and non-motorized boating. Campground rules and regulations are posted at the site. There are no dumpsters on site, visitors must pack in and out their trash. <p>Campsites: 3 semi-developed sites--- At this time, there is not a reservation system in place for the campsites. Campsites are on a first come first serve basis.<p>This site is equipped with vault toilets, picnic tables, fire rings, horse shoe pit, and an undeveloped put-in/take-out for floaters.<p>There are no fees associated with this site.',
    '202085': 'This BLM managed site located along the Blackfoot River that has opportunities for fishing, camping, and non-motorized boating. Campground rules and regulations are posted at the site. There are no dumpsters on site, visitors must pack in and out their trash.<p>Campsites: 4 semi-developed sites--- At this time, there is not a reservation system in place for the campsites. Campsites are on a first come first serve basis.<p>This site is equipped with vault toilets, picnic tables, fire rings, horse shoe pit, and an undeveloped put-in/take-out for floaters.<p>There are no fees associated with this site.',
    '202067': 'This BLM managed site located along the Blackfoot River that has opportunities for fishing, camping, and non-motorized boating. Campground rules and regulations are posted at the site. There are no dumpsters on site, visitors must pack in and out their trash.<p>Campsites: 12 developed sites--- 10 which are accessible by vehicle and 2 which are walk-in only. At this time, there is not a reservation system in place for the campsites. Campsites are on a first come first serve basis.<p>This site is equipped with a vault toilet, picnic tables, fire rings an undeveloped put-in/take-out for floaters. <p> There are no fees associated with this site.',
}


def row(key='2079', name='Hawkins Reservoir Campground', lat=42.51167, lng=-112.33155, **extra):
    return {'FacilityID': key, 'FacilityName': name, 'FacilityLatitude': str(lat),
            'FacilityLongitude': str(lng), 'FacilityTypeDescription': 'Campground',
            'FacilityUseFeeDescription': '', 'BLMFacURL': f'https://www.blm.gov/visit/search-details/{key}/1',
            'FacilityDescription': 'Campsites are on a first come first serve basis. ' + NO_FEE, **extra}


def props(record):
    return blm.to_feature(record, blm.LAYERS[8], '2026-10-29', 8)['properties']


class BLMEvidenceTests(unittest.TestCase):
    def test_five_verified_campgrounds_use_description_with_identity_and_evidence(self):
        for values in FREE_SITES:
            with self.subTest(name=values[1]):
                p = props(row(*values, FacilityDescription=DESCRIPTIONS[values[0]], LastUpdatedDate='2026-02-25'))
                self.assertEqual((p['fee_status'], p['cost']), ('free', 0))
                self.assertEqual(p['facility_id'], values[0])
                self.assertEqual(p['fee_source_field'], 'FacilityDescription')
                evidence = p['fee_evidence_records'][0]
                self.assertEqual(evidence['source_record_id'], values[0])
                self.assertEqual(evidence['retrieved_at'], '2026-10-29')
                self.assertEqual(evidence['source_updated_at'], '2026-02-25')
                self.assertEqual(evidence['sha256'], hashlib.sha256(p['fee_text'].encode()).hexdigest())

    def test_four_actual_payment_statements_have_no_invented_amount(self):
        for key, name, subject in (
            ('10214735', 'Creek Pasture Campground', 'Creek Pasture Campground'),
            ('10214673', 'Superbowl Campground', 'Superbowl Campground'),
            ('10214768', 'Hamburger Rock Campground', 'Hamburger Rock Campground'),
            ('10214711', 'Sand Island Recreation Area', 'The campground at Sand Island Recreation Area'),
        ):
            with self.subTest(name=name):
                text = subject + ' is first come, first served and payment must be made upon arrival at the self-register kiosk at the campground using cash, check, or the Scan & Pay feature on the Recreation.gov mobile app.'
                if key == '10214711':
                    text += ' There is no fee for day use.'
                p = props(row(key, name, FacilityDescription='', FacilityUseFeeDescription=text))
                self.assertEqual((p['fee_status'], p['cost']), ('paid', None))
                self.assertEqual(p['fee_text'], text)
                self.assertEqual(p['fee_source_field'], 'FacilityUseFeeDescription')

    def test_description_fallback_rejects_ancillary_negation_nearby_and_reservability(self):
        for text in ('Free showers. Camping reservations are available.', 'No fee for parking.',
                     'There are no fees associated with parking at this site.',
                     'It is not true that there are no fees associated with this site.',
                     'Nearby Pine Campground has tent sites. ' + NO_FEE,
                     'This site formerly advertised: ' + NO_FEE,
                     'There are no fees associated with this site during winter.',
                     'Reservations are not required. Campsites are first come first served.',
                     'Camping costs $20 per night.'):
            with self.subTest(text=text):
                self.assertEqual(props(row(FacilityDescription=text, Reservable='true'))['fee_status'], 'unknown')
        self.assertEqual(props(row(FacilityTypeDescription='Visitor Center'))['fee_status'], 'unknown')
        area = {'RecAreaID': '1', 'RecAreaName': 'Campground area', 'RecAreaLatitude': '40', 'RecAreaLongitude': '-110',
                'FacilityTypeDescription': 'Campground', 'FacilityDescription': NO_FEE}
        self.assertEqual(blm.to_feature(area, blm.LAYERS[2], '2026-10-29', 2)['properties']['fee_status'], 'unknown')

    def test_known_primary_is_preserved_and_conclusive_disagreement_flagged(self):
        p = props(row(FacilityUseFeeDescription='$20 per night', FacilityDescription='Free parking.'))
        self.assertEqual((p['fee_status'], p['cost']), ('paid', 20))
        for primary, description in (('$20 per night', NO_FEE), ('No fee', 'Camping costs $20 per night.'),
                                     ('', NO_FEE + ' Camping costs $20 per night.')):
            p = props(row(FacilityUseFeeDescription=primary, FacilityDescription=description))
            self.assertEqual((p['fee_status'], p['cost']), ('unknown', None))
            self.assertTrue(p['fee_conflict'])
            self.assertTrue(p['fee_evidence_conflict'])
            self.assertTrue(any(e['source_field'] == 'FacilityDescription' for e in p['fee_evidence_records']))
        p = props(row(FacilityUseFeeDescription='No fee during winter.'))
        self.assertEqual(p['fee_status'], 'conditional')

    def test_complete_evidence_keeps_trailing_pass_requirement_and_source_date(self):
        text = NO_FEE + ' ' + 'Campground rules are posted at the site. ' * 20 + 'A vehicle permit is required.'
        p = props(row(FacilityDescription=text, LastUpdatedDate='2026-10-01'))
        self.assertEqual((p['fee_status'], p['cost']), ('conditional', None))
        self.assertEqual(p['fee_text'], text)
        self.assertGreater(len(p['fee_text']), 400)
        self.assertEqual(p['fee_evidence_records'][0]['source_updated_at'], '2026-10-01')
        text = 'Fee details. ' * 50 + 'No fee. A vehicle pass is required.'
        p = props(row(FacilityUseFeeDescription=text, FacilityDescription=''))
        self.assertEqual(p['fee_text'], text)
        self.assertEqual(p['fee_status'], 'conditional')
        self.assertIsNone(p['fee_evidence_records'][0]['source_updated_at'])

    def test_later_conditions_qualify_unknown_and_known_free_primary(self):
        for primary in ('', 'No fee'):
            for condition in ('A vehicle permit is required.', 'Fees apply in summer.',
                              'This applies only in winter.', 'Camping fees are charged during summer.',
                              'Camping is free only during winter.'):
                with self.subTest(primary=primary, condition=condition):
                    description = NO_FEE + ' ' + condition
                    p = props(row(FacilityUseFeeDescription=primary, FacilityDescription=description))
                    self.assertEqual((p['fee_status'], p['cost']), ('conditional', None))
                    self.assertEqual(p['fee_text'], description)
                    self.assertEqual(p['fee_source_field'], 'FacilityDescription')
                    self.assertFalse(p.get('fee_conflict', False))
                    fields = {e['source_field'] for e in p['fee_evidence_records']}
                    self.assertIn('FacilityDescription', fields)
                    if primary:
                        self.assertIn('FacilityUseFeeDescription', fields)
        p = props(row(FacilityDescription=NO_FEE + ' Fees apply.'))
        self.assertEqual((p['fee_status'], p['cost'], p['fee_conflict']), ('unknown', None, True))


def page(*oids, more=False):
    return {'features': [{'attributes': {'OBJECTID': oid}} for oid in oids], 'exceededTransferLimit': more}


class SequenceService:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def __call__(self, url, timeout):
        self.requests.append({k: v[0] for k, v in parse_qs(urlsplit(url).query).items()})
        if not self.responses:
            raise AssertionError('Unexpected additional request')
        data = self.responses.pop(0)
        return io.StringIO(data if isinstance(data, str) else json.dumps(data))


class BLMCompletenessTests(unittest.TestCase):
    def test_complete_two_pages_and_zero_count_are_bounded(self):
        service = SequenceService({'count': 3}, page(1, 2, more=True), page(3), {'count': 3})
        with patch.object(blm, 'PAGE_SIZE', 2):
            self.assertEqual([r['OBJECTID'] for r in blm.fetch_layer(8, service)], [1, 2, 3])
        self.assertEqual([q.get('resultOffset') for q in service.requests], [None, '0', '2', None])
        self.assertEqual(service.requests[2]['resultRecordCount'], '1')
        self.assertEqual(service.requests[-1]['returnCountOnly'], 'true')
        empty = SequenceService({'count': 0}, {'count': 0})
        self.assertEqual(blm.fetch_layer(2, empty), [])
        self.assertEqual(len(empty.requests), 2)
        with self.assertRaises(ValueError):
            blm.fetch_layer(9, SequenceService())

    def test_incomplete_response_above_old_seventy_percent_guard_keeps_file(self):
        # Eight of ten is above the old 70% safeguard but is still incomplete.
        service = SequenceService({'count': 10}, page(*range(8), more=False))
        fetch_layer = blm.fetch_layer
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'blm.json'
            previous = json.dumps({'features': [{}] * 10}).encode()
            output.write_bytes(previous)
            with patch.object(blm, 'OUT', output), patch.object(blm, 'fetch_layer',
                    side_effect=lambda layer: fetch_layer(layer, service)):
                with self.assertRaisesRegex(RuntimeError, 'expected count'):
                    blm.main()
            self.assertEqual(output.read_bytes(), previous)
            self.assertFalse(output.with_suffix('.json.tmp').exists())

    def test_duplicate_page_or_object_id_never_completes(self):
        examples = [
            SequenceService({'count': 3}, page(1, 2, more=True), page(1)),
            SequenceService({'count': 2}, page(1, 1)),
        ]
        for service in examples:
            with patch.object(blm, 'PAGE_SIZE', 2), self.assertRaisesRegex(RuntimeError, 'repeated'):
                blm.fetch_layer(8, service)

    def test_count_changes_and_transfer_disagreements_fail(self):
        examples = [
            SequenceService({'count': 1}, page(1), {'count': 2}),
            SequenceService({'count': 1}, page(1, more=True)),
            SequenceService({'count': 2}, page(1, more=False)),
            SequenceService({'count': 2}, {'features': [{'attributes': {'OBJECTID': 1}}]}, {'features': []}),
            SequenceService({'count': 1}, page(1, 2)),
        ]
        for service in examples:
            with self.assertRaises(RuntimeError):
                blm.fetch_layer(8, service)

    def test_malformed_pages_error_payloads_and_truncated_json_fail(self):
        malformed = [
            {}, {'features': None}, {'features': []}, {'features': [None]},
            {'features': [{'attributes': None}]}, {'features': [{'attributes': {}}]},
            page(True), {'features': [{'attributes': {'OBJECTID': '1'}}]},
            {'features': [{'attributes': {'OBJECTID': 1}}], 'exceededTransferLimit': 'false'},
            {'error': {'code': 500, 'message': 'Service unavailable'}},
            '{"features":[',
        ]
        for response in malformed:
            with self.subTest(response=response), self.assertRaises(RuntimeError):
                blm.fetch_layer(8, SequenceService({'count': 1}, response))
        for response in ({}, {'count': True}, {'count': -1}, {'count': blm.MAX_ROWS + 1},
                         {'error': {'code': 500}}, []):
            with self.subTest(count=response), self.assertRaises(RuntimeError):
                blm.fetch_layer(8, SequenceService(response))

    def test_read_and_page_limits_are_enforced(self):
        with patch.object(blm, 'MAX_RESPONSE_BYTES', 20), self.assertRaisesRegex(RuntimeError, 'read limit'):
            blm.fetch_layer(8, SequenceService(' ' * 21))
        with patch.object(blm, 'MAX_PAGES', 1), self.assertRaisesRegex(RuntimeError, 'page limit'):
            blm.fetch_layer(8, SequenceService({'count': 2}, page(1, more=True)))

    def test_invalid_source_features_are_quarantined_and_empty_import_keeps_file(self):
        valid = row(OBJECTID=1)
        invalid_coordinates = row('2', OBJECTID=2, FacilityLatitude='not a latitude')
        missing_id = row(None, OBJECTID=3)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'blm.json'
            with patch.object(blm, 'OUT', output), patch.object(blm, 'fetch_layer',
                    side_effect=[[], [valid, invalid_coordinates, missing_id]]):
                blm.main()
            saved = json.loads(output.read_text())
            self.assertEqual(len(saved['features']), 1)
            self.assertEqual(saved['source_counts'], {'2': 0, '8': 3})
            self.assertEqual(saved['quarantined'], [
                {'layer': 8, 'object_id': 2, 'source_record_id': '2', 'reason': 'invalid_coordinates'},
                {'layer': 8, 'object_id': 3, 'source_record_id': None, 'reason': 'missing_source_record_id'},
            ])
            previous = output.read_bytes()
            with patch.object(blm, 'OUT', output), patch.object(blm, 'fetch_layer', side_effect=[[], []]), self.assertRaises(RuntimeError):
                blm.main()
            self.assertEqual(output.read_bytes(), previous)

    def test_second_layer_failure_keeps_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'blm.json'
            output.write_text('{"features":[]}')
            previous = output.read_bytes()
            with patch.object(blm, 'OUT', output), patch.object(blm, 'fetch_layer',
                    side_effect=[[], RuntimeError('incomplete second layer')]), self.assertRaises(RuntimeError):
                blm.main()
            self.assertEqual(output.read_bytes(), previous)
            self.assertFalse(output.with_suffix('.json.tmp').exists())


if __name__ == '__main__':
    unittest.main()
