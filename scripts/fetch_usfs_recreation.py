#!/usr/bin/env python3
"""Import public USFS EDW camping opportunities and secondary camping activities.

Both views permit public distribution and refresh nightly. The refresh is not a
record-level fee verification date. Complete every query before replacing data.
"""
import hashlib
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from functools import lru_cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fee_text  # noqa: E402
import recheck_usfs_fee_pages as fee_rechecks  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0/query'
ACTIVITY_URL = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationAreaActivities_01/MapServer/0/query'
ACTIVITIES = ('Campground Camping', 'Dispersed Camping', 'RV Camping', 'Group Camping', 'Horse Camping', 'OHV Camping')
FIELDS = 'objectid,recareaid,recareaname,latitude,longitude,recareaurl,forestname,markeractivity,feedescription,restrictions,reservation_info,open_season_start,open_season_end,openstatus,recareadescription'
ACTIVITY_FIELDS = 'objectid,recareaid,recareaname,markeractivity,activityname,activitydescription'
OUT = ROOT / 'data' / 'sources' / 'usfs.json'
FEE_REVIEWS = Path(__file__).resolve().parent / 'fixtures' / 'usfs_fee_overrides.json'
PAGE_SIZE = 1000
ID_BATCH_SIZE = 100
MAX_ROWS = 30000


def request_json(url, parameters, opener):
    query = urllib.parse.urlencode({'f': 'json', **parameters})
    for attempt in range(3):
        try:
            with opener(f'{url}?{query}', timeout=120) as response:
                data = json.load(response)
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(5)
    if not isinstance(data, dict) or 'error' in data:
        raise RuntimeError(f'USFS service error: {data}')
    return data


def fetch_complete(url, where, fields, opener, geometry=False):
    """Count at both ends and require unique object IDs on bounded ordered pages.

    A public service is not a transaction; these checks catch count changes,
    repeated pages and silent truncation without publishing partial results.
    """
    def count():
        n = request_json(url, {'where': where, 'returnCountOnly': 'true'}, opener).get('count')
        if type(n) is not int or not 0 <= n <= MAX_ROWS:
            raise RuntimeError('Invalid or unbounded USFS query count')
        return n

    expected = count()
    rows, seen, offset = [], set(), 0
    while offset < expected:
        data = request_json(url, {
            'where': where, 'outFields': fields, 'returnGeometry': str(geometry).lower(),
            'outSR': 4326, 'orderByFields': 'objectid', 'resultOffset': offset,
            'resultRecordCount': min(PAGE_SIZE, expected - offset),
        }, opener)
        page = data.get('features')
        if not isinstance(page, list) or not page or len(page) > PAGE_SIZE:
            raise RuntimeError('USFS returned an incomplete or oversized page')
        for feature in page:
            attributes = feature.get('attributes') if isinstance(feature, dict) else None
            if not isinstance(attributes, dict):
                raise RuntimeError('Malformed USFS feature')
            oid = attributes.get('objectid')
            if type(oid) is not int or oid in seen:
                raise RuntimeError('Missing or repeated USFS objectid during pagination')
            seen.add(oid)
            row = dict(attributes)
            if geometry:
                # Key presence distinguishes live rows from older callers.
                row['_geometry'] = feature.get('geometry')
            rows.append(row)
        offset += len(page)
        if offset > expected or (offset == expected and data.get('exceededTransferLimit')):
            raise RuntimeError('USFS count/transfer limit disagreement')
        if offset < expected and data.get('exceededTransferLimit') is False:
            raise RuntimeError('USFS ended pagination before the expected count')
    if count() != expected:
        raise RuntimeError('USFS query changed during pagination; retry the whole import')
    return rows


def record_id(value):
    if isinstance(value, bool) or not re.fullmatch(r'[1-9][0-9]{0,9}', str(value)):
        raise RuntimeError('Invalid USFS recareaid')
    return int(value)


