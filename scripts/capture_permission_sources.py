#!/usr/bin/env python3
"""Read-only: save raw official pages (body + hash + headers) for rest-area permission review."""
import hashlib, html, json, os, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone
UA = 'KampTrail rest-area policy review (+https://github.com/prowebpromo/kamptrail)'
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
URLS = [
 'https://lawfilesext.leg.wa.gov/law/RCW/RCW%20%2047%20%20TITLE/RCW%20%2047%20.%2038%20%20CHAPTER/RCW%20%2047%20.%2038%20.020.htm',
 'https://sdlegislature.gov/api/Statutes/31-7-15.html',
 'https://www.leg.state.nv.us/nac/NAC-408.html',
 'https://www.law.cornell.edu/regulations/california/21-CCR-2205',
 'https://www.in.gov/indot/resources/maps/welcome-centers-and-rest-areas/',
]
HUB = 'https://www.in.gov/indot/resources/maps/welcome-centers-and-rest-areas/'
meta = {}
def save(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read(20_000_000)
            m = {'url': url, 'retrieved_url': r.geturl(), 'status': r.status, 'retrieved_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                 'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body), 'http_last_modified': r.headers.get('Last-Modified'), 'content_type': r.headers.get('Content-Type')}
        name = hashlib.sha1(url.encode()).hexdigest()[:12]
        open(os.path.join(OUT, name + '.raw'), 'wb').write(body)
        m['file'] = name + '.raw'
    except Exception as e:
        m = {'url': url, 'error': f'{type(e).__name__}: {str(e)[:200]}'}
    meta[url] = m; print(m.get('status'), m.get('error', ''), url); time.sleep(1)
    return m
for u in URLS:
    save(u)
hub = meta.get(HUB, {})
if hub.get('file'):
    text = open(os.path.join(OUT, hub['file']), 'rb').read().decode('utf-8', 'replace')
    links = sorted({urllib.parse.urljoin(HUB, html.unescape(h)) for h in re.findall(r'href="([^"]+)"', text) if '/welcome-centers-and-rest-areas/' in h and h.rstrip('/') != HUB.rstrip('/')})
    links = [l.split('#')[0] for l in links if l.startswith('https://www.in.gov/indot/resources/maps/welcome-centers-and-rest-areas/')]
    for l in sorted(set(links)):
        save(l)
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)
