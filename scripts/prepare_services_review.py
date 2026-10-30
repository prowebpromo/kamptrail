#!/usr/bin/env python3
"""Validate immutable national staging proof and create a review branch only.

No credentials or network API tokens are read here. The manual workflow supplies
native GitHub API metadata, ZIPs and actions/download-artifact output. Production
publication, PR creation, merge and deployment are deliberately separate.
"""
import argparse
from collections import Counter
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile

from aggregate_services import aggregate
from promote_services import promote
from import_services import CATEGORIES, categories, timestamp, validate_source_update
from services_regions import REGISTRY_PATH, URLS
from stage_services import digest, validate_checkpoint

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'prowebpromo/kamptrail'
REPOSITORY_ID = 967717280
REVIEWED_HEAD = '369efee3ed2f2b81ce867f269ff08bad523c039b'
# Exact reviewed blobs for source retries, strict aggregation and publication.
REVIEWED_OVERRIDES = {'scripts/import_services.py': '2225f7ed11f9fb6633ca887e6731ae31c65ab8ac',
                      'scripts/aggregate_services.py': '3feb517d846aa18ea17ff827e3fd520ef5bcabe2',
                      'scripts/promote_services.py': 'efde8bdf5597eae123a15c05235ad96ee6807ece'}
WORKFLOW_ID = 402051348
WORKFLOW_PATH = '.github/workflows/stage-national-services.yml'
REGISTRY_SHA256 = '7415f36abbd9fe35069ff9737e19a08058ae2419eac52cc7f9138acb0af06dee'
REVIEWED_FILES = ('scripts/build-services.js', 'scripts/import_services.py',
                  'scripts/stage_services.py', 'scripts/aggregate_services.py',
                  'scripts/services_regions.py', 'scripts/services-regions.json',
                  'scripts/promote_services.py')
MAX_ZIP_BYTES = 128 * 1024**2
MAX_ALL_ZIP_BYTES = 512 * 1024**2
MAX_EXTRACTED_BYTES = 1024**3
MAX_FILE_BYTES = 64 * 1024**2
MAX_MEMBERS = 5000


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integer(value, low=0, high=2**53 - 1):
    return type(value) is int and low <= value <= high


def run_id(value):
    require(isinstance(value, str) and re.fullmatch(r'[1-9][0-9]{0,15}', value)
            and int(value) <= 2**53 - 1, 'Expected a canonical positive workflow run ID')
    return value


def review_ref(value):
    return 'refs/heads/data/services-national-' + run_id(value)


def checked_json(path, limit=MAX_FILE_BYTES):
    path = Path(path)
    require(path.is_file() and not path.is_symlink() and 0 < path.stat().st_size <= limit,
            'Missing, symlinked or excessive JSON proof')
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(path.read_bytes(), object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON value')))


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + '\n').encode()


