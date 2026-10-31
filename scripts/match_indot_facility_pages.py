"""Match INDOT facility fact pages to KampTrail Indiana rest-area records.

Usage: python3 scripts/match_indot_facility_pages.py data/rest-areas/IN.json <page_dir> <out.json>
A page counts only when its location text is identical to the record and its GPS point is within 500 m.
The output is reviewed by hand before it is copied into scripts/fixtures/rest_area_state_policies.json.
"""
import datetime as dt, hashlib, html, json, math, re, sys, urllib.request
from pathlib import Path

BASE = 'https://www.in.gov/indot/resources/maps/welcome-centers-and-rest-areas/'
SLUGS = {  # candidate pages; a match still requires identical Location text and GPS within 500 m
    'Greenfield Rest Area Westbound': 'greenfield-rest-area-westbound',
    'Spring Creek Welcome Center': 'spring-creek-welcome-center',
    'Henryville Rest Area Southbound': 'henryville-rest-area-southbound',
    'Kankakee Welcome Center': 'kankakee-rest-area-southbound',
    'Michigan City Welcome Center': 'michigan-city-welcome-center',
    'Clear Creek Welcome Center': 'clear-creek-welcome-center',
    'Black River Welcome Center': 'black-river-welcome-center',
    'Nancy Hanks Rest Area Westbound': 'nancy-hanks-rest-area-westbound',
    'Lizton Rest Area Westbound': 'lizton-rest-area-westbound',
    'Pigeon Creek Welcome Center': 'pigeon-creek-welcome-center',
    'Plainfield Rest Area Eastbound': 'plainfield-rest-area-eastbound',
    'Greenfield Rest Area Eastbound': 'greenfield-rest-area-eastbound',
    'Henryville Rest Area Northbound': 'henryville-rest-area-northbound',
    'Lizton Rest Area Eastbound': 'lizton-rest-area-eastbound',
    'Batesville Westbound Welcome Center': 'batesville-welcome-center',
    'Plainfield Rest Area - Westbound': 'plainfield-rest-area-westbound',
}


def text(raw):
    s = re.sub(r'<script.*?</script>|<style.*?</style>', '', raw, flags=re.S)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s)))


def dms(v):
    m = re.fullmatch(r'([NSEW])(\d+)-(\d+)-([\d.]+)', v)
    d = int(m[2]) + int(m[3]) / 60 + float(m[4]) / 3600
    return -d if m[1] in 'SW' else d


def metres(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[1], a[0], b[1], b[0]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def main(catalogue, pages, out):
    data = json.loads(Path(catalogue).read_text())
    records = data.get('records') or data['features']
    exceptions, report = [], []
    for r in records:
        slug = SLUGS.get(r['name'])
        if not slug:
            report.append((r['name'], 'no INDOT facility page found'))
            continue
        url = BASE + slug
        with urllib.request.urlopen(url, timeout=30) as resp:
            raw = resp.read()
            last_mod = resp.headers.get('Last-Modified')
        now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
        (Path(pages) / f'{slug}.html').write_bytes(raw)
        t = text(raw.decode('utf-8', 'replace'))
        loc = re.search(r'(?:Location: |\*\*\* )(Interstate .*?) GPS Coordinates: (\S+) (\S+)', t)
        night = re.search(r'Overnight Parking: (Yes|No)\b', t)
        if not loc or not night:
            report.append((r['name'], 'page lacks Location or Overnight Parking field'))
            continue
        dist = metres(r['coordinates'], (dms(loc[3]), dms(loc[2])))
        if loc[1].strip() != r['location'] or dist > 500:
            report.append((r['name'], f'mismatch: page "{loc[1]}" {dist:.0f} m'))
            continue
        if night[1] != 'No':
            report.append((r['name'], 'page says Overnight Parking: Yes; needs review'))
            continue
        exceptions.append({
            'facility_id': r['id'], 'state': 'IN', 'operator': 'indot',
            'facility_kind': 'rest_area_or_welcome_center',
            'rules': {'overnight_parking': 'prohibited'},
            'conditions': ['INDOT\'s page for this facility lists "Overnight Parking: No". It does not address sleeping in a vehicle or camping.'],
            'sources': [{'url': url, 'retrieved_url': url, 'retrieved_at': now,
                         'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
                         'http_last_modified': last_mod, 'source_updated_at': None}],
            'interpretation': f'Facility page matched by identical location text ("{r["location"]}") and coordinates {dist:.0f} m apart. Its "Overnight Parking: No" field is read as overnight parking not permitted at this facility.',
        })
        report.append((r['name'], f'matched {slug} ({dist:.0f} m)'))
    Path(out).write_text(json.dumps(exceptions, indent=2) + '\n')
    for row in report:
        print(*row, sep=' | ')
    print(len(exceptions), 'exceptions')


if __name__ == '__main__':
    main(*sys.argv[1:])
