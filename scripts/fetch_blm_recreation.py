#!/usr/bin/env python3
"""Fetch BLM camping recreation areas and facilities with their published fee wording.

Source: BLM National Recreation Sites and Facilities map service (public)
https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recreation_Sites_Facilities/MapServer
  layer 2  BLM Natl RIDB Recreation Camping   (RecAreaFeeDescription, StayLimit)
  layer 8  BLM Natl RIDB Facilities Camping   (FacilityUseFeeDescription, StayLimit, Reservable)
Writes data/sources/blm.json. A failed or shrunken fetch raises before writing.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fee_text  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recreation_Sites_Facilities/MapServer'
OUT = ROOT / 'data' / 'sources' / 'blm.json'
LAYERS = {
    2: {'id': 'RecAreaID', 'name': 'RecAreaName', 'fee': 'RecAreaFeeDescription', 'lat': 'RecAreaLatitude', 'lng': 'RecAreaLongitude', 'url': 'BLMRecURL', 'prefix': 'blm-area'},
    8: {'id': 'FacilityID', 'name': 'FacilityName', 'fee': 'FacilityUseFeeDescription', 'lat': 'FacilityLatitude', 'lng': 'FacilityLongitude', 'url': 'BLMFacURL', 'prefix': 'blm-facility'},
}


def fetch_layer(layer, opener=urllib.request.urlopen):
    rows, offset = [], 0
    while True:
        query = urllib.parse.urlencode({'where': '1=1', 'outFields': '*', 'returnGeometry': 'false', 'orderByFields': 'OBJECTID',
                                        'resultOffset': offset, 'resultRecordCount': 1000, 'f': 'json'})
        for attempt in range(3):
            try:
                with opener(f'{BASE}/{layer}/query?{query}', timeout=120) as response:
                    data = json.load(response)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(5)
        if 'error' in data:
            raise RuntimeError(f"BLM service error: {data['error']}")
        page = [f['attributes'] for f in data.get('features', [])]
        rows += page
        if not data.get('exceededTransferLimit') and len(page) < 1000:
            return rows
        offset += len(page)


def to_feature(row, spec, retrieved, layer):
    try:
        lat, lng = float(row[spec['lat']]), float(row[spec['lng']])
    except (TypeError, ValueError, KeyError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180) or (lat == 0 and lng == 0):
        return None
    name, key = fee_text.clean(row.get(spec['name'])), row.get(spec['id'])
    if not name or key in (None, ''):
        return None
    status, cost = fee_text.classify(row.get(spec['fee']))
    if status == 'unknown' and str(row.get('Reservable')).lower() in ('true', '1'):
        status = 'paid'
    url = row.get(spec['url']) or None
    stay = fee_text.clean(row.get('StayLimit'))
    props = {
        'id': f"{spec['prefix']}:{key}",
        'name': name[:160],
        'type': 'established' if layer == 8 or re.search(r'camp(?:ground|site)', name, re.I) else 'dispersed',
        'state': (row.get('State') or '').strip().upper()[:2] or None,
        'source': 'Bureau of Land Management',
        'sources': ['Bureau of Land Management'],
        'source_url': url if url and url.startswith('http') else 'https://www.blm.gov/camping',
        'camping_activity': 'BLM camping area' if layer == 2 else 'BLM camping facility',
        'fee_status': status,
        'cost': cost,
        'fee_text': fee_text.clean(row.get(spec['fee']))[:400] or None,
        'fee_source': 'Bureau of Land Management',
        'fee_checked': retrieved,
        'stay_limit': stay[:160] or None,
        'schema_version': 3,
        'field_provenance': {'cost': f"BLM {spec['fee']}"},
        'amenities': [],
        'rig_friendly': [],
    }
    # Facility records share Recreation.gov facility IDs, so they merge with the same campground.
    if layer == 8:
        props['facility_id'] = str(key)
    return {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(lng, 6), round(lat, 6)]}, 'properties': props}


def main():
    retrieved = date.today().isoformat()
    features = []
    for layer, spec in LAYERS.items():
        features += [f for f in (to_feature(r, spec, retrieved, layer) for r in fetch_layer(layer)) if f]
    previous = 0
    if OUT.exists():
        try:
            previous = len(json.loads(OUT.read_text()).get('features', []))
        except ValueError:
            previous = 0
    if previous and len(features) < previous * 0.7:
        raise RuntimeError(f'BLM returned {len(features)} camping records, down from {previous}. Saved data kept.')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix('.json.tmp')
    tmp.write_text(json.dumps({'type': 'FeatureCollection', 'source': 'BLM National Recreation Sites and Facilities', 'retrieved': retrieved, 'features': features}, separators=(',', ':')))
    tmp.replace(OUT)
    counts = {}
    for f in features:
        counts[f['properties']['fee_status']] = counts.get(f['properties']['fee_status'], 0) + 1
    print(f'blm.json: {len(features)} camping records, fee status {counts}')


if __name__ == '__main__':
    main()