def validate_metadata(expected_id, run, listing):
    expected_id = run_id(expected_id)
    require(run.get('id') == int(expected_id) and run.get('name') == 'Stage dated state service extracts'
            and run.get('workflow_id') == WORKFLOW_ID and run.get('path') == WORKFLOW_PATH,
            'Staging run identity or workflow path mismatch')
    require(run.get('event') == 'workflow_dispatch' and run.get('status') == 'completed'
            and run.get('conclusion') == 'success', 'Only a successful completed manual staging run is accepted')
    require(run.get('head_sha') == REVIEWED_HEAD and run.get('head_branch') == 'main'
            and run.get('repository', {}).get('full_name') == REPOSITORY
            and run.get('repository', {}).get('id') == REPOSITORY_ID
            and run.get('head_repository', {}).get('full_name') == REPOSITORY
            and run.get('head_repository', {}).get('id') == REPOSITORY_ID,
            'Staging run is not from the exact reviewed head in this repository')
    require(integer(run.get('run_attempt'), 1, 100), 'Invalid staging run attempt')
    require(digest(REGISTRY_PATH) == REGISTRY_SHA256, 'Reviewed state registry hash changed')
    entries = listing.get('artifacts')
    require(isinstance(entries, list) and len(entries) == listing.get('total_count')
            and 51 <= len(entries) <= 100, 'Incomplete or unbounded artifact listing')
    candidate = f'services-complete-candidate-{expected_id}-{run["run_attempt"]}'
    expected = {f'services-state-{r}' for r in URLS} | {candidate}
    selected, seen_names, seen_ids = [], set(), set()
    total = 0
    for artifact in entries:
        name = artifact.get('name')
        require(isinstance(name, str) and name not in seen_names
                and integer(artifact.get('id'), 1) and artifact['id'] not in seen_ids,
                'Duplicate or invalid immutable artifact identity')
        seen_names.add(name); seen_ids.add(artifact['id'])
        historical = re.fullmatch(r'services-complete-candidate-' + expected_id + r'-([1-9][0-9]*)', name)
        require(name in expected or (historical and int(historical[1]) < run['run_attempt']),
                'Unexpected or cross-run artifact name')
        bound = artifact.get('workflow_run', {})
        require(bound.get('id') == int(expected_id) and bound.get('head_sha') == REVIEWED_HEAD
                and bound.get('repository_id') == REPOSITORY_ID
                and bound.get('head_repository_id') == REPOSITORY_ID and bound.get('head_branch') == 'main',
                'Artifact workflow/repository/head binding mismatch')
        if name not in expected:
            continue
        require(artifact.get('expired') is False and integer(artifact.get('size_in_bytes'), 1, MAX_ZIP_BYTES)
                and isinstance(artifact.get('digest'), str)
                and re.fullmatch(r'sha256:[a-f0-9]{64}', artifact['digest']),
                'Missing immutable ZIP digest, expired artifact or excessive ZIP size')
        total += artifact['size_in_bytes']
        selected.append(artifact)
    require({a['name'] for a in selected} == expected and len(selected) == 51
            and total <= MAX_ALL_ZIP_BYTES, 'All 50 states and the complete candidate are required within the ZIP budget')
    return {'version': 1, 'run_id': expected_id, 'run': run,
            'artifacts': sorted(selected, key=lambda a: a['name'])}


def load_plan(path):
    plan = checked_json(path, 2 * 1024**2)
    require(plan.get('version') == 1, 'Invalid review plan')
    checked = validate_metadata(plan.get('run_id'), plan.get('run', {}),
                                {'artifacts': plan.get('artifacts'), 'total_count': 51})
    require(checked == plan, 'Review plan changed after metadata validation')
    return plan


def external(path):
    path = Path(path).resolve()
    require(not path.is_relative_to(ROOT), 'Artifact scratch must stay outside checkout')
    return path


def member_allowed(artifact_name, name):
    region = artifact_name.removeprefix('services-state-')
    if region in URLS:
        return name in {f'{region}/source.json', f'{region}/report.json', f'{region}/receipt.json'}
    if name in {'index.json', 'services.json', 'aggregate-receipt.json'} or re.fullmatch(
            r'snapshots/[a-f0-9]{24}/(?:manifest|c_[a-z0-9_]+)\.json', name):
        return True
    source = re.fullmatch(r'sources/(legacy|[A-Z]{2})\.json', name)
    checkpoint = re.fullmatch(r'checkpoints/([A-Z]{2})/(?:report|receipt)\.json', name)
    return bool((source and (source[1] == 'legacy' or source[1] in URLS)) or (checkpoint and checkpoint[1] in URLS))


