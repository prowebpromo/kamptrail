#!/usr/bin/env python3
"""Select only explicitly deferred transport failures for a fresh runner.

Every requested state must have either its complete validated checkpoint or its
bound importer-startup failure receipt. No missing or invalid proof is retryable.
The workflow permits three recovery rounds; aggregate still requires all proofs.
"""
import argparse
import json
import os
from pathlib import Path

from import_services import ROOT, TEMPORARY_DOWNLOAD_EXIT, timestamp, validate_source_update
from services_regions import REGISTRY_PATH
from stage_services import checked_regions, digest, validate_checkpoint

MAX_FAILURE_BYTES = 16 * 1024
FAILURE_FIELDS = {'version', 'region', 'batch', 'registry_sha256', 'failed_at',
                  'error', 'failure_kind', 'importer_exit', 'last_good_retained'}


def pending_states(stage, batch, regions):
    stage = Path(stage)
    regions = checked_regions(regions)
    allowed = set(regions) | {f'{region}-failure.json' for region in regions}
    if not stage.is_dir() or any(path.name not in allowed for path in stage.iterdir()):
        raise ValueError('Recovery stage is missing or contains unrequested proof')
    pending = []
    for region in regions:
        checkpoint = stage / region
        failure = stage / f'{region}-failure.json'
        if checkpoint.exists():
            if failure.exists():
                raise ValueError(f'{region}: conflicting completed and failed proof')
            validate_checkpoint(checkpoint, region, batch)
            accepted = ROOT / f'data/sources/services/{region}.json'
            if accepted.exists():
                validate_source_update(json.loads((checkpoint / 'source.json').read_bytes()), json.loads(accepted.read_bytes()))
            continue
        if not failure.is_file() or not 0 < failure.stat().st_size <= MAX_FAILURE_BYTES:
            raise ValueError(f'{region}: missing or excessive failure proof')
        receipt = json.loads(failure.read_bytes())
        if (set(receipt) != FAILURE_FIELDS or type(receipt['version']) is not int or receipt['version'] != 1
                or receipt['region'] != region or receipt['batch'] != batch
                or receipt['registry_sha256'] != digest(REGISTRY_PATH)
                or receipt['failure_kind'] != 'startup_transport'
                or type(receipt['importer_exit']) is not int or receipt['importer_exit'] != TEMPORARY_DOWNLOAD_EXIT
                or not isinstance(receipt['error'], str) or not receipt['error']
                or type(receipt['last_good_retained']) is not bool):
            raise ValueError(f'{region}: failure proof is not a bound startup transport failure')
        timestamp(receipt['failed_at'])
        pending.append(region)
    return pending


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', type=Path, required=True)
    parser.add_argument('--batch', required=True)
    parser.add_argument('--regions', required=True)
    args = parser.parse_args()
    pending = pending_states(args.stage, args.batch, args.regions)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('states=' + json.dumps(pending) + '\n')
            output.write('has_pending=' + str(bool(pending)).lower() + '\n')
    print(json.dumps({'pending_states': pending, 'completed': len(checked_regions(args.regions)) - len(pending)}))


if __name__ == '__main__':
    main()