def fetch_all(opener=urllib.request.urlopen):
    categories = ','.join(f"'{a}'" for a in ACTIVITIES)
    primary = fetch_complete(URL, f'markeractivity IN ({categories})', FIELDS, opener, geometry=True)
    rows = {}
    for row in primary:
        rid = record_id(row.get('recareaid'))
        if rid in rows:
            raise RuntimeError('Duplicate USFS opportunity recareaid')
        row['_camping_activities'] = [row['markeractivity']]
        row['_discovery'] = 'primary_markeractivity'
        rows[rid] = row
    # Name limits transfer volume, not eligibility: validate joined descriptions.
    where = (f'activityname IN ({categories}) AND '
             f'(markeractivity NOT IN ({categories}) OR markeractivity IS NULL) '
             "AND UPPER(recareaname) LIKE '%CAMP%'")
    activities = fetch_complete(ACTIVITY_URL, where, ACTIVITY_FIELDS, opener)
    by_id = {}
    for activity in activities:
        rid = record_id(activity.get('recareaid'))
        if activity.get('activityname') not in ACTIVITIES:
            raise RuntimeError('USFS activity query returned an unexpected category')
        by_id.setdefault(rid, []).append(activity)
    missing = sorted(set(by_id) - set(rows))
    for start in range(0, len(missing), ID_BATCH_SIZE):
        batch = missing[start:start + ID_BATCH_SIZE]
        joined = fetch_complete(URL, 'recareaid IN (' + ','.join(map(str, batch)) + ')', FIELDS, opener, geometry=True)
        found = set()
        for row in joined:
            rid = record_id(row.get('recareaid'))
            if rid not in batch or rid in found:
                raise RuntimeError('Unexpected or duplicate USFS joined opportunity')
            found.add(rid)
            row['_discovery'] = 'secondary_activity'
            rows[rid] = row
        if found != set(batch):
            raise RuntimeError('USFS secondary activity join is incomplete')
    for rid, activity_rows in by_id.items():
        row = rows[rid]
        row['_camping_activities'] = sorted(set(row.get('_camping_activities', [])) |
                                             {a['activityname'] for a in activity_rows})
        row['_activity_descriptions'] = list(dict.fromkeys(
            fee_text.clean(a.get('activitydescription')) for a in activity_rows if fee_text.clean(a.get('activitydescription'))))
    return [rows[rid] for rid in sorted(rows)]


NAMED_CAMP = re.compile(r'\b(?:campgrounds?|campsites?|camp(?:ing)?\s+(?:area|site)s?|dispersed\s+camping|(?:horse|hunt|group)\s+camp)\b|\bcamp$', re.I)
ADMINISTRATIVE = re.compile(r'\b(?:ranger\s+district|national\s+(?:forest|grassland)|visitor\s+center|historic\s+(?:site|district)|general\s+campgrounds)\b', re.I)
UMBRELLA = re.compile(r'\b(?:eight|8|several|multiple)\s+(?:main\s+)?(?:areas?\s+for\s+dispersed\s+camping|(?:designated\s+)?(?:camping\s+areas|campgrounds))\b|\bthese\s+designated\s+dispersed\s+camping\s+areas\b', re.I)
ONSITE = re.compile(r'\b(?:campground|campsites?|camp\s+(?:units?|sites?|areas?)|camping\s+(?:sites?|spots?|area)|(?:horse|hunt)\s+camp)\b|\bdispersed\s+camping\s+(?:is\s+)?(?:available|along)\b', re.I)
NO_ONSITE = re.compile(r'\b(?:camping|overnight\s+(?:camping|use|parking))\s+(?:is\s+)?(?:not\s+(?:allowed|permitted)|prohibited)|\bno\s+(?:overnight\s+)?camping\b(?!\s+(?:fees?|charge))', re.I)


def secondary_rejection(row):
    if row.get('_discovery') != 'secondary_activity':
        return None
    name = fee_text.clean(row.get('recareaname'))
    description = fee_text.clean(row.get('recareadescription'))
    activity_text = ' '.join(row.get('_activity_descriptions', []))
    context = ' '.join([description, activity_text, fee_text.clean(row.get('restrictions'))])
    if not set(row.get('_camping_activities', [])) & set(ACTIVITIES):
        return 'no_verified_camping_activity'
    if not NAMED_CAMP.search(name) or ADMINISTRATIVE.search(name):
        return 'not_a_named_camping_location'
    if re.search(r'\b(?:picnic|day[ -]use|trailhead)\b', name, re.I) and not re.search(r'\b(?:campground|campsite|camping\s+area)\b', name, re.I):
        return 'picnic_dayuse_or_trailhead_location_ambiguous'
    if UMBRELLA.search(context) or row.get('markeractivity') in ('Forest Service Shield', 'Intermediate Parent Group'):
        return 'administrative_or_multiple_location_umbrella'
    if NO_ONSITE.search(context):
        return 'onsite_camping_prohibited_or_ambiguous'
    if not ONSITE.search(description + ' ' + activity_text):
        return 'no_explicit_onsite_camping_evidence'
    if re.search(r'\btrailhead\b', name, re.I) and not re.search(r'\bcampground\b', name, re.I):
        if not re.search(r'\b(?:campsites?\s+(?:at|here)|camping\s+(?:is\s+)?available\s+(?:at\s+the\s+trailhead|here))\b', context, re.I):
            return 'trailhead_camping_location_ambiguous'
    if re.search(r'\b(?:near(?:by)?|access\s+to|leads?\s+to|outside\s+the\s+(?:site|gates))\b[^.!?]{0,80}\b(?:campgrounds?|campsites?|camping)\b', context, re.I):
        return 'nearby_camping_is_not_onsite_evidence'
    return None


