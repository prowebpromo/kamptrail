#!/usr/bin/env python3
"""Capture real NWS fire-weather alerts as test fixtures.

Saves active Red Flag Warnings and Fire Weather Watches, plus the geometry of
the forecast zones that alerts without their own polygon refer to. Nothing is
published or committed. Output feeds tests for a future warning-area layer.
Standard library only.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ALERTS_URL = 'https://api.weather.gov/alerts/active'
EVENTS = ('Red Flag Warning', 'Fire Weather Watch')
ZONE_PREFIX = 'https://api.weather.gov/zones/'
USER_AGENT = 'KampTrail fire-weather fixture capture (https://kamptrail.com)'
MAX_ZONES = 60
MAX_BYTES = 8_000_000


def fetch_json(url, opener=urllib.request.urlopen, retries=2):
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/geo+json'})
    for attempt in range(retries + 1):
        try:
            with opener(request, timeout=30) as response:
                body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise ValueError('response too large')
            return json.loads(body)
        except (urllib.error.URLError, TimeoutError, ValueError):
            if attempt == retries:
                raise
            time.sleep(2 * (attempt + 1))


def fire_alerts(collection):
    """Return only fire-weather alert features, with a basic shape check."""
    if not isinstance(collection, dict) or collection.get('type') != 'FeatureCollection' or not isinstance(collection.get('features'), list):
        raise ValueError('not an alert FeatureCollection')
    return [f for f in collection['features'] if isinstance(f, dict) and (f.get('properties') or {}).get('event') in EVENTS]


def zones_needed(alerts, limit=MAX_ZONES):
    """Zone URLs referenced by alerts that have no polygon of their own."""
    seen = []
    for alert in alerts:
        if alert.get('geometry'):
            continue
        for zone in (alert.get('properties') or {}).get('affectedZones') or []:
            if isinstance(zone, str) and zone.startswith(ZONE_PREFIX) and zone not in seen:
                seen.append(zone)
    return seen[:limit], max(0, len(seen) - limit)


def summarize(alerts, zone_count, skipped):
    rows = []
    for a in alerts:
        p = a.get('properties') or {}
        rows.append({'id': p.get('id'), 'event': p.get('event'), 'sent': p.get('sent'), 'expires': p.get('expires'),
                     'area': (p.get('areaDesc') or '')[:200], 'has_polygon': bool(a.get('geometry')),
                     'zones': len(p.get('affectedZones') or [])})
    return {'alerts': len(alerts), 'with_polygon': sum(r['has_polygon'] for r in rows),
            'zone_only': sum(not r['has_polygon'] for r in rows), 'zone_geometries_saved': zone_count,
            'zones_skipped_over_limit': skipped, 'items': rows}


def zone_file_name(url):
    return urllib.parse.urlparse(url).path.strip('/').replace('/', '_') + '.json'


def main(argv=None, fetch=fetch_json):
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    args = parser.parse_args(argv)
    retrieved = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    url = ALERTS_URL + '?' + urllib.parse.urlencode({'event': ','.join(EVENTS)})
    alerts = fire_alerts(fetch(url))
    os.makedirs(args.out, exist_ok=True)
    if not alerts:
        with open(os.path.join(args.out, 'summary.json'), 'w', encoding='utf-8') as f:
            json.dump({'retrieved_at': retrieved, 'source': url, 'alerts': 0}, f, indent=1)
        print('No active Red Flag Warnings or Fire Weather Watches.')
        return 0
    zones, skipped = zones_needed(alerts)
    os.makedirs(os.path.join(args.out, 'zones'), exist_ok=True)
    saved = 0
    for zone in zones:
        try:
            data = fetch(zone)
        except Exception as error:  # record the failure, keep going
            print(f'zone failed {zone}: {error}', file=sys.stderr)
            continue
        with open(os.path.join(args.out, 'zones', zone_file_name(zone)), 'w', encoding='utf-8') as f:
            json.dump({'retrieved_at': retrieved, 'source': zone, 'data': data}, f)
        saved += 1
    with open(os.path.join(args.out, 'alerts.json'), 'w', encoding='utf-8') as f:
        json.dump({'retrieved_at': retrieved, 'source': url, 'type': 'FeatureCollection', 'features': alerts}, f)
    summary = summarize(alerts, saved, skipped)
    summary.update({'retrieved_at': retrieved, 'source': url})
    with open(os.path.join(args.out, 'summary.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=1)
    print(f"{summary['alerts']} alerts ({summary['with_polygon']} with polygon, {summary['zone_only']} zone-only), {saved} zone geometries saved")
    return 0


if __name__ == '__main__':
    sys.exit(main())