def check_zips(plan, archives, destination):
    """Hard digest/CRC checks precede safe extraction and any native action unzip."""
    archives, destination = external(archives), external(destination)
    require(not destination.exists(), 'Verified extraction directory already exists')
    require({p.name for p in archives.iterdir()} == {str(a['id']) + '.zip' for a in plan['artifacts']},
            'Missing or extra immutable ZIP')
    destination.parent.mkdir(parents=True, exist_ok=True)
    budget, proof = 0, {}
    with tempfile.TemporaryDirectory(prefix='services-zip-proof-', dir=destination.parent) as temporary:
        temporary = Path(temporary)
        for artifact in plan['artifacts']:
            archive_path = archives / (str(artifact['id']) + '.zip')
            require(archive_path.is_file() and not archive_path.is_symlink()
                    and archive_path.stat().st_size == artifact['size_in_bytes']
                    and 'sha256:' + digest(archive_path) == artifact['digest'], 'Immutable artifact ZIP digest/size mismatch')
            hashes, seen = {}, set()
            with zipfile.ZipFile(archive_path) as archive:
                members = archive.infolist()
                require(0 < len(members) <= MAX_MEMBERS, 'Artifact ZIP member bound exceeded')
                for info in members:
                    name = info.filename
                    require(name and '\\' not in name and '\x00' not in name
                            and not name.startswith('/') and all(p not in ('', '.', '..') for p in name.rstrip('/').split('/'))
                            and name not in seen, 'Unsafe or duplicate ZIP member path')
                    seen.add(name)
                    mode = stat.S_IFMT(info.external_attr >> 16)
                    require(mode in (0, stat.S_IFREG, stat.S_IFDIR) and not (info.flag_bits & 1)
                            and info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                            'Unsupported, encrypted or symlinked ZIP member')
                    if info.is_dir():
                        require(mode in (0, stat.S_IFDIR) and any(member_allowed(artifact['name'],
                                other.filename) and other.filename.startswith(name) for other in members), 'Unexpected ZIP directory')
                        continue
                    require(mode in (0, stat.S_IFREG) and member_allowed(artifact['name'], name)
                            and 0 < info.file_size <= MAX_FILE_BYTES, 'Unexpected or excessive artifact file')
                    budget += info.file_size
                    require(budget <= MAX_EXTRACTED_BYTES, 'Total artifact extraction budget exceeded')
                    target = temporary / artifact['name'] / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    h, size = hashlib.sha256(), 0
                    with archive.open(info) as incoming, target.open('xb') as output:
                        while chunk := incoming.read(65536):
                            size += len(chunk)
                            require(size <= info.file_size, 'ZIP member length mismatch')
                            h.update(chunk); output.write(chunk)
                    require(size == info.file_size, 'Truncated ZIP member')
                    hashes[name] = h.hexdigest()
            region = artifact['name'].removeprefix('services-state-')
            if region in URLS:
                require(set(hashes) == {f'{region}/{n}.json' for n in ('source', 'report', 'receipt')},
                        'State artifact does not contain its complete checkpoint')
            proof[artifact['name']] = {'id': artifact['id'], 'zip_sha256': artifact['digest'][7:], 'files': hashes}
        (temporary / 'zip-proof.json').write_bytes(json_bytes(proof))
        temporary.rename(destination)
    return proof


def file_hashes(directory):
    directory = Path(directory)
    require(directory.is_dir() and not directory.is_symlink(), 'Missing or symlinked artifact directory')
    result, total = {}, 0
    for path in directory.rglob('*'):
        require(not path.is_symlink(), 'Symlink in extracted artifact')
        if path.is_dir():
            continue
        require(path.is_file() and path.stat().st_size <= MAX_FILE_BYTES, 'Unsupported extracted artifact file')
        total += path.stat().st_size
        require(total <= MAX_EXTRACTED_BYTES and len(result) < MAX_MEMBERS, 'Extracted artifact budget exceeded')
        result[path.relative_to(directory).as_posix()] = digest(path)
    return result


def compare_downloads(plan, verified, downloaded):
    proof = checked_json(Path(verified) / 'zip-proof.json', 2 * 1024**2)
    require(set(proof) == {a['name'] for a in plan['artifacts']}
            and {p.name for p in Path(verified).iterdir()} == set(proof) | {'zip-proof.json'},
            'Verified ZIP proof has missing or unexpected artifacts')
    require({p.name for p in Path(downloaded).iterdir()} == {a['name'] for a in plan['artifacts']},
            'Native download did not return all and only the selected artifact IDs')
    for artifact in plan['artifacts']:
        recorded = proof.get(artifact['name'], {})
        require(recorded.get('id') == artifact['id'] and recorded.get('zip_sha256') == artifact['digest'][7:]
                and recorded.get('files') == file_hashes(Path(verified) / artifact['name'])
                and recorded['files'] == file_hashes(Path(downloaded) / artifact['name']),
                'Native artifact files differ from immutable ZIP proof')
    return proof


