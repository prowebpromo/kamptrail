"""Query the NWS /alerts endpoint over an explicit 7-day window, following pagination.

Prints one JSON line per event with HTTP statuses, page count and alert count.
A control event (Small Craft Advisory) proves the window, filter and paging work.
"""
import json, urllib.request, urllib.parse, datetime as dt, hashlib, sys
UA = 'KampTrail fire-weather fixture capture (https://kamptrail.com)'
now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
start = (now - dt.timedelta(days=7)).isoformat().replace('+00:00', 'Z')
end = now.isoformat().replace('+00:00', 'Z')
def run(event):
    params = {'event': event, 'start': start, 'end': end, 'limit': 500}
    url = 'https://api.weather.gov/alerts?' + urllib.parse.urlencode(params)
    feats, pages, statuses = [], 0, []
    while url and pages < 50:
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/geo+json'})
        with urllib.request.urlopen(req, timeout=60) as r:
            statuses.append(r.status); body = r.read()
        d = json.loads(body); pages += 1
        feats += d.get('features', [])
        nxt = (d.get('pagination') or {}).get('next')
        url = nxt if nxt and d.get('features') else None
    sent = sorted(f['properties']['sent'] for f in feats)
    return {'event': event, 'start': start, 'end': end, 'pages': pages, 'http': statuses, 'count': len(feats),
            'first_sent': sent[0] if sent else None, 'last_sent': sent[-1] if sent else None,
            'with_geometry': sum(1 for f in feats if f.get('geometry')),
            'message_types': sorted({f['properties']['messageType'] for f in feats}),
            'events_seen': sorted({f['properties']['event'] for f in feats})}
for e in ['Small Craft Advisory', 'Red Flag Warning', 'Fire Weather Watch']:
    print(json.dumps(run(e)))
