#!/usr/bin/env python3
"""Read-only: run each drafted rest-area region against its live layer and report."""
import collections, json, re, sys, time, urllib.parse
sys.path.insert(0, 'scripts')
import fetch_official_rest_areas as imp
ns = dict(vars(imp))
exec(open('scripts/rest_area_regions_draft.py').read(), ns)
out = {}
for region, cfg in ns['NEW_REGIONS'].items():
    row = {'where': cfg['where']}
    try:
        allq = cfg['layer'] + '/query?' + urllib.parse.urlencode({'where': '1=1', 'outFields': '*', 'outSR': '4326', 'returnGeometry': 'true', 'f': 'json'})
        alld = json.loads(imp.fetch(allq, {allq}).decode())
        feats = alld.get('features') or []
        row['all_count'] = len(feats); row['all_exceeded'] = bool(alld.get('exceededTransferLimit'))
        row['all_with_geometry'] = sum(1 for f in feats if (f.get('geometry') or {}).get('x') is not None)
        keyfields = [k for k in (feats[0]['attributes'] if feats else {}) if re.search(r'status|type|categ|function|maint|class|kind|open|closed|active', k, re.I)]
        row['value_counts'] = {k: collections.Counter(str(f['attributes'].get(k)) for f in feats).most_common(15) for k in keyfields}
        q = imp.query_url(cfg)
        raw = imp.fetch(q, {q})
        c = dict(cfg); c['min'], c['max'] = 0, 100000
        try:
            recs, rejected, n = imp.parse(region, c, raw)
            row.update(filtered_count=n, kept=len(recs), rejected=collections.Counter(r['reason'] for r in rejected).most_common(),
                       names=[r['name'] for r in recs][:60], ids_unique=True)
        except ValueError as e:
            row['parse_error'] = str(e)
            d = json.loads(raw.decode()); fs = d.get('features') or []
            ids = [cfg['native_id'](f.get('attributes') or {}) for f in fs]
            row['filtered_count'] = len(fs)
            row['duplicate_ids'] = [i for i, n in collections.Counter(ids).items() if n > 1][:20]
    except Exception as e:
        row['error'] = f'{type(e).__name__}: {str(e)[:200]}'
    out[region] = row
    print(region, {k: row.get(k) for k in ('all_count', 'filtered_count', 'kept', 'rejected', 'parse_error', 'error')})
    time.sleep(1)
json.dump(out, open(sys.argv[1], 'w'), indent=1)
