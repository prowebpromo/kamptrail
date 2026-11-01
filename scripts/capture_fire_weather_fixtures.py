#!/usr/bin/env python3
"""Capture NWS fire-weather fixtures for the R12 overlay, with provenance.

Saves, unmodified and byte for byte:
  * the NWS /alerts responses for Red Flag Warning and Fire Weather Watch over the
    previous N days (default 7), following pagination,
  * one control /alerts response (limit=1) that shows the real property schema,
  * the geometry of a few NWS fire-weather zones.
A manifest.json records for every file the exact URL, HTTP status, UTC retrieval
time, byte count and SHA-256 of the saved bytes. Nothing is edited, filtered or
invented. An empty alert list is a real result and is recorded as such.

Requests identify the app by a project URL (no personal contact), pause between
calls, honor Retry-After, and stop on 429 or 503 instead of retrying hard.
Standard library only.
"""
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

USER_AGENT = 'KampTrail fire-weather fixture capture (https://kamptrail.com)'
ALERTS = 'https://api.weather.gov/alerts'
EVENTS = ('Red Flag Warning', 'Fire Weather Watch')
CONTROL_EVENT = 'Small Craft Advisory'
DEFAULT_ZONES = ('fire/COZ214', 'fire/CAZ281', 'fire/NMZ104')
PAUSE_SECONDS = 1.0
MAX_PAGES = 20


class Stop(Exception):
    pass


def get(url, opener=urllib.request.urlopen, sleep=time.sleep):
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/geo+json'})
    try:
        with opener(request, timeout=60) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as error:
        if error.code in (429, 503):
            raise Stop(f'{url} answered {error.code}; Retry-After={error.headers.get("Retry-After")}')
        return error.code, error.read(), dict(error.headers)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def save(out, name, data):
    path = os.path.join(out, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as handle:
        handle.write(data)
    return path


def capture_events(out, manifest, start, end, fetch, sleep):
    for event in EVENTS + (CONTROL_EVENT,):
        limit = 1 if event == CONTROL_EVENT else 500
        params = {'event': event, 'start': start, 'end': end, 'limit': limit}
        url = ALERTS + '?' + urllib.parse.urlencode(params)
        page = 0
        while url and page < MAX_PAGES:
            page += 1
            status, body, _ = fetch(url)
            stamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
            name = 'alerts/%s-p%d.json' % (event.lower().replace(' ', '-'), page)
            save(out, name, body)
            manifest['files'].append({'file': name, 'kind': 'nws-alerts', 'event': event, 'url': url, 'http_status': status,
                                      'retrieved_at': stamp, 'bytes': len(body), 'sha256': sha256(body)})
            try:
                data = json.loads(body)
            except ValueError:
                break
            manifest['files'][-1]['feature_count'] = len(data.get('features', []))
            url = (data.get('pagination') or {}).get('next') if data.get('features') and event != CONTROL_EVENT else None
            sleep(PAUSE_SECONDS)


def capture_zones(out, manifest, zones, fetch, sleep):
    for zone in zones:
        url = 'https://api.weather.gov/zones/' + zone
        status, body, headers = fetch(url)
        stamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        name = 'zones/' + zone.replace('/', '_') + '.json'
        save(out, name, body)
        entry = {'file': name, 'kind': 'nws-zone', 'url': url, 'http_status': status, 'retrieved_at': stamp, 'bytes': len(body),
                 'sha256': sha256(body), 'cache_control': headers.get('cache-control') or headers.get('Cache-Control')}
        try:
            entry['geometry_type'] = (json.loads(body).get('geometry') or {}).get('type')
        except ValueError:
            pass
        manifest['files'].append(entry)
        sleep(PAUSE_SECONDS)


def main(argv=None, fetch=get, sleep=time.sleep, now=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--days', type=int, default=7)
    parser.add_argument('--zone', action='append', help='zone path such as fire/COZ214')
    args = parser.parse_args(argv)
    now = (now or datetime.now(timezone.utc)).replace(microsecond=0)
    start = (now - timedelta(days=args.days)).strftime('%Y-%m-%dT%H:%M:%SZ')
    end = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    manifest = {'captured_by': 'scripts/capture_fire_weather_fixtures.py', 'user_agent': USER_AGENT,
                'window': {'start': start, 'end': end, 'days': args.days}, 'files': []}
    try:
        capture_events(args.out, manifest, start, end, fetch, sleep)
        capture_zones(args.out, manifest, args.zone or DEFAULT_ZONES, fetch, sleep)
    except Stop as stop:
        manifest['stopped'] = str(stop)
    with open(os.path.join(args.out, 'manifest.json'), 'w', encoding='utf-8') as handle:
        json.dump(manifest, handle, indent=1)
        handle.write('\n')
    counts = {f['event']: f.get('feature_count') for f in manifest['files'] if f['kind'] == 'nws-alerts'}
    print(json.dumps({'window': manifest['window'], 'alert_pages': counts, 'zones': sum(f['kind'] == 'nws-zone' for f in manifest['files']),
                      'stopped': manifest.get('stopped')}))
    return 1 if manifest.get('stopped') else 0


if __name__ == '__main__':
    sys.exit(main())
