"""Evidence renewal is separate from manual observation and fails closed."""
import copy
from datetime import date
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import recheck_usfs_fee_pages as check
import fetch_usfs_recreation as usfs


# Exact accepted October 30 receipt from baseline 1c1ac3a. Its real dates and pins
# stay frozen for the pilot expiry regression; it is never published as new evidence.
ORIGINAL_PILOT_RECEIPT = json.loads(r'''{
  "schema_version": 1,
  "policy_version": 1,
  "checked_at": "2026-10-30T23:55:09Z",
  "baseline_sha256": "cbd39f1b44f8ffc1b88ff1f8881c9cbb2d6b90e43606b1afde423c8f856ab80c",
  "records": [
    {
      "recareaid": 35347,
      "source_url": "https://www.fs.usda.gov/r03/tonto/recreation/sulphide-del-rey-campground",
      "review_sha256": "af1c8a65d1e0105a57ca2ae6d10db344182f10b8ab130fb3bd36bf4ab74284e3",
      "checked_at": "2026-10-30T23:55:09Z",
      "valid_until": "2026-11-29",
      "observed_page_sha256": "70481736c13cf7c0e1945e2f036a765bee36809077faa7e888feb39495d8e937",
      "raw_sha256": "0d14c979ef16d007bb4ff36387cad25f5c66b16664bf8a02d0ca9d89ca12bf59",
      "page_sha256": "70481736c13cf7c0e1945e2f036a765bee36809077faa7e888feb39495d8e937",
      "status": "unchanged"
    },
    {
      "recareaid": 35355,
      "source_url": "https://www.fs.usda.gov/r03/tonto/recreation/jones-water-campground",
      "review_sha256": "7720d8fa44b50f78e296136bd9199d7d87eacdeccf7df94217844af9b9a5fe66",
      "checked_at": "2026-10-30T23:55:09Z",
      "valid_until": "2026-11-29",
      "observed_page_sha256": "5d8f7d28abbf011afed03a655b68ac2f448a7a09e1c96c6856681e21eaf57401",
      "raw_sha256": "35219a76fb53fc7b567a916783e00bc3df3a6f97ee877fb9e01a6801ad43fe7e",
      "page_sha256": "5d8f7d28abbf011afed03a655b68ac2f448a7a09e1c96c6856681e21eaf57401",
      "status": "unchanged"
    },
    {
      "recareaid": 35645,
      "source_url": "https://www.fs.usda.gov/r03/tonto/recreation/airplane-flat-campground",
      "review_sha256": "7363d40da57e924f995868df2437a7f832b0e520b0a101eba99e173b113c79e7",
      "checked_at": "2026-10-30T23:55:09Z",
      "valid_until": "2026-11-29",
      "observed_page_sha256": "f053b495595f53b39da4100f81cde6fbe18b2247b0d72901968bcb6754da3b9a",
      "raw_sha256": "0b0418eb6d92859220c2f8611fe9f1381c5f671e866d4694e30e0aa254db96af",
      "page_sha256": "f053b495595f53b39da4100f81cde6fbe18b2247b0d72901968bcb6754da3b9a",
      "status": "unchanged"
    },
    {
      "recareaid": 35651,
      "source_url": "https://www.fs.usda.gov/r03/tonto/recreation/haigler-canyon-campground-and-day-use",
      "review_sha256": "b4c27c8b58396b92792ceed1ccf048bce35de2bd86d01b5d1eef3dfdd34fe0d8",
      "checked_at": "2026-10-30T23:55:09Z",
      "valid_until": "2026-11-29",
      "observed_page_sha256": "f46502ce985347d266419b5876dd05c660b9993639bd670d8cb62b1c57ad78f7",
      "raw_sha256": "90504a04fb33bff4995e4b9a213a231cfd0cc38721e5ba414b089493fd981615",
      "page_sha256": "f46502ce985347d266419b5876dd05c660b9993639bd670d8cb62b1c57ad78f7",
      "status": "unchanged"
    },
    {
      "recareaid": 35655,
      "source_url": "https://www.fs.usda.gov/r03/tonto/recreation/colcord-ridge-campground",
      "review_sha256": "b24f5b6672297e44da17fd53abf4c21138dd642adb904ccfb3cb3bb2a0502337",
      "checked_at": "2026-10-30T23:55:09Z",
      "valid_until": "2026-11-29",
      "observed_page_sha256": "dd49764c6ab44e2a03555d73deb4ea237fe08fc69a412e3d59f2a514457f3827",
      "raw_sha256": "cd626dd63d0ab78369de778c0abce6eec1ec7760ff6c89f6513e8994f09c3367",
      "page_sha256": "dd49764c6ab44e2a03555d73deb4ea237fe08fc69a412e3d59f2a514457f3827",
      "status": "unchanged"
    },
    {
      "recareaid": 60306,
      "source_url": "https://www.fs.usda.gov/r01/bitterroot/recreation/blodgett-campground",
      "review_sha256": "a5c320e060dbca512d68eaa04bef95f1fa2550973bca4fec01367e04539d341a",
      "checked_at": "2026-10-30T23:55:09Z",
      "valid_until": "2026-11-29",
      "observed_page_sha256": "cf394b94fd6c56cf32932d66b089620af916f0342583346b85e624e45a8aa333",
      "raw_sha256": "dd743004a230fd1de9d7b401e46f815ea1e42415d739bb5aa93d2f028323104e",
      "page_sha256": "cf394b94fd6c56cf32932d66b089620af916f0342583346b85e624e45a8aa333",
      "status": "unchanged"
    },
    {
      "recareaid": 60320,
      "source_url": "https://www.fs.usda.gov/r01/bitterroot/recreation/gold-creek-campground",
      "review_sha256": "211ea311fe4786293c58ab88e3f82abbfbe971fbd3ad0e9bf61fecf2e04d0920",
      "checked_at": "2026-10-30T23:55:09Z",
      "valid_until": "2026-11-29",
      "observed_page_sha256": "065ef180bd379d34697e79a12c86521045601717f94d2bb343fa9cc6005c9577",
      "raw_sha256": "1d586f88e55e10ba22c6e33fb4915ecb7c805e3ef9dea70075333c95d8fa8ca1",
      "page_sha256": "065ef180bd379d34697e79a12c86521045601717f94d2bb343fa9cc6005c9577",
      "status": "unchanged"
    },
    {
      "recareaid": 60666,
      "source_url": "https://www.fs.usda.gov/r01/bitterroot/recreation/paradise-campground",
      "review_sha256": "d43b8694a909ff5baf8ea6d19ba544d394613bf46a007bcfa1288bc3713eb054",
      "checked_at": "2026-10-30T23:55:09Z",
      "valid_until": "2026-11-29",
      "observed_page_sha256": "f99639503a340e00c02c51ce1c7e870212db89391876b19bfec218bf70e52483",
      "raw_sha256": "79eb40b39202cbcfae4c5752d0845f8b6ae0f77acdfc08edde34297fb167daa7",
      "page_sha256": "f99639503a340e00c02c51ce1c7e870212db89391876b19bfec218bf70e52483",
      "status": "unchanged"
    },
    {
      "recareaid": 66336,
      "source_url": "https://www.fs.usda.gov/r01/flathead/recreation/devils-corkscrew-campground",
      "review_sha256": "625bb16f9034cbafffd12c51532bdfdf0298077eb9c14b449a4399b5854dc5e8",
      "checked_at": "2026-10-30T23:55:09Z",
      "valid_until": "2026-11-29",
      "observed_page_sha256": "03a8afc91de94242f90b6f394c844a6f11bffa25cf4f81de8eb3ba1d408dde19",
      "raw_sha256": "0016191e81d6714d3db5e34da869e7cd9068629781689c6896ffeb99d79da8b9",
      "page_sha256": "03a8afc91de94242f90b6f394c844a6f11bffa25cf4f81de8eb3ba1d408dde19",
      "status": "unchanged"
    },
    {
      "recareaid": 67118,
      "source_url": "https://www.fs.usda.gov/r01/flathead/recreation/upper-stillwater-lake-campground",
      "review_sha256": "1912098419fbfcd14fefb9fd0081575a94096b26d11eca0819f659bf8ba42871",
      "checked_at": "2026-10-30T23:55:09Z",
      "valid_until": "2026-11-29",
      "observed_page_sha256": "fbc9a5991c69468c00714f2ab79248461378b38159f936bb793f5a565d0f9390",
      "raw_sha256": "471660f73cdbe02a100c1dc133eee07e8938ed87a42051eb843ea47500058fce",
      "page_sha256": "fbc9a5991c69468c00714f2ab79248461378b38159f936bb793f5a565d0f9390",
      "status": "unchanged"
    }
  ],
  "dependencies": {
    "https://www.fs.usda.gov/r03/tonto/alerts/canyon-lake-drawdown-public-safety-closure": {
      "status": "unchanged",
      "page_sha256": "6c8b9492c6871d0094f624c3d354c4b5103de88096d2f6824e62d1089645ac43"
    }
  }
}''')