def command(args, cwd=None, timeout=120):
    result = subprocess.run(args, cwd=cwd or ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    require(result.returncode == 0, 'Reviewed command failed; inspect remote state before retrying')
    return result.stdout.decode().strip()


def git(*args, cwd=None):
    return command(['git', *args], cwd=cwd)


def verify_reviewed_code():
    for name in REVIEWED_FILES:
        approved = REVIEWED_OVERRIDES.get(name) or git('rev-parse', REVIEWED_HEAD + ':' + name)
        require(git('hash-object', name) == approved,
                'Reviewed national source/cap contract changed; a new review is required')


def validate_state_proof(directory, region, batch):
    receipt = validate_checkpoint(directory, region, batch)
    source, report = checked_json(directory / 'source.json'), checked_json(directory / 'report.json')
    require(report.get('region') == region and source['source']['categories'] == list(CATEGORIES), 'Incomplete state category coverage')
    rows, stats = source['items'], report['statistics']
    require(len({r['id'] for r in rows}) == len(rows)
            and all(categories(r['tags']) == r['categories'] for r in rows), 'Duplicate identities or nonpositive category evidence')
    counts = {c: sum(c in r['categories'] for r in rows) for c in CATEGORIES}
    require(report.get('counts') == counts, 'State category count mismatch')
    require(report.get('quarantine_reasons') == dict(Counter(q['reason'] for q in report['quarantine'])), 'State quarantine reason count mismatch')
    samples = {c: [{'id': r['id'], 'url': f'https://www.openstreetmap.org/{r["osm_type"]}/{r["osm_id"]}', 'tags': r['tags']}
                   for r in rows if c in r['categories']][:2] for c in CATEGORIES}
    require(report.get('samples') == samples, 'OSM-linked sample proof mismatch')
    def bounded_number(value, high, low=0):
        return type(value) in (int, float) and math.isfinite(value) and low <= value <= high
    require(stats.get('parse_address_limit_bytes') == 4 * 1024**3
            and stats.get('parse_disk_limit_bytes') == 12 * 1024**3
            and stats.get('parse_wall_limit_seconds') == 1800
            and bounded_number(stats.get('bounded_parse_seconds'), 1800)
            and bounded_number(stats.get('parse_seconds'), 1800)
            and bounded_number(stats.get('download_seconds'), 1800)
            and bounded_number(stats.get('sampled_peak_parse_disk_bytes'), 12 * 1024**3)
            and bounded_number(stats.get('peak_rss_kib'), 4 * 1024**2, 1)
            and bounded_number(receipt.get('runtime_seconds'), 75 * 60), 'Native source resource proof is missing or exceeds its reviewed budget')
    require(timestamp(receipt.get('finished_at')) >= timestamp(source['source']['retrieved_at']), 'Checkpoint finish predates source retrieval')
    for name in ('lifecycle_excluded', 'invalid_geometry', 'restricted_retained', 'conditional_access'):
        require(integer(stats.get(name), 0, 10**9), 'Invalid native source statistics')
    accepted = ROOT / f'data/sources/services/{region}.json'
    if accepted.exists() or accepted.is_symlink():
        validate_source_update(source, checked_json(accepted))
    return {'source': source['source'], 'canonical_sha256': digest(directory / 'source.json'),
            'report_sha256': digest(directory / 'report.json'), 'receipt_sha256': digest(directory / 'receipt.json'),
            'accepted': len(rows), 'category_counts': counts, 'quarantine_count': len(report['quarantine']),
            'quarantine_reasons': report['quarantine_reasons'], 'statistics': stats,
            'runtime_seconds': receipt['runtime_seconds'], 'finished_at': receipt['finished_at'], 'samples': samples}


def validate_complete_candidate(plan, downloaded, work):
    """Recheck all accepted baselines, then compare a complete ordinary rebuild."""
    batch = plan['run_id'] + '-' + REVIEWED_HEAD
    stage = work / 'stage'; stage.mkdir()
    states = {}
    for region in sorted(URLS):
        directory = Path(downloaded) / f'services-state-{region}' / region
        states[region] = validate_state_proof(directory, region, batch)
        shutil.copytree(directory, stage / region)
    artifact = next(a for a in plan['artifacts'] if a['name'].startswith('services-complete-candidate-'))
    original = Path(downloaded) / artifact['name']
    original_receipt = checked_json(original / 'aggregate-receipt.json')
    require(original_receipt.get('national_complete') is True and original_receipt.get('batch') == batch
            and original_receipt.get('regions') == sorted(URLS), 'Partial or cross-batch candidate cannot become national')
    rebuilt = work / 'rebuilt'
    receipt = aggregate(stage, rebuilt, batch)
    compare_aggregate(original, rebuilt, receipt)
    return states, receipt, rebuilt


def compare_aggregate(original, rebuilt, receipt):
    """Accept the reviewed legacy receipt or the approved additive source handoff."""
    original_receipt = checked_json(original / 'aggregate-receipt.json')
    core = {'version', 'batch', 'regions', 'national_complete', 'snapshot_id', 'total', 'shards',
            'manifest_bytes', 'manifest_sha256', 'state_receipts'}
    require(set(original_receipt) in (core, core | {'source_files'})
            and all(original_receipt.get(key) == receipt.get(key) for key in core),
            'Complete candidate receipt differs from the current-baseline rebuild')
    original_files, rebuilt_files = file_hashes(original), file_hashes(rebuilt)
    def delivery(files):
        return {name: value for name, value in files.items()
                if name != 'aggregate-receipt.json' and not name.startswith(('sources/', 'checkpoints/'))}
    require(delivery(original_files) == delivery(rebuilt_files), 'Complete candidate index/snapshot/shards differ from the cap-checked rebuild')
    if 'source_files' in original_receipt:
        require(original_receipt['source_files'] == receipt['source_files']
                and {k: v for k, v in original_files.items() if k != 'aggregate-receipt.json'}
                == {k: v for k, v in rebuilt_files.items() if k != 'aggregate-receipt.json'},
                'Auditable aggregate source/checkpoint handoff differs from the rebuild')
    else:
        require(not any(name.startswith(('sources/', 'checkpoints/')) for name in original_files),
                'Unbound source/checkpoint files in the original aggregate')


def remote_head(ref):
    require(ref == 'refs/heads/main' or re.fullmatch(r'refs/heads/data/services-national-[1-9][0-9]{0,15}', ref), 'Unapproved ref')
    result = git('ls-remote', '--refs', 'origin', ref)
    if not result:
        return None
    fields = result.split()
    require(len(fields) == 2 and fields[1] == ref and re.fullmatch('[a-f0-9]{40}', fields[0]), 'Unexpected remote ref response')
    return fields[0]


def preflight_outputs(expected_id):
    """Reject even dangling symlinks in every output or existing output ancestor."""
    run_id(expected_id)
    def checked(relative, directory=False):
        parts = PurePosixPath(relative).parts
        require(parts and not PurePosixPath(relative).is_absolute() and all(p not in ('', '.', '..') for p in parts), 'Unnormalized output path')
        current = ROOT
        for number, part in enumerate(parts):
            current = current / part
            try:
                mode = current.lstat().st_mode
            except FileNotFoundError:
                require(not directory, 'Required output directory is missing')
                break
            require(not stat.S_ISLNK(mode), 'Symlink in an intended output or parent directory')
            expected_directory = directory or number < len(parts) - 1
            require(stat.S_ISDIR(mode) if expected_directory else stat.S_ISREG(mode), 'Nonregular intended output or parent directory')
        require(current.resolve().is_relative_to(ROOT.resolve()), 'Output path resolves outside the checkout')
    for name in ('data/sources/services', 'data/services', 'data/services/snapshots', 'docs'):
        checked(name, directory=True)
    for region in [*sorted(URLS), 'legacy']:
        checked(f'data/sources/services/{region}.json')
    checked('data/health.json')
    require((ROOT / 'data/health.json').is_file(), 'Accepted health file is required for promotion')
    for suffix in ('json', 'md'):
        checked(f'docs/SERVICES_NATIONAL_{expected_id}.{suffix}')
    for directory, names, files in os.walk(ROOT / 'data/services', followlinks=False):
        for name in names:
            checked((Path(directory) / name).relative_to(ROOT).as_posix(), directory=True)
        for name in files:
            checked((Path(directory) / name).relative_to(ROOT).as_posix())


def finish_branch(expected_id, base, tree, proof_path):
    """Conditional creation only; existing identical bot output is a no-op."""
    ref = review_ref(expected_id)
    require(ref not in ('refs/heads/main', 'refs/heads/hostinger') and remote_head('refs/heads/main') == base,
            'Current main moved before review branch publication')
    message = f'Stage national service evidence from run {run_id(expected_id)}'
    previous = remote_head(ref)
    if previous:
        git('fetch', '--no-tags', 'origin', ref)
        require(git('rev-parse', 'FETCH_HEAD') == previous and git('rev-parse', previous + '^{tree}') == tree
                and git('rev-list', '--parents', '-n', '1', previous) == previous + ' ' + base
                and git('show', '-s', '--format=%B', previous) == message
                and git('show', previous + ':' + proof_path) == (ROOT / proof_path).read_text().strip()
                and remote_head(ref) == previous, 'Existing review branch changed; automatic overwrite refused')
        require(remote_head('refs/heads/main') == base, 'Existing review branch is not ready: main changed before no-op handoff')
        return {'branch': ref.removeprefix('refs/heads/'), 'commit': previous, 'status': 'unchanged'}
    commit = git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
                 'commit-tree', tree, '-p', base, '-m', message)
    require(re.fullmatch('[a-f0-9]{40}', commit), 'Invalid review commit')
    require(remote_head('refs/heads/main') == base, 'Main moved immediately before branch creation; no branch advanced')
    # An empty expected SHA is an atomic create-only lease. Even a racing branch
    # at main's ancestor is rejected; this never overwrites an existing ref.
    git('push', '--force-with-lease=' + ref + ':', 'origin', commit + ':' + ref)
    require(remote_head(ref) == commit, 'Published review branch changed during readback')
    require(remote_head('refs/heads/main') == base,
            'Review branch exists but main changed after creation: proposal is not ready; no branch overwritten or deleted')
    return {'branch': ref.removeprefix('refs/heads/'), 'commit': commit, 'status': 'created'}


