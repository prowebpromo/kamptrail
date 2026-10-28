#!/usr/bin/env python3
"""Fetch Forest Service camping opportunities with their published fee wording.

Source: USFS Enterprise Data Warehouse, Recreation Opportunities (public, updated nightly)
https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0
Writes data/sources/usfs.json: normalized GeoJSON features with fee status and evidence.
A failed or shrunken fetch raises before writing, so saved data stays unchanged.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fee_text  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0/query'
ACTIVITIES = ('Campground Camping', 'Dispersed Camping', 'RV Camping', 'Group Camping', 'Horse Camping', 'OHV Camping')
FIELDS = 'recareaid,recareaname,latitude,longitude,recareaurl,forestname,markeractivity,feedescription,restrictions,reservation_info,open_season_start,open_season_end,openstatus'
OUT = ROOT / 'data' / 'sources' / 'usfs.json'


def fetch_all(opener=urllib.request.urlopen):
    where = "markeractivity IN ({})".format(','.join(f"'{a}'" for a in ACTIVITIES))
    rows, offset = [], 0
    while True:
        query = urllib.parse.urlencode({'where': where, 'outFields': FIELDS, 'returnGeometry': 'false', 'orderByFields': 'objectid',
                                        'resultOffset': offset, 'resultRecordCount': 2000, 'f': 'json'})
        for attempt in range(3):
            try:
                with opener(f'{URL}?{query}', timeout=120) as response:
                    data = json.load(response)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(5)
        if 'error' in data:
            raise RuntimeError(f"USFS service error: {data['error']}")
        page = [f['attributes'] for f in data.get('features', [])]
        rows += page
        if not data.get('exceededTransferLimit') and len(page) < 2000:
            return rows
        offset += len(page)


def to_feature(row, retrieved):
    try:
        lat, lng = float(row['latitude']), float(row['longitude'])
    except (TypeError, ValueError, KeyError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180) or (lat == 0 and lng == 0):
        return None
    name = fee_text.clean(row.get('recareaname'))
    if not name or row.get('recareaid') in (None, ''):
        return None
    status, cost = fee_text.classify(row.get('feedescription'))
    wording = fee_text.clean(row.get('feedescription'))
    url = row.get('recareaurl') or f"https://www.fs.usda.gov/recarea/{row['recareaid']}"
    props = {
        'id': f"usfs:{row['recareaid']}",
        'name': name[:160],
        'type': 'dispersed' if row.get('markeractivity') == 'Dispersed Camping' else 'established',
        'source': 'US Forest Service',
        'sources': ['US Forest Service'],
        'source_url': url,
        'camping_activity': row.get('markeractivity'),
        'operator': row.get('forestname') or None,
        'fee_status': status,
        'cost': cost,
        'fee_text': wording[:400] or None,
        'fee_source': 'US Forest Service',
        'fee_checked': retrieved,
        'schema_version': 3,
        'field_provenance': {'cost': 'USFS Recreation Opportunities feedescription'},
        'open_status': (row.get('openstatus') or '').strip().lower() or None,
        'season': ' to '.join(v for v in (row.get('open_season_start'), row.get('open_season_end')) if v) or None,
        'restrictions': fee_text.clean(row.get('restrictions'))[:300] or None,
        'amenities': [],
        'rig_friendly': ['rv'] if row.get('markeractivity') == 'RV Camping' else [],
    }
    return {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(lng, 6), round(lat, 6)]}, 'properties': props}


def main():
    retrieved = date.today().isoformat()
    rows = fetch_all()
    features = [f for f in (to_feature(r, retrieved) for r in rows) if f]
    previous = 0
    if OUT.exists():
        try:
            previous = len(json.loads(OUT.read_text()).get('features', []))
        except ValueError:
            previous = 0
    if previous and len(features) < previous * 0.7:
        raise RuntimeError(f'USFS returned {len(features)} camping records, down from {previous}. Saved data kept.')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix('.json.tmp')
    tmp.write_text(json.dumps({'type': 'FeatureCollection', 'source': 'US Forest Service Recreation Opportunities (EDW)', 'retrieved': retrieved, 'features': features}, separators=(',', ':')))
    tmp.replace(OUT)
    counts = {}
    for f in features:
        counts[f['properties']['fee_status']] = counts.get(f['properties']['fee_status'], 0) + 1
    print(f'usfs.json: {len(features)} camping records, fee status {counts}')


if __name__ == '__main__':
    main()
