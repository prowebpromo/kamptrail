#!/usr/bin/env python3
"""Bounded Rhode Island OSM height-tag pilot, from a verified cached public PBF.

No downloads, routing decisions, bridge inference or facility permission claims.
Complete node/way geometry must be Census-contained in the requested state.
"""
import argparse
from collections import Counter
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
import time

from build_agency_states import ROOT, StateBoundaries, valid_point
from import_services import timestamp, bounded_text
from services_regions import URLS, validate_resolved_url
from services_parse_budget import bounded_process

KEYS = ('maxheight', 'maxheight:physical', 'maxheight:conditional',
        'maxheight:forward', 'maxheight:backward', 'maxheight:lanes')
CONTEXT = ('name', 'ref', 'highway', 'bridge', 'tunnel', 'barrier', 'access',
           'source:maxheight', 'maxheight:signed', 'source:maxheight:physical')
LIFECYCLE = ('disused', 'abandoned', 'demolished', 'removed', 'razed', 'proposed', 'construction')
MAX_BYTES = 512 * 1024
MAX_RECORDS = 2000
MAX_VERTICES = 50000


def parse_height(raw):
    """Only documented metre or ASCII feet/inches syntax. Unknown is not infinity."""
    if not isinstance(raw, str):
        return None
    metric = re.fullmatch(r'(\d+(?:\.\d{1,6})?)(?: m)?', raw)
    imperial = re.fullmatch(r"(\d+)'(?:(\d{1,2})\")?", raw)
    if metric:
        value = Decimal(metric[1])
    elif imperial and (imperial[2] is None or int(imperial[2]) < 12):
        value = Decimal(imperial[1]) * Decimal('0.3048') + Decimal(imperial[2] or '0') * Decimal('0.0254')
    else:
        return None
    return float(value) if 0 < value <= 100 else None


def select_geometry(geometry, boundaries, region):
    """All vertices must belong to exactly the requested Census state."""
    points = [geometry['coordinates']] if geometry['type'] == 'Point' else geometry['coordinates']
    if not points or len(points) > MAX_VERTICES or any(not valid_point(p) for p in points):
        return {'state': None, 'reason': 'invalid_geometry', 'candidates': []}
    results = boundaries.classify_many(points)
    failures = [results[tuple(p)] for p in points if results[tuple(p)]['state'] != region]
    if failures:
        return {'state': None, 'reason': ('boundary_ambiguous' if any(r['reason'] == 'boundary_ambiguous' for r in failures)
                else 'outside_requested_state'), 'candidates': sorted({s for r in failures for s in r['candidates']})}
    return {'state': region, 'reason': 'contained', 'candidates': [region]}


