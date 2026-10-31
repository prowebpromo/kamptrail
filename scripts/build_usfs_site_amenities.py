#!/usr/bin/env python3
"""Build Forest Service water and restroom statements for Recreation.gov-linked campgrounds.

Source: USDA Forest Service EDW Recreation Sites layer. A KampTrail campground
joins only when its Recreation.gov facility ID (catalogue identity ``ridb:<id>``,
primary or legacy alias) exactly equals a record's ``rec1stop_id``. The agency's
own text is kept verbatim. A normalized class is added only when the text is
explicit. Ambiguous text, blank text and absence stay unknown. Nothing is
inferred for a campground without a match, and nothing is merged with the
Recreation.gov campsite-record amenity file.

Standard library only. Use --snapshot for a saved download, otherwise the
public layer is queried in pages of object IDs. Any failed check leaves the
previous output file untouched.
"""
import argparse
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_ridb_sites import ROOT, catalogue_facilities  # noqa: E402

LAYER_URL = 'https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0'
SOURCE_NAME = 'USDA Forest Service Recreation Site record'
LICENSE = 'CC BY 4.0'
FIELDS = ['site_cn', 'public_site_name', 'site_name', 'site_type', 'rec1stop_id', 'water_availability',
          'restroom_availability', 'open_season', 'season_description', 'infra_last_update', 'edw_last_modify']
WHERE = 'rec1stop_id IS NOT NULL'
PAGE = 500
# Sanity ranges for the whole layer subset and for catalogue matches.
ROWS_RANGE = (1500, 8000)
MATCH_RANGE = (300, 2000)
MATCH_KEEP = 0.8  # fail if matches drop below this share of the saved file
ID_PATTERN = re.compile(r'[1-9][0-9]*')
# Same limits data-quality.js enforces when the page validates the file.
LIMITS = {'text': 600, 'name': 160, 'type': 80, 'cn': 40, 'records': 25, 'facilities': 3000}

# ---------------------------------------------------------------- normalization
SPACE = re.compile(r'\s+')


def clean_text(value):
    """Exact agency text apart from outer whitespace. Blank and the literal null are no text."""
    if not isinstance(value, str):
        return None
    text = value.strip()
    return None if not text or text.lower() == 'null' else text


def fold(text):
    return SPACE.sub(' ', text.lower().replace('’', "'")).strip()


# Statements about a current outage or limited condition are never turned into a class.
WATER_TEMPORARY = re.compile(r"\b(currently|temporar|non-?functioning|not (operational|working|functioning)|discontinued|damaged|"
                             r"off ?line|off for the|unavailable|periods of|winter|summer|shut off|turned off)")
WATER_NEGATIVE = re.compile(
    r"\bno (drinking|potable) water\b|\bnon-? ?potable\b|\bnot potable\b|\bno potable\b"
    r"|\b(drinking|potable) water (is |are )?not (provided|available)\b|\bpotable water not available\b"
    r"|\bnot for (human )?(drinking|consumption)\b|\bwater can be treated or filtered\b")
WATER_NONE = re.compile(r"^(no|no water|no water is available|no water available)$"
                        r"|\bno water (is )?available\b|\bno water\b(?![- ]?hook)|^none (available|on site)"
                        r"|^water is not (provided|available)\b")
WATER_NONE_LEAD = re.compile(r"(no water (is )?available|water is not (provided|available))\b")
WATER_POSITIVE = re.compile(r"\bdrinking water\b|\bpotable\b|\bhand ?pump (for )?drinking\b")
WATER_PARTIAL = re.compile(r"\bnearby\b|\bat sites? #?\d")
HAND_PUMP = re.compile(r"\bhand ?-?pumps?\b")
SEASONAL = re.compile(r"\bseasonal(ly)?\b|\bseason\b")


