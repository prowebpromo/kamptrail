#!/usr/bin/env python3
"""Fetch review evidence for named Recreation.gov facilities. Read-only.

Writes one JSON file with each facility's own RIDB record fields (raw, unchanged) and a
summary of its own campsite records. It never writes published data, never refreshes a
state, and never stores the API key.

Usage:
    RIDB_API_KEY=... python3 scripts/fetch_ridb_facility_evidence.py --ids "233178 255232" --out evidence.json
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

BASE_URL = 'https://ridb.recreation.gov/api/v1'
MAX_IDS = 100
PAGE = 50
# Raw facility fields kept verbatim. A missing key, null and blank stay distinguishable.
FACILITY_FIELDS = ('FacilityID', 'FacilityName', 'FacilityTypeDescription', 'LastUpdatedDate',
                   'Enabled', 'Reservable', 'FacilityLatitude', 'FacilityLongitude')
MISSING = {'missing': True}


def parse_ids(text):
    """Return unique facility ids in input order. Reject anything that is not 1-10 digits."""
    ids = []
    for token in re.split(r'[\s,]+', (text or '').strip()):
        if not token:
            continue
        if not re.fullmatch(r'[0-9]{1,10}', token):
            raise ValueError(f'Invalid facility id: {token!r}')
        if token not in ids:
            ids.append(token)
    if not ids:
        raise ValueError('No facility ids given')
    if len(ids) > MAX_IDS:
        raise ValueError(f'At most {MAX_IDS} facility ids per run')
    return ids


def raw_fields(record):
    return {k: (record[k] if k in record else MISSING) for k in FACILITY_FIELDS}


def summarize_campsites(rows):
    """Count the facility's own campsite records by TypeOfUse and CampsiteType."""
    by_use, by_type = {}, {}
    for row in rows:
        use = row.get('TypeOfUse') if isinstance(row, dict) else None
        kind = row.get('CampsiteType') if isinstance(row, dict) else None
        by_use[str(use)] = by_use.get(str(use), 0) + 1
        by_type[str(kind)] = by_type.get(str(kind), 0) + 1
    return {'total': len(rows), 'overnight': by_use.get('Overnight', 0),
            'by_type_of_use': dict(sorted(by_use.items())), 'by_campsite_type': dict(sorted(by_type.items()))}


def fetch_json(get, url, params):
    response = get(url, params=params)
    response.raise_for_status()
    return response.json()


def fetch_facility(get, facility_id, pause=0.0):
    """Return one facility's evidence entry. Errors are recorded, never raised."""
    url = f'{BASE_URL}/facilities/{facility_id}'
    entry = {'facility_id': facility_id, 'source_url': f'https://www.recreation.gov/camping/campgrounds/{facility_id}',
             'api_path': f'/facilities/{facility_id}'}
    try:
        record = fetch_json(get, url, {'full': 'true'})
        if not isinstance(record, dict) or not record:
            entry['status'] = 'not_found'
            return entry
        entry['fields'] = raw_fields(record)
        rows, offset = [], 0
        while True:
            time.sleep(pause)
            page = fetch_json(get, f'{url}/campsites', {'limit': PAGE, 'offset': offset})
            batch = page.get('RECDATA') if isinstance(page, dict) else None
            if not isinstance(batch, list):
                raise ValueError('Invalid campsite response')
            rows.extend(batch)
            if len(batch) < PAGE:
                break
            offset += PAGE
        entry['campsites'] = summarize_campsites(rows)
        entry['status'] = 'ok'
    except Exception as exc:  # recorded per facility so one failure never hides the others
        entry['status'] = 'error'
        entry['error'] = type(exc).__name__ + ': ' + str(exc)[:200]
    return entry


def run(ids, get, now=None, pause=0.0):
    retrieved = (now or datetime.now(timezone.utc)).strftime('%Y-%m-%dT%H:%M:%SZ')
    facilities = {}
    for facility_id in ids:
        facilities[facility_id] = fetch_facility(get, facility_id, pause)
        facilities[facility_id]['retrieved_at'] = retrieved
    return {'version': 1, 'kind': 'review evidence, not published data', 'source': 'Recreation.gov RIDB API v1',
            'retrieved_at': retrieved, 'requested': ids, 'facilities': facilities}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--ids', required=True, help='Facility ids separated by spaces or commas (at most 100)')
    parser.add_argument('--out', required=True, help='Output JSON path')
    args = parser.parse_args(argv)
    ids = parse_ids(args.ids)
    key = os.environ.get('RIDB_API_KEY', '')
    if not key:
        print('Set RIDB_API_KEY', file=sys.stderr)
        return 2
    import requests
    session = requests.Session()
    session.headers['apikey'] = key

    def get(url, params):
        return session.get(url, params=params, timeout=30)

    result = run(ids, get, pause=1.2)
    text = json.dumps(result, indent=2, sort_keys=True)
    if key in text:
        raise RuntimeError('API key must never appear in the output')
    with open(args.out, 'w', encoding='utf-8') as handle:
        handle.write(text + '\n')
    counts = {}
    for entry in result['facilities'].values():
        counts[entry['status']] = counts.get(entry['status'], 0) + 1
    print(f'Fetched {len(ids)} facilities: {counts}')
    return 0 if counts.get('ok') else 1


if __name__ == '__main__':
    sys.exit(main())
