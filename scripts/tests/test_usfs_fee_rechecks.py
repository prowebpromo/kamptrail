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

    def test_all_ten_pilot_records_remain_eligible_on_nov29_after_real_nov23_confirmation(self):
        # Hypothetical future receipt tests the deadline, never edits today's evidence.
        reviews = check.load_reviews()
        actual = json.loads(check.CHECKS.read_text())
        rows = copy.deepcopy(actual['records'])
        for r in rows:
            r['checked_at'] = '2026-11-23T13:00:00Z'
            r['valid_until'] = '2026-12-23'
        from test_usfs_fee_reviews import row
        with patch.object(check, 'load_checks', return_value={r['recareaid']: r for r in rows}), patch.object(usfs, 'load_fee_reviews', return_value=reviews):
            for rid, record in reviews.items():
                lng, lat = record['identity_coordinates']
                item = row(recareaid=rid, recareaname=record['name'], longitude=lng, latitude=lat, _geometry={'x': lng, 'y': lat})
                p = usfs.to_feature(item, '2026-11-29')['properties']
                self.assertEqual(p['fee_status'], 'free', rid)
                self.assertEqual(p['fee_checked'], '2026-10-30', rid)
                evidence = next(e for e in p['fee_evidence_records'] if e.get('evidence_kind') == 'maintained_official_page_observation')
                self.assertEqual(evidence['automated_check']['checked_at'], '2026-11-23T13:00:00Z')
                self.assertEqual(evidence['retrieved_at'], '2026-10-30')

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
