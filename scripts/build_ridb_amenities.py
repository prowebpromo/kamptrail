#!/usr/bin/env python3
"""Build details-only amenity mentions from overnight RIDB campsite records.

Uses a public full-export ZIP. This does not infer campground-wide amenities,
public services, permissions, fees, current operation, or facts from absence.
"""
import argparse
import hashlib
import json
import re
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from build_ridb_sites import ROOT, catalogue_facilities, open_table

SOURCE_URL = 'https://ridb.recreation.gov/downloads/RIDBFullExport_V1_CSV.zip'
# Exact observed field/value pairs. Qualifiers apply to mentions, not the facility.
MAPPINGS = {
    'toilet': {
        'FLUSH TOILETS': ('Flush Toilets', ()),
        'VAULT TOILETS': ('Vault Toilets', ()),
        'PIT TOILETS': ('Pit Toilets', ()),
        'PORTABLE TOILETS': ('Portable Toilets', ()),
        'OUTHOUSE': ('Outhouse', ()),
        'Toilet': (('Y', 'Toilet'), ()),
        'ACCESSIBLE FLUSH TOILETS': ('Accessible Flush Toilets', ('accessible',)),
        'ACCESSIBLE VAULT TOILETS': ('Accessible Vault Toilets', ('accessible',)),
        'ACCESSIBLE PIT TOILETS': ('Accessible Pit Toilets', ('accessible',)),
        'FLUSH TOILETS (SEASONAL)': ('Flush Toilets (Seasonal)', ('seasonal',)),
    },
    'drinking_water': {
        'DRINKING WATER': ('Drinking Water', ()),
        'ACCESSIBLE DRINKING WATER': ('Accessible Drinking Water', ('accessible',)),
        'DRINKING WATER (HAND PUMP)': ('Drinking Water (hand pump)', ('hand_pump',)),
        'DRINKING WATER (PEAK SEASON)': (('Drinking Water (peak season)', 'Drinking Water (Peak Season)', 'Drinking water (peak Season)'), ('peak_season',)),
    },
    'shower': {
        'SHOWERS': ('Showers', ()),
        'ACCESSIBLE SHOWERS': ('Accessible Showers', ('accessible',)),
        'SHOWERS (SEASONAL)': ('Showers (Seasonal)', ('seasonal',)),
        'COIN SHOWERS': ('Coin Showers', ('coin',)),
        'OUTDOOR SHOWERS': ('Outdoor Showers', ('outdoor',)),
    },
    'dump': {'DUMP STATION': ('Dump Station', ())},
    'picnic_table': {
        'Picnic Table': (('Y', 'Picnic Table'), ()),
        'PICNIC TABLES': ('Picnic Tables', ()),
    },
}
FIELDS = {field: (key, values if isinstance(values, tuple) else (values,), qualifiers)
          for key, mapping in MAPPINGS.items()
          for field, (values, qualifiers) in mapping.items()}


