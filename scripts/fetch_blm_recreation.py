#!/usr/bin/env python3
"""Fetch BLM camping recreation areas and facilities with their published fee wording.

Source: BLM National Recreation Sites and Facilities map service (public)
https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recreation_Sites_Facilities/MapServer
  layer 2  BLM Natl RIDB Recreation Camping   (RecAreaFeeDescription, StayLimit)
  layer 8  BLM Natl RIDB Facilities Camping   (FacilityUseFeeDescription, StayLimit, Reservable)
Writes data/sources/blm.json. A failed or shrunken fetch raises before writing.
"""
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fee_text  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recreation_Sites_Facilities/MapServer'
OUT = ROOT / 'data' / 'sources' / 'blm.json'
PAGE_SIZE = 1000
MAX_ROWS = 30000
MAX_PAGES = 100
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
LAYERS = {
    2: {'id': 'RecAreaID', 'name': 'RecAreaName', 'fee': 'RecAreaFeeDescription', 'lat': 'RecAreaLatitude', 'lng': 'RecAreaLongitude', 'url': 'BLMRecURL', 'prefix': 'blm-area'},
    8: {'id': 'FacilityID', 'name': 'FacilityName', 'fee': 'FacilityUseFeeDescription', 'lat': 'FacilityLatitude', 'lng': 'FacilityLongitude', 'url': 'BLMFacURL', 'prefix': 'blm-facility'},
}

SITE_NO_FEES = re.compile(r'(?:^|(?<=[.!?])\s+)There are no fees associated with this site(?:[.!](?=\s|$)|$)', re.I)
UNCLEAR_SUBJECT = re.compile(r'\bnearby\b|\b(?:another|other)\s+(?:campgrounds?|campsites?|sites?)\b|\b(?:not true|incorrect|formerly|historically|used to|no longer)\b', re.I)
CAMPING_CHARGE_SENTENCE = re.compile(r'^(?:camping|this campground|these campsites)\s+(?:is not free|costs?\s+\$\s*\d+|fees?\s+(?:apply|are charged))\b', re.I)
SEPARATE_FEE_CONDITION = re.compile(
    r'^(?:camping\s+)?fees?\s+(?:apply|are charged|are collected)\s+(?:in|during|after|before|from|until)\b'
    r'|^(?:this|the no[ -]fee (?:policy|period|status))\s+(?:applies|is available)\s+only\s+(?:in|during|after|before|from|until)\b'
    r'|^(?:camping|this campground|these campsites)\s+(?:is|are)\s+free\s+only\s+(?:in|during|after|before|from|until)\b', re.I)
UNQUALIFIED_SITE_CHARGE = re.compile(r'^(?:camping\s+)?fees?\s+(?:apply|are charged|are collected)[.!]?$', re.I)


def description_fee(row, layer):
    """Recognize only an explicit on-site statement in a camping facility.

    This is not the general fee-text classifier: arbitrary prices, free services,
    and references to nearby camping in a narrative are not fee evidence.
    """
    if layer != 8 or str(row.get('FacilityTypeDescription') or '').strip().lower() != 'campground':
        return 'unknown', None, False
    text = fee_text.clean(row.get('FacilityDescription'))
    if not text or UNCLEAR_SUBJECT.search(text):
        return 'unknown', None, False
    # Source paragraphs can end without punctuation (Graves Creek does). Keep
    # their boundaries for statement matching, without altering stored evidence.
    statements = fee_text.clean(re.sub(r'</?(?:p|div|li|h[1-6])\b[^>]*>|<br\b[^>]*>', '. ',
                                      row.get('FacilityDescription') or '', flags=re.I))
    free = bool(SITE_NO_FEES.search(statements))
    sentences = re.split(r'(?<=[.!?])\s+', statements)
    seasonal = any(SEPARATE_FEE_CONDITION.search(s) for s in sentences)
    paid = any((CAMPING_CHARGE_SENTENCE.search(s) or UNQUALIFIED_SITE_CHARGE.search(s))
               and not SEPARATE_FEE_CONDITION.search(s) for s in sentences)
    if free and paid:
        return 'unknown', None, True
    if free:
        conditional = (seasonal or fee_text.required_pass(text) or fee_text.SEASONAL_FREE.search(text)
                       or fee_text.SEASON_BEFORE_FREE.search(text)
                       or re.search(r'\b(?:extra|additional)\s+(?:vehicles?|campers?)\b[^.!?]{0,80}\$', text, re.I))
        return ('conditional', None, False) if conditional else ('free', 0, False)
    # Paid narrative evidence is used only to detect a contradiction with a
    # known free primary fee; it does not expand the description fallback.
    return ('paid', None, False) if paid else ('unknown', None, False)