def classify_water(text):
    """Return (class, qualifiers) from the Forest Service water statement."""
    text = clean_text(text)
    if text is None:
        return 'unknown', []
    t = fold(text)
    if WATER_TEMPORARY.search(t):
        return 'unknown', []
    rest = WATER_NEGATIVE.sub(' ', t)
    negative = rest != t
    positive = bool(WATER_POSITIVE.search(rest))
    stripped = t.strip(' .!')
    if not negative and WATER_NONE_LEAD.match(t):
        return 'no_water', []  # "No water available. Bring drinking water." is a statement of no water
    if positive and (negative or WATER_NONE.search(t) or WATER_PARTIAL.search(t)):
        return 'unknown', []
    if positive:
        qualifiers = [q for q, pattern in (('hand_pump', HAND_PUMP), ('seasonal', SEASONAL)) if pattern.search(t)]
        return 'drinking_water', qualifiers
    if WATER_NONE.search(stripped) or WATER_NONE.search(t):
        return 'no_water', []
    if negative:
        return 'no_drinking_water', []
    return 'unknown', []


TOILET_NONE = re.compile(r"^(no( restrooms?| toilets?)?( available)?|no restrooms?|no toilets?)$")
TOILET_FLUSH = re.compile(r"\bflush(ing)?\b(?! ?able)")
TOILET_VAULT = re.compile(r"\bvault\b|\bpit\b|\bouthouses?\b|\bcomposting\b|\bcompostable\b")
TOILET_NEARBY = re.compile(r"\bavailable nearby\b|\bnearby\b")
ACCESSIBLE = re.compile(r"\baccessible\b")
NOT_ACCESSIBLE = re.compile(r"\b(not|non-?) ?(ada )?accessible\b")
# A negated, closed or outage statement is never a toilet type.
TOILET_NEGATED = re.compile(r"\b(not|no|never|without)\b|\b(closed|closure|unavailable|out of order|non-?functioning|"
                            r"temporar\w*|currently|shut off|turned off|discontinued|removed|damaged|decommissioned)\b")
TOILET_TOPIC = re.compile(r"\b(toilets?|restrooms?|latrines?|outhouses?|privy|privies|vault)\b")
WATER_TOPIC = re.compile(r"\b(water|potable)\b")


def classify_toilet(text):
    """Return (class, qualifiers) from the Forest Service restroom statement."""
    text = clean_text(text)
    if text is None:
        return 'unknown', []
    t = fold(text)
    stripped = t.strip(' .!')
    if TOILET_NONE.fullmatch(stripped):
        return 'no_toilet', []
    if TOILET_NEGATED.search(NOT_ACCESSIBLE.sub(' ', t)):
        return 'unknown', []
    flush, vault, nearby = bool(TOILET_FLUSH.search(t)), bool(TOILET_VAULT.search(t)), bool(TOILET_NEARBY.search(t))
    if nearby:
        # Only a bare statement that restrooms are available nearby is a class. A type plus a nearby place is mixed.
        return ('nearby_only', []) if not flush and not vault and re.search(r"\b(restrooms?|toilets?)\b", t) else ('unknown', [])
    if flush == vault:  # neither type is explicit, or the statement mixes both
        return 'unknown', []
    qualifiers = ['accessible'] if ACCESSIBLE.search(NOT_ACCESSIBLE.sub(' ', t)) else []
    return ('flush' if flush else 'vault_or_pit'), qualifiers


