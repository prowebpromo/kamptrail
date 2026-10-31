#!/usr/bin/env python3
"""National OSM height-tag builder for the 50 states and DC (R10 data side).

Source: one public Geofabrik state PBF per run, parsed natively. This extends the
Rhode Island pilot (build_clearances.py) and shares its Census containment,
resource limits and ODbL attribution. It records what OSM states. It does not
decide route association, safe passage or completeness.

Subcommands:
  build     one or more states into a stage directory, with guards
  publish   move staged states into data/clearances and rewrite index.json
  manifest  rebuild index.json from the files on disk
  verify    recompute every hash in index.json
"""
import argparse
import datetime as dt
import hashlib
import json
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
from clearance_parse import HEIGHT_KEYS, height_fields
from import_services import timestamp, bounded_text, utc_now
from services_regions import URLS, validate_resolved_url

SCHEMA = 'kamptrail-clearances-2'
SCHEMA_VERSION = 2
ALL_REGIONS = tuple(sorted(STATES)) + ('DC',)
DC_URL = 'https://download.geofabrik.de/north-america/us/district-of-columbia-latest.osm.pbf'
USER_AGENT = 'KampTrail-clearances/1.0 (+https://github.com/prowebpromo/kamptrail)'
DEFAULT_DIR = ROOT / 'data/clearances'

KEYS = PILOT_KEYS + ('height',)
CONTEXT = PILOT_CONTEXT + ('covered', 'layer', 'man_made', 'railway', 'junction', 'oneway')
LICENSE = {'license': 'ODbL-1.0', 'license_url': 'https://opendatacommons.org/licenses/odbl/1-0/',
           'copyright_url': 'https://www.openstreetmap.org/copyright',
           'attribution': 'Contains information from OpenStreetMap, © OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0.'}

# Each file stays inside the pilot client's limits (clearances.js: 512 KiB, 2000 rows, 50000 vertices).
MAX_FILE_BYTES = 512 * 1024
MAX_FILE_RECORDS = 2000
MAX_FILE_VERTICES = 50000
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


def select_tags(tags):
    """Return (selected, None) or (None, skip_reason) from the tags alone."""
    selected = {k: tags[k] for k in KEYS if k in tags}
    # Plain height is a structure dimension, usually of buildings. Keep it only on bridges, tunnels and barriers.
    if 'height' in selected and not (structure_of(tags) or tags.get('barrier')):
        del selected['height']
    if not selected:
        return None, 'no_height_tags'
    return selected, None


def classify_element(kind, oid, version, edited_at, tags, geometry, boundaries, region, extract_date):
    """Return ('skip', reason), ('quarantine', entry) or ('row', row). geometry may be a callable."""
    selected, reason = select_tags(tags)
    if selected is None:
        return 'skip', reason
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
    metres, inches, status = height_fields(selected)
    row = {'id': identity, 'osm_type': kind, 'osm_id': str(oid), 'osm_version': version, 'edited_at': edited,
           'state': region, 'geometry': geometry, 'tags': selected,
           'context': {k: bounded_text(tags[k], 240) for k in CONTEXT if k in tags},
           'metres': metres, 'inches': inches, 'parse': status,
           'restriction_on': 'way' if kind == 'way' else 'node', 'structure': structure_of(tags)}
    return 'row', row


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


# ---------------------------------------------------------------- native extraction (runs in the bounded child)

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
    rows, quarantine = [], []
    reasons, skipped = {}, {}
    vertices = 0

    class Handler(osmium.SimpleHandler):
        def record(self, obj, kind, geometry):
            nonlocal vertices
            outcome, value = classify_element(kind, obj.id, obj.version, obj.timestamp.isoformat(), dict(obj.tags), geometry, boundaries, region, extract_date)
            if outcome == 'skip':
                skipped[value] = skipped.get(value, 0) + 1
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
    report = {'vertices': vertices, 'quarantined': sum(reasons.values()), 'quarantine_reasons': reasons, 'quarantine_samples': quarantine,
              'skipped': skipped, 'parser_version': version('osmium')}
    return {'source': source, 'records': sorted(rows, key=lambda r: r['id']), 'report': report}


