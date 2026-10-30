"""National review tooling refuses untrusted artifacts and protected ref writes."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import prepare_services_review as review
import aggregate_services
import stage_services
from services_regions import URLS


class ServicesReviewTests(unittest.TestCase):
    def test_publication_code_requires_its_exact_reviewed_blob(self):
        name = 'scripts/promote_services.py'
        self.assertIn(name, review.REVIEWED_FILES)
        content = (SCRIPTS / 'promote_services.py').read_bytes()
        def blob(data):
            return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        self.assertEqual(blob(content), review.REVIEWED_OVERRIDES[name])
        def revision(*arguments):
            if arguments[0] == 'hash-object':
                return blob(content) if arguments[1] == name else review.REVIEWED_OVERRIDES.get(arguments[1], 'a' * 40)
            return 'a' * 40
        with patch.object(review, 'git', side_effect=revision):
            review.verify_reviewed_code()
            content += b'\n# Unreviewed publication behavior change.\n'
            with self.assertRaisesRegex(ValueError, 'contract changed'):
                review.verify_reviewed_code()

    def metadata(self):
        identifier = '41098691497'
        run = {'id': int(identifier), 'name': 'Stage dated state service extracts', 'workflow_id': review.WORKFLOW_ID,
               'path': review.WORKFLOW_PATH, 'event': 'workflow_dispatch', 'status': 'completed', 'conclusion': 'success',
               'head_sha': review.REVIEWED_HEAD, 'head_branch': 'main', 'run_attempt': 1,
               'repository': {'full_name': review.REPOSITORY, 'id': review.REPOSITORY_ID},
               'head_repository': {'full_name': review.REPOSITORY, 'id': review.REPOSITORY_ID}}
        artifacts = []
        for number, name in enumerate([f'services-state-{r}' for r in sorted(URLS)] + [f'services-complete-candidate-{identifier}-1'], 1):
            artifacts.append({'id': number, 'name': name, 'size_in_bytes': 100, 'expired': False, 'digest': 'sha256:' + 'a' * 64,
                              'workflow_run': {'id': int(identifier), 'head_sha': review.REVIEWED_HEAD, 'head_branch': 'main',
                                               'repository_id': review.REPOSITORY_ID, 'head_repository_id': review.REPOSITORY_ID}})
        return identifier, run, {'total_count': len(artifacts), 'artifacts': artifacts}

    def test_only_exact_successful_manual_this_repository_run_and_fifty_states(self):
        identifier, run, listing = self.metadata()
        plan = review.validate_metadata(identifier, run, listing)
        self.assertEqual(len(plan['artifacts']), 51)
        for value in ['', '01', '-1', '1;echo x', '../main', '9007199254740992']:
            with self.assertRaises(ValueError): review.run_id(value)
        changes = [{'event': 'schedule'}, {'status': 'in_progress'}, {'conclusion': 'failure'}, {'head_sha': 'f' * 40},
                   {'head_branch': 'other'}, {'path': '.github/workflows/other.yml'}, {'workflow_id': 1},
                   {'head_repository': {'full_name': 'fork/kamptrail', 'id': 1}}, {'id': 1}]
        for values in changes:
            with self.subTest(values=values), self.assertRaises(ValueError):
                review.validate_metadata(identifier, {**run, **values}, listing)
        for mutate in [lambda d: d['artifacts'].pop(), lambda d: d['artifacts'][0].update(expired=True),
                       lambda d: d['artifacts'][0].update(digest=None), lambda d: d['artifacts'][0].update(id=d['artifacts'][1]['id']),
                       lambda d: d['artifacts'][0]['workflow_run'].update(id=1),
                       lambda d: d['artifacts'][0]['workflow_run'].update(head_repository_id=1),
                       lambda d: d['artifacts'][0].update(name='services-state-DC'),
                       lambda d: d['artifacts'][0].update(size_in_bytes=review.MAX_ZIP_BYTES + 1)]:
            bad = copy.deepcopy(listing); mutate(bad)
            with self.assertRaises(ValueError): review.validate_metadata(identifier, run, bad)

    def test_historical_candidate_never_replaces_current_attempt_identity(self):
        identifier, run, listing = self.metadata(); run['run_attempt'] = 2
        current = copy.deepcopy(listing['artifacts'][-1]); current.update(id=52, name=f'services-complete-candidate-{identifier}-2')
        listing['artifacts'].append(current); listing['total_count'] += 1
        plan = review.validate_metadata(identifier, run, listing)
        self.assertEqual(len(plan['artifacts']), 51)
        self.assertIn(current, plan['artifacts']); self.assertNotIn(listing['artifacts'][-2], plan['artifacts'])
        listing['artifacts'].pop(); listing['total_count'] -= 1
        with self.assertRaises(ValueError): review.validate_metadata(identifier, run, listing)

    def archives(self, directory, corrupt=None):
        identifier, run, listing = self.metadata()
        directory.mkdir()
        for artifact in listing['artifacts']:
            region = artifact['name'].removeprefix('services-state-')
            with zipfile.ZipFile(directory / (str(artifact['id']) + '.zip'), 'w', zipfile.ZIP_DEFLATED) as archive:
                names = [f'{region}/{n}.json' for n in ('source', 'report', 'receipt')] if region in URLS else ['index.json']
                for name in names:
                    archive.writestr(name, '{}')
                if corrupt and artifact['name'] == 'services-state-AK':
                    corrupt(archive)
            path = directory / (str(artifact['id']) + '.zip')
            artifact.update(size_in_bytes=path.stat().st_size, digest='sha256:' + review.digest(path))
        return review.validate_metadata(identifier, run, listing)

    def test_immutable_zip_proof_and_native_extraction_must_match_all_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); archives = root / 'zips'; plan = self.archives(archives)
            destination = root / 'verified'; proof = review.check_zips(plan, archives, destination)
            native = root / 'native'; shutil.copytree(destination, native); (native / 'zip-proof.json').unlink()
            self.assertEqual(review.compare_downloads(plan, destination, native), proof)
            (native / 'services-state-AK/AK/source.json').write_text('{"changed":true}')
            with self.assertRaisesRegex(ValueError, 'differ'): review.compare_downloads(plan, destination, native)
            (archives / '1.zip').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'digest'): review.check_zips(plan, archives, root / 'rejected')
            self.assertFalse((root / 'rejected').exists())

    def test_zip_traversal_symlink_duplicate_and_extra_members_are_rejected(self):
        def symlink(archive):
            info = zipfile.ZipInfo('AK/link.json'); info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, '/private/config')
        cases = [lambda a: a.writestr('../escape.json', '{}'), symlink,
                 lambda a: a.writestr('AK/source.json', '{}'), lambda a: a.writestr('AK/unexpected.json', '{}')]
        for corrupt in cases:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); plan = self.archives(root / 'zips', corrupt)
                with self.assertRaises(ValueError): review.check_zips(plan, root / 'zips', root / 'verified')
                self.assertFalse((root / 'escape.json').exists()); self.assertFalse((root / 'verified').exists())

    def test_extraction_budget_is_enforced_before_native_download(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); plan = self.archives(root / 'zips')
            with patch.object(review, 'MAX_EXTRACTED_BYTES', 5), self.assertRaisesRegex(ValueError, 'budget'):
                review.check_zips(plan, root / 'zips', root / 'verified')

    def test_current_accepted_freshness_loss_guards_are_mandatory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); state = root / 'RI'; state.mkdir()
            source = {'source': {'categories': list(review.CATEGORIES), 'retrieved_at': '2025-01-02T00:00:00Z', 'extract_timestamp': '2025-01-01T00:00:00Z'},
                      'items': [{'id': 'osm:node:1', 'osm_type': 'node', 'osm_id': '1', 'tags': {'amenity': 'fuel'}, 'categories': ['fuel']}]}
            stats = {'parse_address_limit_bytes': 4 * 1024**3, 'parse_disk_limit_bytes': 12 * 1024**3, 'parse_wall_limit_seconds': 1800,
                     'bounded_parse_seconds': 1, 'parse_seconds': 1, 'download_seconds': 1, 'sampled_peak_parse_disk_bytes': 100,
                     'peak_rss_kib': 100, 'lifecycle_excluded': 0, 'invalid_geometry': 0, 'restricted_retained': 0, 'conditional_access': 0}
            samples = {c: [{'id': 'osm:node:1', 'url': 'https://www.openstreetmap.org/node/1', 'tags': {'amenity': 'fuel'}}] if c == 'fuel' else [] for c in review.CATEGORIES}
            report = {'region': 'RI', 'statistics': stats, 'counts': {c: int(c == 'fuel') for c in review.CATEGORIES}, 'quarantine': [], 'quarantine_reasons': {}, 'samples': samples}
            (state / 'source.json').write_bytes(review.json_bytes(source)); (state / 'report.json').write_bytes(review.json_bytes(report)); (state / 'receipt.json').write_text('{}')
            accepted = root / 'data/sources/services/RI.json'; accepted.parent.mkdir(parents=True)
            prior = copy.deepcopy(source); prior['source']['extract_timestamp'] = '2025-02-01T00:00:00Z'; accepted.write_bytes(review.json_bytes(prior))
            receipt = {'runtime_seconds': 2, 'finished_at': '2025-01-02T00:00:02Z'}
            before = accepted.read_bytes()
            with patch.object(review, 'ROOT', root), patch.object(review, 'validate_checkpoint', return_value=receipt):
                with self.assertRaisesRegex(ValueError, 'date regression'): review.validate_state_proof(state, 'RI', 'batch')
                prior['source']['extract_timestamp'] = '2024-01-01T00:00:00Z'; prior['items'] *= 10; accepted.write_bytes(review.json_bytes(prior))
                with self.assertRaisesRegex(ValueError, 'shrink'): review.validate_state_proof(state, 'RI', 'batch')
            self.assertEqual(before, review.json_bytes({**source, 'source': {**source['source'], 'extract_timestamp': '2025-02-01T00:00:00Z'}}))

    def test_partial_or_cross_batch_aggregate_is_never_rebuilt_or_published(self):
        identifier, run, listing = self.metadata(); plan = review.validate_metadata(identifier, run, listing)
        for partial in [False, True]:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); downloads = root / 'downloads'; work = root / 'work'; work.mkdir()
                for region in URLS:
                    p = downloads / f'services-state-{region}' / region; p.mkdir(parents=True); (p / 'source.json').write_text('{}')
                candidate = downloads / f'services-complete-candidate-{identifier}-1'; candidate.mkdir()
                receipt = {'national_complete': partial, 'regions': sorted(URLS), 'batch': 'other'}
                (candidate / 'aggregate-receipt.json').write_bytes(review.json_bytes(receipt))
                with patch.object(review, 'validate_state_proof', return_value={}), patch.object(review, 'aggregate') as aggregate:
                    with self.assertRaisesRegex(ValueError, 'Partial or cross-batch'):
                        review.validate_complete_candidate(plan, downloads, work)
                    aggregate.assert_not_called()

    def test_complete_synthetic_batch_rebuilds_exactly_and_changed_candidate_fails(self):
        # Synthetic orchestration fixtures establish no real imported coverage.
        identifier, run, listing = self.metadata(); plan = review.validate_metadata(identifier, run, listing)
        batch = identifier + '-' + review.REVIEWED_HEAD
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); checkout = root / 'checkout'; checkout.mkdir()
            (checkout / 'scripts').symlink_to(SCRIPTS, target_is_directory=True)
            sources = checkout / 'data/sources/services'; sources.mkdir(parents=True)
            legacy = {'version': 2, 'region': 'legacy', 'source': {'kind': 'legacy', 'url': 'https://www.openstreetmap.org',
                      'extract_timestamp': None, 'retrieved_at': None, 'sha256': 'b' * 64, 'license': 'ODbL-1.0', 'categories': ['dump', 'water', 'lpg']},
                      'items': [{'id': 'osm:node:999', 'osm_type': 'node', 'osm_id': '999', 'osm_version': None, 'edited_at': None,
                                 'coordinates': [-110, 40], 'name': 'Legacy fixture', 'categories': ['dump'], 'tags': {},
                                 'states': ['UT'], 'source_region': 'legacy', 'retrieved_at': '2024-01-01T00:00:00Z'}]}
            (sources / 'legacy.json').write_bytes(review.json_bytes(legacy)); legacy_bytes = (sources / 'legacy.json').read_bytes()
            downloads = root / 'downloads'; stage = root / 'stage'; stage.mkdir()
            for number, region in enumerate(sorted(URLS), 1):
                directory = downloads / f'services-state-{region}' / region; directory.mkdir(parents=True)
                row = {'id': f'osm:node:{number}', 'osm_type': 'node', 'osm_id': str(number), 'osm_version': 1,
                       'edited_at': '2025-01-01T00:00:00Z', 'coordinates': [-100 + number / 100, 40],
                       'name': 'Synthetic service fixture', 'categories': ['fuel'], 'tags': {'amenity': 'fuel'},
                       'states': [region], 'source_region': region}
                source = {'version': 2, 'region': region, 'source': {'kind': 'geofabrik', 'url': URLS[region],
                          'extract_timestamp': '2025-01-01T00:00:00Z', 'retrieved_at': '2025-02-01T00:00:00Z',
                          'sha256': 'a' * 64, 'license': 'ODbL-1.0', 'categories': list(review.CATEGORIES)}, 'items': [row]}
                stats = {'accepted': 1, 'parser_version': '4.3.2', 'sha256': 'a' * 64, 'url': URLS[region],
                         'resolved_url': URLS[region].replace('latest', '250101'), 'retrieved_at': source['source']['retrieved_at'],
                         'bytes': 100, 'quarantined': 0, 'parse_address_limit_bytes': 4 * 1024**3,
                         'parse_disk_limit_bytes': 12 * 1024**3, 'parse_wall_limit_seconds': 1800,
                         'bounded_parse_seconds': 1, 'parse_seconds': 1, 'download_seconds': 1,
                         'sampled_peak_parse_disk_bytes': 100, 'peak_rss_kib': 100, 'lifecycle_excluded': 0,
                         'invalid_geometry': 0, 'restricted_retained': 0, 'conditional_access': 0}
                report = {'region': region, 'source': source['source'], 'statistics': stats,
                          'counts': {c: int(c == 'fuel') for c in review.CATEGORIES}, 'quarantine': [], 'quarantine_reasons': {},
                          'samples': {c: [{'id': row['id'], 'url': f'https://www.openstreetmap.org/node/{number}', 'tags': row['tags']}] if c == 'fuel' else [] for c in review.CATEGORIES}}
                (directory / 'source.json').write_bytes(review.json_bytes(source)); (directory / 'report.json').write_bytes(review.json_bytes(report))
                receipt = {'version': 1, 'region': region, 'batch': batch, 'registry_sha256': review.REGISTRY_SHA256, 'accepted': 1,
                           'finished_at': '2025-02-01T00:00:02Z', 'runtime_seconds': 2,
                           'hashes': {name: review.digest(directory / name) for name in ('source.json', 'report.json')}}
                (directory / 'receipt.json').write_bytes(review.json_bytes(receipt)); shutil.copytree(directory, stage / region)
            candidate = downloads / f'services-complete-candidate-{identifier}-1'
            with patch.object(review, 'ROOT', checkout), patch.object(aggregate_services, 'ROOT', checkout), patch.object(stage_services, 'ROOT', checkout):
                aggregate_services.aggregate(stage, candidate, batch)
                work = root / 'work'; work.mkdir()
                states, receipt, rebuilt = review.validate_complete_candidate(plan, downloads, work)
                self.assertEqual(len(states), 50); self.assertTrue(receipt['national_complete']); self.assertEqual(receipt['total'], 50)
                self.assertEqual((sources / 'legacy.json').read_bytes(), legacy_bytes)
                self.assertEqual(json.loads((rebuilt / 'index.json').read_bytes())['coverage'][0]['region'], 'AK')
                # PR99's additive source/checkpoint handoff is bound to its exact
                # files; the actual reviewed 369 run used the older receipt shape.
                handoff = candidate / 'sources/RI.json'; saved = handoff.read_bytes(); handoff.write_text('{"changed":true}')
                with self.assertRaisesRegex(ValueError, 'handoff differs'): review.compare_aggregate(candidate, rebuilt, receipt)
                handoff.write_bytes(saved)
                original_receipt = json.loads((candidate / 'aggregate-receipt.json').read_bytes())
                original_receipt.pop('source_files')
                (candidate / 'aggregate-receipt.json').write_bytes(review.json_bytes(original_receipt))
                shutil.rmtree(candidate / 'sources'); shutil.rmtree(candidate / 'checkpoints')
                review.compare_aggregate(candidate, rebuilt, receipt)
                (candidate / 'index.json').write_text('{"corrupt":true}')
                next_work = root / 'next-work'; next_work.mkdir()
                with self.assertRaisesRegex(ValueError, 'index/snapshot/shards'):
                    review.validate_complete_candidate(plan, downloads, next_work)
                self.assertEqual((sources / 'legacy.json').read_bytes(), legacy_bytes)

    def test_preparation_uses_transactional_promoter_and_stages_health(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'checkout'; root.mkdir(); self.output_fixture(root)
            verified = Path(temporary) / 'verified'; verified.mkdir()
            (verified / 'zip-proof.json').write_text('{}')
            downloaded = Path(temporary) / 'downloaded'; downloaded.mkdir()
            candidate = Path(temporary) / 'candidate'; candidate.mkdir()
            base = 'a' * 40
            index_hash = review.digest(root / 'data/services/index.json')
            receipt = {'total': 50, 'shards': 1, 'manifest_bytes': 10, 'snapshot_id': 'b' * 24, 'manifest_sha256': index_hash}
            states = {r: {'source': {}, 'accepted': 1, 'quarantine_count': 0,
                          'category_counts': {c: 0 for c in review.CATEGORIES},
                          'statistics': {'bytes': 1, 'peak_rss_kib': 1}, 'runtime_seconds': 1} for r in URLS}
            plan = {'run_id': '41', 'run': {'run_attempt': 2}}
            staged = []
            def git(*args, **kwargs):
                if args == ('status', '--porcelain'): return ''
                if args == ('rev-parse', 'HEAD'): return base
                if args[:2] == ('diff', '--cached'): return 'data/health.json'
                if args == ('write-tree',): return 'c' * 40
                if args[0] == 'add': staged.extend(args)
                return ''
            def promote(candidate_arg, batch, root, accepted_ref):
                self.assertEqual(candidate_arg, candidate)
                self.assertEqual(batch, '41-' + review.REVIEWED_HEAD)
                self.assertEqual(accepted_ref, base)
                (root / 'data/health.json').write_text('{"services_run":{"coverage_states":50}}')
                return {'snapshot_id': receipt['snapshot_id']}
            with patch.object(review, 'ROOT', root), patch.object(review, 'compare_downloads'), \
                 patch.object(review, 'remote_head', return_value=base), patch.object(review, 'git', side_effect=git), \
                 patch.object(review, 'command'), patch.object(review, 'verify_reviewed_code'), \
                 patch.object(review, 'validate_complete_candidate', return_value=(states, receipt, candidate)), \
                 patch.object(review, 'promote', side_effect=promote) as called, \
                 patch.object(review, 'finish_branch', return_value={'status': 'created'}):
                self.assertEqual(review.prepare(plan, verified, downloaded), {'status': 'created'})
                called.assert_called_once()
            self.assertIn('data/health.json', staged)
            self.assertEqual(json.loads((root / 'data/health.json').read_text())['services_run']['coverage_states'], 50)

    def test_branch_create_uses_atomic_absent_ref_lease_and_never_protected_ref(self):
        base, tree, commit = 'a' * 40, 'b' * 40, 'c' * 40
        with patch.object(review, 'remote_head', side_effect=[base, None, base, commit, base]), patch.object(review, 'git') as git:
            git.side_effect = lambda *args, **kw: commit if 'commit-tree' in args else ''
            result = review.finish_branch('41', base, tree, 'docs/proof.json')
            self.assertEqual(result['status'], 'created')
            pushes = [call.args for call in git.call_args_list if call.args[0] == 'push']
            self.assertEqual(pushes, [('push', '--force-with-lease=refs/heads/data/services-national-41:', 'origin', commit + ':refs/heads/data/services-national-41')])
            self.assertFalse(any(':refs/heads/main' in str(call.args) or ':refs/heads/hostinger' in str(call.args) for call in git.call_args_list))
        with patch.object(review, 'remote_head', return_value='f' * 40), patch.object(review, 'git') as git:
            with self.assertRaisesRegex(ValueError, 'main moved'): review.finish_branch('41', base, tree, 'docs/proof.json')
            git.assert_not_called()

    def test_existing_changed_branch_and_branch_creation_race_refuse_writes(self):
        base, tree, previous = 'a' * 40, 'b' * 40, 'd' * 40
        with patch.object(review, 'remote_head', side_effect=[base, previous]), patch.object(review, 'git') as git:
            git.side_effect = lambda *args, **kw: previous if args == ('rev-parse', 'FETCH_HEAD') else 'changed-tree'
            with self.assertRaisesRegex(ValueError, 'overwrite refused'): review.finish_branch('41', base, tree, 'docs/proof.json')
            self.assertFalse(any(call.args[0] == 'push' for call in git.call_args_list))
        with patch.object(review, 'remote_head', side_effect=[base, None, base]), patch.object(review, 'git') as git:
            def race(*args, **kwargs):
                if args[0] == 'push': raise ValueError('Lease rejected because another branch was created')
                return 'c' * 40
            git.side_effect = race
            with self.assertRaisesRegex(ValueError, 'Lease rejected'): review.finish_branch('41', base, tree, 'docs/proof.json')

    def test_existing_exact_review_branch_is_idempotent_without_a_push(self):
        base, tree, previous = 'a' * 40, 'b' * 40, 'd' * 40
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'docs').mkdir(); (root / 'docs/proof.json').write_text('{"verified":true}\n')
            def git(*args, **kwargs):
                return {('fetch', '--no-tags', 'origin', 'refs/heads/data/services-national-41'): '',
                        ('rev-parse', 'FETCH_HEAD'): previous, ('rev-parse', previous + '^{tree}'): tree,
                        ('rev-list', '--parents', '-n', '1', previous): previous + ' ' + base,
                        ('show', '-s', '--format=%B', previous): 'Stage national service evidence from run 41',
                        ('show', previous + ':docs/proof.json'): '{"verified":true}'}[args]
            with patch.object(review, 'ROOT', root), patch.object(review, 'remote_head', side_effect=[base, previous, previous, base]), patch.object(review, 'git', side_effect=git) as commands:
                result = review.finish_branch('41', base, tree, 'docs/proof.json')
                self.assertEqual(result['status'], 'unchanged'); self.assertEqual(result['commit'], previous)
                self.assertFalse(any(c.args[0] == 'push' for c in commands.call_args_list))

    def output_fixture(self, root):
        for name in ('data/sources/services', 'data/services/snapshots', 'docs'):
            (root / name).mkdir(parents=True)
        (root / 'data/services/index.json').write_text('{}')
        (root / 'data/health.json').write_text('{}')
        (root / 'data/sources/services/legacy.json').write_text('{}')

    def test_all_output_roots_files_and_parents_reject_even_dangling_symlinks(self):
        cases = [('data/sources/services/RI.json', False), ('data/sources/services/legacy.json', False),
                 ('docs/SERVICES_NATIONAL_41.json', False), ('docs/SERVICES_NATIONAL_41.md', False),
                 ('data/services/index.json', False), ('data/health.json', False), ('data/services/snapshots', True),
                 ('data/services', True), ('data/sources', True), ('docs', True)]
        for relative, directory in cases:
            with self.subTest(path=relative), tempfile.TemporaryDirectory() as temporary:
                parent = Path(temporary); root = parent / 'checkout'; root.mkdir(); self.output_fixture(root)
                outside = parent / 'outside'; outside.mkdir(); sentinel = outside / 'sentinel.json'; sentinel.write_bytes(b'untouched')
                target = root / relative
                if target.is_dir(): shutil.rmtree(target)
                else: target.unlink(missing_ok=True)
                target.symlink_to(outside if directory else outside / 'does-not-exist.json', target_is_directory=directory)
                self.assertTrue(target.is_symlink())
                if not directory:
                    self.assertFalse(target.exists())
                with patch.object(review, 'ROOT', root), patch.object(review, 'compare_downloads'), patch.object(review, 'git') as git:
                    with self.assertRaisesRegex(ValueError, 'Symlink'):
                        review.prepare({'run_id': '41'}, parent / 'verified', parent / 'downloaded')
                    git.assert_not_called()
                self.assertEqual(sentinel.read_bytes(), b'untouched')
                self.assertFalse((outside / 'does-not-exist.json').exists())
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); self.output_fixture(root)
            with patch.object(review, 'ROOT', root): review.preflight_outputs('41')

    def test_main_change_before_push_or_after_push_never_reports_ready(self):
        base, tree, commit, moved = 'a' * 40, 'b' * 40, 'c' * 40, 'f' * 40
        for heads, expected_pushes, message in [([base, None, moved], 0, 'immediately before'),
                                                ([base, None, base, commit, moved], 1, 'not ready')]:
            with patch.object(review, 'remote_head', side_effect=heads), patch.object(review, 'git') as git:
                git.side_effect = lambda *args, **kwargs: commit if 'commit-tree' in args else ''
                with self.assertRaisesRegex(ValueError, message): review.finish_branch('41', base, tree, 'docs/proof.json')
                self.assertEqual(sum(c.args[0] == 'push' for c in git.call_args_list), expected_pushes)
                self.assertFalse(any('--delete' in c.args or c.args[0] in ('reset', 'update-ref') for c in git.call_args_list))


if __name__ == '__main__':
    unittest.main()