# ---------------------------------------------------------------- building
def iso_day(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return datetime.fromtimestamp(value / 1000, timezone.utc).strftime('%Y-%m-%d')
    except (OverflowError, OSError, ValueError):
        return None


def used_rows(rows):
    """Rows with a Recreation.gov ID, reduced to the fields this feature uses, in a stable order."""
    kept = [{field: row.get(field) for field in FIELDS} for row in rows if row.get('rec1stop_id') is not None]
    return sorted(kept, key=lambda r: str(r['site_cn']))


def rows_digest(rows):
    canonical = json.dumps(rows, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def fit(value, limit):
    """Truncate over-long agency text with an ellipsis so the page validator accepts it."""
    if value is None or len(value) <= limit:
        return value
    return value[:limit - 1].rstrip() + '\u2026'


def statement(text, classifier, topic):
    """Quote text only when it is about the topic or explicitly classified. Off-topic unclassified text is missing."""
    text = clean_text(text)
    if text is None:
        return None
    kind, qualifiers = classifier(text)
    if kind == 'unknown' and not topic.search(fold(text)):
        return None
    item = {'text': fit(text, LIMITS['text']), 'class': kind}
    if qualifiers:
        item['qualifiers'] = qualifiers
    return item


def build(rows, wanted):
    """Return (facilities, stats). Only exact string equality joins a record to a catalogue ID."""
    facilities, matched = {}, set()
    for row in rows:
        rid = row.get('rec1stop_id')
        if not isinstance(rid, str) or rid not in wanted or not ID_PATTERN.fullmatch(rid):
            continue
        matched.add(rid)
        if len(str(row['site_cn'])) > LIMITS['cn']:
            raise ValueError(f"site_cn over {LIMITS['cn']} characters: {row['site_cn']}")
        record = {'cn': str(row['site_cn']),
                  'name': fit(clean_text(row.get('public_site_name')) or clean_text(row.get('site_name')), LIMITS['name']),
                  'type': fit(clean_text(row.get('site_type')), LIMITS['type'])}
        water = statement(row.get('water_availability'), classify_water, WATER_TOPIC)
        toilet = statement(row.get('restroom_availability'), classify_toilet, TOILET_TOPIC)
        if water:
            record['water'] = water
        if toilet:
            record['toilet'] = toilet
        if not water and not toilet:
            continue
        season = {key: clean_text(row.get(field)) for key, field in (('open_season', 'open_season'), ('description', 'season_description'))}
        season = {k: fit(v, LIMITS['text']) for k, v in season.items() if v}
        if season:
            record['season'] = season
        record['updated'] = iso_day(row.get('infra_last_update'))
        record['edw_modified'] = iso_day(row.get('edw_last_modify'))
        facilities.setdefault(rid, {'records': [], 'conflicts': []})['records'].append(record)
    for facility in facilities.values():
        facility['records'].sort(key=lambda r: r['cn'])
        for field in ('water', 'toilet'):
            classes = {r[field]['class'] for r in facility['records'] if field in r} - {'unknown'}
            if len(classes) > 1:
                facility['conflicts'].append(field)
    if len(facilities) > LIMITS['facilities']:
        raise ValueError(f"{len(facilities)} facilities exceed the page limit of {LIMITS['facilities']}")
    for fid, facility in facilities.items():
        if len(facility['records']) > LIMITS['records']:
            raise ValueError(f"Facility {fid} has {len(facility['records'])} records; the page limit is {LIMITS['records']}")
    ordered = {fid: facilities[fid] for fid in sorted(facilities, key=int)}
    stats = {'matched_facilities': len(matched), 'facilities_with_statements': len(ordered),
             'records': sum(len(f['records']) for f in ordered.values())}
    return ordered, stats


def summarize(facilities, wanted_count):
    """Counts reviewers need: classes per field and conflicts, over facilities."""
    out = {'catalogue_ids': wanted_count}
    for field in ('water', 'toilet'):
        classes, conflicts = {}, 0
        for facility in facilities.values():
            if field in facility['conflicts']:
                conflicts += 1
                continue
            known = {r[field]['class'] for r in facility['records'] if field in r} - {'unknown'}
            label = next(iter(known)) if known else ('unknown' if any(field in r for r in facility['records']) else 'no_text')
            classes[label] = classes.get(label, 0) + 1
        out[field] = {'facilities_by_class': dict(sorted(classes.items())), 'conflicts': conflicts}
    return out


def read_snapshot(path):
    data = json.loads(Path(path).read_text())
    rows = data['site']['rows'] if 'site' in data else data['rows']
    if not isinstance(rows, list):
        raise ValueError('Snapshot has no row list')
    return [{k: v for k, v in row.items() if not k.startswith('_')} for row in rows]


def request_json(url, parameters, attempts=3):
    body = urllib.parse.urlencode({'f': 'json', **parameters}).encode()
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=body), timeout=120) as response:
                data = json.load(response)
            break
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(5)
    if not isinstance(data, dict) or 'error' in data:
        raise RuntimeError(f'Forest Service layer error: {data}')
    return data


