"""No network: promotion proof, current accepted baselines and last-good safety."""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from types import SimpleNamespace
import subprocess
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from aggregate_services import aggregate
from promote_services import promote
from services_regions import URLS
import test_national_services as fixtures

BATCH = '123-' + 'a' * 40


class ServicesPromotionTests(unittest.TestCase):
    def fixture(self, root):
        checkout = root / 'checkout'
        (checkout / 'data/sources/services').mkdir(parents=True)
        (checkout / 'scripts').symlink_to(SCRIPTS, target_is_directory=True)
        stage = root / 'stage'; stage.mkdir()
        helper = fixtures.NationalServicesTests()
        # Distinct OSM IDs make the all-state synthetic fixture explicit.
        from stage_services import digest
        for number, region in enumerate(sorted(URLS), 1):
            path = helper.checkpoint(stage, region, BATCH)
            source = json.loads((path / 'source.json').read_bytes())
            source['items'][0].update(id=f'osm:node:{number}', osm_id=str(number))
            (path / 'source.json').write_text(json.dumps(source))
            receipt = json.loads((path / 'receipt.json').read_bytes())
            receipt['hashes']['source.json'] = digest(path / 'source.json')
            (path / 'receipt.json').write_text(json.dumps(receipt))
        candidate = root / 'candidate'
        with patch('aggregate_services.ROOT', checkout):
            aggregate(stage, candidate, BATCH)
        (checkout / 'data/health.json').write_text(json.dumps({'version': 1, 'sources': {}, 'run': {'counts': {'fresh': 104}}}))
        public = checkout / 'data/services'; public.mkdir()
        (public / 'index.json').write_text('{"snapshot_id":"' + '0' * 24 + '"}')
        (public / 'last-good-marker').write_text('retained')
        return checkout, candidate

    def test_complete_handoff_promotes_exact_source_bytes_and_caps(self):
        with tempfile.TemporaryDirectory() as temporary:
            checkout, candidate = self.fixture(Path(temporary))
            before = (checkout / 'data/services/index.json').read_bytes()
            summary = promote(candidate, BATCH, checkout, check_only=True)
            self.assertEqual((checkout / 'data/services/index.json').read_bytes(), before)
            self.assertEqual(len(summary['states']), 50)
            self.assertEqual(summary['identities'], 50)
            promote(candidate, BATCH, checkout)
            self.assertEqual((checkout / 'data/services/index.json').read_bytes(), (candidate / 'index.json').read_bytes())
            for region in URLS:
                self.assertEqual((checkout / f'data/sources/services/{region}.json').read_bytes(), (candidate / f'sources/{region}.json').read_bytes())
            self.assertEqual((checkout / 'data/services/last-good-marker').read_text(), 'retained')
            self.assertFalse(list((checkout / 'data').rglob('*.national-previous')))
            health = json.loads((checkout / 'data/health.json').read_bytes())
            self.assertEqual(health['run']['counts'], {'fresh': 104})
            self.assertEqual(health['services_run']['counts'], {'fresh': 50})


    def test_rebased_current_main_source_date_is_rechecked(self):
        with tempfile.TemporaryDirectory() as temporary:
            checkout, candidate = self.fixture(Path(temporary))
            before = (checkout / 'data/services/index.json').read_bytes()
            real_run = subprocess.run
            def current_main(command, **kwargs):
                if command[:2] == ['git', 'cat-file']:
                    return SimpleNamespace(returncode=0, stdout=b'')
                if command[:2] == ['git', 'show']:
                    self.assertTrue(command[2].startswith('origin/main:data/sources/services/'))
                    region = Path(command[2]).stem
                    if region == 'legacy': return SimpleNamespace(returncode=1, stdout=b'')
                    accepted = json.loads((candidate / f'sources/{region}.json').read_bytes())
                    if region == 'RI': accepted['source']['extract_timestamp'] = '2025-02-01T00:00:00Z'
                    return SimpleNamespace(returncode=0, stdout=json.dumps(accepted).encode())
                return real_run(command, **kwargs)
            with patch('promote_services.subprocess.run', side_effect=current_main):
                with self.assertRaisesRegex(ValueError, 'date regression'):
                    promote(candidate, BATCH, checkout, check_only=True, accepted_ref='origin/main')
            self.assertEqual((checkout / 'data/services/index.json').read_bytes(), before)

    def test_second_directory_failure_rolls_back_both_last_good_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            checkout, candidate = self.fixture(Path(temporary))
            before = {p.relative_to(checkout): p.read_bytes() for p in (checkout / 'data').rglob('*') if p.is_file()}
            real_rename = Path.rename
            def fail_second(path, target):
                if path == checkout / 'data/services.national-next':
                    raise OSError('simulated second directory failure')
                return real_rename(path, target)
            with patch.object(Path, 'rename', fail_second):
                with self.assertRaisesRegex(OSError, 'second directory'):
                    promote(candidate, BATCH, checkout)
            after = {p.relative_to(checkout): p.read_bytes() for p in (checkout / 'data').rglob('*') if p.is_file() and '.national-next' not in str(p)}
            self.assertEqual(before, after)

    def test_partial_staging_copy_is_removed_and_all_public_bytes_restored(self):
        with tempfile.TemporaryDirectory() as temporary:
            checkout, candidate = self.fixture(Path(temporary))
            before = {p.relative_to(checkout): p.read_bytes() for p in (checkout / 'data').rglob('*') if p.is_file()}
            real_copytree = shutil.copytree
            def partial_copy(source, target, *args, **kwargs):
                if Path(target) == checkout / 'data/services.national-next':
                    Path(target).mkdir()
                    (Path(target) / 'partial').write_text('incomplete')
                    raise OSError('simulated partial copy')
                return real_copytree(source, target, *args, **kwargs)
            with patch('promote_services.shutil.copytree', side_effect=partial_copy):
                with self.assertRaisesRegex(OSError, 'partial copy'):
                    promote(candidate, BATCH, checkout)
            after = {p.relative_to(checkout): p.read_bytes() for p in (checkout / 'data').rglob('*') if p.is_file()}
            self.assertEqual(before, after)
            self.assertFalse(list((checkout / 'data').rglob('*.national-next')))
            self.assertFalse(list((checkout / 'data').rglob('*.national-previous')))

    def test_linked_outputs_and_parents_fail_before_writes_and_keep_last_good(self):
        def snapshot(directory):
            return {p.relative_to(directory): ('link', str(p.readlink())) if p.is_symlink()
                    else ('file', p.read_bytes()) if p.is_file() else ('directory', None)
                    for p in directory.rglob('*')}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            checkout, candidate = self.fixture(root)
            before = snapshot(checkout / 'data')
            paths = ('data/health.json.national-next', 'data/health.json.national-previous',
                     'data/services.national-next', 'data/services.national-previous',
                     'data/sources/services.national-next', 'data/sources/services.national-previous',
                     'data/health.json', 'data/services', 'data/services/index.json',
                     'data/sources/services', 'data/sources/services/UT.json', 'data/sources', 'data')
            for number, relative in enumerate(paths):
                for existing_target in (False, True):
                    with self.subTest(path=relative, existing_target=existing_target):
                        path = checkout / relative
                        original = root / 'held-output'
                        if path.exists():
                            path.rename(original)
                        external = root / f'external-{number}-{existing_target}'
                        if existing_target:
                            external.write_bytes(b'external bytes must stay unchanged')
                        path.symlink_to(external)
                        attacked = snapshot(checkout / 'data') if relative != 'data' else snapshot(checkout)
                        with patch('promote_services.tempfile.TemporaryDirectory', side_effect=AssertionError('preflight must precede scratch writes')):
                            with self.assertRaisesRegex(ValueError, 'symlink|Symlink'):
                                promote(candidate, BATCH, checkout)
                        self.assertTrue(path.is_symlink())
                        self.assertEqual(snapshot(checkout / 'data') if relative != 'data' else snapshot(checkout), attacked)
                        if existing_target:
                            self.assertEqual(external.read_bytes(), b'external bytes must stay unchanged')
                        else:
                            self.assertFalse(external.exists())
                        path.unlink()
                        if original.exists():
                            original.rename(path)
                        self.assertEqual(snapshot(checkout / 'data'), before)

    def test_late_dangling_staging_link_is_rechecked_before_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            checkout, candidate = self.fixture(root)
            before = {p.relative_to(checkout): p.read_bytes() for p in (checkout / 'data').rglob('*') if p.is_file()}
            external = root / 'external-health.json'
            staged = checkout / 'data/health.json.national-next'
            real_run = subprocess.run
            def add_late_link(command, **kwargs):
                result = real_run(command, **kwargs)
                if len(command) > 1 and Path(command[1]).name == 'record_health.js':
                    staged.symlink_to(external)
                return result
            with patch('promote_services.subprocess.run', side_effect=add_late_link):
                with self.assertRaisesRegex(ValueError, 'symlink'):
                    promote(candidate, BATCH, checkout)
            self.assertTrue(staged.is_symlink())
            self.assertFalse(external.exists())
            staged.unlink()
            after = {p.relative_to(checkout): p.read_bytes() for p in (checkout / 'data').rglob('*') if p.is_file()}
            self.assertEqual(after, before)

    def test_incomplete_mismatched_cap_failed_and_regressed_candidates_keep_public_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); checkout, candidate = self.fixture(root)
            before = {p.relative_to(checkout): p.read_bytes() for p in (checkout / 'data').rglob('*') if p.is_file()}
            for failure in ('missing_state', 'hash', 'delivery', 'batch', 'date', 'loss', 'cap', 'legacy_missing'):
                with self.subTest(failure=failure):
                    altered = root / failure; shutil.copytree(candidate, altered)
                    receipt = json.loads((altered / 'aggregate-receipt.json').read_bytes())
                    if failure == 'legacy_missing':
                        (checkout / 'data/sources/services/legacy.json').write_text('{}')
                    if failure == 'missing_state':
                        receipt['regions'].remove('RI')
                    elif failure == 'hash':
                        (altered / 'sources/RI.json').write_text('{}')
                    elif failure == 'delivery':
                        (altered / 'index.json').write_text('{}')
                    elif failure == 'batch':
                        receipt['batch'] = '999-' + 'a'*40
                    elif failure in ('date', 'loss'):
                        accepted = json.loads((candidate / 'sources/RI.json').read_bytes())
                        if failure == 'date': accepted['source']['extract_timestamp'] = '2025-02-01T00:00:00Z'
                        else: accepted['items'] *= 2
                        (checkout / 'data/sources/services/RI.json').write_text(json.dumps(accepted))
                    (altered / 'aggregate-receipt.json').write_text(json.dumps(receipt))
                    if failure == 'cap':
                        with patch('promote_services.subprocess.run', side_effect=ValueError('Manifest byte cap exceeded')):
                            with self.assertRaises(ValueError): promote(altered, BATCH, checkout)
                    else:
                        with self.assertRaises((ValueError, FileNotFoundError)):
                            promote(altered, BATCH, checkout)
                    (checkout / 'data/sources/services/RI.json').unlink(missing_ok=True)
                    (checkout / 'data/sources/services/legacy.json').unlink(missing_ok=True)
                    after = {p.relative_to(checkout): p.read_bytes() for p in (checkout / 'data').rglob('*') if p.is_file()}
                    self.assertEqual(before, after)


if __name__ == '__main__': unittest.main()