def evidence_record(text, field, key, url, retrieved, updated):
    return {'source': 'Bureau of Land Management', 'source_field': field,
            'source_record_id': str(key), 'source_url': url, 'retrieved_at': retrieved,
            'source_updated_at': updated or None, 'text': text,
            'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest()}


def request_json(layer, parameters, opener):
    query = urllib.parse.urlencode({'where': '1=1', 'f': 'json', **parameters})
    for attempt in range(3):
        try:
            with opener(f'{BASE}/{layer}/query?{query}', timeout=120) as response:
                payload = response.read(MAX_RESPONSE_BYTES + 1)
            break
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(5)
    if len(payload) > MAX_RESPONSE_BYTES:
        raise RuntimeError('BLM response exceeds the bounded read limit')
    try:
        data = json.loads(payload)
    except (ValueError, UnicodeError) as exc:
        raise RuntimeError('BLM returned invalid or truncated JSON') from exc
    if not isinstance(data, dict) or 'error' in data:
        raise RuntimeError('BLM returned a service error or malformed response')
    return data


def fetch_layer(layer, opener=urllib.request.urlopen):
    """Require complete, bounded, uniquely identified pages from a fixed layer.

    Counts before and after are consistency checks, not a transactional snapshot.
    Fail rather than publish a changing or truncated response.
    """
    if type(layer) is not int or layer not in LAYERS:
        raise ValueError('Unsupported BLM camping layer')

    def count():
        n = request_json(layer, {'returnCountOnly': 'true'}, opener).get('count')
        if type(n) is not int or not 0 <= n <= MAX_ROWS:
            raise RuntimeError('Invalid or unbounded BLM query count')
        return n

    expected = count()
    rows, seen, pages = [], set(), 0
    while len(rows) < expected:
        pages += 1
        if pages > MAX_PAGES:
            raise RuntimeError('BLM pagination exceeds the page limit')
        requested = min(PAGE_SIZE, expected - len(rows))
        data = request_json(layer, {'outFields': '*', 'returnGeometry': 'false', 'orderByFields': 'OBJECTID',
                                   'resultOffset': len(rows), 'resultRecordCount': requested}, opener)
        page = data.get('features')
        if not isinstance(page, list) or not page or len(page) > requested:
            raise RuntimeError('BLM returned an incomplete or oversized page')
        transfer = data.get('exceededTransferLimit')
        if transfer is not None and type(transfer) is not bool:
            raise RuntimeError('BLM returned an invalid transfer-limit flag')
        for feature in page:
            attributes = feature.get('attributes') if isinstance(feature, dict) else None
            if not isinstance(attributes, dict):
                raise RuntimeError('Malformed BLM feature')
            oid = attributes.get('OBJECTID')
            if type(oid) is not int or oid < 0 or oid in seen:
                raise RuntimeError('Missing or repeated BLM OBJECTID during pagination')
            seen.add(oid)
            rows.append(attributes)
        if len(rows) == expected and transfer is True:
            raise RuntimeError('BLM count/transfer limit disagreement')
        if len(rows) < expected and transfer is False:
            raise RuntimeError('BLM ended pagination before the expected count')
    if count() != expected:
        raise RuntimeError('BLM count changed during pagination; retry the whole import')
    return rows


def quarantined_record(row, spec, layer):
    """Identify rejected source rows without silently dropping their identities."""
    reason = 'invalid_coordinates'
    if row.get(spec['id']) in (None, ''):
        reason = 'missing_source_record_id'
    elif not fee_text.clean(row.get(spec['name'])):
        reason = 'missing_name'
    return {'layer': layer, 'object_id': row.get('OBJECTID'),
            'source_record_id': str(row[spec['id']]) if row.get(spec['id']) is not None else None,
            'reason': reason}


def to_feature(row, spec, retrieved, layer):
    try:
        lat, lng = float(row[spec['lat']]), float(row[spec['lng']])
    except (TypeError, ValueError, KeyError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180) or (lat == 0 and lng == 0):
        return None
    name, key = fee_text.clean(row.get(spec['name'])), row.get(spec['id'])
    if not name or key in (None, ''):
        return None
    wording = fee_text.clean(row.get(spec['fee']))
    status, cost = fee_text.classify(wording)
    source_field = spec['fee']
    desc_status, desc_cost, conflict = description_fee(row, layer)
    # Conclusive disagreement stays unknown; never silently replace a known fee.
    conflict = conflict or {status, desc_status} == {'free', 'paid'}
    if conflict:
        status, cost = 'unknown', None
    elif ((status == 'unknown' and desc_status in ('free', 'conditional'))
          or (status == 'free' and desc_status == 'conditional')):
        # A more specific on-site condition qualifies a bare no-fee statement.
        status, cost = desc_status, desc_cost
        wording = fee_text.clean(row.get('FacilityDescription'))
        source_field = 'FacilityDescription'
    # Reservability is not camping-fee evidence. It is recorded separately.
    url = row.get(spec['url']) or None
    url = url if url and url.startswith('http') else 'https://www.blm.gov/camping'
    evidence = []
    for field in (spec['fee'], 'FacilityDescription'):
        text = fee_text.clean(row.get(field))
        if text and (field == spec['fee'] or desc_status != 'unknown' or conflict):
            evidence.append(evidence_record(text, field, key, url, retrieved, row.get('LastUpdatedDate')))
    stay = fee_text.clean(row.get('StayLimit'))
    props = {
        'id': f"{spec['prefix']}:{key}",
        'name': name[:160],
        'type': 'established' if layer == 8 or re.search(r'camp(?:ground|site)', name, re.I) else 'dispersed',
        'state': (row.get('State') or '').strip().upper()[:2] or None,
        'source': 'Bureau of Land Management',
        'sources': ['Bureau of Land Management'],
        'source_url': url,
        'camping_activity': 'BLM camping area' if layer == 2 else 'BLM camping facility',
        'fee_status': status,
        'cost': cost,
        'fee_text': wording or None,
        'fee_source': 'Bureau of Land Management',
        'fee_source_field': source_field,
        'fee_checked': retrieved,
        'fee_evidence_records': evidence,
        'stay_limit': stay[:160] or None,
        'reservable': str(row.get('Reservable')).lower() in ('true', '1') or None,
        'schema_version': 3,
        'field_provenance': {'cost': f"BLM {source_field}"},
        'amenities': [],
        'rig_friendly': [],
    }
    if conflict:
        props['fee_conflict'] = True
        props['fee_evidence_conflict'] = True
    # Facility records share Recreation.gov facility IDs, so they merge with the same campground.
    if layer == 8:
        props['facility_id'] = str(key)
    return {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(lng, 6), round(lat, 6)]}, 'properties': props}


