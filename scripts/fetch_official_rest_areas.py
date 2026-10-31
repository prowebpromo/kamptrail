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
def _num(value):
    """Format a numeric milepost without a trailing .0. Blank becomes None."""
    return None if value in (None, '') else f"{float(value):g}"


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
    'CA': {
        'operator': 'caltrans', 'facility_kind': 'safety_roadside_rest_area',
        'publisher': 'Caltrans, Division of Maintenance',
        'layer': 'https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Rest_Areas/FeatureServer/0',
        'info_url': 'https://dot.ca.gov/programs/design/lap-landscape-architecture-and-community-livability/lap-liv-h-safety-roadside-rest-areas',
        # Layer is Caltrans' "Safety Roadside Rest Areas" and has no type or status field. 1=1 relies on the layer scope.
        'where': '1=1', 'min': 60, 'max': 120,
        'bbox': (-124.6, 32.4, -114.0, 42.1),
        'native_id': lambda a: slug(a.get('CT_NO')),
        'name': lambda a: a.get('MAP_LABEL_NAME'),
        'location': lambda a: join(a.get('ROUTE') and f"Route {str(a['ROUTE']).strip()}", a.get('LANDMARK_LOCATION'), a.get('COUNTY') and f"{a['COUNTY']} County"),
        'milepost': lambda a: _num(a.get('POSTMILE')),
        'updated': lambda a: None,
    },
    'WA': {
        'operator': 'wsdot', 'facility_kind': 'safety_rest_area',
        'publisher': 'Washington State Department of Transportation',
        'layer': 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/FacilitiesData/FeatureServer/8',
        'info_url': 'https://wsdot.wa.gov/travel/safety/rest-areas/home',
        # Layer 8 is "Sites Active Rest Area" (site points). Layer 6 (buildings) is not used. SiteStatus samples: OWNED. Leased sites are still WSDOT facilities.
        'where': '1=1', 'min': 30, 'max': 70,
        'bbox': (-124.9, 45.5, -116.9, 49.1),
        'native_id': lambda a: slug(str(a.get('SiteFCR') or '').strip()),
        'name': lambda a: a.get('SiteName'),
        'location': lambda a: join(re.sub(r'\s+', ' ', str(a.get('SiteLocation') or '')).strip(), a.get('SiteCity')),
        'milepost': lambda a: (re.search(r'\bMP\s+(\d+(?:\.\d+)?)', str(a.get('SiteLocation') or '')) or [None, None])[1],
        'updated': lambda a: None,
    },
    'SD': {
        'operator': 'sddot', 'facility_kind': 'rest_area',
        'publisher': 'South Dakota Department of Transportation',
        'layer': 'https://dotgis.sd.gov/missouririver/rest/services/Operations/DOT_Rest_Areas/MapServer/1',
        'info_url': 'https://dot.sd.gov/travelers/travelers/rest-areaports-of-entry/',
        # Welcome_Center = Y/N marks SDDOT welcome centers that sit at rest areas. They stay in scope. Verified 2026-10-31: every record has Type_ 'Rest Area'.
        'where': "Type_ = 'Rest Area'", 'min': 15, 'max': 60,
        'bbox': (-104.2, 42.4, -96.3, 46.0),
        'native_id': lambda a: str(a.get('GlobalID') or '').strip('{}').lower(),
        'name': lambda a: a.get('Location') and join(f"{a['Location']} Rest Area", a.get('Lane_Dir')).replace(', ', ' ', 1),
        'location': lambda a: join(a.get('Hwy_route'), a.get('County') and f"{a['County']} County"),
        'milepost': lambda a: None if a.get('MRM') in (None, '') else str(a['MRM']),
        'updated': lambda a: None,
    },
    'MI': {
        'operator': 'mdot', 'facility_kind': 'rest_area_or_welcome_center',
        'publisher': 'Michigan Department of Transportation',
        'layer': 'https://gisagomdot.state.mi.us/arcgis/rest/services/MDOT/MdotRestAreaPublic/MapServer/0',
        'info_url': 'https://www.michigan.gov/mdot/travel/tourists/rest-areas',
        # Only Status = 'Open' is proven by samples. FacilityFunction samples: "Safety Rest Area", "Safety Rest Area/Welcome Center".
        # Verified 2026-10-31: Status is Open or Closed; FacilityFunction is Safety Rest Area or Safety Rest Area/Welcome Center.
        'where': "Status = 'Open'", 'min': 40, 'max': 110,
        'bbox': (-90.6, 41.6, -82.1, 48.4),
        'native_id': lambda a: slug(join(a.get('FacilityName'), a.get('RouteName'), a.get('RouteDirection'))),
        'name': lambda a: a.get('FacilityName'),
        'location': lambda a: ' '.join(str(x).strip() for x in (a.get('RouteName'), a.get('RouteDirection')) if x not in (None, '') and str(x).strip()),
        'milepost': lambda a: None if str(a.get('MileMarker') or '').strip() == '' else str(a['MileMarker']).strip(),
        'updated': lambda a: None,
    },
    'NV': {
        'operator': 'ndot', 'facility_kind': 'rest_area',
        'publisher': 'Nevada Department of Transportation',
        'layer': 'https://gis.dot.nv.gov/arcgis/rest/services/Applications/511Map/MapServer/5',
        'info_url': 'https://www.dot.nv.gov/travel-info/rest-areas-welcome-centers',
        # Layer metadata says NDOT and county entities maintain these. MAINTAINED_BY separates them (samples: Nevada DOT, Eureka County).
        # Verified 2026-10-31 on the live layer: MAINTAINED_BY is Nevada DOT or a county; STATUS includes closed, under construction and removed.
        'where': "MAINTAINED_BY = 'Nevada DOT' AND STATUS = 'Open To Traffic'", 'min': 15, 'max': 50,
        'bbox': (-120.1, 35.0, -114.0, 42.0),
        'native_id': lambda a: slug(a.get('REST_AREA_ID')),
        'name': lambda a: a.get('NAME'),
        'location': lambda a: join(a.get('ROUTE_FULL'), a.get('COUNTY') and f"{a['COUNTY']} County"),
        'milepost': lambda a: _num(a.get('MILEPOST')),
        'updated': lambda a: epoch_iso(a.get('last_edited_date')),
    },
    'IN': {
        'operator': 'indot', 'facility_kind': 'rest_area_or_welcome_center',
        'publisher': 'Indiana Department of Transportation',
        'layer': 'https://gis.indot.in.gov/ro/rest/services/DOT/INDOT_Rest_Areas/FeatureServer/0',
        'info_url': 'https://www.in.gov/indot/resources/maps/welcome-centers-and-rest-areas/',
        # STATUS and MAINT_BY are real fields (samples: Open, INDOT). Truck-only sites are named "... Truck Parking ..." in SITE_NAME (one sample). UNVERIFIED: that naming holds for every truck-only site.
        'where': "MAINT_BY = 'INDOT' AND STATUS = 'Open' AND SITE_NAME NOT LIKE '%Truck Parking%'", 'min': 15, 'max': 45,
        'bbox': (-88.2, 37.7, -84.7, 41.8),
        'native_id': lambda a: str(a.get('GLOBALID') or '').strip('{}').lower(),
        'name': lambda a: a.get('SITE_NAME'),
        'location': lambda a: a.get('LOCATION'),
        'milepost': lambda a: (re.search(r'Mile Marker\s+(\d+(?:\.\d+)?)', str(a.get('LOCATION') or '')) or [None, None])[1],
        'updated': lambda a: epoch_iso(a.get('LAST_EDITED_DATE')),
    },
    'KS': {
        'operator': 'kdot', 'facility_kind': 'rest_area',
        'publisher': 'Kansas Department of Transportation',
        'layer': 'https://kanplan.ksdot.gov/arcgis_web_adaptor/rest/services/Facilities/Rest_Areas/MapServer/0',
        'info_url': 'https://www.ksdot.gov/Assets/wwwksdotorg/Safety_Rest_Areas_in_Kansas.pdf',
        # No type, status or name field exists. Whether closed sites remain in the layer is not stated.
        'where': '1=1', 'min': 25, 'max': 60,
        'bbox': (-102.1, 36.9, -94.6, 40.1),
        'native_id': lambda a: slug(str(a.get('DOT_NO') or '').strip()),
        'name': lambda a: a.get('Route') and join(f"{str(a['Route']).strip()} Rest Area", str(a.get('LocationDescription') or '').strip().title()).replace(', ', ' ', 1),
        'location': lambda a: a.get('LocationDescription'),
        'milepost': lambda a: None,
        'updated': lambda a: None,
    },
    'IA': {
        'operator': 'iowa_dot', 'facility_kind': 'rest_area',
        'publisher': 'Iowa Department of Transportation',
        'layer': 'https://gis.iowadot.gov/agshost/rest/services/Hosted/Rest_Areas_All/FeatureServer/1',
        'info_url': 'https://gis.iowadot.gov/agshost/rest/services/Hosted/Rest_Areas_All/FeatureServer/1',
        # Layer description says it also holds parking facilities and weigh areas. facility_type samples: Rest Area. Verified 2026-10-31: every record has facility_type 'Rest Area'.
        'where': "facility_type = 'Rest Area'", 'order': 'objectid', 'min': 20, 'max': 60,
        'bbox': (-96.7, 40.3, -90.1, 43.6),
        'native_id': lambda a: slug(str(a.get('inventory_id') or '').strip()),
        'name': lambda a: a.get('rest_areas'),
        'location': lambda a: a.get('address'),
        'milepost': lambda a: _num(a.get('milepost')),
        'updated': lambda a: epoch_iso(a.get('rest_updated')) or epoch_iso(a.get('edited_date')),
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
              'orderByFields': cfg.get('order', 'OBJECTID'), 'f': 'json'}
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
