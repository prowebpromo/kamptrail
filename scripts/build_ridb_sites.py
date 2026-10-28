#!/usr/bin/env python3
"""Summarize Recreation.gov campsite details per campground for KampTrail.

Input: the public RIDB full export (no API key needed):
  https://ridb.recreation.gov/downloads/RIDBFullExport_V1_CSV.zip
Output: data/campsites/ridb-sites.json, keyed by RIDB facility ID, for campgrounds
already in the KampTrail catalogue.

Per facility:
  t  overnight campsites listed
  r  sites that permit an RV-type vehicle (RV, trailer, fifth wheel, camper van, ...)
  L  longest reported RV-type length in feet (0 = not reported)
  g  site signatures: [[length_ft, hookup_bits, site_count], ...] for RV-type sites,
     hookup_bits electric=1, water=2, sewer=4. One signature describes one kind of campsite,
     so a filter for 40 ft + electric only matches a campsite that has both.
  e, w, s  sites reporting electric, water, and sewer hookups (display only)
  f, c     camping fee evidence from the facility's fee text: 'free', 'paid' or 'conditional', and a nightly cost when stated
  fe       'fee_text' (reservability is never fee evidence)
  rs       1 when the facility is reservable on Recreation.gov (information only)
  sl       stay limit text as published

Lengths come from PermittedEquipment.MaxLength for RV-type equipment, falling back
to the site's "Max Vehicle Length" attribute when the site permits RV-type equipment.
Zero means not reported, not unlimited.
"""
import argparse
import csv
import io
import json
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RV_EQUIPMENT = {'rv', 'trailer', 'fifth wheel', 'rv/motorhome', 'caravan/camper van', 'pop up', 'pickup camper', 'motorhome'}
YES = {'yes', 'y', 'water hookup', 'sewer hookup'}
csv.field_size_limit(10_000_000)


def open_table(source, name):
    """Yield dict rows from a CSV inside the export zip or an extracted folder."""
    path = Path(source)
    if path.is_dir():
        handle = open(path / name, encoding='utf-8', errors='replace', newline='')
    else:
        archive = zipfile.ZipFile(path)
        handle = io.TextIOWrapper(archive.open(name), encoding='utf-8', errors='replace', newline='')
    with handle:
        yield from csv.DictReader(handle)


def number(value):
    try:
        n = float(str(value).strip())
    except (TypeError, ValueError):
        return 0
    return int(round(n)) if 0 < n < 200 else 0


def catalogue_facilities(index_path):
    data = json.loads(Path(index_path).read_text())
    return {s['id'].split(':', 1)[1] for s in data.get('sites', []) if str(s.get('id', '')).startswith('ridb:')}


sys.path.insert(0, str(Path(__file__).resolve().parent))
import fee_text  # noqa: E402


def fee_from_text(text, reservable):
    """Camping fee evidence from the published fee wording only. Reservability is recorded separately."""
    status, cost = fee_text.classify(text)
    rec = {}
    if status != 'unknown':
        rec = {'f': status, 'fe': 'fee_text'}
        if status == 'paid' and cost:
            rec['c'] = cost
    if str(reservable).strip().lower() == 'true':
        rec['rs'] = 1
    return rec