def fetch_rows():
    """Page through object IDs. Counts must agree at both ends and IDs must be unique."""
    query = f'{LAYER_URL}/query'
    def count():
        n = request_json(query, {'where': WHERE, 'returnCountOnly': 'true'}).get('count')
        if type(n) is not int or not ROWS_RANGE[0] <= n <= ROWS_RANGE[1]:
            raise RuntimeError(f'Unexpected Forest Service record count: {n}')
        return n
    expected = count()
    ids = request_json(query, {'where': WHERE, 'returnIdsOnly': 'true'}).get('objectIds')
    if not isinstance(ids, list) or len(ids) != expected or len(set(ids)) != len(ids):
        raise RuntimeError('Forest Service object IDs do not match the record count')
    rows = []
    for start in range(0, len(ids), PAGE):
        batch = sorted(ids)[start:start + PAGE]
        data = request_json(query, {'objectIds': ','.join(map(str, batch)), 'outFields': ','.join(FIELDS), 'returnGeometry': 'false'})
        features = data.get('features')
        if not isinstance(features, list) or len(features) != len(batch):
            raise RuntimeError('Forest Service page returned an unexpected number of records')
        rows.extend((f.get('attributes') or {}) for f in features)
    if count() != expected:
        raise RuntimeError('Forest Service records changed during the download')
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', help='Saved JSON download (key "site" -> "rows"). Network is not used.')
    parser.add_argument('--retrieved', help='Retrieval date YYYY-MM-DD of the snapshot (required with --snapshot)')
    parser.add_argument('--index', default=str(ROOT / 'data/campsites/search-index.json'))
    parser.add_argument('--out', default=str(ROOT / 'data/campsites/usfs-site-amenities.json'))
    args = parser.parse_args(argv)
    if args.snapshot:
        if not args.retrieved or not re.fullmatch(r'\d{4}-\d\d-\d\d', args.retrieved):
            parser.error('--retrieved YYYY-MM-DD is required with --snapshot')
        datetime.strptime(args.retrieved, '%Y-%m-%d')
        rows, basis, retrieved = read_snapshot(args.snapshot), 'saved_download', args.retrieved
    else:
        rows, basis, retrieved = fetch_rows(), 'layer_query', datetime.now(timezone.utc).strftime('%Y-%m-%d')
    rows = used_rows(rows)
    if not ROWS_RANGE[0] <= len(rows) <= ROWS_RANGE[1]:
        print(f'Forest Service rows out of range: {len(rows)}; saved file kept.', file=sys.stderr)
        return 1
    wanted = catalogue_facilities(args.index)
    try:
        facilities, stats = build(rows, wanted)
    except ValueError as error:
        print(f'{error}; saved file kept.', file=sys.stderr)
        return 1
    out = Path(args.out)
    if not MATCH_RANGE[0] <= stats['matched_facilities'] <= MATCH_RANGE[1]:
        print(f"Catalogue matches out of range: {stats['matched_facilities']}; saved file kept.", file=sys.stderr)
        return 1
    if out.exists():
        try:
            previous = json.loads(out.read_text())['source']['matched_facilities']
        except (OSError, ValueError, KeyError, TypeError):
            previous = 0
        if stats['matched_facilities'] < previous * MATCH_KEEP:
            print(f"Catalogue matches fell from {previous} to {stats['matched_facilities']}; saved file kept.", file=sys.stderr)
            return 1
    source = {'name': SOURCE_NAME, 'layer_url': LAYER_URL, 'license': LICENSE, 'basis': basis, 'retrieved': retrieved,
              'fields': FIELDS, 'where': WHERE, 'rows_used': len(rows), 'rows_sha256': rows_digest(rows),
              'rows_sha256_basis': 'Canonical JSON (sorted keys, compact separators, UTF-8) of the used fields for every row with a rec1stop_id, ordered by site_cn',
              **stats}
    payload = {'version': 1, 'source': source, 'facilities': facilities}
    temporary = out.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(payload, separators=(',', ':'), ensure_ascii=False) + '\n')
    temporary.replace(out)
    print(f"Forest Service site amenities: {stats['matched_facilities']} matched IDs, "
          f"{stats['facilities_with_statements']} with statements, {stats['records']} records")
    print(json.dumps(summarize(facilities, len(wanted)), indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
