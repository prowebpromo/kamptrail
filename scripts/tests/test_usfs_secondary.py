"""Bounded USFS join and researched onsite/fee regression cases (no network)."""
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
import fetch_usfs_recreation as usfs


def row(rid=16634, name='Rainy Day Campground', **changes):
    value = {
        'objectid': rid, 'recareaid': rid, 'recareaname': name,
        'latitude': '45.761800', 'longitude': '-115.702900',
        '_geometry': {'x': -115.702913, 'y': 45.761806},
        'markeractivity': 'Beachcombing', 'feedescription': 'No Fee.',
        'recareadescription': 'Rainy Day Campground provides campsites located in open timber on ridge top. Road access is rough and narrow in places.',
        'restrictions': 'Garbage services not available. Pack It In, Pack It Out.',
        'openstatus': 'open', '_discovery': 'secondary_activity',
        '_camping_activities': ['Dispersed Camping'],
    }
    value.update(changes)
    return value


def response(data):
    return io.StringIO(json.dumps(data))


class FakeService:
    """Emulate normal ArcGIS count and offset queries, including geometry."""
    def __init__(self, primary, activities, joined):
        self.primary, self.activities, self.joined = primary, activities, joined
        self.requests = []

    def __call__(self, url, timeout):
        q = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
        self.requests.append(q)
        if url.startswith(usfs.ACTIVITY_URL):
            records = self.activities
        elif q['where'].startswith('markeractivity'):
            records = self.primary
        else:
            ids = set(q['where'].split('(')[1].rstrip(')').split(','))
            records = [r for r in self.joined if str(r['recareaid']) in ids]
        if q.get('returnCountOnly') == 'true':
            return response({'count': len(records)})
        offset, count = int(q['resultOffset']), int(q['resultRecordCount'])
        page = records[offset:offset + count]
        return response({
            'features': [{'attributes': {k: v for k, v in r.items() if not k.startswith('_')},
                          'geometry': r.get('_geometry')} for r in page],
            'exceededTransferLimit': offset + len(page) < len(records),
        })