def coordinates(row):
    def valid(x, y):
        return math.isfinite(x) and math.isfinite(y) and -180 <= x <= 180 and -90 <= y <= 90 and (x, y) != (0, 0)
    try:
        attr = float(row['longitude']), float(row['latitude'])
        if not valid(*attr):
            attr = None
    except (KeyError, TypeError, ValueError):
        attr = None
    if '_geometry' not in row:
        return attr, None if attr else 'invalid_attribute_coordinates'
    try:
        geometry = row['_geometry']
        point = float(geometry['x']), float(geometry['y'])
        if not valid(*point):
            raise ValueError('invalid')
    except (KeyError, TypeError, ValueError):
        return None, 'missing_or_invalid_official_geometry'
    if attr:
        distance = 111000 * math.hypot((point[0] - attr[0]) * math.cos(math.radians(point[1])), point[1] - attr[1])
        if distance > 1000:
            return None, 'geometry_attribute_disagreement_over_1km'
    return point, None


def restriction_qualification(text):
    """Restrictions can qualify an existing free fee, never establish one.

    General descriptions are not fee inputs. Preserve all their text as context
    rather than extracting an apparently free sentence from another campground.
    Ignore permits for ancillary activities when they do not concern camping.
    """
    clauses = re.split(r'(?<=[.!?;])\s+', fee_text.clean(text))
    relevant = []
    for clause in clauses:
        if re.search(r'\b(?:fishing|hunting|camp\s*fires?|firewood|propane|cooking|stoves?)\b', clause, re.I) and not re.search(r'\b(?:camping|overnight|vehicle|adventure\s+pass)\b', clause, re.I):
            continue
        if re.search(r'\b(?:near(?:by)?|other\s+campgrounds?|elsewhere)\b', clause, re.I):
            continue
        negated_charge = re.search(r'\bno\s+(?:camping\s+)?fees?\s+(?:apply|are\s+(?:charged|collected))\b|\bfees?\s+(?:are\s+)?not\s+(?:charged|collected|required)\b', clause, re.I)
        charge_or_season = re.search(r'\bfees?\s+(?:apply|are\s+(?:charged|collected))\b|\bcamping\s+(?:costs?|fees?)\b[^.!?]*\$|\bcamping\s+is\s+(?:not|no\s+longer)\s+free\b|\b(?:no\s+fees?|free)\b[^.!?]{0,30}\b(?:only|during|after|before|winter|summer|season)\b', clause, re.I)
        if fee_text.required_pass(clause) or (charge_or_season and not negated_charge):
            relevant.append(clause)
    return ' '.join(relevant)


@lru_cache(maxsize=1)
def load_fee_reviews():
    """Load maintained official observations; malformed evidence fails closed."""
    data = json.loads(FEE_REVIEWS.read_text())
    if data.get('schema_version') != 1 or not isinstance(data.get('records'), list):
        raise RuntimeError('Invalid USFS maintained fee evidence')
    reviews = {}
    for record in data['records']:
        rid = record_id(record.get('recareaid'))
        if (rid in reviews or record.get('source') != 'US Forest Service' or
                not all(isinstance(record.get(k), str) and record[k].strip() for k in ('name', 'text', 'source_field')) or
                len(record['text']) > 20000):
            raise RuntimeError('Duplicate or incomplete USFS maintained fee evidence')
        parsed = urllib.parse.urlsplit(record.get('source_url', ''))
        if parsed.scheme != 'https' or parsed.hostname != 'www.fs.usda.gov' or parsed.username or parsed.password:
            raise RuntimeError('USFS fee review must identify an official source')
        checked = date.fromisoformat(record['retrieved_at'])
        if record.get('source_updated_at') is not None:
            date.fromisoformat(record['source_updated_at'])
        if record.get('review_after') is not None and date.fromisoformat(record['review_after']) <= checked:
            raise RuntimeError('USFS fee review deadline must follow its observation')
        point = record.get('identity_coordinates')
        if (record.get('review_after') is not None and point is None) or (point is not None and (not isinstance(point, list) or len(point) != 2 or
                not all(type(v) in (int, float) and math.isfinite(v) for v in point) or
                not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90))):
            raise RuntimeError('Invalid USFS review identity coordinates')
        context = record.get('context', [])
        if not isinstance(context, list) or len(context) > 10 or any(
                not isinstance(c, dict) or not isinstance(c.get('source_field'), str) or not c['source_field'].strip() or not isinstance(c.get('text'), str)
                or not c['text'].strip() or len(c['text']) > 20000 for c in context):
            raise RuntimeError('Invalid USFS review context')
        reviews[rid] = record
    return reviews


