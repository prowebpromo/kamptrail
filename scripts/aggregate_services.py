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
    with tempfile.TemporaryDirectory(prefix='services-aggregate-') as temporary:
        sources = Path(temporary) / 'sources'
        sources.mkdir()
        checkpoints = Path(temporary) / 'checkpoints'
        checkpoints.mkdir()
        receipts = {}
        # Retain existing unrefreshed state + legacy evidence in regional candidates.
        for path in (ROOT / 'data/sources/services').glob('*.json'):
            if path.stem == 'legacy' or path.stem in URLS:
                if json.loads(path.read_bytes()).get('region') != path.stem:
                    raise ValueError('Source filename/region binding mismatch')
                shutil.copyfile(path, sources / path.name)
        for region in regions:
            # Validate the exact copied bytes used by the build and handoff, so a
            # changing input checkpoint cannot diverge from its validated proof.
            checkpoint = checkpoints / region
            checkpoint.mkdir()
            for name in ('source.json', 'report.json', 'receipt.json'):
                shutil.copyfile(stage / region / name, checkpoint / name)
            receipts[region] = validate_checkpoint(checkpoint, region, batch)
            candidate = checkpoint / 'source.json'
            accepted = sources / f'{region}.json'
            if accepted.exists():
                validate_source_update(json.loads(candidate.read_bytes()), json.loads(accepted.read_bytes()))
            candidate.replace(accepted)
        candidate = Path(temporary) / 'assets'
        subprocess.run(['node', str(ROOT / 'scripts/build-services.js'), str(sources), str(candidate)], check=True, timeout=300)
        manifest = json.loads((candidate / 'index.json').read_bytes())
        # Rebuild from the same validated sources into destination. Existing builder
        # checks immutable bytes before its atomic index rename and keeps old snapshots.
        subprocess.run(['node', str(ROOT / 'scripts/build-services.js'), str(sources), str(destination)], check=True, timeout=300)
        # Include every builder input, including retained regional/legacy data.
        # State receipt hashes name source.json; its identical handoff bytes live
        # at sources/STATE.json, alongside checkpoints/STATE/{report,receipt}.json.
        for name, source in (('sources', sources), ('checkpoints', checkpoints)):
            target = destination / name
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(source, target)
        receipt = {'version': 1, 'batch': batch, 'regions': regions, 'national_complete': set(regions) == set(URLS), 'snapshot_id': manifest['snapshot_id'], 'total': manifest['total'], 'shards': len(manifest['shards']), 'manifest_bytes': (candidate / 'index.json').stat().st_size, 'manifest_sha256': digest(candidate / 'index.json'), 'source_files': {f'sources/{path.name}': digest(path) for path in sorted(sources.glob('*.json'))}, 'state_receipts': receipts}
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
