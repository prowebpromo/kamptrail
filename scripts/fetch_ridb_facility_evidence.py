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
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE_URL = 'https://ridb.recreation.gov/api/v1'
MAX_IDS = 100
PAGE = 50
# Raw facility fields kept verbatim. A missing key, null and blank stay distinguishable.
FACILITY_FIELDS = ('FacilityID', 'FacilityName', 'FacilityTypeDescription', 'LastUpdatedDate',
                   'Enabled', 'Reservable', 'FacilityLatitude', 'FacilityLongitude')
MISSING = {'missing': True}
MAX_REDIRECTS = 5
DEFAULT_PORTS = {'http': 80, 'https': 443}


class RedirectRefused(Exception):
    """A redirect that would leave the original origin or exceed the hop limit."""


def origin_of(url):
    parts = urllib.parse.urlsplit(url)
    scheme = (parts.scheme or '').lower()
    return (scheme, (parts.hostname or '').lower(), parts.port or DEFAULT_PORTS.get(scheme))


class SameOriginRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Follow only same-origin redirects, at most MAX_REDIRECTS. Any other redirect raises
    before a new request exists, so the apikey header is never sent anywhere else."""

    def __init__(self, origin):
        self.origin, self.hops = origin, 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urllib.parse.urljoin(req.full_url, newurl)
        if origin_of(target) != self.origin:
            raise RedirectRefused(f'Refused cross-origin redirect to {origin_of(target)[0]}://{origin_of(target)[1]}')
        self.hops += 1
        if self.hops > MAX_REDIRECTS:
            raise RedirectRefused(f'More than {MAX_REDIRECTS} redirects')
        return super().redirect_request(req, fp, code, msg, headers, target)


class HttpResponse:
    def __init__(self, status, body):
        self.status, self.body = status, body

    def raise_for_status(self):
        if self.status >= 400:
            raise RuntimeError(f'HTTP {self.status}')

    def json(self):
        return json.loads(self.body.decode('utf-8'))


def make_get(key, timeout=30):
    """Return get(url, params) that sends the apikey header with same-origin redirects only."""
    def get(url, params=None):
        if params:
            url = url + ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
        opener = urllib.request.build_opener(SameOriginRedirectHandler(origin_of(url)))
        request = urllib.request.Request(url, headers={'apikey': key, 'Accept': 'application/json'})
        try:
            with opener.open(request, timeout=timeout) as resp:
                return HttpResponse(resp.status, resp.read())
        except urllib.error.HTTPError as exc:
            return HttpResponse(exc.code, b'')
    return get


def same_id(a, b):
    return a is not None and b is not None and str(a).strip() == str(b).strip()


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


def split_campsites(rows, facility_id):
    """Separate campsites whose parent FacilityID equals the requested id from the rest."""
    accepted, reasons = [], {}
    for row in rows:
        parent = row.get('FacilityID') if isinstance(row, dict) else None
        if same_id(parent, facility_id):
            accepted.append(row)
        else:
            reason = ('campsite record has no FacilityID' if parent is None or not isinstance(row, dict)
                      else f'campsite parent FacilityID {str(parent).strip()!r} is not the requested id')
            reasons[reason] = reasons.get(reason, 0) + 1
    return accepted, reasons


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
             'api_path': f'/facilities/{facility_id}', 'decision': 'pending'}
    try:
        record = fetch_json(get, url, {'full': 'true'})
        if not isinstance(record, dict) or not record:
            entry['status'] = 'not_found'
            return entry
        if not same_id(record.get('FacilityID'), facility_id):
            entry['status'] = 'error'
            entry['error'] = (f"Identity mismatch: requested facility {facility_id} but the record's FacilityID is "
                              f"{record.get('FacilityID', 'missing')!r}")
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
        accepted, reasons = split_campsites(rows, facility_id)
        if reasons:
            # Foreign rows mean the response cannot be trusted as this facility's evidence.
            entry.pop('fields', None)
            entry['status'] = 'error'
            entry['campsites_rejected'] = {'count': sum(reasons.values()), 'reasons': dict(sorted(reasons.items())),
                                           'accepted_not_counted': len(accepted)}
            entry['error'] = f'Identity mismatch: {sum(reasons.values())} campsite records rejected'
            return entry
        entry['campsites'] = summarize_campsites(accepted)
        entry['campsites_rejected'] = {'count': 0, 'reasons': {}, 'accepted_not_counted': 0}
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
    result = run(ids, make_get(key), pause=1.2)
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
