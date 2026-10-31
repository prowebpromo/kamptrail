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
def slug(value):
    return re.sub(r'[^a-z0-9]+', '-', str(value or '').lower()).strip('-')[:64]


def us_date(value):
    match = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{4})', str(value or '').strip())
    if not match:
        return None
    month, day, year = map(int, match.groups())
    try:
        return dt.datetime(year, month, day, tzinfo=dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    except ValueError:
        return None


def join(*parts):
    return ', '.join(str(p).strip() for p in parts if p not in (None, '') and str(p).strip())


# Exact reviewed scopes. The operator and facility_kind must match a reviewed policy scope in
# data/rest-areas/state-policies.json. min/max bound the expected record count so a changed or
# truncated source keeps the prior catalogue. Each mapper reads only the agency's own fields.
REGIONS = {
    'ID': {
        'operator': 'itd', 'facility_kind': 'safety_rest_area',
        'publisher': 'Idaho Transportation Department',
        'layer': 'https://gisp.itd.idaho.gov/server/rest/services/GDWarehouse/Assets/FeatureServer/5',
        'info_url': 'https://itd.idaho.gov/faqs/rest-areas/', 'where': '1=1', 'min': 20, 'max': 60,
        'bbox': (-117.3, 41.9, -111.0, 49.1),
        'native_id': lambda a: str(a.get('GlobalID') or '').strip('{}').lower(),
        'name': lambda a: a.get('FacilityName'),
        'location': lambda a: join(a.get('CommonRoadName'), a.get('CountyName') and f"{a['CountyName']} County"),
        'milepost': lambda a: None, 'updated': lambda a: epoch_iso(a.get('ServiceLastUpdatedUTC')),
    },
    'MT': {
        'operator': 'mdt', 'facility_kind': 'rest_area',
        'publisher': 'Montana Department of Transportation',
        'layer': 'https://services1.arcgis.com/dKlvxNSUvl36IGMp/arcgis/rest/services/Montana_Rest_Areas/FeatureServer/0',
        'info_url': 'https://mdt.mt.gov/travinfo/restarea.aspx',
        # Only rest areas MDT itself maintains. City, tribal and other-run sites and parking-only pull-offs are a different scope.
        'where': "CLASS = 'ADA Access Rest Area' AND ST_MAINT = 'State Maintained'", 'min': 30, 'max': 80,
        'bbox': (-116.1, 44.3, -104.0, 49.1),
        'native_id': lambda a: slug(a.get('RA_NAME')),
        'name': lambda a: a.get('RA_NAME'),
        'location': lambda a: join(a.get('SIGN_RT'), a.get('AVAILABLE')),
        'milepost': lambda a: None if a.get('RA_RP') in (None, '') else f"{float(a['RA_RP']):g}",
        'updated': lambda a: epoch_iso(a.get('EditDate')),
    },
    'FL': {
        'operator': 'florida_turnpike', 'facility_kind': 'turnpike_service_plaza',
        'publisher': "Florida's Turnpike Enterprise",
        'layer': 'https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/TurnpikeBaseData/FeatureServer/0',
        'info_url': 'https://floridasturnpike.com/traveler-resources/service-plazas/', 'where': '1=1', 'min': 6, 'max': 12,
        'bbox': (-87.7, 24.4, -79.9, 31.1),
        'native_id': lambda a: slug(a.get('MP_NAME')),
        'name': lambda a: a.get('Plaza_Name') and f"{a['Plaza_Name']} Service Plaza",
        'location': lambda a: "Florida's Turnpike",
        'milepost': lambda a: (re.match(r'\s*(\d+(?:\.\d+)?)\b', str(a.get('MP_NAME') or '')) or [None, None])[1],
        'updated': lambda a: us_date(a.get('DATEDATE')),
    },
    'OH': {
        'operator': 'odot', 'facility_kind': 'rest_area_or_roadside_park',
        'publisher': 'Ohio Department of Transportation',
        'layer': 'https://tims.dot.state.oh.us/ags/rest/services/Assets/ODOT_Facilities/MapServer/0',
        'info_url': 'https://tims.dot.state.oh.us/ags/rest/services/Assets/ODOT_Facilities/MapServer/0',
        # TYPE_CODE 355 is ODOT's rest-area facility type (interstate, state-route and US-route rest areas and roadside parks).
        'where': 'TYPE_CODE = 355', 'min': 60, 'max': 120, 'collapse_identical': True,
        'bbox': (-84.9, 38.3, -80.4, 42.4),
        'native_id': lambda a: slug(a.get('SITE_CD')),
        'name': lambda a: a.get('FACILITY_NAME'),
        'location': lambda a: join(join(a.get('ROUTE_NBR'), a.get('DIRECTION')).replace(', ', ' '), a.get('COUNTY') and f"{a['COUNTY']} County"),
        'milepost': lambda a: None if a.get('MILE_MARKER') in (None, '') else str(a['MILE_MARKER']),
        'updated': lambda a: None,
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
    records, rejected, by_id = [], [], {}
    west, south, east, north = cfg['bbox']
    for feature in features:
        attrs, geom = feature.get('attributes') or {}, feature.get('geometry') or {}
        native = cfg['native_id'](attrs)
        name = clean(cfg['name'](attrs), 200)
        if not re.fullmatch(r'[a-z0-9-]{1,64}', native or '') or not name:
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
        milepost = clean(cfg['milepost'](attrs), 60)
        row = {'id': identity, 'name': name, 'coordinates': [round(lng, 6), round(lat, 6)],
               'location': clean(cfg['location'](attrs), 800), 'milepost': milepost or None, 'source_url': cfg['info_url'],
               'state': region, 'permission': 'unknown', 'source_updated_at': cfg['updated'](attrs)}
        if identity in by_id:
            if cfg.get('collapse_identical') and by_id[identity] == row:
                continue
            raise ValueError('Conflicting duplicate official identity')
        by_id[identity] = row
        records.append(row)
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