class SecondaryTests(unittest.TestCase):
    def feature(self, value):
        return usfs.to_feature(value, '2026-10-29')

    def test_researched_actual_campgrounds_keep_access_and_status(self):
        examples = [
            row(),
            row(64883, 'Redinger Campground', recareadescription='There is one designated camp area only. Road access is paved.', restrictions='Maximum vehicle length = 25 feet. Maximum stay = 14 days.'),
            row(76182, 'Pass Creek Narrows Camping Area & Picnic Site', recareadescription='The area has seven camping sites scattered through scenic Pass Creek Narrows.'),
            row(25200, 'Green Springs Campground', markeractivity='Trailhead', recareadescription='There are six sites at this dispersed-style campground. A high-clearance 4x4 vehicle is recommended.'),
            row(12204, 'Manning Meadows CUA Dispersed Camping', recareadescription='Most dispersed camp sites are found near aspen trees.'),
        ]
        for value in examples:
            with self.subTest(id=value['recareaid']):
                f = self.feature(value)
                self.assertIsNotNone(f)
                self.assertEqual(f['properties']['fee_status'], 'free')
                self.assertEqual(f['properties']['description'], value['recareadescription'])
                self.assertEqual(f['properties']['restrictions'], value['restrictions'])
                self.assertEqual(f['properties']['open_status'], 'open')
        closed = self.feature(row(83162, 'Luther Pass Campground', openstatus='closed'))
        self.assertEqual(closed['properties']['open_status'], 'closed')
        self.assertEqual(closed['properties']['fee_status'], 'free')

    def test_admin_umbrella_trailhead_and_nearby_rejected(self):
        examples = [
            row(13054, 'Happy Camp/Oak Knoll Ranger District', markeractivity='Forest Service Shield'),
            row(25250, 'General Campgrounds & Trailheads', markeractivity='Intermediate Parent Group'),
            row(84034, 'West Sedona Designated Dispersed Camping & Day-use', recareadescription='These designated dispersed camping areas provide eight main areas for dispersed camping.'),
            row(22948, 'Encampment Trailhead', recareadescription='Designated trailhead with access to trails into Mount Zirkel Wilderness. Facilities include outhouse and horse corral.'),
            row(71332, 'Pepperdine Trailhead', recareadescription='Access to overnight wilderness camping.'),
            row(80620, 'Kentucky Camp', recareadescription='Camping is prohibited within the site boundary, however there are dispersed camping areas outside the gates.'),
            row(99, 'Old Camp Picnic Site', recareadescription='There are nearby campgrounds. This picnic site has tables.'),
            row(102, 'Camp Creek Picnic Area', recareadescription='A picnic area near Pine Campground.'),
            row(103, 'Camp Creek Picnic Area', recareadescription='The trail leads to Pine Campground.'),
            row(104, 'Cedar Campground', recareadescription='The trail leads to Pine Campground.'),
            row(100, 'Example Campground', _camping_activities=['Day Hiking']),
            row(101, 'Example Campground', recareadescription='Fishing and hiking opportunities.'),
        ]
        for value in examples:
            with self.subTest(id=value['recareaid']):
                self.assertIsNotNone(usfs.secondary_rejection(value))
                self.assertIsNone(self.feature(value))

    def test_primary_six_categories_not_subject_to_secondary_name_gate(self):
        for activity in usfs.ACTIVITIES:
            value = row(1, 'A historical primary location', _discovery='primary_markeractivity',
                        markeractivity=activity, _camping_activities=[activity], recareadescription=None)
            self.assertIsNotNone(self.feature(value))

    def test_picnic_free_does_not_make_paid_camping_free(self):
        value = row(70984, 'Dam Creek Walk-In Campground and Picnic Area',
                    feedescription='Camping fee is $5. There is no fee for picnicking.',
                    recareadescription='This site offers picnicking and camping at the campground.')
        self.assertEqual(self.feature(value)['properties']['fee_status'], 'paid')

    def test_full_evidence_hash_date_and_separate_source_fields(self):
        text = 'No fee. ' + 'Published camping restrictions apply. ' * 30
        value = row(feedescription=text)
        p = self.feature(value)['properties']
        self.assertGreater(len(p['fee_text']), 400)
        e = p['fee_evidence_records'][0]
        self.assertEqual(e['text'], text.strip())
        self.assertEqual(e['sha256'], hashlib.sha256(e['text'].encode()).hexdigest())
        self.assertEqual(e['source_field'], 'feedescription')
        self.assertEqual(e['source_record_id'], '16634')
        self.assertEqual(e['retrieved_at'], '2026-10-29')
        self.assertIsNone(e['source_updated_at'])
        self.assertEqual({e['source_field'] for e in p['fee_evidence_records']}, {'feedescription', 'recareadescription', 'restrictions'})

    def test_broad_canyon_maintained_page_fee_conflicts_with_edw(self):
        value = row(76196, 'Broad Canyon Campground & Trailhead', feedescription='No fee required',
                    recareadescription='This site has eight camp units in a beautiful wooded setting.')
        p = self.feature(value)['properties']
        self.assertEqual((p['fee_status'], p['cost']), ('unknown', None))
        self.assertTrue(p['fee_conflict'])
        self.assertTrue(p['fee_evidence_conflict'])
        self.assertEqual(p['fee_text'], 'No fee required')
        statements = {e['source_field']: e for e in p['fee_evidence_records']}
        self.assertEqual(statements['feedescription']['text'], 'No fee required')
        page = statements['official_page.Fee Site and Info']
        self.assertEqual(page['text'], '$5 per night')
        self.assertEqual(page['source_record_id'], '76196')
        self.assertEqual(page['retrieved_at'], '2026-10-29')
        self.assertEqual(page['source_updated_at'], '2026-07-01')
        self.assertTrue(page['source_url'].endswith('/broad-canyon-campground-trailhead'))
        self.assertEqual(page['sha256'], hashlib.sha256(b'$5 per night').hexdigest())
        # The newer observation never silently wins over contrary agency data.
        self.assertIsNone(statements['feedescription']['source_updated_at'])
        self.assertEqual(self.feature(row(76182, 'Pass Creek Narrows Camping Area'))['properties']['fee_status'], 'free')

    def test_temporarily_uncollected_fees_are_not_unqualified_free(self):
        p = self.feature(row(82782, 'Jerry Johnson Campground', feedescription='No fee currently charged.', openstatus='closed'))['properties']
        self.assertEqual((p['fee_status'], p['cost'], p['open_status']), ('conditional', None, 'closed'))

    def test_description_never_supplies_fee_or_conflicts_with_dedicated_fee(self):
        descriptions = [
            'Cedar Campground has tent sites. There is no fee to camp at nearby Pine Campground.',
            'Cedar Campground has tent sites. Camping is free at Pine Campground.',
            'The campground has campsites. Camping is free.',
            'The campground has campsites. Free parking and water.',
            'The campground has campsites. Camping is free. Fees apply in summer.',
            'The campground has campsites. Camping is free. A permit is required.',
        ]
        for description in descriptions:
            for discovery in ['primary_markeractivity', 'secondary_activity']:
                for fee, expected in [(None, 'unknown'), ('No fee', 'free'), ('$20 per night', 'paid')]:
                    with self.subTest(description=description, discovery=discovery, fee=fee):
                        value = row(105, 'Cedar Campground', _discovery=discovery,
                                    markeractivity='Campground Camping', feedescription=fee,
                                    recareadescription=description)
                        f = self.feature(value)
                        if f is None:
                            self.assertEqual(discovery, 'secondary_activity')
                            self.assertIn('nearby', description)
                            continue
                        p = f['properties']
                        self.assertEqual((p['fee_status'], p['fee_source_field']), (expected, 'feedescription'))
                        self.assertFalse(p['fee_conflict'])
                        self.assertEqual(p['description'], description)

    def test_dedicated_restrictions_only_qualify_an_existing_free_fee(self):
        for restriction in ['A permit is required.', 'An Adventure Pass is required.',
                            'Fees apply in summer.', 'Camping costs $20 per night.',
                            'A camping permit is required.', 'A campfire permit is required. A camping permit is required.']:
            with self.subTest(restriction=restriction):
                self.assertEqual(self.feature(row(restrictions=restriction))['properties']['fee_status'], 'conditional')
                self.assertEqual(self.feature(row(feedescription=None, restrictions=restriction))['properties']['fee_status'], 'unknown')
        for restriction in ['A fishing permit is required.', 'Campfire permits are required.', 'No permits are required.',
                            'No fees apply.', 'No camping fees are charged.',
                            'California camp fire permit required ( https://www.fs.usda.gov/detail/htnf/passes-permits/?cid=fseprd673196 ). Dog must be on a leash at campground.',
                            'No campfires, propane only permit required.']:
            self.assertEqual(self.feature(row(restrictions=restriction))['properties']['fee_status'], 'free')

    def test_geometry_preferred_invalid_missing_and_disagreement_quarantined(self):
        self.assertEqual(self.feature(row())['geometry']['coordinates'], [-115.702913, 45.761806])
        for changes in ({'_geometry': None}, {'_geometry': {'x': float('nan'), 'y': 40}},
                        {'_geometry': {'x': 0, 'y': 0}}, {'longitude': '115.702900'},
                        {'_geometry': {'x': -117, 'y': 45}}):
            with self.subTest(changes=changes):
                self.assertIsNone(self.feature(row(**changes)))
        old = row()
        del old['_geometry']
        self.assertEqual(self.feature(old)['geometry']['coordinates'], [-115.7029, 45.7618])

    def test_join_multiple_pages_deduplicates_activity_rows_and_batches_ids(self):
        primary = row(1, 'Primary', markeractivity='RV Camping')
        activities = [
            {'objectid': 10, 'recareaid': 16634, 'activityname': 'Campground Camping'},
            {'objectid': 11, 'recareaid': 16634, 'activityname': 'RV Camping'},
            {'objectid': 12, 'recareaid': 64883, 'activityname': 'Campground Camping'},
        ]
        service = FakeService([primary], activities, [row(), row(64883, 'Redinger Campground')])
        with patch.object(usfs, 'PAGE_SIZE', 1), patch.object(usfs, 'ID_BATCH_SIZE', 1):
            result = usfs.fetch_all(opener=service)
        self.assertEqual([r['recareaid'] for r in result], [1, 16634, 64883])
        rainy = next(r for r in result if r['recareaid'] == 16634)
        self.assertEqual(rainy['_camping_activities'], ['Campground Camping', 'RV Camping'])
        self.assertEqual(rainy['_discovery'], 'secondary_activity')
        self.assertEqual(result[0]['_discovery'], 'primary_markeractivity')
        geometry_queries = [q for q in service.requests if q.get('returnGeometry') == 'true']
        self.assertTrue(all(q['outSR'] == '4326' for q in geometry_queries))
        self.assertEqual({q['where'] for q in geometry_queries if q['where'].startswith('recareaid')},
                         {'recareaid IN (16634)', 'recareaid IN (64883)'})

    def test_missing_join_record_fails(self):
        service = FakeService([], [{'objectid': 1, 'recareaid': 16634, 'activityname': 'Campground Camping'}], [])
        with self.assertRaisesRegex(RuntimeError, 'join is incomplete'):
            usfs.fetch_all(opener=service)

    def test_pagination_count_change_duplicate_and_early_end_fail(self):
        feature = {'attributes': {'objectid': 1}}
        scenarios = [
            [{'count': 1}, {'features': [feature]}, {'count': 2}],
            [{'count': 2}, {'features': [feature], 'exceededTransferLimit': True}, {'features': [feature]}],
            [{'count': 2}, {'features': [feature], 'exceededTransferLimit': False}],
            [{'count': 1}, {'features': [feature], 'exceededTransferLimit': True}],
            [{'count': 1}, {'features': []}],
        ]
        for payloads in scenarios:
            with self.subTest(payloads=payloads), patch.object(usfs, 'PAGE_SIZE', 1):
                replies = iter(payloads)
                with self.assertRaises(RuntimeError):
                    usfs.fetch_complete(usfs.URL, '1=1', 'objectid', lambda *a, **k: response(next(replies)))

    def test_failed_fetch_never_replaces_saved_data(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'usfs.json'
            output.write_text('previous saved data')
            with patch.object(usfs, 'OUT', output), patch.object(usfs, 'fetch_all', side_effect=RuntimeError('incomplete second page')):
                with self.assertRaises(RuntimeError):
                    usfs.main()
            self.assertEqual(output.read_text(), 'previous saved data')
            self.assertFalse(output.with_suffix('.json.tmp').exists())


if __name__ == '__main__':
    unittest.main()