def review():
    return {'recareaid': 35347, 'name': 'Reviewed Campground', 'observed_name': 'Reviewed Campground',
            'source': 'US Forest Service', 'source_field': 'official_page.Fee Site and Info',
            'source_url': 'https://www.fs.usda.gov/r03/example/recreation/reviewed-campground',
            'text': 'No fees are required for this site', 'retrieved_at': '2026-10-30',
            'review_after': '2026-11-29', 'identity_coordinates': [-111.0, 40.0],
            'notice_review': {'source_url': 'https://www.fs.usda.gov/r03/example/alerts/order'}}


def page(fee='No fees are required for this site', extra='', lat='40.0'):
    return (f'<html><nav>template navigation</nav><main><h1>Reviewed Campground</h1>'
            f'<p>{"The official campground description has relevant camping and access context. " * 4}</p>'
            f'<div id="rec_acc_fees"><p>{fee}</p></div><p>Latitude: {lat}</p><p>Longitude: -111.0</p>'
            f'<a href="/r03/example/alerts/order">Closure notice</a>{extra}</main><footer>footer</footer></html>').encode()


class RecheckTests(unittest.TestCase):
    def setUp(self):
        self.review = review()
        self.reviews = {35347: self.review}
        self.baseline = check.capture_baselines(self.reviews, lambda u: page())
        self.baseline['captured_at'] = '2026-10-30T12:00:00Z'
        self.clock = patch.object(check, 'utc_now', return_value=check.instant('2027-04-28T23:00:00Z'))
        self.clock.start()
        check.load_checks.cache_clear()

    def tearDown(self):
        self.clock.stop()
        check.load_checks.cache_clear()

    def test_semantic_snapshot_ignores_template_and_scripts_but_keeps_all_main_links_and_text(self):
        base = check.snapshot(page(), self.review)
        ignored = page().replace(b'template navigation', b'new template').replace(b'<main>', b'<main>\n <script>random session=123</script>\n')
        self.assertEqual(base['semantic_sha256'], check.snapshot(ignored, self.review)['semantic_sha256'])
        for raw in (page(extra='<p>Camping requires a permit.</p>'), page().replace(b'alerts/order', b'alerts/new-order')):
            self.assertNotEqual(base['semantic_sha256'], check.snapshot(raw, self.review)['semantic_sha256'])

    def test_identity_fee_and_ambiguous_error_pages_fail_closed(self):
        bad = [page(lat='41.0'), page(fee='$10 per night'), page().replace(b'Reviewed Campground', b'Another Campground'),
               page().replace(b'</main>', b'<div id="rec_acc_fees">duplicate</div></main>'),
               b'<html>Access denied. No fees are required for this site</html>',
               page().replace(b'</main>', b'<h1>Another heading</h1></main>')]
        for raw in bad:
            with self.subTest(raw=raw[:70]), self.assertRaises(ValueError):
                check.snapshot(raw, self.review)

    def test_unchanged_check_extends_automated_window_but_not_human_review_date(self):
        receipt = check.run_checks(self.reviews, self.baseline, lambda u: page(), '2026-11-23T13:00:00Z', now=check.instant('2026-11-23T13:00:00Z'))
        self.assertEqual(receipt['records'][0]['valid_until'], '2026-12-23')
        self.assertEqual(self.review['retrieved_at'], '2026-10-30')
        self.assertEqual(self.review['review_after'], '2026-11-29')
        with patch.object(check, 'load_checks', return_value={35347: receipt['records'][0]}):
            self.assertTrue(check.validation(self.review, date(2026, 11, 29)))
            self.assertFalse(check.validation(self.review, date(2026, 12, 23)))
            self.assertFalse(check.validation(self.review, date(2026, 11, 22)))
            edited = {**self.review, 'text': '$8 per night'}
            self.assertFalse(check.validation(edited, date(2026, 11, 29)))

    def test_changed_fee_notice_or_failed_retrieval_blocks_even_an_unexpired_manual_review(self):
        getters = [lambda u: page(fee='$10 per night'),
                   lambda u: page(extra='<p>New notice</p>') if '/alerts/' in u else page()]
        def unavailable(url):
            raise TimeoutError('no response')
        getters.append(unavailable)
        for getter in getters:
            receipt = check.run_checks(self.reviews, self.baseline, getter, '2026-11-01T13:00:00Z', now=check.instant('2026-11-01T13:00:00Z'))
            row = receipt['records'][0]
            self.assertNotEqual(row['status'], 'unchanged')
            self.assertIsNone(row['valid_until'])
            with patch.object(check, 'load_checks', return_value={35347: row}):
                self.assertFalse(check.validation(self.review, date(2026, 11, 1)))

    def test_manual_hard_cap_and_baseline_evidence_pin(self):
        receipt = check.run_checks(self.reviews, self.baseline, lambda u: page(), '2027-04-27T12:00:00Z', now=check.instant('2027-04-27T12:00:00Z'))
        self.assertEqual(receipt['records'][0]['valid_until'], '2027-04-28')
        expired = check.run_checks(self.reviews, self.baseline, lambda u: page(), '2027-04-28T12:00:00Z', now=check.instant('2027-04-28T12:00:00Z'))
        self.assertEqual(expired['records'][0]['status'], 'manual_review_due')
        self.reviews[35347]['review_after'] = '2027-01-01'
        changed = check.run_checks(self.reviews, self.baseline, lambda u: page(), '2026-11-23T13:00:00Z', now=check.instant('2026-11-23T13:00:00Z'))
        self.assertNotEqual(changed['records'][0]['status'], 'unchanged')

    def test_receipt_tampering_future_windows_duplicate_rows_and_dependency_changes_rejected(self):
        receipt = check.run_checks(self.reviews, self.baseline, lambda u: page(), '2026-11-23T13:00:00Z', now=check.instant('2026-11-23T13:00:00Z'))
        with tempfile.TemporaryDirectory() as folder:
            b, c = Path(folder)/'baseline.json', Path(folder)/'checks.json'
            b.write_text(json.dumps(self.baseline))
            variants = [copy.deepcopy(receipt) for _ in range(5)]
            variants[0]['baseline_sha256'] = '0' * 64
            variants[1]['records'][0]['valid_until'] = '2027-12-31'
            variants[2]['records'].append(copy.deepcopy(variants[2]['records'][0]))
            variants[3]['dependencies'][self.review['notice_review']['source_url']]['status'] = 'changed'
            variants[4]['records'][0]['page_sha256'] = '0' * 64
            with patch.object(check, 'BASELINES', b), patch.object(check, 'CHECKS', c), patch.object(check, 'PILOT', frozenset((35347,))):
                for value in variants:
                    check.load_checks.cache_clear()
                    c.write_text(json.dumps(value))
                    with self.assertRaises(ValueError): check.load_checks()
                check.load_checks.cache_clear()
                c.write_text(json.dumps(receipt))
                self.assertTrue(check.validation(self.review, date(2026, 11, 29)))

    def test_importer_uses_renewal_without_changing_original_observation_and_refuses_failure(self):
        from test_usfs_fee_reviews import row
        item = row(recareaid=35347)
        with patch.object(usfs, 'load_fee_reviews', return_value=self.reviews), patch.object(check, 'validation', return_value=True):
            feature = usfs.to_feature(item, '2026-11-29')['properties']
            self.assertEqual(feature['fee_status'], 'free')
            self.assertEqual(feature['fee_checked'], '2026-10-30')
        with patch.object(usfs, 'load_fee_reviews', return_value=self.reviews), patch.object(check, 'validation', return_value=False):
            self.assertIsNone(usfs.applicable_fee_review(item, '2026-11-01'))

    def test_all_ten_original_pilot_receipts_expire_on_nov29_without_new_confirmation(self):
        # Replay the actual original receipt through the full pin validator, with
        # no future check timestamps and no changes to today's source evidence.
        reviews = check.load_reviews()
        from test_usfs_fee_reviews import row
        with tempfile.TemporaryDirectory() as folder:
            receipt_path = Path(folder) / 'original-checks.json'
            receipt_path.write_text(json.dumps(ORIGINAL_PILOT_RECEIPT))
            with patch.object(check, 'CHECKS', receipt_path), patch.object(usfs, 'load_fee_reviews', return_value=reviews):
                check.load_checks.cache_clear()
                self.assertEqual(set(check.load_checks()), check.PILOT)
                for rid, record in reviews.items():
                    with self.subTest(recareaid=rid):
                        lng, lat = record['identity_coordinates']
                        item = row(recareaid=rid, recareaname=record['name'], longitude=lng, latitude=lat, _geometry={'x': lng, 'y': lat})
                        p = usfs.to_feature(item, '2026-11-28')['properties']
                        self.assertEqual(p['fee_status'], 'free')
                        self.assertEqual(p['fee_checked'], '2026-10-30')
                        evidence = next(e for e in p['fee_evidence_records'] if e.get('evidence_kind') == 'maintained_official_page_observation')
                        self.assertEqual(evidence['automated_check']['checked_at'], '2026-10-30T23:55:09Z')
                        self.assertEqual(evidence['retrieved_at'], '2026-10-30')
                        expired = usfs.to_feature(item, '2026-11-29')['properties']
                        self.assertEqual(expired['fee_status'], 'unknown')
                        self.assertFalse(any(e.get('evidence_kind', '').startswith('maintained_') for e in expired['fee_evidence_records']))
            check.load_checks.cache_clear()

    def test_current_changed_pilot_receipts_cannot_renew_old_free_observations(self):
        reviews = check.load_reviews()
        document = json.loads(check.CHECKS.read_text())
        imported_on = check.day(document['checked_at']).isoformat()
        current = check.load_checks()  # Validate today's actual receipt and its source pins.
        self.assertEqual(set(current), check.PILOT)
        from test_usfs_fee_reviews import row
        with patch.object(usfs, 'load_fee_reviews', return_value=reviews):
            for rid, record in reviews.items():
                with self.subTest(recareaid=rid, status=current[rid]['status']):
                    lng, lat = record['identity_coordinates']
                    item = row(recareaid=rid, recareaname=record['name'], longitude=lng, latitude=lat, _geometry={'x': lng, 'y': lat})
                    p = usfs.to_feature(item, imported_on)['properties']
                    maintained = [e for e in p['fee_evidence_records'] if e.get('evidence_kind') == 'maintained_official_page_observation']
                    if current[rid]['status'] == 'unchanged':
                        self.assertEqual(p['fee_status'], 'free')
                        self.assertEqual(p['fee_checked'], record['retrieved_at'])
                        self.assertEqual(maintained[0]['retrieved_at'], record['retrieved_at'])
                        self.assertEqual(maintained[0]['automated_check']['checked_at'], current[rid]['checked_at'])
                    else:
                        self.assertEqual(p['fee_status'], 'unknown')
                        self.assertEqual(maintained, [], 'changed, failed or expired checks cannot renew a free observation')

    def test_future_same_day_receipts_and_baselines_rejected_by_full_utc_instant(self):
        now = check.instant('2026-10-30T22:15:00Z')
        for checked_at in ['2026-10-30T23:59:59Z', '2026-10-30T11:59:59Z']:
            with self.assertRaises(ValueError):
                check.run_checks(self.reviews, self.baseline, lambda u: page(), checked_at, now=now)
        receipt = check.run_checks(self.reviews, self.baseline, lambda u: page(), '2026-10-30T22:00:00Z', now=now)
        with tempfile.TemporaryDirectory() as folder:
            b, c = Path(folder)/'baseline.json', Path(folder)/'checks.json'
            with patch.object(check, 'BASELINES', b), patch.object(check, 'CHECKS', c), patch.object(check, 'PILOT', frozenset((35347,))):
                bad_receipt = copy.deepcopy(receipt)
                bad_receipt['checked_at'] = bad_receipt['records'][0]['checked_at'] = '2026-10-30T23:59:59Z'
                b.write_text(json.dumps(self.baseline)); c.write_text(json.dumps(bad_receipt))
                with self.assertRaises(ValueError): check.load_checks(now=now)
                check.load_checks.cache_clear()
                later_baseline = copy.deepcopy(self.baseline)
                later_baseline['captured_at'] = '2026-10-30T22:01:00Z'
                receipt['baseline_sha256'] = check.digest(later_baseline)
                b.write_text(json.dumps(later_baseline)); c.write_text(json.dumps(receipt))
                with self.assertRaises(ValueError): check.load_checks(now=now)

    def test_unrelated_manual_reviews_do_not_expand_or_disable_automated_pilot(self):
        document = json.loads(check.REVIEWS.read_text())
        document['records'].append({**review(), 'recareaid': 999001})
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'reviews.json'; path.write_text(json.dumps(document))
            with patch.object(check, 'REVIEWS', path):
                self.assertEqual(set(check.load_reviews()), check.PILOT)
            document['records'].append(copy.deepcopy(document['records'][1]))
            path.write_text(json.dumps(document))
            with patch.object(check, 'REVIEWS', path), self.assertRaises(ValueError):
                check.load_reviews()

    def test_capture_default_destination_does_not_overwrite_receipts(self):
        with patch.object(check, 'load_reviews', return_value=self.reviews), patch.object(check, 'capture_baselines', return_value=self.baseline), patch.object(check, 'write') as writer:
            check.main(['--capture-baselines'])
            self.assertEqual(writer.call_args.args[0], check.BASELINES)
            self.assertNotEqual(writer.call_args.args[0], check.CHECKS)

    def test_parent_swap_during_atomic_publish_never_follows_attacker_symlink(self):
        with tempfile.TemporaryDirectory() as folder:
            parent, other = Path(folder)/'trusted', Path(folder)/'other'
            parent.mkdir(); other.mkdir()
            victim = other/'checks.json'; victim.write_text('keep')
            original_replace = check.os.replace
            def raced_replace(source, destination, **kwargs):
                parent.rename(Path(folder)/'moved')
                parent.symlink_to(other, target_is_directory=True)
                return original_replace(source, destination, **kwargs)
            with patch.object(check.os, 'replace', side_effect=raced_replace), self.assertRaises(ValueError):
                check.write(parent/'checks.json', {'safe': True})
            self.assertEqual(victim.read_text(), 'keep')
            self.assertEqual(json.loads((Path(folder)/'moved/checks.json').read_text()), {'safe': True})

    def test_official_network_origin_and_redirects_are_fixed(self):
        invalid = ['http://www.fs.usda.gov/r03/page', 'https://www.fs.usda.gov.evil.test/r03/page',
                   'https://name@www.fs.usda.gov/r03/page', 'https://www.fs.usda.gov:443/r03/page',
                   'https://www.fs.usda.gov/r03/page?redirect=elsewhere']
        for url in invalid:
            with self.assertRaises(ValueError): check.official_url(url)
        with self.assertRaises(ValueError): check.NoRedirect().redirect_request(None, None, None, None, None, None)

    def test_output_symlink_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder)/'target'; target.write_text('keep')
            link = Path(folder)/'link'; link.symlink_to(target)
            with self.assertRaises(ValueError): check.write(link, {})
            self.assertEqual(target.read_text(), 'keep')


if __name__ == '__main__':
    unittest.main()