# ---------------------------------------------------------------- sharding and encoding

def encode(payload):
    return (json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n').encode()


def part_name(region, number):
    return f'{region}.json' if number == 1 else f'{region}-{number}.json'


def vertex_count(record):
    geometry = record['geometry']
    return 1 if geometry['type'] == 'Point' else len(geometry['coordinates'])


def shard(region, source, records, *, max_bytes=MAX_FILE_BYTES, max_records=MAX_FILE_RECORDS, max_vertices=MAX_FILE_VERTICES):
    """Split sorted records into files that each satisfy the client's byte, row and vertex limits."""
    header = len(encode({'version': SCHEMA_VERSION, 'schema': SCHEMA, 'region': region, 'part': 999, 'parts': 999, 'source': source, 'records': []}))
    chunks, current, size, count, verts = [], [], header, 0, 0
    for record in records:
        length = len(json.dumps(record, ensure_ascii=False, separators=(',', ':')).encode()) + 1
        v = vertex_count(record)
        if header + length > max_bytes or v > max_vertices:
            raise ValueError(f'Single record {record["id"]} exceeds the per-file budget')
        if current and (size + length > max_bytes or count + 1 > max_records or verts + v > max_vertices):
            chunks.append(current)
            current, size, count, verts = [], header, 0, 0
        current.append(record)
        size, count, verts = size + length, count + 1, verts + v
    if current:
        chunks.append(current)
    files = []
    for number, chunk in enumerate(chunks, 1):
        payload = {'version': SCHEMA_VERSION, 'schema': SCHEMA, 'region': region, 'part': number, 'parts': len(chunks), 'source': source, 'records': chunk}
        data = encode(payload)
        if len(data) > max_bytes:
            raise ValueError('Encoded part exceeds its byte budget')
        files.append((part_name(region, number), data, len(chunk)))
    return files


def parse_counts(records):
    counts = {'numeric': 0, 'below_default': 0, 'unknown': 0, 'unparseable': 0}
    for record in records:
        for status in record['parse'].values():
            counts[status] += 1
    return counts


# ---------------------------------------------------------------- prior data and guards

def read_json(path):
    return json.loads(Path(path).read_bytes())


def prior_state_info(directory, region):
    """What the committed files say now, read from disk and not from the manifest."""
    first = Path(directory) / part_name(region, 1)
    if not first.is_file():
        return None
    head = read_json(first)
    parts = head.get('parts', 1) if head.get('version') == SCHEMA_VERSION else 1
    records = 0
    for number in range(1, parts + 1):
        path = Path(directory) / part_name(region, number)
        records += len(read_json(path)['records']) if path.is_file() else 0
    return {'schema': head.get('schema') if head.get('version') == SCHEMA_VERSION else 'pilot-1', 'records': records,
            'parts': parts, 'source_sha256': head.get('source', {}).get('sha256')}


def guard(prior, new_records, new_bytes, allow_schema_change=False):
    """Return a failure reason when the prior file must be kept, otherwise None."""
    if new_records == 0:
        return 'no_records'
    if new_bytes > MAX_STATE_BYTES:
        return 'state_too_large'
    if prior:
        if prior['schema'] != SCHEMA and not allow_schema_change:
            return 'schema_locked'
        if prior['records'] >= MIN_PRIOR_FOR_SHRINK and new_records < SHRINK_RATIO * prior['records']:
            return 'shrunk_sharply'
    return None


# ---------------------------------------------------------------- build one state

def plan(region, directory, scratch):
    return {'state': region, 'url': region_url(region), 'user_agent': USER_AGENT, 'output': [str(Path(directory) / part_name(region, 1)) + ' (+ numbered parts)'],
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


def build_state(region, *, directory, stage, scratch, pause=0, allow_schema_change=False, pbf=None, receipt=None,
                downloader=download, worker=run_worker, sleep=time.sleep, now=utc_now):
    """Build one state into stage. Never touches the committed files. Always returns a status dict."""
    stage, scratch = Path(stage), Path(scratch)
    (stage / 'status').mkdir(parents=True, exist_ok=True)
    scratch.mkdir(parents=True, exist_ok=True)
    status = {'state': region, 'attempted_at': now()}
    prior = prior_state_info(directory, region)
    pbf_path = Path(pbf) if pbf else scratch / f'{region}.osm.pbf'
    try:
        if not pbf:
            if pause:
                sleep(pause)
            receipt = downloader(region, pbf_path)
        receipt = receipt if isinstance(receipt, dict) else read_json(receipt)
        status['source_sha256'] = receipt['sha256']
        if prior and prior['schema'] == SCHEMA and prior['source_sha256'] == receipt['sha256']:
            status['status'] = 'unchanged'
            return status
        result = worker(pbf_path, receipt, scratch, region)
        records = result['records']
        files = shard(region, result['source'], records) if records else []
        total = sum(len(data) for _, data, _ in files)
        reason = guard(prior, len(records), total, allow_schema_change)
        status.update(records=len(records), bytes=total, parse_counts=parse_counts(records),
                      quarantined=result['report']['quarantined'], quarantine_reasons=result['report']['quarantine_reasons'],
                      skipped=result['report']['skipped'], extract_timestamp=result['source']['extract_timestamp'],
                      retrieved_at=result['source']['retrieved_at'])
        if reason:
            status.update(status='kept_prior' if prior else 'failed', failure={'reason': reason, 'at': now(), 'prior_records': prior['records'] if prior else 0})
            return status
        for name, data, _ in files:
            (stage / name).write_bytes(data)
        status['status'] = 'ok'
        status['files'] = [{'path': name, 'bytes': len(data), 'records': count} for name, data, count in files]
        (stage / 'status' / f'{region}.audit.json').write_text(json.dumps(
            {'state': region, 'report': result['report'], 'source': result['source']}, indent=2) + '\n')
        return status
    except Exception as exc:  # fetch, parse and budget failures all keep the prior file
        status.update(status='kept_prior' if prior else 'failed', failure={'reason': 'build_failed', 'detail': bounded_text(exc, 300), 'at': now(), 'prior_records': prior['records'] if prior else 0})
        return status
    finally:
        if not pbf:
            pbf_path.unlink(missing_ok=True)
        (stage / 'status' / f'{region}.json').write_text(json.dumps(status, indent=2) + '\n')


# ---------------------------------------------------------------- manifest

def sha256_of(paths):
    digest = hashlib.sha256()
    for path in paths:
        digest.update(Path(path).read_bytes())
    return digest.hexdigest()


def entry_from_disk(directory, region):
    first = Path(directory) / part_name(region, 1)
    if not first.is_file():
        return {'status': 'not_built', 'records': 0, 'parts': 0, 'files': [], 'bytes': 0, 'sha256': None}
    head = read_json(first)
    v2 = head.get('version') == SCHEMA_VERSION
    parts = head['parts'] if v2 else 1
    paths = [Path(directory) / part_name(region, n) for n in range(1, parts + 1)]
    missing = [p.name for p in paths if not p.is_file()]
    if missing:
        raise ValueError(f'{region} is missing parts: {missing}')
    docs = [head] + [read_json(p) for p in paths[1:]]
    records = [r for d in docs for r in d['records']]
    source = head['source']
    entry = {'status': 'present', 'schema': head['schema'] if v2 else 'pilot-1', 'records': len(records), 'parts': parts,
             'files': [{'path': p.name, 'bytes': p.stat().st_size, 'sha256': sha256_of([p]), 'records': len(d['records'])} for p, d in zip(paths, docs)],
             'bytes': sum(p.stat().st_size for p in paths), 'sha256': sha256_of(paths),
             'retrieved_at': source['retrieved_at'], 'extract_timestamp': source['extract_timestamp'], 'source_sha256': source['sha256']}
    if v2:
        entry['parse_counts'] = parse_counts(records)
    return entry


def build_index(directory, statuses=(), previous=None):
    """Derive the manifest from files on disk, then overlay this run's statuses. Deterministic."""
    previous = previous or {}
    by_state = {s['state']: s for s in statuses}
    states = {}
    for region in ALL_REGIONS:
        entry = entry_from_disk(directory, region)
        status = by_state.get(region)
        old = (previous.get('states') or {}).get(region, {})
        if status and status['status'] in ('kept_prior', 'failed') and 'failure' in status:
            entry['failure'] = status['failure']
            entry['status'] = 'kept_prior' if entry['status'] == 'present' else 'failed'
        elif status is None and old.get('failure'):
            entry['failure'] = old['failure']
            entry['status'] = 'kept_prior' if entry['status'] == 'present' else 'failed'
        counted = status if status and status.get('status') == 'ok' else old
        if counted.get('quarantined') is not None:
            entry.update(quarantined=counted['quarantined'], quarantine_reasons=counted['quarantine_reasons'])
        states[region] = entry
    built = [e for e in states.values() if e['files']]
    stamps = [e['retrieved_at'] for e in built if e.get('retrieved_at')]
    return {'version': 1, 'schema': SCHEMA, 'generated_at': max(stamps) if stamps else None, **LICENSE,
            'limits': {'max_file_bytes': MAX_FILE_BYTES, 'max_file_records': MAX_FILE_RECORDS, 'max_file_vertices': MAX_FILE_VERTICES,
                       'shrink_ratio': SHRINK_RATIO},
            'notice': 'Source-reported OSM tags. Coverage is uneven and incomplete. Not a route, passage or safety statement.',
            'totals': {'states_with_data': len(built), 'records': sum(e['records'] for e in built), 'bytes': sum(e['bytes'] for e in built),
                       'states_not_built': sorted(r for r, e in states.items() if not e['files']),
                       'states_with_failures': sorted(r for r, e in states.items() if e.get('failure'))},
            'states': states}


def write_index(directory, index):
    path = Path(directory) / 'index.json'
    temporary = path.with_suffix('.json.tmp')
    temporary.write_bytes((json.dumps(index, indent=1, ensure_ascii=False) + '\n').encode())
    temporary.replace(path)


def verify_index(directory):
    """Recompute every file and state hash. Returns a list of problems, empty when consistent."""
    directory = Path(directory)
    index = read_json(directory / 'index.json')
    problems = []
    for region, entry in index['states'].items():
        paths = []
        for item in entry['files']:
            path = directory / item['path']
            paths.append(path)
            if not path.is_file():
                problems.append(f'{region}: missing {item["path"]}')
            elif sha256_of([path]) != item['sha256'] or path.stat().st_size != item['bytes']:
                problems.append(f'{region}: {item["path"]} differs from the manifest')
        if paths and all(p.is_file() for p in paths) and sha256_of(paths) != entry['sha256']:
            problems.append(f'{region}: state hash differs')
        if sum(i['records'] for i in entry['files']) != entry['records']:
            problems.append(f'{region}: record count differs')
        extra = sorted(p.name for p in directory.glob(f'{region}*.json') if re.fullmatch(rf'{region}(-[0-9]+)?\.json', p.name)
                       and p.name not in {i['path'] for i in entry['files']})
        if extra:
            problems.append(f'{region}: unlisted files {extra}')
    return problems


def publish(stage, directory, expected=(), now=utc_now):
    """Move ok states into place, then rewrite the manifest. Refuses a mostly failed run.

    A state in expected with no status file means its job crashed. It is recorded as failed.
    """
    stage, directory = Path(stage), Path(directory)
    statuses = [read_json(p) for p in sorted((stage / 'status').glob('*.json')) if not p.name.endswith('.audit.json')] if (stage / 'status').is_dir() else []
    seen = {s['state'] for s in statuses}
    statuses += [{'state': r, 'status': 'failed', 'failure': {'reason': 'no_status_from_job', 'at': now()}} for r in expected if r not in seen]
    failed = [s for s in statuses if s['status'] in ('failed', 'kept_prior')]
    if statuses and len(failed) > MAX_FAILED_FRACTION * len(statuses):
        raise SystemExit(f'{len(failed)} of {len(statuses)} states failed. Nothing published.')
    previous = read_json(directory / 'index.json') if (directory / 'index.json').is_file() else {}
    for status in statuses:
        if status['status'] != 'ok':
            continue
        region = status['state']
        for item in status['files']:
            if not (stage / item['path']).is_file() or (stage / item['path']).stat().st_size != item['bytes']:
                raise SystemExit(f'{region}: staged file {item["path"]} is missing or altered')
    for status in statuses:
        if status['status'] != 'ok':
            continue
        region = status['state']
        keep = {i['path'] for i in status['files']}
        for item in status['files']:
            target = directory / item['path']
            temporary = target.with_suffix('.json.tmp')
            temporary.write_bytes((stage / item['path']).read_bytes())
            temporary.replace(target)
        for old in directory.glob(f'{region}-*.json'):
            if re.fullmatch(rf'{region}-[0-9]+\.json', old.name) and old.name not in keep:
                old.unlink()
    total = sum(p.stat().st_size for p in directory.glob('*.json') if p.name != 'index.json')
    if total > MAX_TOTAL_BYTES:
        raise SystemExit(f'Clearance data is {total} bytes, over the {MAX_TOTAL_BYTES} byte repository budget. Review before committing.')
    index = build_index(directory, statuses, previous)
    write_index(directory, index)
    problems = verify_index(directory)
    if problems:
        raise SystemExit('Manifest check failed: ' + '; '.join(problems))
    return index, [s for s in statuses if s['status'] == 'ok'], failed


# ---------------------------------------------------------------- command line

def worker_main(directory):
    directory = Path(directory)
    request = json.loads((directory / 'request.json').read_bytes())
    result = extract_region(request['pbf'], request['receipt'], directory, request['region'])
    (directory / 'result.json').write_text(json.dumps(result, separators=(',', ':')))


def regions_from(values):
    if not values or values == ['ALL']:
        return list(ALL_REGIONS)
    bad = [v for v in values if v not in ALL_REGIONS]
    if bad:
        raise SystemExit(f'Unknown state codes: {bad}')
    return values


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ['--worker']:
        return worker_main(argv[1])
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='command', required=True)
    b = sub.add_parser('build')
    b.add_argument('--state', action='append', help='State code, repeatable. Default ALL (50 states and DC).')
    b.add_argument('--dir', type=Path, default=DEFAULT_DIR)
    b.add_argument('--stage', type=Path)
    b.add_argument('--scratch', type=Path)
    b.add_argument('--pause', type=float, default=10, help='Seconds to wait before each download.')
    b.add_argument('--pbf', type=Path, help='Use an existing PBF instead of downloading. Needs --receipt and one --state.')
    b.add_argument('--receipt', type=Path)
    b.add_argument('--allow-schema-change', action='store_true')
    b.add_argument('--dry-run', action='store_true', help='Print the plan. No network, no writes.')
    for name in ('publish', 'manifest', 'verify'):
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
            status = build_state(region, directory=args.dir, stage=args.stage, scratch=args.scratch, pause=args.pause,
                                 allow_schema_change=args.allow_schema_change, pbf=args.pbf, receipt=args.receipt)
            print(json.dumps({k: status.get(k) for k in ('state', 'status', 'records', 'bytes', 'failure') if status.get(k) is not None}))
    elif args.command == 'publish':
        index, updated, failed = publish(args.stage, args.dir, regions_from(args.expect) if args.expect else ())
        print(json.dumps({'updated_states': [s['state'] for s in updated], 'failed': [f['state'] for f in failed], 'totals': index['totals']}, indent=2))
    elif args.command == 'manifest':
        write_index(args.dir, build_index(args.dir, (), read_json(args.dir / 'index.json') if (args.dir / 'index.json').is_file() else {}))
        problems = verify_index(args.dir)
        if problems:
            raise SystemExit('; '.join(problems))
    else:
        problems = verify_index(args.dir)
        print('\n'.join(problems) or 'Manifest hashes match.')
        sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