def applicable_fee_review(row, retrieved):
    """Keep a reviewed page tied to one named location and its review window.

    A public website ID, not a nearby name, identifies the site. A changed name
    or a point displaced by more than the existing 300 m identity radius needs
    review. Expired positive observations cannot promote an unknown fee.
    """
    review = load_fee_reviews().get(record_id(row.get('recareaid')))
    if not review or fee_text.clean(review['name']).casefold() != fee_text.clean(row.get('recareaname')).casefold():
        return None
    checked = date.fromisoformat(retrieved)
    if checked < date.fromisoformat(review['retrieved_at']):
        return None
    automated = fee_rechecks.validation(review, checked)
    if automated is False:
        return None
    if automated is not True and review.get('review_after') and checked >= date.fromisoformat(review['review_after']):
        return None
    expected = review.get('identity_coordinates')
    if review.get('review_after') and expected is None:
        return None
    if expected is not None:
        point, reason = coordinates(row)
        if reason:
            return None
        delta_lon = (point[0] - expected[0] + 180) % 360 - 180
        distance = 111195 * math.hypot(point[1] - expected[1], delta_lon * math.cos(math.radians((point[1] + expected[1]) / 2)))
        if distance > 300:
            return None
    return review


def to_feature(row, retrieved):
    if secondary_rejection(row):
        return None
    point, reason = coordinates(row)
    if reason:
        return None
    name = fee_text.clean(row.get('recareaname'))
    if not name or row.get('recareaid') in (None, ''):
        return None
    rid = record_id(row['recareaid'])
    url = row.get('recareaurl') or f'https://www.fs.usda.gov/recarea/{rid}'
    wording = fee_text.clean(row.get('feedescription'))
    status, cost = fee_text.classify(wording)
    base_status, base_cost = status, cost
    source_field = 'feedescription'
    qualification = restriction_qualification(row.get('restrictions'))
    if status == 'free' and qualification:
        status, cost = 'conditional', None
    evidence = []
    for field in ('feedescription', 'recareadescription', 'restrictions'):
        text = fee_text.clean(row.get(field))
        if not text:
            continue
        classification_text = text if field == 'feedescription' else ''
        evidence.append({
            'source': 'US Forest Service', 'source_field': field, 'source_record_id': str(rid),
            'source_url': url, 'query_url': URL, 'retrieved_at': retrieved,
            'source_updated_at': None, 'text': text,
            'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(),
            'classification_text': classification_text,
            'qualification_text': qualification if field == 'restrictions' else '',
        })
    conflict = False
    review = applicable_fee_review(row, retrieved)
    if review:
        automated = fee_rechecks.load_checks() or {}
        automated = automated.get(rid) if fee_rechecks.validation(review, date.fromisoformat(retrieved)) is True else None
        text = fee_text.clean(review['text'])
        reviewed_status, reviewed_cost = fee_text.classify(text)
        evidence.append({
            'source': review['source'], 'source_field': review['source_field'],
            'source_record_id': str(rid), 'source_url': review['source_url'],
            'retrieved_at': review['retrieved_at'], 'source_updated_at': review.get('source_updated_at'),
            'source_updated_at_basis': review.get('source_updated_at_basis'),
            'text': text, 'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(),
            'classification_text': text, 'evidence_kind': 'maintained_official_page_observation',
            **({'automated_check': {'checked_at': automated['checked_at'], 'valid_until': automated['valid_until'],
                'basis': 'Approved complete main-page text and links, fee section, identity and notice dependencies unchanged',
                'page_sha256': automated['page_sha256']}} if automated else {}),
        })
        for context in review.get('context', []):
            context_text = fee_text.clean(context['text'])
            evidence.append({
                'source': review['source'], 'source_field': context['source_field'],
                'source_record_id': str(rid), 'source_url': review['source_url'],
                'retrieved_at': review['retrieved_at'], 'source_updated_at': review.get('source_updated_at'),
                'text': context_text, 'sha256': hashlib.sha256(context_text.encode('utf-8')).hexdigest(),
                'classification_text': '', 'evidence_kind': 'maintained_official_page_context',
            })
        conflict = ({base_status, reviewed_status} == {'free', 'paid'} or
                    (base_status == reviewed_status == 'paid' and base_cost is not None and
                     reviewed_cost is not None and base_cost != reviewed_cost))
        if conflict:
            status, cost = 'unknown', None
        elif base_status == 'unknown' and reviewed_status != 'unknown' and review.get('review_after'):
            status, cost = reviewed_status, reviewed_cost
            wording, source_field = text, review['source_field']
        elif status == 'free' and reviewed_status == 'conditional':
            status, cost = 'conditional', None
            wording, source_field = text, review['source_field']
        # Mandatory camping/access permits still qualify an otherwise free fee.
        if status == 'free' and qualification:
            status, cost = 'conditional', None
    activities = row.get('_camping_activities') or ([row['markeractivity']] if row.get('markeractivity') in ACTIVITIES else [])
    camping_activity = row.get('markeractivity') if row.get('markeractivity') in ACTIVITIES else next((a for a in ACTIVITIES if a in activities), None)
    props = {
        'id': f'usfs:{rid}', 'name': name[:160],
        'type': 'dispersed' if 'Dispersed Camping' in activities else 'established',
        'source': 'US Forest Service', 'sources': ['US Forest Service'], 'source_url': url,
        'camping_activity': camping_activity, 'camping_activities': activities,
        'operator': row.get('forestname') or None,
        'fee_status': status, 'cost': cost, 'fee_text': wording or None,
        'fee_source': 'US Forest Service', 'fee_source_field': source_field,
        'fee_checked': review['retrieved_at'] if review and source_field == review['source_field'] else retrieved,
        'fee_evidence_records': evidence,
        'fee_conflict': conflict, 'fee_evidence_conflict': conflict,
        'fee_conflict_note': 'Official agency fee sources disagree; check the current site page before travel.' if conflict else None,
        'schema_version': 3,
        'field_provenance': {
            'cost': f'USFS official campground page {source_field}' if source_field.startswith('official_page.') else f'USFS Recreation Opportunities {source_field}',
            'camping_activities': 'USFS Recreation Area Activities activityname' if row.get('_discovery') == 'secondary_activity' else 'USFS Recreation Opportunities markeractivity',
            'coordinates': 'USFS EDW geometry outSR=4326' if '_geometry' in row else 'USFS EDW longitude/latitude attributes',
        },
        'retrieved_at': retrieved, 'source_updated_at': None,
        'discovery_method': row.get('_discovery', 'primary_markeractivity'),
        'open_status': (row.get('openstatus') or '').strip().lower() or None,
        'season': ' to '.join(v for v in (row.get('open_season_start'), row.get('open_season_end')) if v) or None,
        'restrictions': fee_text.clean(row.get('restrictions')) or None,
        'description': fee_text.clean(row.get('recareadescription')) or None,
        'reservation_info': fee_text.clean(row.get('reservation_info')) or None,
        'activity_descriptions': row.get('_activity_descriptions', []),
        'amenities': [], 'rig_friendly': ['rv'] if 'RV Camping' in activities else [],
    }
    return {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(v, 6) for v in point]}, 'properties': props}


