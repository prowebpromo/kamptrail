#!/usr/bin/env python3
"""Promote only a complete, byte-verified 50-state service handoff; never fetch.

Run inside the serialized refresh writer. --check-only is also required after a
rebase, with --accepted-ref origin/main, before pushing a long-running result.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile

from import_services import ROOT, validate_source_update
from services_regions import URLS
from stage_services import digest, validate_checkpoint


def read(path):
    return json.loads(Path(path).read_bytes())


def preflight_outputs(root):
    """Refuse links, special files and interrupted staging before any write."""
    root = Path(root).absolute()
    if root != root.resolve() or not stat.S_ISDIR(root.lstat().st_mode):
        raise ValueError('Publication root must be a regular directory without symlink parents')
    paths = [('data', True), ('data/sources', True),
             ('data/sources/services', True), ('data/services', True),
             ('data/health.json', False)]
    for relative, directory in paths:
        path = root / relative
        try:
            mode = path.lstat().st_mode
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(mode) or not (stat.S_ISDIR(mode) if directory else stat.S_ISREG(mode)):
            raise ValueError('Symlink or nonregular publication output or parent')
    # Existing files are copied into the replacement tree, so inspect their
    # types without following a linked source file or immutable snapshot.
    for relative in ('data/sources/services', 'data/services'):
        for path in (root / relative).rglob('*'):
            mode = path.lstat().st_mode
            if not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                raise ValueError('Symlink or nonregular publication output')
    for relative in ('data/sources/services', 'data/services', 'data/health.json'):
        public = root / relative
        for suffix in ('.national-next', '.national-previous'):
            try:
                public.with_name(public.name + suffix).lstat()
            except FileNotFoundError:
                continue
            raise ValueError('Interrupted promotion or symlink requires inspection before retry')


def baseline(root, name, accepted_ref=None):
    if accepted_ref:
        result = subprocess.run(['git', 'show', f'{accepted_ref}:data/sources/services/{name}.json'], cwd=root, capture_output=True)
        if result.returncode:
            exists = subprocess.run(['git', 'cat-file', '-e', accepted_ref + '^{commit}'], cwd=root, capture_output=True)
            if exists.returncode:
                raise ValueError('Accepted reference is not an available commit')
            return None
        return json.loads(result.stdout)
    path = root / f'data/sources/services/{name}.json'
    return read(path) if path.exists() else None


def prepare(candidate, batch, root=ROOT, accepted_ref=None):
    """Copy first, validate exact copied bytes and rebuild without public writes."""
    root = Path(root).absolute()
    preflight_outputs(root)
    candidate = Path(candidate).resolve()
    if candidate.is_relative_to(root):
        raise ValueError('Candidate must remain outside checkout')
    if not re.fullmatch(r'[0-9]+-[a-f0-9]{40}', batch):
        raise ValueError('Batch must bind the producing run ID and source commit')
    temporary = tempfile.TemporaryDirectory(prefix='services-promotion-')
    try:
        work = Path(temporary.name)
        handoff = work / 'handoff'
        shutil.copytree(candidate, handoff, symlinks=True)
        if any(p.is_symlink() for p in handoff.rglob('*')):
            raise ValueError('Candidate cannot contain symbolic links')
        receipt = read(handoff / 'aggregate-receipt.json')
        if receipt.get('version') != 1 or receipt.get('batch') != batch or receipt.get('national_complete') is not True or receipt.get('regions') != sorted(URLS) or set(receipt.get('state_receipts', {})) != set(URLS):
            raise ValueError('Complete same-batch fifty-state proof is required')
        source_files = receipt.get('source_files', {})
        allowed = {f'sources/{r}.json' for r in URLS} | {'sources/legacy.json'}
        if not set(source_files).issubset(allowed) or not {f'sources/{r}.json' for r in URLS}.issubset(source_files):
            raise ValueError('Incomplete or unexpected handoff source set')
        accepted_legacy = baseline(root, 'legacy', accepted_ref)
        legacy_path = handoff / 'sources/legacy.json'
        if accepted_legacy is not None and (not legacy_path.is_file() or read(legacy_path) != accepted_legacy):
            raise ValueError('Current accepted legacy source must be retained unchanged')
        actual = {f'sources/{p.name}' for p in (handoff / 'sources').iterdir()}
        if actual != set(source_files):
            raise ValueError('Handoff source inventory differs from receipt')
        for name, sha in source_files.items():
            if not isinstance(sha, str) or not re.fullmatch('[a-f0-9]{64}', sha) or digest(handoff / name) != sha:
                raise ValueError('Handoff source hash mismatch')
            source = read(handoff / name)
            if source.get('region') != Path(name).stem:
                raise ValueError('Source filename/region binding mismatch')
            old = baseline(root, source['region'], accepted_ref)
            validate_source_update(source, old)
        for region in sorted(URLS):
            checkpoint = handoff / 'checkpoints' / region
            shutil.copyfile(handoff / f'sources/{region}.json', checkpoint / 'source.json')
            state_receipt = validate_checkpoint(checkpoint, region, batch)
            if state_receipt != receipt['state_receipts'][region]:
                raise ValueError('State receipt differs from aggregate proof')
        rebuilt = work / 'rebuilt'
        subprocess.run(['node', str(ROOT / 'scripts/build-services.js'), str(handoff / 'sources'), str(rebuilt)], check=True, timeout=300)
        manifest = read(rebuilt / 'index.json')
        if receipt.get('snapshot_id') != manifest['snapshot_id'] or receipt.get('manifest_sha256') != digest(rebuilt / 'index.json') or receipt.get('manifest_bytes') != (rebuilt / 'index.json').stat().st_size or receipt.get('total') != manifest['total'] or receipt.get('shards') != len(manifest['shards']):
            raise ValueError('Aggregate receipt differs from deterministic rebuild')
        # The builder enforces all five delivery caps; compare every served byte.
        for path in rebuilt.rglob('*'):
            if path.is_file():
                other = handoff / path.relative_to(rebuilt)
                if not other.is_file() or path.read_bytes() != other.read_bytes():
                    raise ValueError('Candidate delivery bytes differ from deterministic rebuild')
        states = {r: read(handoff / f'sources/{r}.json')['source'] for r in sorted(URLS)}
        summary = {'batch': batch, 'source_commit': batch.split('-', 1)[1], 'snapshot_id': manifest['snapshot_id'], 'states': states, 'identities': manifest['total'], 'shards': len(manifest['shards']), 'manifest_bytes': (rebuilt / 'index.json').stat().st_size}
        legacy = read(handoff / 'sources/legacy.json')['items'] if (handoff / 'sources/legacy.json').exists() else []
        selected = {row['id'] for p in (handoff / 'sources').glob('*.json') if p.stem in URLS for row in read(p)['items']}
        legacy_ids = {row['id'] for row in legacy}
        summary['oldest_extract'] = min(source['extract_timestamp'] for source in states.values())
        summary['newest_extract'] = max(source['extract_timestamp'] for source in states.values())
        summary['legacy_exact_identities'] = {'also_in_state_extracts': len(legacy_ids & selected), 'absent_from_complete_state_extracts': len(legacy_ids - selected), 'selected_legacy_rows': sum(c['count'] for c in manifest['coverage'] if c['region'] == 'legacy')}
        return temporary, handoff, summary
    except BaseException:
        temporary.cleanup()
        raise


def promote(candidate, batch, root=ROOT, check_only=False, accepted_ref=None):
    root = Path(root).absolute()
    temporary, handoff, summary = prepare(candidate, batch, root, accepted_ref)
    try:
        if check_only:
            return summary
        # Prepare both replacement directories, including immutable collision and
        # pruning checks, before moving either public last-good directory.
        replacements = Path(temporary.name) / 'publish'
        replacements.mkdir()
        for name in ('services', 'sources/services'):
            public = root / 'data' / name
            target = replacements / name
            if public.exists():
                shutil.copytree(public, target)
            else:
                target.mkdir(parents=True)
        sources = replacements / 'sources/services'
        for file in (handoff / 'sources').glob('*.json'):
            shutil.copyfile(file, sources / file.name)
        subprocess.run(['node', str(ROOT / 'scripts/build-services.js'), str(sources), str(replacements / 'services')], check=True, timeout=300)
        (replacements / 'services/national-receipt.json').write_text(json.dumps({'aggregate': read(handoff / 'aggregate-receipt.json'), 'promotion': summary}, indent=2) + '\n')
        publications = ['sources/services', 'services']
        # Prepare service freshness before any public rename, then include it in
        # the same rollback group. Keep campsite run counts separate.
        if (root / 'data/health.json').exists():
            health = replacements / 'health.json'
            shutil.copyfile(root / 'data/health.json', health)
            subprocess.run(['node', str(ROOT / 'scripts/record_health.js'), 'national-services', 'fresh', str(handoff / 'index.json')], env={**os.environ, 'KT_HEALTH_FILE': str(health)}, check=True, timeout=120)
            publications.append('health.json')
        # Same filesystem staging permits atomic path renames. Roll back every
        # replacement if a later move fails. No network calls occur here.
        def remove(path):
            if path.is_dir(): shutil.rmtree(path)
            elif path.exists(): path.unlink()
        preflight_outputs(root)
        moved = []
        staging = []
        try:
            for name in publications:
                public = root / 'data' / name
                staged = public.with_name(public.name + '.national-next')
                previous = public.with_name(public.name + '.national-previous')
                target = replacements / name
                # Register before copying: copytree/copyfile can leave partial output.
                staging.append(staged)
                if target.is_dir(): shutil.copytree(target, staged)
                else:
                    # Exclusive creation also refuses a staging link appearing
                    # after preflight instead of following it during copyfile.
                    with target.open('rb') as incoming, staged.open('xb') as output:
                        shutil.copyfileobj(incoming, output)
                if public.exists():
                    public.rename(previous)
                try:
                    staged.rename(public)
                except BaseException:
                    if previous.exists(): previous.rename(public)
                    raise
                moved.append((public, previous))
        except BaseException:
            for public, previous in reversed(moved):
                remove(public)
                if previous.exists(): previous.rename(public)
            for staged in staging: remove(staged)
            raise
        for public, previous in moved: remove(previous)
        return summary
    finally:
        temporary.cleanup()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--candidate', required=True, type=Path)
    p.add_argument('--batch', required=True)
    p.add_argument('--check-only', action='store_true')
    p.add_argument('--accepted-ref')
    p.add_argument('--summary', type=Path)
    args = p.parse_args()
    result = promote(args.candidate, args.batch, check_only=args.check_only, accepted_ref=args.accepted_ref)
    if args.summary:
        args.summary.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