def extract(pbf, receipt, scratch, region='RI'):
    import osmium
    from importlib.metadata import version
    if region != 'RI' or version('osmium') != '4.3.2':
        raise ValueError('This reviewed pilot requires RI and pinned osmium 4.3.2')
    pbf = Path(pbf)
    with pbf.open('rb') as raw:
        actual = hashlib.file_digest(raw, 'sha256').hexdigest()
    if receipt.get('url') != URLS[region] or receipt.get('sha256') != actual or not 0 < pbf.stat().st_size == receipt.get('bytes') <= 2 * 1024**3:
        raise ValueError('PBF bytes differ from the existing canonical download receipt')
    retrieved = timestamp(receipt.get('retrieved_at'))
    resolved = validate_resolved_url(region, receipt.get('resolved_url', ''))
    with osmium.io.Reader(str(pbf)) as reader:
        extract_date = timestamp(reader.header().get('osmosis_replication_timestamp'))
    if extract_date > retrieved or (resolved and resolved.isoformat() != extract_date[:10]):
        raise ValueError('PBF header date does not match its dated receipt')
    boundaries = StateBoundaries()
    rows, quarantine, stats = [], [], Counter()
    vertices = 0

    class Handler(osmium.SimpleHandler):
        def record(self, obj, kind, geometry):
            nonlocal vertices
            tags = dict(obj.tags)
            selected = {k: tags[k] for k in KEYS if k in tags}
            if not selected:
                return
            identity = f'osm:{kind}:{obj.id}'
            if any(len(v.encode('utf-8')) > 240 for v in selected.values()):
                quarantine.append({'id': identity, 'reason': 'excessive_tag_bytes', 'candidates': []})
                return
            if not tags.get('highway') and tags.get('barrier') != 'height_restrictor':
                quarantine.append({'id': identity, 'reason': 'no_highway_or_height_restrictor_context', 'candidates': []})
                return
            if any(tags.get(k) in ('yes', 'true', '1') for k in LIFECYCLE) or any(k.startswith(tuple(p + ':' for p in LIFECYCLE)) for k in tags):
                stats['lifecycle_excluded'] += 1
                return
            if geometry is None:
                quarantine.append({'id': identity, 'reason': 'unsupported_or_incomplete_geometry', 'candidates': []})
                return
            assigned = select_geometry(geometry, boundaries, region)
            if assigned['state'] != region:
                quarantine.append({'id': identity, 'reason': assigned['reason'], 'candidates': assigned['candidates']})
                return
            edited = timestamp(obj.timestamp.isoformat())
            if edited > extract_date:
                raise ValueError('Object edit is newer than the PBF header')
            count = 1 if geometry['type'] == 'Point' else len(geometry['coordinates'])
            vertices += count
            if len(rows) >= MAX_RECORDS or vertices > MAX_VERTICES:
                raise ValueError('Clearance pilot geometry/record budget exceeded')
            rows.append({'id': identity, 'osm_type': kind, 'osm_id': str(obj.id), 'osm_version': obj.version,
                         'edited_at': edited, 'state': region, 'geometry': geometry, 'tags': selected,
                         'context': {k: bounded_text(tags[k], 240) for k in CONTEXT if k in tags},
                         'metres': {k: parse_height(v) for k, v in selected.items() if k in ('maxheight', 'maxheight:physical')}})

        def node(self, obj):
            self.record(obj, 'node', {'type': 'Point', 'coordinates': [obj.location.lon, obj.location.lat]} if obj.location.valid() else None)

        def way(self, obj):
            points = [[n.lon, n.lat] for n in obj.nodes if n.location.valid()]
            geometry = {'type': 'LineString', 'coordinates': points} if len(points) == len(obj.nodes) and len(points) >= 2 else None
            self.record(obj, 'way', geometry)

        def relation(self, obj):
            self.record(obj, 'relation', None)

    with tempfile.TemporaryDirectory(prefix='clearance-index-', dir=scratch) as tmp:
        Handler().apply_file(str(pbf), locations=True, idx=f'sparse_file_array,{Path(tmp) / "locations.idx"}', filters=[osmium.filter.KeyFilter(*KEYS)])
    if not rows:
        raise ValueError('No valid records; previous pilot retained')
    source = {'kind': 'geofabrik', 'url': URLS[region], 'resolved_url': receipt['resolved_url'], 'sha256': actual,
              'bytes': pbf.stat().st_size, 'retrieved_at': retrieved, 'extract_timestamp': extract_date,
              'license': 'ODbL-1.0', 'copyright_url': 'https://www.openstreetmap.org/copyright'}
    payload = {'version': 1, 'region': region, 'source': source, 'records': sorted(rows, key=lambda r: r['id'])}
    with (boundaries.directory / 'manifest.json').open('rb') as reference:
        reference_hash = hashlib.file_digest(reference, 'sha256').hexdigest()
    report = {'version': 1, 'source': source, 'region': region, 'accepted': len(rows), 'vertices': vertices,
              'by_type': dict(Counter(r['osm_type'] for r in rows)),
              'tag_counts': dict(Counter(k for r in rows for k in r['tags'])),
              'parsed_counts': dict(Counter(k for r in rows for k, v in r['metres'].items() if v is not None)),
              'quarantined': len(quarantine), 'quarantine_reasons': dict(Counter(r['reason'] for r in quarantine)),
              'quarantine': quarantine, 'statistics': dict(stats), 'parser_version': version('osmium'),
              'boundary_reference_sha256': reference_hash,
              'samples': [{'id': r['id'], 'url': f"https://www.openstreetmap.org/{r['osm_type']}/{r['osm_id']}", 'tags': r['tags']} for r in rows[:5]]}
    return payload, report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--pbf', type=Path)
    p.add_argument('--receipt', type=Path)
    p.add_argument('--scratch', type=Path)
    p.add_argument('--out', type=Path, default=ROOT / 'data/clearances/RI.json')
    p.add_argument('--audit', type=Path, default=ROOT / 'docs/CLEARANCE_RI_PROOF.json')
    p.add_argument('--worker', type=Path, help=argparse.SUPPRESS)
    args = p.parse_args()
    if args.worker:
        request = json.loads((args.worker / 'request.json').read_bytes())
        result = extract(request['pbf'], request['receipt'], args.worker)
        (args.worker / 'result.json').write_text(json.dumps(result, separators=(',', ':')))
        return
    if not all((args.pbf, args.receipt, args.scratch)):
        p.error('--pbf, --receipt and --scratch are required')
    scratch = args.scratch.resolve()
    if scratch.is_relative_to(ROOT):
        raise ValueError('Raw/cache/parse work must remain outside checkout')
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='clearance-parse-', dir=scratch) as tmp:
        directory = Path(tmp)
        (directory / 'request.json').write_text(json.dumps({'pbf': str(args.pbf.resolve()), 'receipt': json.loads(args.receipt.read_bytes())}))
        elapsed = bounded_process([sys.executable, __file__, '--worker', str(directory)], directory)
        raw = (directory / 'result.json').read_bytes()
        if len(raw) > 2 * MAX_BYTES:
            raise ValueError('Clearance result byte budget exceeded')
        payload, report = json.loads(raw)
    encoded = (json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    if len(encoded) > MAX_BYTES:
        raise ValueError('Clearance browser asset budget exceeded')
    report.update(elapsed, asset_bytes=len(encoded), asset_sha256=hashlib.sha256(encoded).hexdigest(),
                  parse_address_limit_bytes=4 * 1024**3, parse_disk_limit_bytes=12 * 1024**3, parse_wall_limit_seconds=1800)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.out.with_suffix('.json.tmp')
    temporary.write_bytes(encoded)
    temporary.replace(args.out)
    args.audit.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ('quarantine', 'samples', 'source')}, indent=2))


if __name__ == '__main__':
    main()
