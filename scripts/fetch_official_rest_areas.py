#!/usr/bin/env python3
"""Import official state rest-area locations published by the managing agency.

Each region is fetched only from one exact, reviewed agency endpoint. A location never carries
permission: overnight parking, sleeping and camping stay unknown here. The separately reviewed
state policy for the same operator and facility class is applied at display time.

Texas keeps its own importer (fetch_rest_areas.py). This module covers the other reviewed scopes
and writes data/rest-areas/<ST>.json plus the region manifest data/rest-areas/index.json.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/rest-areas'
LIMIT = 5_000_000
UA = 'KampTrail rest-area importer (+https://github.com/prowebpromo/kamptrail)'

# Exact reviewed scopes. The operator and facility_kind must match a reviewed policy scope in
# data/rest-areas/state-policies.json. min/max bound the expected record count so a changed or
# truncated source keeps the prior catalogue.
REGIONS = {
    'ID': {
        'operator': 'itd', 'facility_kind': 'safety_rest_area',
        'publisher': 'Idaho Transportation Department',
        'layer': 'https://gisp.itd.idaho.gov/server/rest/services/GDWarehouse/Assets/FeatureServer/5',
        'info_url': 'https://itd.idaho.gov/faqs/rest-areas/',
        'id_field': 'GlobalID', 'name_field': 'FacilityName',
        'location_fields': [('CommonRoadName', ''), ('CountyName', ' County')], 'milepost_field': None,
        'updated_field': 'ServiceLastUpdatedUTC', 'where': '1=1', 'min': 20, 'max': 60,
        'bbox': (-117.3, 41.9, -111.0, 49.1),
    },
}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def clean(value, limit):
    text = re.sub(r'\s+', ' ', str(value or '')).strip()
    if len(text.encode()) > limit:
        raise ValueError('Official field exceeds bound')
    return text


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError('Official source redirected; review before changing the allowlist')


def query_url(cfg):
    params = {'where': cfg['where'], 'outFields': '*', 'outSR': '4326', 'returnGeometry': 'true',
              'orderByFields': 'OBJECTID', 'f': 'json'}
    return cfg['layer'] + '/query?' + urllib.parse.urlencode(params)


def fetch(url, allowed):
    if url not in allowed:
        raise ValueError('Unapproved official source')
    request = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=90) as response:
        raw = response.read(LIMIT + 1)
    if not raw or len(raw) > LIMIT:
        raise ValueError('Official response empty or too large')
    return raw


def epoch_iso(value):
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    when = dt.datetime.fromtimestamp(value / 1000, dt.timezone.utc)
    if not dt.datetime(1990, 1, 1, tzinfo=dt.timezone.utc) <= when <= dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1):
        return None
    return when.isoformat(timespec='seconds').replace('+00:00', 'Z')


def parse(region, cfg, raw, boundaries=None):
    data = json.loads(raw.decode('utf-8'))
    if data.get('error') or data.get('exceededTransferLimit') or not isinstance(data.get('features'), list):
        raise ValueError('Incomplete or invalid official response')
    features = data['features']
    if not cfg['min'] <= len(features) <= cfg['max']:
        raise ValueError(f'{region}: unexpected official count {len(features)}; prior catalogue retained')
    records, rejected, seen = [], [], set()
    west, south, east, north = cfg['bbox']
    for feature in features:
        attrs, geom = feature.get('attributes') or {}, feature.get('geometry') or {}
        native = str(attrs.get(cfg['id_field']) or '').strip().strip('{}').lower()
        name = clean(attrs.get(cfg['name_field']), 200)
        if not re.fullmatch(r'[a-z0-9-]{1,64}', native) or not name:
            rejected.append({'reason': 'missing_identity_or_name', 'name': name or None})
            continue
        try:
            lng, lat = float(geom['x']), float(geom['y'])
        except (KeyError, TypeError, ValueError):
            rejected.append({'reason': 'missing_geometry', 'name': name})
            continue
        if not (west <= lng <= east and south <= lat <= north):
            rejected.append({'reason': 'outside_state_bounds', 'name': name, 'coordinates': [lng, lat]})
            continue
        identity = f"{cfg['operator']}:{native}"
        if identity in seen:
            raise ValueError('Duplicate official identity')
        seen.add(identity)
        location = ', '.join(v + suffix for v, suffix in ((clean(attrs.get(f), 200), sfx) for f, sfx in cfg['location_fields']) if v)
        milepost = clean(attrs.get(cfg['milepost_field']), 60) if cfg.get('milepost_field') else ''
        records.append({'id': identity, 'name': name, 'coordinates': [round(lng, 6), round(lat, 6)],
                        'location': location, 'milepost': milepost or None, 'source_url': cfg['info_url'],
                        'state': region, 'permission': 'unknown',
                        'source_updated_at': epoch_iso(attrs.get(cfg['updated_field'])) if cfg.get('updated_field') else None})
    if boundaries is not None:
        assignments = boundaries.classify_many([r['coordinates'] for r in records])
        kept = []
        for r in records:
            match = assignments.get(tuple(r['coordinates']))
            if match and match['state'] == region:
                kept.append(r)
            else:
                rejected.append({'reason': 'outside_census_state_geometry', 'name': r['name'], 'coordinates': r['coordinates']})
        records = kept
    if len(records) < cfg['min']:
        raise ValueError(f'{region}: too few valid official records after validation')
    return sorted(records, key=lambda r: r['id']), rejected, len(features)


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False, encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(',', ':'))
        handle.write('\n')
        temporary = Path(handle.name)
    os.chmod(temporary, 0o644)
    temporary.replace(path)


def guarded_write(path, wrapper):
    if path.exists():
        prior = json.loads(path.read_text())
        if len(wrapper['records']) < .7 * len(prior['records']):
            raise ValueError('Unreviewed rest-area source shrink; prior data retained')
        if wrapper['source']['retrieved_at'] < prior['source']['retrieved_at']:
            raise ValueError('Source retrieval date regressed')
    write_json(path, wrapper)


def write_manifest():
    regions = []
    for path in sorted(OUT.glob('[A-Z][A-Z].json')):
        d = json.loads(path.read_text())
        regions.append({'region': d['region'], 'file': path.name, 'records': len(d['records']),
                        'retrieved_at': d['source']['retrieved_at']})
    write_json(OUT / 'index.json', {'version': 1, 'regions': regions})
    return regions


def import_region(region, boundaries):
    cfg = REGIONS[region]
    url = query_url(cfg)
    raw = fetch(url, {query_url(c) for c in REGIONS.values()})
    records, rejected, count = parse(region, cfg, raw, boundaries)
    wrapper = {'version': 1, 'region': region, 'operator': cfg['operator'], 'facility_kind': cfg['facility_kind'],
               'publisher': cfg['publisher'],
               'source': {'url': cfg['layer'], 'sha256': hashlib.sha256(raw).hexdigest(), 'retrieved_at': now(),
                          'source_updated_at': None},
               'records': records}
    guarded_write(OUT / f'{region}.json', wrapper)
    return {'region': region, 'source_rows': count, 'imported': len(records), 'rejected': rejected}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--region', action='append', choices=sorted(REGIONS), help='Limit to these regions')
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT / 'scripts'))
    from build_agency_states import StateBoundaries
    boundaries = StateBoundaries()
    reports, failures = [], []
    for region in args.region or sorted(REGIONS):
        try:
            reports.append(import_region(region, boundaries))
        except Exception as error:  # one failed source keeps its prior file and never blocks the others
            failures.append({'region': region, 'error': str(error)})
    manifest = write_manifest()
    print(json.dumps({'imported': reports, 'failed': failures, 'manifest': manifest}, indent=1))
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
