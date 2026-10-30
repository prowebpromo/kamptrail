#!/usr/bin/env python3
"""Bounded public Geofabrik PBF -> dated, Census-validated service evidence.

Only the optional PBF path needs pyosmium (pinned in requirements-services.txt).
Raw downloads, location indexes and report intermediates belong outside the repo.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
from pathlib import Path
import tempfile
import time
import urllib.error
import urllib.request
from collections import Counter
from services_regions import URLS, validate_resolved_url

from build_agency_states import StateBoundaries, valid_point, STATES

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = ('dump', 'water', 'lpg', 'showers', 'laundry', 'groceries', 'fuel')
TAGS = ('amenity', 'tourism', 'sanitary_dump_station', 'waterway', 'drinking_water', 'fuel', 'fuel:lpg', 'shop', 'laundry', 'self_service', 'access', 'access:conditional', 'fee', 'charge', 'opening_hours', 'operator', 'brand', 'website', 'phone', 'wheelchair', 'shower')
MAX_BYTES = 2 * 1024**3
MAX_SECONDS = 30 * 60


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def timestamp(value, nullable=False):
    if value is None and nullable:
        return None
    if not isinstance(value, str):
        raise ValueError('Missing UTC date')
    date = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if date.tzinfo is None or date.utcoffset() != dt.timedelta(0) or date > dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5):
        raise ValueError('Invalid or future UTC date')
    return date.isoformat(timespec='seconds').replace('+00:00', 'Z')


def bounded_text(value, limit):
    return str(value).encode('utf-8')[:limit].decode('utf-8', errors='ignore')


def categories(tags):
    """Positive exact matches only. Lifecycle negatives win over positive tags."""
    if any(tags.get(k) in ('yes', 'true', '1') for k in ('disused', 'abandoned', 'demolished', 'removed', 'razed', 'proposed', 'construction', 'closed')) or tags.get('opening_hours') in ('closed', 'off'):
        return []
    if any(k.startswith(('disused:', 'abandoned:', 'demolished:', 'removed:', 'razed:', 'proposed:', 'construction:')) and k.split(':', 1)[1] in ('amenity', 'shop', 'sanitary_dump_station', 'fuel:lpg') for k in tags):
        return []
    found = set()
    if tags.get('amenity') == 'sanitary_dump_station' or tags.get('sanitary_dump_station') in ('yes', 'public', 'customers'):
        found.add('dump')
    if tags.get('amenity') == 'water_point' or tags.get('waterway') == 'water_point':
        found.add('water')
    if tags.get('fuel:lpg') == 'yes' or tags.get('fuel') == 'lpg':
        found.add('lpg')
    if tags.get('amenity') == 'shower': found.add('showers')
    if tags.get('shop') == 'laundry': found.add('laundry')
    if tags.get('shop') in ('supermarket', 'convenience'): found.add('groceries')
    if tags.get('amenity') == 'fuel': found.add('fuel')
    return [category for category in CATEGORIES if category in found]


class FixedRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, region=None):
        super().__init__()
        self.region = region
        self.redirects = 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        region = self.region or next((key for key, url in URLS.items() if req is not None and req.full_url == url), None)
        if region is None or req is None:
            raise ValueError('PBF redirect outside fixed same-state public extract')
        validate_resolved_url(region, req.full_url)
        validate_resolved_url(region, newurl)
        self.redirects += 1
        if self.redirects > 3:
            raise ValueError('Excessive PBF redirects')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _open_download(request, region, deadline):
    """Retry only initial-response timeouts, within the original download budget."""
    for delay in (1, 3, None):  # At most three total attempts, never body retries.
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ValueError('PBF download budget exceeded')
        try:
            return urllib.request.build_opener(FixedRedirect(region)).open(request, timeout=min(60, remaining))
        except (TimeoutError, urllib.error.URLError) as exc:
            timed_out = isinstance(exc, TimeoutError) or isinstance(getattr(exc, 'reason', None), TimeoutError)
            if isinstance(exc, urllib.error.HTTPError) or not timed_out:
                raise
            if delay is None:
                raise
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError('PBF download budget exceeded') from exc
            time.sleep(min(delay, remaining))


def download(region, destination):
    url = URLS[region]
    destination = Path(destination).resolve()
    if destination.is_relative_to(ROOT):
        raise ValueError('Raw PBF must remain outside the repository')
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix('.part')
    started = time.monotonic()
    deadline = started + MAX_SECONDS
    digest = hashlib.sha256()
    total = 0
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'KampTrail-services/2.14 (+https://www.openstreetmap.org/copyright)'})
        with _open_download(request, region, deadline) as response, partial.open('wb') as output:
            if time.monotonic() >= deadline:
                raise ValueError('PBF download budget exceeded')
            resolved_url = response.geturl()
            validate_resolved_url(region, resolved_url)
            expected = int(response.headers.get('Content-Length', 0))
            if not 0 < expected <= MAX_BYTES:
                raise ValueError('Missing or excessive PBF content length')
            while True:
                chunk = response.read(1024 * 1024)
                if time.monotonic() >= deadline:
                    raise ValueError('PBF download budget exceeded')
                if not chunk: break
                total += len(chunk)
                if total > MAX_BYTES:
                    raise ValueError('PBF download budget exceeded')
                digest.update(chunk)
                output.write(chunk)
            if total != expected: raise ValueError('Truncated PBF download')
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)
    return {'url': url, 'resolved_url': resolved_url, 'sha256': digest.hexdigest(), 'retrieved_at': utc_now(), 'bytes': total, 'download_seconds': round(time.monotonic() - started, 3)}


def assign(items, boundaries, region):
    assignments = boundaries.classify_many([row['coordinates'] for row in items])
    accepted, quarantine = [], []
    for row in items:
        result = assignments.get(tuple(row['coordinates']), {'state': None, 'reason': 'invalid_coordinates', 'candidates': []})
        state = result['state']
        if state is None or (region != 'legacy' and state != region):
            quarantine.append({'id': row['id'], 'coordinates': row['coordinates'], 'reason': result['reason'] if state is None else 'outside_requested_state', 'candidates': result['candidates']})
        else:
            row['states'] = [state]
            accepted.append(row)
    return accepted, quarantine


def legacy(raw, boundaries):
    source = json.loads(raw)
    rows = []
    for feature in source.get('features', []):
        props = feature.get('properties', {})
        category = {'dump': 'dump', 'water': 'water', 'propane': 'lpg'}.get(props.get('type'))
        if props.get('source') != 'openstreetmap' or not category: continue
        if category == 'water' and not (props.get('osm_id') is not None and props.get('schema_version', 0) >= 3): continue
        typ, oid = props.get('osm_type'), str(props.get('osm_id', ''))
        coordinates = feature.get('geometry', {}).get('coordinates')
        if typ not in ('node', 'way', 'relation') or not oid.isdigit() or int(oid) <= 0 or not valid_point(coordinates): continue
        tags = {key: bounded_text(props[key], 240) for key in TAGS if props.get(key) is not None and props[key] != 'unknown'}
        # Original raw input preserves category provenance but does not retain the original tag.
        # Do not invent a raw OSM tag: category is the dated legacy fetcher's evidence.
        rows.append({'id': f'osm:{typ}:{oid}', 'osm_type': typ, 'osm_id': oid, 'osm_version': None, 'edited_at': None, 'coordinates': coordinates, 'name': bounded_text(props.get('name') or '', 120), 'categories': [category], 'tags': tags, 'states': [], 'source_region': 'legacy', 'retrieved_at': timestamp(props.get('source_retrieved_at'), True)})
    rows, quarantine = assign(rows, boundaries, 'legacy')
    return {'version': 2, 'region': 'legacy', 'source': {'kind': 'legacy', 'url': 'https://www.openstreetmap.org', 'extract_timestamp': None, 'retrieved_at': None, 'sha256': hashlib.sha256(raw).hexdigest(), 'license': 'ODbL-1.0', 'categories': ['dump', 'water', 'lpg']}, 'items': rows}, quarantine


def import_pbf(path, region, metadata, boundaries, location_index=None):
    import osmium
    from importlib.metadata import version
    parser_version = version('osmium')
    if parser_version != '4.3.2':
        raise ValueError('Native parser must be the checksum-pinned osmium 4.3.2')
    started = time.monotonic()
    if not 0 < Path(path).stat().st_size <= MAX_BYTES:
        raise ValueError('Invalid PBF byte size')
    with Path(path).open('rb') as raw:
        actual_hash = hashlib.file_digest(raw, 'sha256').hexdigest()
    if actual_hash != metadata['sha256']:
        raise ValueError('PBF checksum differs from download receipt')
    with osmium.io.Reader(str(path)) as reader:
        header = reader.header()
        extract = timestamp(header.get('osmosis_replication_timestamp'))
    if metadata.get('url', URLS[region]) != URLS[region]:
        raise ValueError('Download receipt differs from requested region')
    dated = validate_resolved_url(region, metadata.get('resolved_url', URLS[region]))
    if dated and dt.datetime.fromisoformat(extract.replace('Z', '+00:00')).date() != dated:
        raise ValueError('Extract header date differs from resolved URL date')
    if extract > timestamp(metadata['retrieved_at']):
        raise ValueError('Extract date newer than retrieval')
    stats = Counter()
    rows = []
    unresolved_relations = set()

    class Handler(osmium.SimpleHandler):
        def record(self, obj, typ, coords):
            tags = dict(obj.tags)
            selected = categories(tags)
            if not selected:
                # Count otherwise positive closed/lifecycle-only service evidence.
                lifecycle = ('disused', 'abandoned', 'demolished', 'removed', 'razed', 'proposed', 'construction', 'closed')
                stripped = {k: v for k, v in tags.items() if k.split(':', 1)[0] not in lifecycle and k != 'opening_hours'}
                for key, value in tags.items():
                    if ':' in key and key.split(':', 1)[0] in lifecycle:
                        stripped.setdefault(key.split(':', 1)[1], value)
                if categories(stripped): stats['lifecycle_excluded'] += 1
                return
            if coords is None or not valid_point(coords):
                stats['invalid_geometry'] += 1
                return
            if tags.get('access') in ('no', 'private'): stats['restricted_retained'] += 1
            if tags.get('access') in ('customers', 'permit'): stats['conditional_access'] += 1
            if len(rows) >= 1000000:
                raise ValueError('Canonical row budget exceeded')
            rows.append({'id': f'osm:{typ}:{obj.id}', 'osm_type': typ, 'osm_id': str(obj.id), 'osm_version': obj.version or None, 'edited_at': timestamp(obj.timestamp.isoformat()), 'coordinates': coords, 'name': bounded_text(tags.get('name', ''), 120), 'categories': selected, 'tags': {k: bounded_text(tags[k], 240) for k in TAGS if k in tags}, 'states': [], 'source_region': region})

        def node(self, obj):
            tags = dict(obj.tags)
            if categories(tags) or any(k.startswith(('disused', 'abandoned', 'demolished', 'removed', 'razed', 'proposed', 'construction', 'closed')) for k in tags) or tags.get('opening_hours') in ('closed', 'off'):
                self.record(obj, 'node', [obj.location.lon, obj.location.lat] if obj.location.valid() else None)

        def way(self, obj):
            tags = dict(obj.tags)
            if not categories(tags):
                self.record(obj, 'way', None)
                return
            coords = [[n.lon, n.lat] for n in obj.nodes if n.location.valid()]
            # A representative existing geometry node avoids claiming a driveway or polygon centroid.
            self.record(obj, 'way', coords[len(coords) // 2] if len(coords) == len(obj.nodes) and coords else None)

        def relation(self, obj):
            if categories(dict(obj.tags)):
                unresolved_relations.add(f'osm:relation:{obj.id}')

        def area(self, obj):
            if obj.from_way(): return  # already represented as an exact way identity
            if not categories(dict(obj.tags)): return
            rings = list(obj.outer_rings())
            coords = [[n.lon, n.lat] for n in rings[0] if n.location.valid()] if rings else []
            if not coords: stats['invalid_geometry'] += 1; return
            class RelationProxy:
                id = obj.orig_id()
                tags = obj.tags
                version = obj.version
                timestamp = obj.timestamp
            self.record(RelationProxy, 'relation', coords[len(coords) // 2])
            unresolved_relations.discard(f'osm:relation:{obj.orig_id()}')

    # Production runs use a bounded child process and an external file-backed index.
    # Native key filtering occurs after location/area assembly, avoiding Python
    # callbacks for the millions of untagged geometry nodes in a state extract.
    service_keys = ['amenity', 'shop', 'sanitary_dump_station', 'waterway', 'fuel', 'fuel:lpg']
    service_keys += [prefix + ':' + key for prefix in ('disused', 'abandoned', 'demolished', 'removed', 'razed', 'proposed', 'construction') for key in service_keys.copy()]
    with tempfile.TemporaryDirectory(prefix='services-location-index-') as index_directory:
        index = location_index or f'sparse_file_array,{Path(index_directory) / "locations.idx"}'
        Handler().apply_file(str(path), locations=True, idx=index, filters=[osmium.filter.KeyFilter(*service_keys)])
    rows, quarantine = assign(rows, boundaries, region)
    quarantine.extend({'id': oid, 'coordinates': None, 'reason': 'unsupported_relation_geometry', 'candidates': []} for oid in sorted(unresolved_relations))
    source = {'kind': 'geofabrik', 'url': URLS[region], 'extract_timestamp': extract, 'retrieved_at': timestamp(metadata['retrieved_at']), 'sha256': metadata['sha256'], 'license': 'ODbL-1.0', 'categories': list(CATEGORIES)}
    for name in ('lifecycle_excluded', 'invalid_geometry', 'restricted_retained', 'conditional_access'):
        stats.setdefault(name, 0)
    stats.update({'accepted': len(rows), 'quarantined': len(quarantine)})
    return {'version': 2, 'region': region, 'source': source, 'items': sorted(rows, key=lambda row: row['id'])}, quarantine, {**metadata, **stats, 'parser_version': parser_version, 'parse_seconds': round(time.monotonic() - started, 3)}


def validate_source_update(wrapper, prior=None, allow_shrink=False):
    """Check loss/freshness without mutating either candidate or accepted evidence."""
    if not wrapper['items']:
        raise ValueError('Empty source cannot replace accepted state')
    if prior is not None:
        old_date, new_date = prior['source']['extract_timestamp'], wrapper['source']['extract_timestamp']
        if old_date and (not new_date or new_date < old_date):
            raise ValueError('Source date regression')
        if len(wrapper['items']) < len(prior['items']) * .7 and not allow_shrink:
            raise ValueError('Unreviewed source shrink exceeds 30%; previous source retained')


def write_source(path, wrapper, allow_shrink=False):
    path = Path(path)
    validate_source_update(wrapper, json.loads(path.read_bytes()) if path.exists() else None, allow_shrink)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(wrapper, ensure_ascii=False, separators=(',', ':')) + '\n'
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as output:
        output.write(raw)
        temporary = output.name
    os.replace(temporary, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--region', choices=['legacy', *URLS], required=True)
    parser.add_argument('--scratch', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'data/sources/services')
    parser.add_argument('--allow-reviewed-shrink', action='store_true')
    parser.add_argument('--reuse-download', action='store_true', help='Replay local PBF and verified receipt without refreshing retrieval evidence')
    args = parser.parse_args()
    scratch = args.scratch.resolve()
    if scratch.is_relative_to(ROOT): raise ValueError('Scratch must be outside checkout')
    scratch.mkdir(parents=True, exist_ok=True)
    if args.region == 'legacy':
        boundaries = StateBoundaries()
        wrapper, quarantine = legacy((ROOT / 'data/poi_dump_water_propane.geojson').read_bytes(), boundaries)
        stats = {'accepted': len(wrapper['items']), 'quarantined': len(quarantine)}
    else:
        pbf = scratch / f'{args.region}.osm.pbf'
        receipt = scratch / f'{args.region}-download.json'
        if args.reuse_download:
            metadata = json.loads(receipt.read_bytes())
            if metadata.get('url') != URLS[args.region] or metadata.get('bytes') != pbf.stat().st_size or not re.fullmatch('[a-f0-9]{64}', metadata.get('sha256', '')):
                raise ValueError('Invalid saved download receipt')
            timestamp(metadata.get('retrieved_at'))
        else:
            metadata = download(args.region, pbf)
            receipt.write_text(json.dumps(metadata, indent=2))
        from services_parse_budget import bounded_import
        wrapper, quarantine, stats = bounded_import(pbf, args.region, metadata, scratch)
    report = {'region': args.region, 'source': wrapper['source'], 'counts': {category: sum(category in row['categories'] for row in wrapper['items']) for category in CATEGORIES}, 'statistics': stats, 'quarantine_reasons': dict(Counter(q['reason'] for q in quarantine)), 'quarantine': quarantine, 'samples': {category: [{'id': row['id'], 'url': f"https://www.openstreetmap.org/{row['osm_type']}/{row['osm_id']}", 'tags': row['tags']} for row in wrapper['items'] if category in row['categories']][:2] for category in CATEGORIES}}
    (scratch / f'{args.region}-report.json').write_text(json.dumps(report, indent=2))
    write_source(args.output_dir / f'{args.region}.json', wrapper, args.allow_reviewed_shrink)
    print(json.dumps({k: v for k, v in report.items() if k not in ('quarantine', 'samples')}, indent=2))


if __name__ == '__main__':
    main()
