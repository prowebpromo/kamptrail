#!/usr/bin/env python3
"""National OSM height-tag builder for the 50 states and DC (R10 data side).

Source: one public Geofabrik state PBF per run, parsed natively. This extends the
Rhode Island pilot (build_clearances.py) and shares its Census containment,
resource limits and ODbL attribution. It records what OSM states. It does not
decide route association, safe passage or completeness.

The output is a set of clearance candidates in spatial tiles. Candidates are OSM objects that carry
a height tag. Their meaning is not established until validation. Nothing here says verified.

Subcommands:
  build     one or more states into a stage directory, with guards (RI is protected and skipped)
  publish   merge staged states into data/clearances tiles and rewrite index.json
  migrate   re-process committed v2 state files offline into the v3 tile format (no download)
  manifest  rebuild tiles and index.json from the files on disk
  verify    recompute every hash and check the tile contract
  measure   bytes and tile count for a map view, from the manifest tile index
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request

from build_agency_states import ROOT, STATES, valid_point
from build_clearances import KEYS as PILOT_KEYS, CONTEXT as PILOT_CONTEXT, LIFECYCLE, select_geometry
from clearance_parse import assess, height_use, object_tag, STATUSES_CANDIDATE
from import_services import timestamp, bounded_text, utc_now
from services_regions import URLS, validate_resolved_url

SCHEMA = 'kamptrail-clearances-3'
SCHEMA_VERSION = 3
STATE_SCHEMA = 'kamptrail-clearances-state-3'
EXCLUDED_SCHEMA = 'kamptrail-clearances-excluded-1'
OLD_SCHEMA_VERSION = 2
ALL_REGIONS = tuple(sorted(STATES)) + ('DC',)
# Regions the builder never downloads or replaces. RI.json is the shipped pilot file that the current client reads.
PROTECTED = {'RI': {
    'status': 'protected',
    'reason': 'RI.json is the version 1 pilot file that the shipped client reads. A national rebuild would change its format.',
    'release_gate': 'Release a client that reads kamptrail-clearances-3 tiles, then review and rebuild RI under this schema.'}}
BUILD_REGIONS = tuple(r for r in ALL_REGIONS if r not in PROTECTED)
DC_URL = 'https://download.geofabrik.de/north-america/us/district-of-columbia-latest.osm.pbf'
USER_AGENT = 'KampTrail-clearances/1.0 (+https://github.com/prowebpromo/kamptrail)'
DEFAULT_DIR = ROOT / 'data/clearances'

KEYS = PILOT_KEYS + ('height',)
CONTEXT = PILOT_CONTEXT + ('covered', 'layer', 'man_made', 'railway', 'junction', 'oneway')
LICENSE = {'license': 'ODbL-1.0', 'license_url': 'https://opendatacommons.org/licenses/odbl/1-0/',
           'copyright_url': 'https://www.openstreetmap.org/copyright',
           'attribution': 'Contains information from OpenStreetMap, © OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0.'}
NOTICE = ('Clearance candidates: OSM objects that carry a height tag. Their meaning is not established until validation. '
          'Source-reported, uneven and incomplete. Not a route, passage or safety statement. See LICENSE-DATA.md.')
HEADER = {**LICENSE, 'notice': NOTICE}

# Each file stays inside the pilot client's limits (clearances.js: 512 KiB, 2000 rows, 50000 vertices).
MAX_FILE_BYTES = 512 * 1024
MAX_FILE_RECORDS = 2000
MAX_FILE_VERTICES = 50000
# Tile grid: a slippy-map quadtree. Candidates start in z7 cells and a cell splits into four until it fits.
TILE_BASE_ZOOM = 7
TILE_MAX_ZOOM = 13
TILE_TARGET_BYTES = 128 * 1024  # a cell splits above this size. The 512 KiB cap is the hard limit.
TILE_DIR = 'tiles'
EXCLUDED_DIR = 'excluded'
HEADER_RESERVE = 1400
MAX_STATE_BYTES = 48 * 1024 * 1024
MAX_TOTAL_BYTES = 200 * 1024 * 1024
MAX_RESULT_BYTES = 256 * 1024 * 1024
MAX_PBF_BYTES = 3 * 1024**3
MAX_QUARANTINE_SAMPLES = 100
SHRINK_RATIO = 0.7
MIN_PRIOR_FOR_SHRINK = 10
MAX_FAILED_FRACTION = 0.25
DOWNLOAD_SECONDS = 40 * 60
RETRY_DELAYS = (15, 60)
RETRY_CODES = (429, 500, 502, 503, 504)
WORKER_ADDRESS_BYTES = 8 * 1024**3
# Approximate DC extent. The Census reference covers the 50 states only, so DC containment is coarse and flagged.
DC_BBOX = (-77.1198, 38.7916, -76.9094, 38.9958)
GRID = {'scheme': 'slippy-quadtree', 'base_zoom': TILE_BASE_ZOOM, 'max_zoom': TILE_MAX_ZOOM, 'anchor': 'bbox_center_of_candidate',
        'tile_bbox': 'union of the candidate bounding boxes in the tile, so a way that crosses a cell edge is still found',
        'path': 'tiles/{z}-{x}-{y}.json, extra parts as tiles/{z}-{x}-{y}-p{n}.json'}
OBJECT_KEYS = ('building', 'man_made', 'natural', 'landuse', 'amenity', 'leisure', 'power', 'waterway', 'aeroway', 'shop', 'tourism', 'office', 'craft', 'historic')


# ---------------------------------------------------------------- regions

def region_url(region):
    if region == 'DC':
        return DC_URL
    if region not in URLS:
        raise ValueError(f'Unknown region {region}')
    return URLS[region]


def validate_resolved(region, url):
    """Only the requested canonical extract, or its dated same-region variant."""
    if region != 'DC':
        return validate_resolved_url(region, url)
    if url == DC_URL:
        return None
    prefix = DC_URL.removesuffix('latest.osm.pbf')
    if not url.startswith(prefix) or not re.fullmatch('[0-9]{6}\\.osm\\.pbf', url[len(prefix):]):
        raise ValueError('PBF redirect outside fixed same-region public extract')
    day = dt.datetime.strptime(url[len(prefix):len(prefix) + 6], '%y%m%d').date()
    if day > dt.datetime.now(dt.timezone.utc).date():
        raise ValueError('Future dated extract redirect')
    return day


class DcBoundaries:
    """Coarse bounding-box containment for DC. Records carry containment 'bbox'."""
    directory = None
    reference = {'kind': 'bbox', 'bbox': DC_BBOX}

    def classify_many(self, points):
        west, south, east, north = DC_BBOX
        out = {}
        for p in points:
            inside = west <= p[0] <= east and south <= p[1] <= north
            out[tuple(p)] = {'state': 'DC' if inside else None, 'reason': 'contained' if inside else 'outside_requested_state',
                             'candidates': ['DC'] if inside else []}
        return out


# ---------------------------------------------------------------- element classification

def _is(tags, key):
    return tags.get(key) not in (None, 'no')


def structure_of(tags):
    found = []
    if _is(tags, 'bridge') or tags.get('man_made') == 'bridge':
        found.append('bridge')
    if _is(tags, 'tunnel') or tags.get('man_made') == 'tunnel':
        found.append('tunnel')
    if tags.get('covered') == 'yes' or tags.get('tunnel') == 'building_passage':
        found.append('covered')
    if tags.get('barrier') == 'height_restrictor':
        found.append('height_restrictor')
    return found


def has_context(tags):
    """A road, a bridge or tunnel, a covered way, a railway, or a barrier."""
    return bool(tags.get('highway') or tags.get('barrier') or tags.get('railway') or structure_of(tags))


def primary_object(tags):
    """Coarse object kind for counting skipped plain-height objects such as buildings. No ids are kept for these."""
    for key in OBJECT_KEYS:
        if key in tags:
            return key
    return 'other'


def finalize_row(row):
    """Apply the height rule and the assessment. Returns ('row', candidate) or ('excluded', entry).

    A record whose only height evidence is a plain `height` tag is kept only where that tag plausibly
    limits a vehicle path. Otherwise it is excluded with its raw value and a reason code.
    """
    tags, context, structure = row['tags'], row['context'], row['structure']
    if set(tags) == {'height'}:
        use, reason = height_use(context, structure)
        if not use:
            return 'excluded', {'id': row['id'], 'osm_type': row['osm_type'], 'reason': reason, 'tag': object_tag(context, structure), 'raw': tags['height']}
    out = {k: v for k, v in row.items() if k not in ('metres', 'inches', 'parse')}
    out.update(assess(tags, context, structure, row['restriction_on']))
    return 'row', out


def classify_element(kind, oid, version, edited_at, tags, geometry, boundaries, region, extract_date):
    """Return ('skip', reason), ('quarantine', entry), ('excluded', entry) or ('row', row). geometry may be a callable."""
    selected = {k: tags[k] for k in KEYS if k in tags}
    if not selected:
        return 'skip', 'no_height_tags'
    if set(selected) == {'height'} and not has_context(tags):
        return 'skip', 'height_only_no_road_context:' + primary_object(tags)
    identity = f'osm:{kind}:{oid}'
    if any(len(v.encode('utf-8')) > 240 for v in selected.values()):
        return 'quarantine', {'id': identity, 'reason': 'excessive_tag_bytes', 'candidates': []}
    if not has_context(tags):
        return 'quarantine', {'id': identity, 'reason': 'no_road_structure_or_barrier_context', 'candidates': []}
    if any(tags.get(k) in ('yes', 'true', '1') for k in LIFECYCLE) or any(k.startswith(tuple(p + ':' for p in LIFECYCLE)) for k in tags):
        return 'skip', 'lifecycle_excluded'
    geometry = geometry() if callable(geometry) else geometry
    if geometry is None:
        return 'quarantine', {'id': identity, 'reason': 'unsupported_or_incomplete_geometry', 'candidates': []}
    assigned = select_geometry(geometry, boundaries, region)
    if assigned['state'] != region:
        return 'quarantine', {'id': identity, 'reason': assigned['reason'], 'candidates': assigned['candidates']}
    edited = timestamp(edited_at)
    if edited > extract_date:
        raise ValueError('Object edit is newer than the PBF header')
    row = {'id': identity, 'osm_type': kind, 'osm_id': str(oid), 'osm_version': version, 'edited_at': edited,
           'state': region, 'geometry': geometry, 'tags': selected,
           'context': {k: bounded_text(tags[k], 240) for k in CONTEXT if k in tags},
           'restriction_on': 'way' if kind == 'way' else 'node', 'structure': structure_of(tags)}
    return finalize_row(row)


# ---------------------------------------------------------------- download

class _Redirects(urllib.request.HTTPRedirectHandler):
    def __init__(self, region):
        super().__init__()
        self.region, self.count = region, 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_resolved(self.region, newurl)
        self.count += 1
        if self.count > 3:
            raise ValueError('Excessive PBF redirects')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _retry_wait(error, delay):
    after = getattr(error, 'headers', None) and error.headers.get('Retry-After')
    if after and after.isdigit():
        return min(int(after), 300)
    return delay + random.uniform(0, delay / 4)


def download(region, destination, *, opener=None, sleep=time.sleep, now=utc_now, delays=RETRY_DELAYS, seconds=DOWNLOAD_SECONDS):
    """One polite GET of the canonical Geofabrik extract. Retries with backoff, never in parallel."""
    url = region_url(region)
    destination = Path(destination).resolve()
    if destination.is_relative_to(ROOT):
        raise ValueError('Raw PBF must remain outside the repository')
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix('.part')
    started = time.monotonic()
    deadline = started + seconds
    last = None
    try:
        for attempt in range(len(delays) + 1):
            digest, total = hashlib.sha256(), 0
            try:
                request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ValueError('PBF download budget exceeded')
                open_ = opener or urllib.request.build_opener(_Redirects(region)).open
                with open_(request, timeout=min(60, remaining)) as response, partial.open('wb') as output:
                    resolved = response.geturl()
                    validate_resolved(region, resolved)
                    expected = int(response.headers.get('Content-Length', 0))
                    if not 0 < expected <= MAX_PBF_BYTES:
                        raise ValueError('Missing or excessive PBF content length')
                    while True:
                        chunk = response.read(1024 * 1024)
                        if time.monotonic() >= deadline:
                            raise ValueError('PBF download budget exceeded')
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > MAX_PBF_BYTES:
                            raise ValueError('PBF download budget exceeded')
                        digest.update(chunk)
                        output.write(chunk)
                if total != expected:
                    raise OSError('Truncated PBF download')
                partial.replace(destination)
                return {'url': url, 'resolved_url': resolved, 'sha256': digest.hexdigest(), 'retrieved_at': now(), 'bytes': total,
                        'download_seconds': round(time.monotonic() - started, 3), 'attempts': attempt + 1}
            except urllib.error.HTTPError as exc:
                if exc.code not in RETRY_CODES:
                    raise
                last = exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last = exc
            if attempt < len(delays):
                wait = _retry_wait(last, delays[attempt])
                if time.monotonic() + wait >= deadline:
                    break
                sleep(wait)
        raise ValueError(f'PBF download failed after {len(delays) + 1} attempts: {last}')
    finally:
        partial.unlink(missing_ok=True)


def extract_region(pbf, receipt, scratch, region):
    import osmium
    from importlib.metadata import version
    if version('osmium') != '4.3.2':
        raise ValueError('This reviewed builder requires pinned osmium 4.3.2')
    pbf = Path(pbf)
    with pbf.open('rb') as raw:
        actual = hashlib.file_digest(raw, 'sha256').hexdigest()
    if receipt.get('url') != region_url(region) or receipt.get('sha256') != actual or not 0 < pbf.stat().st_size == receipt.get('bytes') <= MAX_PBF_BYTES:
        raise ValueError('PBF bytes differ from the download receipt')
    retrieved = timestamp(receipt.get('retrieved_at'))
    resolved = validate_resolved(region, receipt.get('resolved_url', ''))
    with osmium.io.Reader(str(pbf)) as reader:
        extract_date = timestamp(reader.header().get('osmosis_replication_timestamp'))
    if extract_date > retrieved or (resolved and resolved.isoformat() != extract_date[:10]):
        raise ValueError('PBF header date does not match its dated receipt')
    if region == 'DC':
        boundaries = DcBoundaries()
        reference_hash = hashlib.sha256(json.dumps(DcBoundaries.reference, sort_keys=True).encode()).hexdigest()
        containment = 'bbox'
    else:
        from build_agency_states import StateBoundaries
        boundaries = StateBoundaries()
        with (boundaries.directory / 'manifest.json').open('rb') as handle:
            reference_hash = hashlib.file_digest(handle, 'sha256').hexdigest()
        containment = 'census_polygon'
    rows, quarantine, excluded = [], [], []
    reasons, skipped = {}, {}
    vertices = 0

    class Handler(osmium.SimpleHandler):
        def record(self, obj, kind, geometry):
            nonlocal vertices
            outcome, value = classify_element(kind, obj.id, obj.version, obj.timestamp.isoformat(), dict(obj.tags), geometry, boundaries, region, extract_date)
            if outcome == 'skip':
                skipped[value] = skipped.get(value, 0) + 1
            elif outcome == 'excluded':
                excluded.append(value)
            elif outcome == 'quarantine':
                reasons[value['reason']] = reasons.get(value['reason'], 0) + 1
                if len(quarantine) < MAX_QUARANTINE_SAMPLES:
                    quarantine.append(value)
            else:
                vertices += 1 if value['geometry']['type'] == 'Point' else len(value['geometry']['coordinates'])
                rows.append(value)

        def node(self, obj):
            self.record(obj, 'node', lambda: {'type': 'Point', 'coordinates': [obj.location.lon, obj.location.lat]} if obj.location.valid() else None)

        def way(self, obj):
            def geometry():
                points = [[n.lon, n.lat] for n in obj.nodes if n.location.valid()]
                return {'type': 'LineString', 'coordinates': points} if len(points) == len(obj.nodes) and len(points) >= 2 else None
            self.record(obj, 'way', geometry)

        def relation(self, obj):
            self.record(obj, 'relation', None)

    with tempfile.TemporaryDirectory(prefix='clearance-index-', dir=scratch) as tmp:
        Handler().apply_file(str(pbf), locations=True, idx=f'sparse_file_array,{Path(tmp) / "locations.idx"}', filters=[osmium.filter.KeyFilter(*KEYS)])
    source = {'kind': 'geofabrik', 'url': region_url(region), 'resolved_url': receipt['resolved_url'], 'sha256': actual,
              'bytes': pbf.stat().st_size, 'retrieved_at': retrieved, 'extract_timestamp': extract_date,
              'containment': containment, 'boundary_reference_sha256': reference_hash, **LICENSE}
    report = {'vertices': vertices, 'excluded': len(excluded), 'quarantined': sum(reasons.values()), 'quarantine_reasons': reasons, 'quarantine_samples': quarantine,
              'skipped': skipped, 'parser_version': version('osmium')}
    return {'source': source, 'candidates': sorted(rows, key=lambda r: r['id']), 'excluded': sorted(excluded, key=lambda e: e['id']), 'report': report}


# ---------------------------------------------------------------- encoding

def canonical(payload):
    """Deterministic JSON text. Sorted keys, no spaces, so equal content is byte-identical."""
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def encode(payload):
    return (canonical(payload) + '\n').encode()


def read_json(path):
    return json.loads(Path(path).read_bytes())


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_of(paths):
    digest = hashlib.sha256()
    for path in paths:
        digest.update(Path(path).read_bytes())
    return digest.hexdigest()


# ---------------------------------------------------------------- excluded ids (compact, reproducible)

def _numeric_id(entry):
    return int(entry['id'].rsplit(':', 1)[1])


def encode_excluded(region, entries):
    """Group excluded entries by reason, object tag and OSM type. Ids are sorted and delta encoded.

    Decode: ids[0] is absolute and every later id is the previous id plus the stored delta. raw[i] indexes
    into values and gives the raw height text that was excluded for ids[i].
    """
    values = sorted({e['raw'] for e in entries})
    position = {v: i for i, v in enumerate(values)}
    groups = {}
    for entry in entries:
        groups.setdefault((entry['reason'], entry['tag'], entry['osm_type']), []).append(entry)
    out = []
    for (reason, tag, osm_type) in sorted(groups):
        items = sorted(groups[(reason, tag, osm_type)], key=_numeric_id)
        ids = [_numeric_id(e) for e in items]
        out.append({'reason': reason, 'tag': tag, 'osm_type': osm_type, 'count': len(ids),
                    'ids_delta': [ids[0]] + [b - a for a, b in zip(ids, ids[1:])], 'raw': [position[e['raw']] for e in items]})
    return {'schema': EXCLUDED_SCHEMA, 'version': 1, 'kind': 'excluded_ids', 'region': region, **HEADER,
            'decode': 'ids_delta[0] is absolute, later entries add to the previous id. raw[i] indexes values.',
            'total': len(entries), 'groups': out, 'values': values}


def decode_excluded(doc):
    entries = []
    for group in doc['groups']:
        current = 0
        for i, delta in enumerate(group['ids_delta']):
            current = delta if i == 0 else current + delta
            entries.append({'id': f'osm:{group["osm_type"]}:{current}', 'osm_type': group['osm_type'], 'reason': group['reason'],
                            'tag': group['tag'], 'raw': doc['values'][group['raw'][i]]})
    return sorted(entries, key=lambda e: e['id'])


def excluded_counts(doc):
    by_reason, by_tag = {}, {}
    for group in doc['groups']:
        by_reason[group['reason']] = by_reason.get(group['reason'], 0) + group['count']
        tags = by_tag.setdefault(group['reason'], {})
        tags[group['tag']] = tags.get(group['tag'], 0) + group['count']
    return by_reason, by_tag


def content_sha256(candidates, excluded_doc):
    """Hash of what an extract produced, without source dates, so a re-download of the same content is not a change."""
    body = {'candidates': sorted(candidates, key=lambda r: r['id']), 'excluded': excluded_doc}
    return sha256_bytes(canonical(body).encode())


def make_state_doc(region, source, candidates, excluded_entries, report=None):
    excluded_doc = encode_excluded(region, excluded_entries)
    candidates = sorted(candidates, key=lambda r: r['id'])
    return {'schema': STATE_SCHEMA, 'region': region, 'source': source, 'content_sha256': content_sha256(candidates, excluded_doc),
            'candidates': candidates, 'excluded': excluded_doc, 'report': report or {}}


# ---------------------------------------------------------------- tiles

def tile_xy(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat = max(-85.0511, min(85.0511, lat))
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def geometry_points(geometry):
    return [geometry['coordinates']] if geometry['type'] == 'Point' else geometry['coordinates']


def record_bbox(record):
    points = geometry_points(record['geometry'])
    lons, lats = [p[0] for p in points], [p[1] for p in points]
    return min(lons), min(lats), max(lons), max(lats)


def vertex_count(record):
    return len(geometry_points(record['geometry']))


def part_path(z, x, y, part):
    return f'{TILE_DIR}/{z}-{x}-{y}.json' if part == 1 else f'{TILE_DIR}/{z}-{x}-{y}-p{part}.json'


def _outward(box):
    w, s, e, n = box
    return [math.floor(w * 1e6) / 1e6, math.floor(s * 1e6) / 1e6, math.ceil(e * 1e6) / 1e6, math.ceil(n * 1e6) / 1e6]


def encode_tile(z, x, y, part, parts, items):
    boxes = [i['bbox'] for i in items]
    bbox = _outward((min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)))
    payload = {'version': SCHEMA_VERSION, 'schema': SCHEMA, 'kind': 'clearance_candidates', **HEADER,
               'tile': {'z': z, 'x': x, 'y': y, 'part': part, 'parts': parts}, 'bbox': bbox,
               'candidates': [i['record'] for i in sorted(items, key=lambda i: i['record']['id'])]}
    return bbox, encode(payload)


def make_tiles(candidates, *, max_bytes=MAX_FILE_BYTES, max_records=MAX_FILE_RECORDS, max_vertices=MAX_FILE_VERTICES,
               base_zoom=TILE_BASE_ZOOM, max_zoom=TILE_MAX_ZOOM, target_bytes=TILE_TARGET_BYTES):
    """Spatial quadtree tiles. A candidate lives in exactly one tile, chosen by the centre of its bounding box.

    Returns a list of dicts: path, z, x, y, part, parts, bbox, bytes, records, sha256, data.
    """
    items = []
    for record in candidates:
        box = record_bbox(record)
        length = len(canonical(record).encode()) + 1
        if length + HEADER_RESERVE > max_bytes or vertex_count(record) > max_vertices:
            raise ValueError(f'Single record {record["id"]} exceeds the per-file budget')
        items.append({'record': record, 'bbox': box, 'size': length, 'verts': vertex_count(record),
                      'centre': ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)})

    def fits(group, limit=max_bytes):
        return (len(group) <= max_records and sum(i['verts'] for i in group) <= max_vertices
                and HEADER_RESERVE + sum(i['size'] for i in group) <= limit)

    leaves = []

    def place(group, z, x, y):
        if fits(group, min(target_bytes, max_bytes)) or (len(group) == 1 and fits(group)):
            leaves.append((z, x, y, [group]))
        elif z >= max_zoom:
            parts, current = [], []
            for item in sorted(group, key=lambda i: i['record']['id']):
                if current and not fits(current + [item]):
                    parts.append(current)
                    current = []
                current.append(item)
            parts.append(current)
            leaves.append((z, x, y, parts))
        else:
            children = {}
            for item in group:
                children.setdefault(tile_xy(*item['centre'], z + 1), []).append(item)
            for (cx, cy) in sorted(children):
                place(children[(cx, cy)], z + 1, cx, cy)

    cells = {}
    for item in items:
        cells.setdefault(tile_xy(*item['centre'], base_zoom), []).append(item)
    for (x, y) in sorted(cells):
        place(cells[(x, y)], base_zoom, x, y)
    tiles = []
    for z, x, y, parts in sorted(leaves, key=lambda leaf: leaf[:3]):
        for number, group in enumerate(parts, 1):
            bbox, data = encode_tile(z, x, y, number, len(parts), group)
            if len(data) > max_bytes:
                raise ValueError('Encoded tile exceeds its byte budget')
            tiles.append({'path': part_path(z, x, y, number), 'z': z, 'x': x, 'y': y, 'part': number, 'parts': len(parts), 'bbox': bbox,
                          'bytes': len(data), 'records': len(group), 'sha256': sha256_bytes(data), 'data': data})
    return tiles


def bbox_intersects(a, b):
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def viewport_bbox(lon, lat, zoom, width=1280, height=800):
    """Lon/lat bounds of a map view of width x height CSS pixels on 256 px tiles."""
    world = 256 * 2 ** zoom
    cx = (lon + 180.0) / 360.0 * world
    cy = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * world

    def lonlat(px, py):
        return px / world * 360.0 - 180.0, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * py / world))))
    west, north = lonlat(cx - width / 2, cy - height / 2)
    east, south = lonlat(cx + width / 2, cy + height / 2)
    return [west, south, east, north]


def tiles_for_view(index, bbox):
    return [t for t in index['tiles'] if bbox_intersects(t['bbox'], bbox)]


# ---------------------------------------------------------------- merge: one OSM identity, one tile

def canonical_region(regions):
    """Census polygon containment beats the coarse DC box. Ties go to the first code."""
    return sorted(regions, key=lambda r: (r == 'DC', r))[0]


def members_of(record):
    return {record['state'], *record.get('also_in_extracts', [])}


def merge_candidates(prior, fresh_docs):
    """Replace the memberships of refreshed regions, then deduplicate by osm type and id.

    prior is a list of stored candidates. fresh_docs maps region to a state doc. A candidate listed in
    two extracts is stored once, under the canonical region, with the other regions in also_in_extracts.
    """
    refreshed = set(fresh_docs)
    merged = {}

    def add(record, members, fresh):
        slot = merged.get(record['id'])
        if slot is None:
            merged[record['id']] = {'record': dict(record), 'members': set(members), 'fresh': fresh}
            return
        slot['members'] |= members
        if fresh and not slot['fresh']:
            slot['record'], slot['fresh'] = dict(record), True

    for record in prior:
        members = members_of(record) - refreshed
        if members:
            add(record, members, False)
    for region in sorted(fresh_docs):
        for record in fresh_docs[region]['candidates']:
            add(record, {region}, True)
    out = []
    for key in sorted(merged):
        slot = merged[key]
        record, members = slot['record'], slot['members']
        record['state'] = canonical_region(members)
        others = sorted(members - {record['state']})
        record.pop('also_in_extracts', None)
        if others:
            record['also_in_extracts'] = others
        out.append(record)
    return out


# ---------------------------------------------------------------- the store on disk

def load_store(directory):
    """Read the committed tiles, excluded files and manifest sections into memory."""
    directory = Path(directory)
    path = directory / 'index.json'
    store = {'sources': {}, 'failures': {}, 'candidates': [], 'excluded': {}}
    if not path.is_file():
        return store
    index = read_json(path)
    if index.get('version') != SCHEMA_VERSION:
        return store
    store['sources'] = index.get('sources', {})
    store['failures'] = index.get('failures', {})
    for tile in index['tiles']:
        store['candidates'].extend(read_json(directory / tile['path'])['candidates'])
    for region, item in index['exclusions']['files'].items():
        store['excluded'][region] = read_json(directory / item['path'])
    return store


def source_entry(source, doc, quarantine=None):
    entry = {k: source[k] for k in ('url', 'resolved_url', 'sha256', 'bytes', 'retrieved_at', 'extract_timestamp', 'containment', 'boundary_reference_sha256') if k in source}
    entry['source_sha256'] = entry.pop('sha256')
    entry['content_sha256'] = doc['content_sha256']
    entry['extract_candidates'] = len(doc['candidates'])
    entry['extract_excluded'] = doc['excluded']['total']
    quarantine = quarantine if quarantine is not None else doc.get('report', {})
    if quarantine.get('quarantined') is not None:
        entry['quarantined'] = quarantine['quarantined']
        entry['quarantine_reasons'] = quarantine.get('quarantine_reasons', {})
    return entry


def build_index(tiles, store, protected=PROTECTED):
    candidates = store['candidates']
    by_status, by_state = {}, {}
    for record in candidates:
        by_status[record['status']] = by_status.get(record['status'], 0) + 1
        slot = by_state.setdefault(record['state'], {'candidates': 0, 'comparable': 0, 'suspect': 0})
        slot['candidates'] += 1
        slot['comparable'] += 1 if record['comparable'] else 0
        slot['suspect'] += 1 if record['status'] == 'suspect' else 0
    by_reason, by_tag, by_state_reason, files = {}, {}, {}, {}
    for region in sorted(store['excluded']):
        doc = store['excluded'][region]
        reasons, tags = excluded_counts(doc)
        by_state_reason[region] = reasons
        for reason, count in reasons.items():
            by_reason[reason] = by_reason.get(reason, 0) + count
        for reason, counts in tags.items():
            slot = by_tag.setdefault(reason, {})
            for tag, count in counts.items():
                slot[tag] = slot.get(tag, 0) + count
        data = encode(doc)
        files[region] = {'path': f'{EXCLUDED_DIR}/{region}.json', 'bytes': len(data), 'sha256': sha256_bytes(data), 'ids': doc['total']}
    states_with_data = sorted(r for r in by_state)
    failures = {r: f for r, f in sorted(store['failures'].items()) if r not in protected}
    return {
        'version': SCHEMA_VERSION, 'schema': SCHEMA, 'kind': 'clearance_candidates_manifest', **HEADER,
        'terminology': 'Records are clearance candidates. Each is an OSM object with a height tag. status and comparable say how far the value can be compared. None is a verified clearance.',
        'limits': {'max_file_bytes': MAX_FILE_BYTES, 'max_file_records': MAX_FILE_RECORDS, 'max_file_vertices': MAX_FILE_VERTICES, 'shrink_ratio': SHRINK_RATIO},
        'grid': GRID,
        'states_protected': {r: dict(v) for r, v in sorted(protected.items())},
        'failures': failures,
        'totals': {'candidates': len(candidates), 'tiles': len(tiles), 'bytes': sum(t['bytes'] for t in tiles),
                   'comparable': sum(1 for r in candidates if r['comparable']), 'by_status': dict(sorted(by_status.items())),
                   'excluded': sum(by_reason.values()), 'states_with_data': len(states_with_data),
                   'states_not_built': sorted(r for r in BUILD_REGIONS if r not in by_state),
                   'states_with_failures': sorted(failures)},
        'states': dict(sorted(by_state.items())),
        'exclusions': {'total': sum(by_reason.values()), 'by_reason': dict(sorted(by_reason.items())),
                       'by_tag': {k: dict(sorted(v.items())) for k, v in sorted(by_tag.items())},
                       'by_state': by_state_reason, 'files': files},
        'sources': {r: store['sources'][r] for r in sorted(store['sources'])},
        'tiles': [{k: t[k] for k in ('path', 'z', 'x', 'y', 'part', 'parts', 'bbox', 'bytes', 'records', 'sha256')} for t in tiles],
    }


def _write_if_changed(path, data):
    path = Path(path)
    if path.is_file() and sha256_bytes(path.read_bytes()) == sha256_bytes(data):
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_bytes(data)
    temporary.replace(path)
    return True


def write_store(directory, store):
    """Write tiles, excluded files and the manifest. A file whose bytes are unchanged is not touched."""
    directory = Path(directory)
    tiles = make_tiles(store['candidates'])
    total = sum(t['bytes'] for t in tiles)
    if total > MAX_TOTAL_BYTES:
        raise SystemExit(f'Clearance data is {total} bytes, over the {MAX_TOTAL_BYTES} byte repository budget. Review before committing.')
    index = build_index(tiles, store)
    written, unchanged = [], []
    wanted = set()
    for tile in tiles:
        wanted.add(tile['path'])
        (written if _write_if_changed(directory / tile['path'], tile['data']) else unchanged).append(tile['path'])
    for region, doc in store['excluded'].items():
        path = index['exclusions']['files'][region]['path']
        wanted.add(path)
        (written if _write_if_changed(directory / path, encode(doc)) else unchanged).append(path)
    for folder in (TILE_DIR, EXCLUDED_DIR):
        for old in sorted((directory / folder).glob('*.json')) if (directory / folder).is_dir() else []:
            if f'{folder}/{old.name}' not in wanted:
                old.unlink()
                written.append(f'{folder}/{old.name} (removed)')
    body = (json.dumps(index, indent=1, ensure_ascii=False, sort_keys=True) + '\n').encode()
    (written if _write_if_changed(directory / 'index.json', body) else unchanged).append('index.json')
    return index, written, unchanged


def verify_index(directory):
    """Recompute every hash and check the tile contract. Returns a list of problems, empty when consistent."""
    directory = Path(directory)
    index = read_json(directory / 'index.json')
    problems = []
    if index.get('version') != SCHEMA_VERSION:
        return [f'index.json is version {index.get("version")}, expected {SCHEMA_VERSION}']
    for field in ('license', 'license_url', 'copyright_url', 'attribution'):
        if not index.get(field):
            problems.append(f'index.json lacks {field}')
    seen, records = set(), 0
    listed = {t['path'] for t in index['tiles']}
    for tile in index['tiles']:
        path = directory / tile['path']
        if not path.is_file():
            problems.append(f'missing {tile["path"]}')
            continue
        raw = path.read_bytes()
        if len(raw) > MAX_FILE_BYTES:
            problems.append(f'{tile["path"]} is over {MAX_FILE_BYTES} bytes')
        if sha256_bytes(raw) != tile['sha256'] or len(raw) != tile['bytes']:
            problems.append(f'{tile["path"]} differs from the manifest')
            continue
        doc = json.loads(raw)
        if not all(doc.get(f) for f in ('license', 'license_url', 'copyright_url', 'attribution')):
            problems.append(f'{tile["path"]} lacks the attribution header')
        if len(doc['candidates']) != tile['records']:
            problems.append(f'{tile["path"]} record count differs')
        if len(doc['candidates']) > MAX_FILE_RECORDS or sum(vertex_count(r) for r in doc['candidates']) > MAX_FILE_VERTICES:
            problems.append(f'{tile["path"]} is over the row or vertex limit')
        for record in doc['candidates']:
            records += 1
            if record['id'] in seen:
                problems.append(f'duplicate identity {record["id"]}')
            seen.add(record['id'])
            box = record_bbox(record)
            if not (tile['bbox'][0] <= box[0] and tile['bbox'][1] <= box[1] and box[2] <= tile['bbox'][2] and box[3] <= tile['bbox'][3]):
                problems.append(f'{record["id"]} lies outside the bbox of {tile["path"]}')
    for old in sorted((directory / TILE_DIR).glob('*.json')) if (directory / TILE_DIR).is_dir() else []:
        if f'{TILE_DIR}/{old.name}' not in listed:
            problems.append(f'unlisted tile {old.name}')
    if records != index['totals']['candidates']:
        problems.append('candidate total differs')
    for region, item in index['exclusions']['files'].items():
        path = directory / item['path']
        if not path.is_file() or sha256_bytes(path.read_bytes()) != item['sha256']:
            problems.append(f'excluded record for {region} differs from the manifest')
    return problems


# ---------------------------------------------------------------- guards

def prior_state_info(directory, region):
    """What the committed manifest says about a state, or None."""
    path = Path(directory) / 'index.json'
    if not path.is_file():
        return None
    index = read_json(path)
    entry = index.get('sources', {}).get(region) if index.get('version') == SCHEMA_VERSION else None
    if not entry:
        return None
    return {'schema': SCHEMA, 'candidates': entry['extract_candidates'], 'source_sha256': entry['source_sha256'], 'content_sha256': entry['content_sha256']}


def guard(prior, new_candidates, new_bytes):
    """Return a failure reason when the prior data must be kept, otherwise None."""
    if new_candidates == 0:
        return 'no_records'
    if new_bytes > MAX_STATE_BYTES:
        return 'state_too_large'
    if prior and prior['candidates'] >= MIN_PRIOR_FOR_SHRINK and new_candidates < SHRINK_RATIO * prior['candidates']:
        return 'shrunk_sharply'
    return None


# ---------------------------------------------------------------- build one state

def plan(region, directory, scratch):
    if region in PROTECTED:
        return {'state': region, 'skip': 'protected', 'url': None, 'user_agent': USER_AGENT, 'prior': None, **PROTECTED[region]}
    return {'state': region, 'url': region_url(region), 'user_agent': USER_AGENT, 'output': [f'{{stage}}/state/{region}.json'],
            'scratch': str(scratch), 'retry_delays_seconds': list(RETRY_DELAYS), 'prior': prior_state_info(directory, region),
            'guards': {'shrink_ratio': SHRINK_RATIO, 'max_state_bytes': MAX_STATE_BYTES, 'max_file_bytes': MAX_FILE_BYTES}}


def run_worker(pbf, receipt, scratch, region):
    import services_parse_budget as budget
    from services_parse_budget import bounded_process
    previous_limit = budget.MAX_ADDRESS_BYTES
    budget.MAX_ADDRESS_BYTES = WORKER_ADDRESS_BYTES  # read by limits() in the forked child only
    try:
        with tempfile.TemporaryDirectory(prefix='clearance-national-', dir=scratch) as tmp:
            directory = Path(tmp)
            (directory / 'request.json').write_text(json.dumps({'pbf': str(Path(pbf).resolve()), 'receipt': receipt, 'region': region}))
            bounded_process([sys.executable, __file__, '--worker', str(directory)], directory)
            raw = (directory / 'result.json').read_bytes()
            if len(raw) > MAX_RESULT_BYTES:
                raise ValueError('Clearance result byte budget exceeded')
            return json.loads(raw)
    finally:
        budget.MAX_ADDRESS_BYTES = previous_limit


def build_state(region, *, directory, stage, scratch, pause=0, pbf=None, receipt=None,
                downloader=download, worker=run_worker, sleep=time.sleep, now=utc_now):
    """Build one state into stage. Never touches the committed files. Always returns a status dict."""
    stage, scratch = Path(stage), Path(scratch)
    (stage / 'status').mkdir(parents=True, exist_ok=True)
    (stage / 'state').mkdir(parents=True, exist_ok=True)
    scratch.mkdir(parents=True, exist_ok=True)
    status = {'state': region, 'attempted_at': now()}
    if region in PROTECTED:
        status.update(status='protected', reason=PROTECTED[region]['reason'])
        (stage / 'status' / f'{region}.json').write_text(json.dumps(status, indent=2) + '\n')
        return status
    prior = prior_state_info(directory, region)
    pbf_path = Path(pbf) if pbf else scratch / f'{region}.osm.pbf'
    try:
        if not pbf:
            if pause:
                sleep(pause)
            receipt = downloader(region, pbf_path)
        receipt = receipt if isinstance(receipt, dict) else read_json(receipt)
        status['source_sha256'] = receipt['sha256']
        if prior and prior['source_sha256'] == receipt['sha256']:
            status['status'] = 'unchanged'
            return status
        result = worker(pbf_path, receipt, scratch, region)
        doc = make_state_doc(region, result['source'], result['candidates'], result['excluded'], result['report'])
        size = len(encode(doc))
        reason = guard(prior, len(doc['candidates']), size)
        status.update(candidates=len(doc['candidates']), excluded=doc['excluded']['total'], bytes=size, content_sha256=doc['content_sha256'],
                      quarantined=result['report']['quarantined'], quarantine_reasons=result['report']['quarantine_reasons'],
                      skipped=result['report']['skipped'], extract_timestamp=result['source']['extract_timestamp'])
        if reason:
            status.update(status='kept_prior' if prior else 'failed', failure={'reason': reason})
            return status
        if prior and prior['content_sha256'] == doc['content_sha256']:
            status['status'] = 'unchanged_content'
            return status
        (stage / 'state' / f'{region}.json').write_bytes(encode(doc))
        status['status'] = 'ok'
        return status
    except Exception as exc:  # fetch, parse and budget failures all keep the prior data
        status.update(status='kept_prior' if prior else 'failed', failure={'reason': 'build_failed'}, detail=bounded_text(exc, 300))
        return status
    finally:
        if not pbf:
            pbf_path.unlink(missing_ok=True)
        (stage / 'status' / f'{region}.json').write_text(json.dumps(status, indent=2) + '\n')


# ---------------------------------------------------------------- publish and migrate

def publish(stage, directory, expected=(), now=utc_now):
    """Merge ok states into the tile store, then rewrite changed files and the manifest.

    Refuses a mostly failed run. A state in expected with no status file crashed and is recorded as failed.
    Files whose bytes are unchanged are not rewritten, so an unchanged run leaves the tree clean.
    """
    stage, directory = Path(stage), Path(directory)
    statuses = [read_json(p) for p in sorted((stage / 'status').glob('*.json'))] if (stage / 'status').is_dir() else []
    statuses = [s for s in statuses if s['state'] not in PROTECTED]
    seen = {s['state'] for s in statuses}
    statuses += [{'state': r, 'status': 'failed', 'failure': {'reason': 'no_status_from_job'}} for r in expected if r not in seen and r not in PROTECTED]
    failed = [s for s in statuses if s['status'] in ('failed', 'kept_prior')]
    if statuses and len(failed) > MAX_FAILED_FRACTION * len(statuses):
        raise SystemExit(f'{len(failed)} of {len(statuses)} states failed. Nothing published.')
    store = load_store(directory)
    docs = {}
    for status in statuses:
        if status['status'] == 'ok':
            path = stage / 'state' / f'{status["state"]}.json'
            if not path.is_file():
                raise SystemExit(f'{status["state"]}: staged state file is missing')
            doc = read_json(path)
            # Same content from a newer extract is not a change. Keep the committed source entry so no date churns.
            if store['sources'].get(status['state'], {}).get('content_sha256') != doc['content_sha256']:
                docs[status['state']] = doc
    store['candidates'] = merge_candidates(store['candidates'], docs)
    for region, doc in docs.items():
        store['sources'][region] = source_entry(doc['source'], doc)
        store['excluded'][region] = doc['excluded']
    for status in statuses:
        region = status['state']
        if status['status'] in ('failed', 'kept_prior'):
            store['failures'][region] = {'reason': status['failure']['reason']}
        elif status['status'] in ('ok', 'unchanged', 'unchanged_content'):
            store['failures'].pop(region, None)
    index, written, unchanged = write_store(directory, store)
    problems = verify_index(directory)
    if problems:
        raise SystemExit('Manifest check failed: ' + '; '.join(problems))
    return index, [s for s in statuses if s['status'] == 'ok'], failed, written


def rebuild(directory):
    store = load_store(directory)
    index, written, _ = write_store(directory, store)
    return index, written


OLD_FILE = re.compile(r'([A-Z]{2})(-[0-9]+)?\.json')


def migrate(directory):
    """Re-process committed version 2 state files offline into version 3 tiles. No download, no information loss.

    Source dates are copied from each state file. Rows are reclassified by finalize_row, so a dropped row
    lands in the excluded record with its raw value. Old state files are removed and RI.json stays.
    """
    directory = Path(directory)
    old_index = read_json(directory / 'index.json') if (directory / 'index.json').is_file() else {}
    old_states = old_index.get('states', {}) if old_index.get('schema') == 'kamptrail-clearances-2' else {}
    store = {'sources': {}, 'failures': {}, 'candidates': [], 'excluded': {}}
    docs = {}
    for region in BUILD_REGIONS:
        first = directory / f'{region}.json'
        if not first.is_file():
            continue
        head = read_json(first)
        if head.get('version') != OLD_SCHEMA_VERSION:
            continue
        rows = []
        for number in range(1, head['parts'] + 1):
            rows += read_json(directory / (f'{region}.json' if number == 1 else f'{region}-{number}.json'))['records']
        kept, excluded = [], []
        for row in rows:
            outcome, value = finalize_row(row)
            (kept if outcome == 'row' else excluded).append(value)
        quarantine = {'quarantined': old_states.get(region, {}).get('quarantined'), 'quarantine_reasons': old_states.get(region, {}).get('quarantine_reasons', {})}
        doc = make_state_doc(region, head['source'], kept, excluded)
        docs[region] = doc
        store['sources'][region] = source_entry(head['source'], doc, quarantine)
        store['excluded'][region] = doc['excluded']
    store['candidates'] = merge_candidates([], docs)
    index, written, _ = write_store(directory, store)
    for old in sorted(directory.glob('*.json')):
        match = OLD_FILE.fullmatch(old.name)
        if match and match[1] not in PROTECTED:
            old.unlink()
    problems = verify_index(directory)
    if problems:
        raise SystemExit('Manifest check failed: ' + '; '.join(problems))
    return index, written


# ---------------------------------------------------------------- command line

def worker_main(directory):
    directory = Path(directory)
    request = json.loads((directory / 'request.json').read_bytes())
    result = extract_region(request['pbf'], request['receipt'], directory, request['region'])
    (directory / 'result.json').write_text(json.dumps(result, separators=(',', ':')))


def regions_from(values):
    if not values or values == ['ALL']:
        return list(BUILD_REGIONS)
    bad = [v for v in values if v not in ALL_REGIONS]
    if bad:
        raise SystemExit(f'Unknown state codes: {bad}')
    return values


CITIES = {'New York City': (-74.0060, 40.7128), 'Los Angeles': (-118.2437, 34.0522), 'Chicago': (-87.6298, 41.8781),
          'Wyoming I-80 (Rawlins)': (-107.2387, 41.7911), 'West Virginia US-219 (Marlinton)': (-80.0959, 38.2243)}


def measure(directory, zooms=(8, 10, 12)):
    import gzip
    index = read_json(Path(directory) / 'index.json')
    rows = []
    for name, (lon, lat) in CITIES.items():
        for zoom in zooms:
            hit = tiles_for_view(index, viewport_bbox(lon, lat, zoom))
            gz = sum(len(gzip.compress((Path(directory) / t['path']).read_bytes(), 6)) for t in hit)
            rows.append({'view': name, 'zoom': zoom, 'tiles': len(hit), 'bytes': sum(t['bytes'] for t in hit), 'gzip_bytes': gz, 'candidates': sum(t['records'] for t in hit)})
    return rows


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ['--worker']:
        return worker_main(argv[1])
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='command', required=True)
    b = sub.add_parser('build')
    b.add_argument('--state', action='append', help='State code, repeatable. Default ALL (50 states and DC, RI is protected and skipped).')
    b.add_argument('--dir', type=Path, default=DEFAULT_DIR)
    b.add_argument('--stage', type=Path)
    b.add_argument('--scratch', type=Path)
    b.add_argument('--pause', type=float, default=10, help='Seconds to wait before each download.')
    b.add_argument('--pbf', type=Path, help='Use an existing PBF instead of downloading. Needs --receipt and one --state.')
    b.add_argument('--receipt', type=Path)
    b.add_argument('--dry-run', action='store_true', help='Print the plan. No network, no writes.')
    for name in ('publish', 'manifest', 'verify', 'migrate', 'measure'):
        s = sub.add_parser(name)
        s.add_argument('--dir', type=Path, default=DEFAULT_DIR)
        if name == 'publish':
            s.add_argument('--stage', type=Path, required=True)
            s.add_argument('--expect', nargs='*', default=[], help='States this run planned. A missing status counts as a failure.')
    args = p.parse_args(argv)
    if args.command == 'build':
        regions = regions_from(args.state)
        if args.dry_run:
            print(json.dumps([plan(r, args.dir, args.scratch or '<scratch>') for r in regions], indent=2))
            return
        if not args.stage or not args.scratch:
            p.error('--stage and --scratch are required')
        for path in (args.stage.resolve(), args.scratch.resolve()):
            if path.is_relative_to(ROOT):
                raise SystemExit('Stage and scratch must stay outside the checkout')
        if args.pbf and (len(regions) != 1 or not args.receipt):
            p.error('--pbf needs --receipt and exactly one --state')
        for region in regions:
            status = build_state(region, directory=args.dir, stage=args.stage, scratch=args.scratch, pause=args.pause, pbf=args.pbf, receipt=args.receipt)
            print(json.dumps({k: status.get(k) for k in ('state', 'status', 'candidates', 'excluded', 'bytes', 'failure') if status.get(k) is not None}))
    elif args.command == 'publish':
        index, updated, failed, written = publish(args.stage, args.dir, regions_from(args.expect) if args.expect else ())
        print(json.dumps({'updated_states': [s['state'] for s in updated], 'failed': [f['state'] for f in failed], 'totals': index['totals'],
                          'files_written': len(written)}, indent=2))
    elif args.command == 'migrate':
        index, written = migrate(args.dir)
        print(json.dumps({'totals': index['totals'], 'files_written': len(written)}, indent=2))
    elif args.command == 'manifest':
        rebuild(args.dir)
    elif args.command == 'measure':
        print(json.dumps(measure(args.dir), indent=1))
    else:
        problems = verify_index(args.dir)
        print('\n'.join(problems) or 'Manifest hashes match.')
        sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