def prepare(plan, verified, downloaded):
    verified, downloaded = external(verified), external(downloaded)
    compare_downloads(plan, verified, downloaded)
    preflight_outputs(plan['run_id'])
    require(not git('status', '--porcelain'), 'Review branch requires a clean checkout')
    base = git('rev-parse', 'HEAD')
    require(remote_head('refs/heads/main') == base, 'Checkout must start from current main')
    command(['git', 'merge-base', '--is-ancestor', REVIEWED_HEAD, base])
    verify_reviewed_code()
    legacy = ROOT / 'data/sources/services/legacy.json'
    require(legacy.is_file() and not legacy.is_symlink(), 'Missing or symlinked accepted legacy evidence')
    legacy_hash = digest(legacy)
    with tempfile.TemporaryDirectory(prefix='national-services-review-') as temporary:
        work = Path(temporary)
        states, receipt, rebuilt = validate_complete_candidate(plan, downloaded, work)
        summary = {'version': 1, 'run_id': plan['run_id'], 'reviewed_head': REVIEWED_HEAD,
                   'source_run_url': f'https://github.com/{REPOSITORY}/actions/runs/{plan["run_id"]}',
                   'source_workflow_path': WORKFLOW_PATH, 'source_event': 'workflow_dispatch',
                   'source_run_attempt': plan['run']['run_attempt'], 'base_main_sha': base,
                   'registry_sha256': REGISTRY_SHA256, 'national_complete': True,
                   'candidate': {k: v for k, v in receipt.items() if k != 'state_receipts'},
                   'artifact_proof': checked_json(verified / 'zip-proof.json', 2 * 1024**2),
                   'legacy_source_sha256': legacy_hash, 'states': states}
        proof_path = f'docs/SERVICES_NATIONAL_{plan["run_id"]}.json'
        markdown_path = f'docs/SERVICES_NATIONAL_{plan["run_id"]}.md'
        # All source, immutable ZIP, loss/freshness and full aggregate checks have
        # passed before any tracked source or browser asset is touched.
        preflight_outputs(plan['run_id'])
        # Stable ordering preserves the existing immutable generation policy.
        for directory in (ROOT / 'data/services/snapshots').iterdir():
            require(directory.is_dir() and not directory.is_symlink(), 'Unexpected service generation directory')
            manifest = checked_json(directory / 'manifest.json')
            stamp = dt.datetime.fromisoformat(timestamp(manifest['generated_at']).replace('Z', '+00:00')).timestamp()
            os.utime(directory, (stamp, stamp))
        promotion = promote(rebuilt, plan['run_id'] + '-' + REVIEWED_HEAD, root=ROOT, accepted_ref=base)
        require(digest(ROOT / 'data/services/index.json') == receipt['manifest_sha256']
                and digest(legacy) == legacy_hash, 'Promoted build differs or retained legacy source changed')
        summary['promotion'] = promotion
        generations = list((ROOT / 'data/services/snapshots').iterdir())
        require(len(generations) <= 3, 'Ordinary builder exceeded three-generation retention')
        summary['published_generations'] = sorted(p.name for p in generations)
        (ROOT / proof_path).write_bytes(json_bytes(summary))
        rows = [f'| {r} | {s["accepted"]:,} | {s["quarantine_count"]:,} | ' +
                ' / '.join(str(s['category_counts'][c]) for c in CATEGORIES) +
                f' | {s["statistics"]["bytes"]:,} | {s["runtime_seconds"]} | {s["statistics"]["peak_rss_kib"]:,} |'
                for r, s in sorted(states.items())]
        text = (f'# National service evidence from staging run {plan["run_id"]}\n\n'
                f'Review branch candidate only. Source: {summary["source_run_url"]}, exact reviewed head `{REVIEWED_HEAD}`. '
                'All 50 immutable state artifacts and their source/report/receipt hashes were checked against the same batch and registry. '
                'The complete aggregate was rebuilt with current accepted freshness/loss guards and unchanged delivery ceilings.\n\n'
                f'Measured candidate: {receipt["total"]:,} deduplicated service identities, {receipt["shards"]:,} shards, '
                f'{receipt["manifest_bytes"]:,} manifest bytes, snapshot `{receipt["snapshot_id"]}`. '
                'Canonical legacy evidence is retained byte-for-byte; complete state extracts own their states, so obsolete legacy rows do not resurrect. '
                'This is a data review branch, not a merge, deployment, permission guarantee or current-operation claim.\n\n'
                '| State | Accepted identities | Quarantined | Dump / water / LPG / showers / laundry / groceries / fuel | PBF bytes | Runtime seconds | Peak RSS KiB |\n'
                '| --- | ---: | ---: | --- | ---: | ---: | ---: |\n' + '\n'.join(rows) + '\n\n'
                f'Full source URLs/dates, category and quarantine counts, runtime/resource measurements, OSM-linked samples and immutable artifact/file hashes: '
                f'[{Path(proof_path).name}]({Path(proof_path).name}). Category totals overlap and source counts may differ from deduplicated database counts. '
                'Only normal PR checks and review may authorize a later merge and the existing Hostinger deployment path.\n')
        (ROOT / markdown_path).write_text(text)
        paths = [f'data/sources/services/{r}.json' for r in sorted(URLS)] + ['data/services', 'data/health.json', proof_path, markdown_path]
        git('add', '-A', '--', *paths)
        changed = git('diff', '--cached', '--name-only').splitlines()
        allowed_sources = set(paths[:50])
        require(changed and all(p in allowed_sources or p.startswith('data/services/') or p in ('data/health.json', proof_path, markdown_path)
                                for p in changed), 'Unexpected staged change outside the data review scope')
        return finish_branch(plan['run_id'], base, git('write-tree'), proof_path)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('plan'); p.add_argument('--run-id', required=True); p.add_argument('--metadata', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
    p = commands.add_parser('check-zips'); p.add_argument('--plan', type=Path, required=True); p.add_argument('--archives', type=Path, required=True); p.add_argument('--destination', type=Path, required=True)
    p = commands.add_parser('prepare'); p.add_argument('--plan', type=Path, required=True); p.add_argument('--verified', type=Path, required=True); p.add_argument('--downloaded', type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == 'plan':
        plan = validate_metadata(args.run_id, checked_json(args.metadata / 'run.json', 1024**2), checked_json(args.metadata / 'artifacts.json', 1024**2))
        args.output.write_bytes(json_bytes(plan))
        if output := os.environ.get('GITHUB_OUTPUT'):
            with open(output, 'a') as handle:
                handle.write('run_id=' + plan['run_id'] + '\nartifact_ids=' + ','.join(str(a['id']) for a in plan['artifacts']) + '\n')
        print('Validated successful reviewed run and all 51 immutable artifact identities')
    elif args.command == 'check-zips':
        check_zips(load_plan(args.plan), args.archives, args.destination)
        print('Immutable ZIP hashes, CRCs, member paths and extraction budgets verified')
    else:
        result = prepare(load_plan(args.plan), args.verified, args.downloaded)
        print(json.dumps(result))


if __name__ == '__main__':
    main()