def main():
    retrieved = fee_text.retrieval_date()
    features, quarantined, source_counts = [], [], {}
    for layer, spec in LAYERS.items():
        rows = fetch_layer(layer)
        source_counts[str(layer)] = len(rows)
        for row in rows:
            feature = to_feature(row, spec, retrieved, layer)
            if feature is None:
                quarantined.append(quarantined_record(row, spec, layer))
            else:
                features.append(feature)
    if not features:
        raise RuntimeError('BLM returned no publishable camping records; saved data kept')
    previous = 0
    if OUT.exists():
        try:
            previous = len(json.loads(OUT.read_text()).get('features', []))
        except ValueError:
            previous = 0
    if previous and len(features) < previous * 0.7:
        raise RuntimeError(f'BLM returned {len(features)} camping records, down from {previous}. Saved data kept.')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix('.json.tmp')
    tmp.write_text(json.dumps({'type': 'FeatureCollection', 'source': 'BLM National Recreation Sites and Facilities',
                               'retrieved': retrieved, 'source_counts': source_counts,
                               'quarantined': quarantined, 'features': features}, separators=(',', ':')))
    tmp.replace(OUT)
    counts = {}
    for f in features:
        counts[f['properties']['fee_status']] = counts.get(f['properties']['fee_status'], 0) + 1
    print(f'blm.json: {len(features)} camping records, fee status {counts}')


if __name__ == '__main__':
    main()
