#!/usr/bin/env python3
"""One-request FCC Public Map Data API check from a CI runner.

Sends a single GET to listAsOfDates with the documented username and
hash_value headers and an honest User-Agent. Prints only the UTC time,
HTTP status and declared response format. Never prints credentials,
response headers or bodies. Standard library only.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

URL = 'https://bdc.fcc.gov/api/public/map/listAsOfDates'
UA = 'KampTrail coverage importer (+https://github.com/prowebpromo/kamptrail)'
KIND = {'application/json': 'JSON', 'application/problem+json': 'JSON', 'text/html': 'HTML'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    user, token = os.environ.get('FCC_USERNAME', '').strip(), os.environ.get('FCC_TOKEN', '').strip()
    if not user or not token:
        print('FCC_USERNAME or FCC_TOKEN is not set. No request was sent.')
        return 2
    stamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    req = urllib.request.Request(URL, headers={'username': user, 'hash_value': token, 'User-Agent': UA,
                                              'Accept': 'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=90) as r:
            status, media, body = r.getcode(), r.headers.get('Content-Type', ''), r.read(2_000_000)
    except urllib.error.HTTPError as e:
        status, media, body = e.code, (e.headers or {}).get('Content-Type', ''), b''
        e.close()
    except Exception as e:
        print(f'{stamp} | connection failed ({type(e).__name__}). No details logged.')
        return 1
    kind = KIND.get(media.split(';', 1)[0].strip().lower(), 'other/unspecified')
    dates = 0
    if status == 200:
        try:
            dates = sum(1 for row in json.loads(body).get('data', []) if isinstance(row, dict) and row.get('data_type') == 'availability')
        except Exception:
            dates = -1
    verdict = ('authentication succeeded' if status == 200 and dates > 0 else
               'account or token rejected by the API' if status in (401, 403) and kind == 'JSON' else
               'block page, source unconfirmed' if status == 403 and kind == 'HTML' else 'unexpected response')
    print(f'{stamp} | HTTP {status} | format {kind} | availability dates {dates if status == 200 else "n/a"} | {verdict}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
