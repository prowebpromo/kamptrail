#!/usr/bin/env python3
"""Serial resumable public extract staging. Never promotes browser assets.

A completed receipt commits source + report hashes; failed attempts leave the
previous checkpoint intact. Aggregate separately only after every requested state
has validated source proof. Cache and stage roots must be outside the checkout.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

from import_services import ROOT, utc_now, validate_source_update
from services_regions import URLS, REGISTRY_PATH, validate_resolved_url

MAX_SOURCE_BYTES = 512 * 1024**2


def digest(path):
    with Path(path).open('rb') as raw:
        return hashlib.file_digest(raw, 'sha256').hexdigest()


def checked_regions(values):
    regions = values.split() if isinstance(values, str) else list(values)
    if not regions or len(set(regions)) != len(regions) or any(r not in URLS for r in regions):
        raise ValueError('Expected unique Census state codes from the official registry')
    return sorted(regions)


def validate_checkpoint(directory, region, batch):
    directory = Path(directory)
    receipt = json.loads((directory / 'receipt.json').read_bytes())
    if receipt.get('version') != 1 or receipt.get('region') != region or receipt.get('batch') != batch or receipt.get('registry_sha256') != digest(REGISTRY_PATH):
        raise ValueError('Checkpoint batch/region/registry binding mismatch')
    for name in ('source.json', 'report.json'):
        p = directory / name
        if not p.is_file() or p.stat().st_size > MAX_SOURCE_BYTES or digest(p) != receipt.get('hashes', {}).get(name):
            raise ValueError('Checkpoint missing, excessive or hash-mismatched asset')
    source = json.loads((directory / 'source.json').read_bytes())
    report = json.loads((directory / 'report.json').read_bytes())
    if source['region'] != region or source['source']['url'] != URLS[region] or source['source'] != report['source'] or len(source['items']) != receipt['accepted'] or report['statistics']['accepted'] != receipt['accepted']:
        raise ValueError('Checkpoint source/report/count binding mismatch')
    statistics = report['statistics']
    if statistics.get('parser_version') != '4.3.2' or statistics.get('sha256') != source['source']['sha256'] or statistics.get('url') != URLS[region] or statistics.get('retrieved_at') != source['source']['retrieved_at'] or not 0 < statistics.get('bytes', 0) <= 2 * 1024**3:
        raise ValueError('Checkpoint lacks native download/parser provenance')
    dated = validate_resolved_url(region, statistics.get('resolved_url', ''))
    if dated and dated.isoformat() != source['source']['extract_timestamp'][:10]:
        raise ValueError('Checkpoint extract date differs from resolved URL date')
    if statistics.get('quarantined') != len(report.get('quarantine', [])):
        raise ValueError('Checkpoint quarantine count mismatch')
    # Reuse the browser producer's full schema and provenance validation.
    subprocess.run(['node', '-e', "require('./scripts/build-services.js').validateSource(JSON.parse(require('fs').readFileSync(process.argv[1])))", str(directory / 'source.json')], cwd=ROOT, check=True, timeout=120)
    return receipt


def run_import(command):
    """Give the importer time to terminate its isolated parser before hard kill."""
    process = subprocess.Popen(command)
    old_handlers = {}
    def interrupted(signum, frame):
        raise SystemExit(128 + signum)
    for sig in (signal.SIGTERM, signal.SIGINT):
        old_handlers[sig] = signal.signal(sig, interrupted)
    try:
        returncode = process.wait(timeout=62 * 60)
        if returncode:
            raise subprocess.CalledProcessError(returncode, command)
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)


def stage_one(region, stage, scratch, batch, resume=True, reuse_download=False):
    stage, scratch = Path(stage).resolve(), Path(scratch).resolve()
    if stage.is_relative_to(ROOT) or scratch.is_relative_to(ROOT):
        raise ValueError('Staging and raw cache must remain outside checkout')
    stage.mkdir(parents=True, exist_ok=True)
    scratch.mkdir(parents=True, exist_ok=True)
    destination = stage / region
    previous = stage / f'.{region}-previous'
    # Recover a process interruption between the two checkpoint renames.
    if previous.exists():
        validate_checkpoint(previous, region, batch)
        if destination.exists():
            validate_checkpoint(destination, region, batch)
            shutil.rmtree(previous)
        else:
            previous.rename(destination)
    if destination.exists() and resume:
        validate_checkpoint(destination, region, batch)
        accepted = ROOT / f'data/sources/services/{region}.json'
        if accepted.exists():
            validate_source_update(json.loads((destination / 'source.json').read_bytes()), json.loads(accepted.read_bytes()))
        return 'resumed'
    started = time.monotonic()
    try:
        with tempfile.TemporaryDirectory(prefix=f'.{region}-', dir=stage) as temporary:
            temporary = Path(temporary)
            output = temporary / 'sources'
            output.mkdir()
            # Both baselines remain binding: a stale checkpoint cannot weaken the
            # accepted source's date/loss guard, or a newer smaller accepted source
            # weaken the checkpoint's applicable loss guard.
            accepted = ROOT / f'data/sources/services/{region}.json'
            checkpoint_source = destination / 'source.json'
            if checkpoint_source.exists():
                validate_checkpoint(destination, region, batch)
            baselines = [path for path in (accepted, checkpoint_source) if path.exists()]
            if baselines:
                shutil.copyfile(baselines[0], output / f'{region}.json')
            command = [sys.executable, str(ROOT / 'scripts/import_services.py'), '--region', region, '--scratch', str(scratch), '--output-dir', str(output)]
            if reuse_download:
                command.append('--reuse-download')
            run_import(command)
            candidate = json.loads((output / f'{region}.json').read_bytes())
            for baseline in baselines:
                validate_source_update(candidate, json.loads(baseline.read_bytes()))
            shutil.move(output / f'{region}.json', temporary / 'source.json')
            shutil.copyfile(scratch / f'{region}-report.json', temporary / 'report.json')
            receipt = {'version': 1, 'region': region, 'batch': batch, 'registry_sha256': digest(REGISTRY_PATH), 'finished_at': utc_now(), 'runtime_seconds': round(time.monotonic() - started, 3), 'accepted': len(json.loads((temporary / 'source.json').read_bytes())['items']), 'hashes': {name: digest(temporary / name) for name in ('source.json', 'report.json')}}
            (temporary / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
            shutil.rmtree(output)
            validate_checkpoint(temporary, region, batch)
            # First successful checkpoint is a single rename. Refresh replacement
            # retains the old checkpoint until replacement is completely validated.
            previous = stage / f'.{region}-previous'
            if previous.exists():
                raise ValueError('Interrupted checkpoint replacement requires recovery')
            if destination.exists():
                destination.rename(previous)
            try:
                temporary.rename(destination)
            except BaseException:
                if previous.exists():
                    previous.rename(destination)
                raise
            if previous.exists():
                shutil.rmtree(previous)
        (stage / f'{region}-failure.json').unlink(missing_ok=True)
        return 'staged'
    except BaseException as exc:
        (stage / f'{region}-failure.json').write_text(json.dumps({'region': region, 'batch': batch, 'failed_at': utc_now(), 'error': str(exc), 'last_good_retained': destination.exists() or (ROOT / f'data/sources/services/{region}.json').is_file()}, indent=2) + '\n')
        raise


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--regions', required=True, help='Explicit space-separated state codes; serial within this process')
    p.add_argument('--batch', required=True, help='Stable run identity for resume and aggregation')
    p.add_argument('--stage', required=True, type=Path)
    p.add_argument('--scratch', required=True, type=Path)
    p.add_argument('--refresh', action='store_true')
    p.add_argument('--reuse-download', action='store_true')
    args = p.parse_args()
    for region in checked_regions(args.regions):
        print(region, stage_one(region, args.stage, args.scratch, args.batch, not args.refresh, args.reuse_download), flush=True)


if __name__ == '__main__':
    main()