def build(source, wanted):
    sites = {row['CampsiteID']: row['FacilityID']
             for row in open_table(source, 'Campsites_API_v1.csv')
             if row.get('FacilityID') in wanted and row.get('TypeOfUse', '').strip().lower() == 'overnight'}
    observations = defaultdict(lambda: {'positive': False, 'negative': False, 'qualifiers': set()})
    for row in open_table(source, 'CampsiteAttributes_API_v1.csv'):
        site_id = row.get('EntityID')
        mapped = FIELDS.get(row.get('AttributeName'))
        if row.get('EntityType') != 'Campsite' or site_id not in sites or not mapped:
            continue
        key, values, qualifiers = mapped
        item = observations[site_id, key]
        value = row.get('AttributeValue', '')
        if value in values:
            item['positive'] = True
            item['qualifiers'].update(qualifiers)
        elif row.get('AttributeName') == 'Picnic Table' and value == 'No':
            item['negative'] = True
        # Blank and unrecognized values remain unknown; never use truthiness.
    totals = Counter(sites.values())
    facilities = {fid: {'sites': totals[fid], 'amenities': {}} for fid in sorted(wanted, key=int)}
    for (site_id, key), item in observations.items():
        group = facilities[sites[site_id]]['amenities'].setdefault(key, {'reported': 0, 'negative': 0, 'unknown': 0, 'conflict': 0, 'qualifiers': {}})
        status = ('conflict' if item['positive'] and item['negative'] else
                  'reported' if item['positive'] else 'negative' if item['negative'] else 'unknown')
        group[status] += 1
        if status == 'reported':
            for qualifier in sorted(item['qualifiers']):
                group['qualifiers'][qualifier] = group['qualifiers'].get(qualifier, 0) + 1
    return facilities


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', help='Public RIDB full-export ZIP; retrieval is unknown unless a matching completed download receipt is supplied')
    parser.add_argument('--index', default=str(ROOT / 'data/campsites/search-index.json'))
    parser.add_argument('--out', default=str(ROOT / 'data/campsites/ridb-amenities.json'))
    parser.add_argument('--audit', default=str(ROOT / 'data/campsites/ridb-amenities-audit.json'))
    parser.add_argument('--download-receipt', help='Receipt from a completed canonical download; URL, hash and size must match')
    args = parser.parse_args(argv)
    source = Path(args.source)
    wanted = catalogue_facilities(args.index)
    facilities = build(source, wanted)
    with zipfile.ZipFile(source) as archive:
        entry_time = datetime(*archive.getinfo('CampsiteAttributes_API_v1.csv').date_time).isoformat()
        attribute_tables = [name for name in archive.namelist() if 'Attributes' in name]
    with source.open('rb') as handle:
        digest = hashlib.file_digest(handle, 'sha256').hexdigest()
    provenance = {'name': 'Recreation.gov RIDB full export', 'url': SOURCE_URL,
                  'sha256': digest, 'inspected_at': datetime.now(timezone.utc).isoformat(),
                  'original_retrieved_at': None, 'attribute_updated_at': None,
                  'archive_entry_time': entry_time, 'archive_entry_timezone': None,
                  'basis': 'frozen_public_export_cache', 'http_last_modified': None}
    if args.download_receipt:
        receipt = json.loads(Path(args.download_receipt).read_text())
        def utc(value):
            if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)', value):
                return False
            try:
                datetime.fromisoformat(value.replace('Z', '+00:00'))
                return True
            except ValueError:
                return False
        if (receipt.get('url') != SOURCE_URL or receipt.get('sha256') != digest or receipt.get('size_bytes') != source.stat().st_size
                or receipt.get('http_status') != 200 or not utc(receipt.get('retrieved_at'))
                or (receipt.get('http_last_modified') is not None and not utc(receipt.get('http_last_modified')))):
            raise ValueError('Download receipt does not match this completed canonical export')
        retrieved = datetime.fromisoformat(receipt['retrieved_at'].replace('Z', '+00:00'))
        modified = receipt.get('http_last_modified')
        if retrieved > datetime.fromisoformat(provenance['inspected_at']) or (modified is not None and datetime.fromisoformat(modified.replace('Z', '+00:00')) > retrieved):
            raise ValueError('Download receipt dates are inconsistent')
        provenance.update(basis='canonical_download', original_retrieved_at=receipt['retrieved_at'], http_last_modified=modified)
    payload = {'version': 1, 'source': provenance, 'facilities': facilities}
    out = Path(args.out)
    temporary = out.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(payload, separators=(',', ':')) + '\n')
    temporary.replace(out)
    primary = catalogue_facilities_from_primary(args.index)
    audit = {'version': 1, 'source': provenance, 'scope': 'Exact catalogue RIDB primary and legacy IDs; overnight campsite records only',
             'attribute_table': 'CampsiteAttributes_API_v1.csv', 'attribute_entity_type': 'Campsite',
             'attribute_tables': attribute_tables, 'facility_attribute_table': next((name for name in attribute_tables if name.startswith('FacilityAttributes')), None),
             'primary_facility_ids': len(primary), 'alias_only_facility_ids': len(wanted - primary),
             'facility_ids': len(wanted), 'facilities_with_overnight_sites': sum(f['sites'] > 0 for f in facilities.values()),
             'selection_sha256': hashlib.sha256(json.dumps(sorted(wanted), separators=(',', ':')).encode()).hexdigest(),
             'selection_encoding': 'Compact UTF-8 JSON array of exact selected facility ID strings in lexicographic order',
             'overnight_sites': sum(f['sites'] for f in facilities.values()), 'amenities': {},
             'counting': 'Distinct overnight records per facility and amenity; conflict takes precedence over positive, then explicit negative, then blank/unrecognized. Qualifier counts overlap and count positive records only. Missing fields remain unknown.',
             'limits': ['Campsite-record mentions, not fixture counts or campground-wide guarantees',
                        'Absence is unknown; no fee, permission, filter or public-service inference',
                        'Individual attribute update dates are unknown; HTTP Last-Modified describes the export file; inspection is not refresh']}
    for key in MAPPINGS:
        groups = [f['amenities'].get(key, {}) for f in facilities.values()]
        audit['amenities'][key] = {status: sum(g.get(status, 0) for g in groups) for status in ['reported', 'negative', 'unknown', 'conflict']}
        audit['amenities'][key]['facility_ids_reporting'] = sum(g.get('reported', 0) > 0 for g in groups)
        audit['amenities'][key]['qualifiers'] = {q: sum(g.get('qualifiers', {}).get(q, 0) for g in groups)
                                                for q in sorted({q for g in groups for q in g.get('qualifiers', {})})}
    Path(args.audit).write_text(json.dumps(audit, indent=2) + '\n')
    print(f"Amenity evidence: {len(facilities)} facility IDs, {audit['overnight_sites']} overnight campsite records")
    return 0


def catalogue_facilities_from_primary(index):
    data = json.loads(Path(index).read_text())
    return {s['id'][5:] for s in data.get('sites', [])
            if isinstance(s.get('id'), str) and re.fullmatch(r'ridb:[1-9][0-9]*', s['id'])}


if __name__ == '__main__':
    raise SystemExit(main())
