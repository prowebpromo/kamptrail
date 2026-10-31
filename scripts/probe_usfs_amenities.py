#!/usr/bin/env python3
"""Read-only: download USFS Recreation Site layer attributes needed to audit amenity evidence."""
import json, sys, time, urllib.parse, urllib.request
UA = 'KampTrail amenity audit (+https://github.com/prowebpromo/kamptrail)'
LAYERS = {'site': 'https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0',
          'subsite': 'https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/1'}
def get(url, params):
    req = urllib.request.Request(url + '?' + urllib.parse.urlencode(params), headers={'User-Agent': UA})
    for i in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read(60_000_000))
        except Exception:
            if i == 3: raise
            time.sleep(5 * (i + 1))
out = {}
for name, url in LAYERS.items():
    meta = get(url, {'f': 'json'})
    fields = [f['name'] for f in meta.get('fields') or []]
    want = [f for f in fields if f.lower() in ('site_cn', 'root_cn', 'parent_cn', 'site_id', 'site_name', 'public_site_name', 'site_type', 'site_subtype', 'nrrs_id', 'rec1stop_id', 'rec1stop_url', 'water_availability', 'restroom_availability', 'water_hookup', 'sewer_hookup', 'electricity_hookup', 'seasonal_operational_status', 'open_season', 'season_description', 'site_season_start_date', 'site_season_end_date', 'operational_status', 'edw_last_modify', 'infra_last_update', 'admin_org_name', 'forest_name', 'development_scale')]
    ids = get(url + '/query', {'where': '1=1', 'returnIdsOnly': 'true', 'f': 'json'})
    oid_field, oids = ids.get('objectIdFieldName'), sorted(ids.get('objectIds') or [])
    rows = []
    for i in range(0, len(oids), 500):
        chunk = oids[i:i + 500]
        d = get(url + '/query', {'objectIds': ','.join(map(str, chunk)), 'outFields': ','.join(want), 'outSR': '4326', 'returnGeometry': 'true', 'f': 'json'})
        for f in d.get('features') or []:
            a = f.get('attributes') or {}; g = f.get('geometry') or {}
            a['_lon'], a['_lat'] = g.get('x'), g.get('y'); rows.append(a)
        time.sleep(0.5)
    out[name] = {'url': url, 'fields_all': fields, 'fields_kept': want, 'count': len(rows), 'rows': rows}
    print(name, len(oids), len(rows), want)
json.dump(out, open(sys.argv[1], 'w'))