def main():
    retrieved = fee_text.retrieval_date()
    rows = fetch_all()
    features, quarantined = [], []
    for row in rows:
        feature = to_feature(row, retrieved)
        if feature:
            features.append(feature)
        else:
            reason = secondary_rejection(row) or coordinates(row)[1] or 'missing_name_or_id'
            quarantined.append({'id': f"usfs:{row.get('recareaid')}", 'reason': reason})
    previous = 0
    if OUT.exists():
        try:
            previous = len(json.loads(OUT.read_text()).get('features', []))
        except ValueError:
            pass
    if not features or (previous and len(features) < previous * 0.7):
        raise RuntimeError(f'USFS returned {len(features)} camping records, down from {previous}. Saved data kept.')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix('.json.tmp')
    tmp.write_text(json.dumps({
        'type': 'FeatureCollection', 'source': 'US Forest Service Recreation Opportunities and Area Activities (EDW)',
        'retrieved': retrieved, 'features': features, 'quarantined_source_records': quarantined,
    }, separators=(',', ':')))
    tmp.replace(OUT)
    counts = {}
    for feature in features:
        status = feature['properties']['fee_status']
        counts[status] = counts.get(status, 0) + 1
    print(f'usfs.json: {len(features)} camping records, fee status {counts}; {len(quarantined)} quarantined')


if __name__ == '__main__':
    main()