def build(source, wanted):
    sites = {}
    for row in open_table(source, 'Campsites_API_v1.csv'):
        if row.get('FacilityID') in wanted and str(row.get('TypeOfUse', '')).strip().lower() == 'overnight':
            sites[row['CampsiteID']] = {'f': row['FacilityID'], 'rv': False, 'len': 0, 'attr_len': 0, 'e': False, 'w': False, 's': False}
    for row in open_table(source, 'PermittedEquipment_API_v1.csv'):
        site = sites.get(row.get('CampsiteID'))
        if site and str(row.get('EquipmentName', '')).strip().lower() in RV_EQUIPMENT:
            site['rv'] = True
            site['len'] = max(site['len'], number(row.get('MaxLength')))
    for row in open_table(source, 'CampsiteAttributes_API_v1.csv'):
        if row.get('EntityType') != 'Campsite':
            continue
        site = sites.get(row.get('EntityID'))
        if not site:
            continue
        name, value = row.get('AttributeName', ''), str(row.get('AttributeValue', '')).strip()
        low = value.lower()
        if name == 'Max Vehicle Length':
            site['attr_len'] = max(site['attr_len'], number(value))
        elif name == 'Electricity Hookup' and re.search(r'\d', value):
            site['e'] = True
        elif name == 'Water Hookup' and low in YES:
            site['w'] = True
        elif name == 'Sewer Hookup' and low in YES:
            site['s'] = True
        elif name == 'Full Hookup' and value and low not in {'no', 'n/a'}:
            site['e'] = site['w'] = site['s'] = True
    facility_info = {}
    for row in open_table(source, 'Facilities_API_v1.csv'):
        fid = row.get('FacilityID')
        if fid in wanted:
            info = fee_from_text(row.get('FacilityUseFeeDescription'), row.get('Reservable'))
            stay = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', row.get('StayLimit') or '')).strip()
            if stay:
                info['sl'] = stay[:160]
            if info:
                facility_info[fid] = info
    out = {}
    agg = defaultdict(lambda: {'t': 0, 'r': 0, 'L': 0, 'g': defaultdict(int), 'e': 0, 'w': 0, 's': 0})
    for site in sites.values():
        a = agg[site['f']]
        a['t'] += 1
        # A vehicle length on a site with no RV-type equipment may describe a car pad. Do not count it.
        length = site['len'] or (site['attr_len'] if site['rv'] else 0)
        if site['rv']:
            a['r'] += 1
            bits = int(site['e']) | int(site['w']) << 1 | int(site['s']) << 2
            a['g'][(length, bits)] += 1
        if length:
            a['L'] = max(a['L'], length)
        for k in 'ews':
            a[k] += int(site[k])
    for fid, a in agg.items():
        rec = {'t': a['t'], 'r': a['r'], 'L': a['L']}
        if a['g']:
            rec['g'] = [[length, bits, n] for (length, bits), n in sorted(a['g'].items())]
        for k in 'ews':
            if a[k]:
                rec[k] = a[k]
        out[fid] = rec
    for fid, info in facility_info.items():
        out.setdefault(fid, {'t': 0, 'r': 0, 'L': 0}).update(info)
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('source', help='RIDBFullExport_V1_CSV.zip or a folder with its CSV files')
    parser.add_argument('--index', default=str(ROOT / 'data' / 'campsites' / 'search-index.json'))
    parser.add_argument('--out', default=str(ROOT / 'data' / 'campsites' / 'ridb-sites.json'))
    args = parser.parse_args(argv)
    wanted = catalogue_facilities(args.index)
    facilities = build(args.source, wanted)
    previous = 0
    out = Path(args.out)
    if out.exists():
        try:
            previous = len(json.loads(out.read_text()).get('facilities', {}))
        except ValueError:
            previous = 0
    # An unexpectedly small result means a broken export. Keep the saved file.
    if previous and len(facilities) < previous * 0.7:
        print(f'Refusing to replace {previous} facilities with {len(facilities)}; saved data kept.', file=sys.stderr)
        return 1
    payload = {'version': 2, 'source': 'Recreation.gov RIDB full export', 'facilities': facilities}
    tmp = out.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(payload, separators=(',', ':')))
    tmp.replace(out)
    with_len = sum(1 for f in facilities.values() if f['L'])
    fees = {k: sum(1 for f in facilities.values() if f.get('f') == k) for k in ('free', 'conditional', 'paid')}
    print(f'ridb-sites.json: {len(facilities)} of {len(wanted)} catalogue campgrounds, {with_len} with a reported RV length, fee text evidence {fees}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
