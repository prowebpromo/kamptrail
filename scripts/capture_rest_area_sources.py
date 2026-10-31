#!/usr/bin/env python3
"""Capture hashed, dated policy-source records for new rest-area regions (one GET each)."""
import hashlib, json, sys, urllib.request
from datetime import datetime, timezone
sys.path.insert(0, 'scripts')
import fetch_official_rest_areas as r
UA = 'KampTrail rest-area importer (+https://github.com/prowebpromo/kamptrail)'
out = {}
for region in sys.argv[2:]:
    url = r.REGIONS[region]['info_url']
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read(20_000_000)
            out[region] = {'url': url, 'retrieved_url': resp.geturl(), 'status': resp.status,
                           'retrieved_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                           'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body),
                           'http_last_modified': resp.headers.get('Last-Modified'), 'source_updated_at': None,
                           'content_type': resp.headers.get('Content-Type')}
    except Exception as e:
        out[region] = {'url': url, 'error': f'{type(e).__name__}: {str(e)[:200]}'}
    print(region, out[region].get('status'), out[region].get('error', ''))
json.dump(out, open(sys.argv[1], 'w'), indent=1)
