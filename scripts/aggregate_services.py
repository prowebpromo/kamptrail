#!/usr/bin/env python3
"""Validate a complete checkpoint set then atomically promote its manifest.

This only creates a candidate in an explicit external output directory. Publishing
or copying sources into the repository is a separate reviewed operation. National
coverage requires all 50 state checkpoints from the same batch, never tests alone.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from import_services import ROOT, validate_source_update
from services_regions import URLS
from stage_services import checked_regions, validate_checkpoint, digest


def aggregate(stage, destination, batch, regions=None):
    regions = checked_regions(regions if regions is not None else URLS)
    stage, destination = Path(stage).resolve(), Path(destination).resolve()
    if destination.is_relative_to(ROOT):
        raise ValueError('Candidate output must remain outside checkout until reviewed promotion')
    # No writes to destination before all source proof is validated.
    receipts = {r: validate_checkpoint(stage / r, r, batch) for r in regions}
    with tempfile.TemporaryDirectory(prefix='services-aggregate-') as temporary:
        sources = Path(temporary) / 'sources'
        sources.mkdir()
        # Retain existing unrefreshed state + legacy evidence in regional candidates.
        for path in (ROOT / 'data/sources/services').glob('*.json'):
            if path.stem == 'legacy' or path.stem in URLS:
                shutil.copyfile(path, sources / path.name)
        for region in regions:
            candidate = stage / region / 'source.json'
            accepted = sources / f'{region}.json'
            if accepted.exists():
                validate_source_update(json.loads(candidate.read_bytes()), json.loads(accepted.read_bytes()))
            shutil.copyfile(candidate, accepted)
        candidate = Path(temporary) / 'assets'
        subprocess.run(['node', str(ROOT / 'scripts/build-services.js'), str(sources), str(candidate)], check=True, timeout=300)
        manifest = json.loads((candidate / 'index.json').read_bytes())
        # Rebuild from the same validated sources into destination. Existing builder
        # checks immutable bytes before its atomic index rename and keeps old snapshots.
        subprocess.run(['node', str(ROOT / 'scripts/build-services.js'), str(sources), str(destination)], check=True, timeout=300)
        receipt = {'version': 1, 'batch': batch, 'regions': regions, 'national_complete': set(regions) == set(URLS), 'snapshot_id': manifest['snapshot_id'], 'total': manifest['total'], 'shards': len(manifest['shards']), 'manifest_bytes': (candidate / 'index.json').stat().st_size, 'manifest_sha256': digest(candidate / 'index.json'), 'state_receipts': receipts}
        (destination / 'aggregate-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        return receipt


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--stage', required=True, type=Path)
    p.add_argument('--destination', required=True, type=Path)
    p.add_argument('--batch', required=True)
    p.add_argument('--regions', help='Regional pilot only; omit to require the complete 50-state batch')
    a = p.parse_args()
    print(json.dumps(aggregate(a.stage, a.destination, a.batch, a.regions), indent=2))
