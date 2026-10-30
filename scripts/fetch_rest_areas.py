#!/usr/bin/env python3
"""Import the official TxDOT rest-area list. A parking duration is not overnight permission."""
import argparse
import datetime as dt
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import tempfile
import urllib.parse
import urllib.request

from build_agency_states import StateBoundaries, valid_point

ROOT = Path(__file__).resolve().parents[1]
LIST_URL = 'https://www.txdot.gov/discover/rest-areas-travel-information-centers/safety-rest-area-list.html'
POLICY_URL = 'https://www.txdot.gov/discover/rest-areas-travel-information-centers/safety-rest-area-map.html'
DETAIL = re.compile(r'https://www\.txdot\.gov/discover/rest-areas-travel-information-centers/safety-rest-area-list/[a-z0-9-]+\.html\Z')
HEADERS = ['Rest area name', 'Location', 'Mile post', 'Latitude', 'Longitude']
LIMIT = 2_000_000


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def clean(text):
    return re.sub(r'\s+', ' ', text).strip()


class Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.depth, self.table, self.row, self.cell = [], 0, None, None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self.depth += 1
            if self.depth == 1:
                self.table = []
        elif self.depth == 1 and tag == 'tr':
            self.row = []
        elif self.depth == 1 and tag in ('td', 'th') and self.row is not None:
            self.cell = {'text': '', 'links': []}
        elif tag == 'a' and self.cell is not None:
            self.cell['links'].append(dict(attrs).get('href', ''))

    def handle_data(self, text):
        if self.cell is not None:
            self.cell['text'] += text

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.cell['text'] = clean(self.cell['text'])
            self.row.append(self.cell)
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.table.append(self.row)
            self.row = None
        elif tag == 'table' and self.depth:
            if self.depth == 1:
                self.tables.append(self.table)
            self.depth -= 1


def parse_list(raw, boundaries):
    if not raw or len(raw) > LIMIT:
        raise ValueError('Rest-area page size outside bound')
    parser = Tables()
    parser.feed(raw.decode('utf-8', errors='strict'))
    tables = [t for t in parser.tables if t and [c['text'] for c in t[0]] == HEADERS]
    if len(tables) != 1:
        raise ValueError('Official table header changed or is ambiguous')
    source_rows = tables[0][1:]
    if not 50 <= len(source_rows) <= 150:
        raise ValueError('Unexpected official list count; previous catalogue retained')
    records, excluded, seen = [], [], set()
    for cells in source_rows:
        if len(cells) != 5:
            raise ValueError('Malformed official row')
        name, location, milepost, lat, lng = [c['text'] for c in cells]
        if name.startswith('Texas Travel Information Center at '):
            excluded.append({'name': name, 'reason': 'travel_information_center_outside_pilot_scope'})
            continue
        if len(cells[0]['links']) != 1:
            raise ValueError('Official row has no unique detail identity')
        url = urllib.parse.urljoin(LIST_URL, cells[0]['links'][0])
        if not DETAIL.fullmatch(url) or not name or len(name.encode()) > 200 or len(location.encode()) > 800:
            raise ValueError('Unapproved official detail URL or row text')
        coordinates = [float(lng), float(lat)]
        if not valid_point(coordinates):
            raise ValueError('Invalid official coordinates')
        # The official list has no native facility ID. Keep its exact URL+label,
        # rather than claiming proximity/name equivalence to an OSM campsite.
        identity = 'txdot:' + hashlib.sha256((url + '\n' + name).encode()).hexdigest()[:24]
        if identity in seen:
            raise ValueError('Duplicate official source identity')
        seen.add(identity)
        records.append({'id': identity, 'name': name, 'coordinates': coordinates,
                        'location': location, 'milepost': milepost or None,
                        'source_url': url, 'state': 'TX', 'permission': 'unknown'})
    assignments = boundaries.classify_many([r['coordinates'] for r in records])
    for row in records:
        match = assignments.get(tuple(row['coordinates']))
        if not match or match['state'] != 'TX':
            raise ValueError('Official rest-area point outside unambiguous Census Texas geometry')
    return sorted(records, key=lambda r: r['id']), excluded, len(source_rows)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError('Official source redirected; review the destination before changing the allowlist')


def fetch(url):
    if url not in (LIST_URL, POLICY_URL):
        raise ValueError('Unapproved official source')
    request = urllib.request.Request(url, headers={'User-Agent': 'KampTrail rest-area importer (+https://github.com/prowebpromo/kamptrail)'})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=60) as response:
        raw = response.read(LIMIT + 1)
        if not raw or len(raw) > LIMIT:
            raise ValueError('Official source response too large or empty')
    return raw, {'url': url, 'sha256': hashlib.sha256(raw).hexdigest(), 'retrieved_at': now(), 'source_updated_at': None}


def write(path, wrapper):
    path = Path(path)
    if path.exists():
        prior = json.loads(path.read_text())
        if len(wrapper['records']) < .7 * len(prior['records']):
            raise ValueError('Unreviewed rest-area source shrink; prior data retained')
        if wrapper['source']['retrieved_at'] < prior['source']['retrieved_at']:
            raise ValueError('Source retrieval date regressed')
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False, encoding='utf-8') as handle:
        json.dump(wrapper, handle, ensure_ascii=False, separators=(',', ':'))
        handle.write('\n')
        temporary = Path(handle.name)
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'data/rest-areas/TX.json')
    args = parser.parse_args()
    raw, source = fetch(LIST_URL)
    records, excluded, count = parse_list(raw, StateBoundaries())
    policy_raw, policy_source = fetch(POLICY_URL)
    text = clean(re.sub('<[^>]+>', ' ', policy_raw.decode('utf-8')))
    # This exact duration statement is distinct from restrooms being open 24h.
    if not re.search(r'Visitor length of stay:\s*up to 24 hours under Texas Transportation Code 545\.411', text, re.I):
        raise ValueError('Official duration wording changed; review before publishing')
    wrapper = {'version': 1, 'region': 'TX', 'source': source,
               'duration_context': {'maximum_hours': 24, 'source': policy_source},
               'records': records}
    write(args.output, wrapper)
    report = {'source': source, 'duration_context': wrapper['duration_context'], 'page_rows': count,
              'rest_areas': len(records), 'excluded': excluded,
              'permission_status': 'unknown for every imported location',
              'sample': records[:2]}
    report_path = ROOT / 'docs/REST_AREAS_PILOT_2.15.json'
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ('excluded', 'sample')}))


if __name__ == '__main__':
    main()
