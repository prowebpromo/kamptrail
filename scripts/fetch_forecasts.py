#!/usr/bin/env python3
"""Produce bounded, dated NDFD temperature evidence; never fetch individual campsites.

Run in environment/forecast-linux-64.lock. Only three allowlisted NOAA objects are
fetched. Outputs are dynamic release assets, not catalogue data or Git content.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import math
import os
import re
import resource
import shutil
import tempfile
import threading
import time
import urllib.error
import urllib.request

from fetch_elevation import coordinate_key, read_catalogue, STATES

UTC = timezone.utc
REGIONS = ('conus', 'alaska', 'hawaii')
URLS = {r: f'https://noaa-ndfd-pds.s3.amazonaws.com/opnl/AR.{r}/VP.001-003/ds.temp.bin' for r in REGIONS}
MAX_SOURCE_BYTES = 150 * 1024 * 1024
MAX_CACHE_BYTES = 300 * 1024 * 1024
MAX_FILE_BYTES = 75 * 1024 * 1024
MAX_RAW_BYTES = 8 * 1024 * 1024
MAX_GZIP_BYTES = 2 * 1024 * 1024
MAX_GRID_CELLS = 4_000_000
MAX_DISTANCE_M = 5000
AGE = timedelta(hours=3)
SKEW = timedelta(minutes=5)


class ForecastError(ValueError):
    pass


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def stamp(value):
    if value.tzinfo is None:
        # GRIB datetime fields are UTC, without a Python tzinfo.
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat(timespec='seconds').replace('+00:00', 'Z')


def utc(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', value):
        raise ForecastError('Expected an actual UTC timestamp')
    try:
        return datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=UTC)
    except ValueError as exc:
        raise ForecastError('Invalid UTC date') from exc


def atomic_bytes(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as out:
            temporary = out.name
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def catalogue(path):
    rows = read_catalogue(path)
    if len(rows) > 100000:
        raise ForecastError('Catalogue exceeds 100,000 records')
    # UTF-8 byte order, shared with Buffer.compare in the search builder.
    rows.sort(key=lambda row: row['id'].encode('utf-8'))
    counts = {s: 0 for s in STATES}
    for row in rows:
        for state in row['states']:
            counts[state] += 1
    if max(counts.values()) > 20000:
        raise ForecastError('State exceeds 20,000 records')
    identity = [[r['id'], r['coordinate_key'], r['states']] for r in rows]
    return rows, digest(encoded(identity))


def expiry(files, now):
    if len(files) != 3 or {f['region'] for f in files} != set(REGIONS):
        raise ForecastError('All three regional source files are required')
    dates = [utc(f['last_modified']) for f in files]
    if any(date > now + SKEW for date in dates):
        raise ForecastError('Source modification time is in the future')
    expires = min(now + AGE, min(dates) + AGE)
    if expires <= now:
        raise ForecastError('NOAA source files have expired; publication refused')
    return expires


def file_hash(path):
    sha = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(chunk)
    return sha.hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ForecastError('Unexpected NOAA redirect')


class Budget:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.downloaded = 0
        self.lock = threading.Lock()

    def add(self, count):
        with self.lock:
            self.downloaded += count
            disk = sum(p.stat().st_size for p in self.directory.iterdir() if p.is_file())
            if self.downloaded > MAX_SOURCE_BYTES or disk + count > MAX_CACHE_BYTES:
                raise ForecastError('Source download/cache byte budget exceeded')


def cached_source(directory, region):
    directory = Path(directory)
    path, meta_path = directory / f'{region}.bin', directory / f'{region}.json'
    if not path.exists() or not meta_path.exists():
        return None
    try:
        if meta_path.stat().st_size > 8192 or path.stat().st_size > MAX_FILE_BYTES:
            raise ForecastError('Oversized source cache')
        meta = json.loads(meta_path.read_text())
        if (meta['region'] != region or meta['url'] != URLS[region]
                or type(meta['bytes']) is not int or meta['bytes'] != path.stat().st_size
                or not isinstance(meta['etag'], str) or not 1 <= len(meta['etag']) <= 200
                or file_hash(path) != meta['sha256']):
            raise ForecastError('Source cache identity/checksum differs')
        utc(meta['last_modified'])
        return meta
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ForecastError('Invalid source cache metadata') from exc


def fetch_source(directory, region, budget, offline=False, opener=None):
    if region not in URLS:
        raise ForecastError('Unsupported source region')
    directory = Path(directory)
    old = cached_source(directory, region)
    if offline:
        if old is None:
            raise ForecastError('Offline source cache is incomplete')
        return old
    headers = {'User-Agent': 'KampTrail-NDFD/1.0', 'Accept-Encoding': 'identity'}
    if old:
        headers['If-None-Match'] = old['etag']
        headers['If-Modified-Since'] = utc(old['last_modified']).strftime('%a, %d %b %Y %H:%M:%S GMT')
    opener = opener or urllib.request.build_opener(NoRedirect()).open
    try:
        response = opener(urllib.request.Request(URLS[region], headers=headers), timeout=45)
    except urllib.error.HTTPError as exc:
        if exc.code == 304 and old:
            # Do not update mtime or meteorological age on a conditional hit.
            return old
        raise ForecastError(f'NOAA download failed: HTTP {exc.code}') from exc
    temporary = None
    try:
        with response:
            if response.status != 200 or response.geturl() != URLS[region]:
                raise ForecastError('Unexpected NOAA response')
            modified = parsedate_to_datetime(response.headers['Last-Modified'])
            if modified.tzinfo is None:
                raise ForecastError('Source modification header lacks timezone')
            etag = response.headers.get('ETag', '')
            length = int(response.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_FILE_BYTES or not 1 <= len(etag) <= 200:
                raise ForecastError('Missing or oversized NOAA object metadata')
            sha, total = hashlib.sha256(), 0
            with tempfile.NamedTemporaryFile(dir=directory, prefix=f'.{region}-', delete=False) as out:
                temporary = out.name
                while chunk := response.read(1024 * 1024):
                    budget.add(len(chunk))
                    total += len(chunk)
                    if total > length:
                        raise ForecastError('NOAA body exceeds declared length')
                    sha.update(chunk)
                    out.write(chunk)
                if total != length:
                    raise ForecastError('Truncated NOAA object')
                out.flush()
                os.fsync(out.fileno())
        meta = {'region': region, 'url': URLS[region], 'etag': etag,
                'last_modified': stamp(modified), 'bytes': total, 'sha256': sha.hexdigest()}
        # Atomic file then metadata; interruption leaves a detectable hash mismatch,
        # never a falsely fresh cache. The existing public snapshot is unaffected.
        os.utime(temporary, (modified.timestamp(), modified.timestamp()))
        os.replace(temporary, directory / f'{region}.bin')
        atomic_bytes(directory / f'{region}.json', encoded(meta))
        return meta
    except (KeyError, TypeError, OverflowError) as exc:
        raise ForecastError('Invalid NOAA source headers') from exc
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def sources(directory, offline=False):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    budget = Budget(directory)
    # Two concurrent source downloads, only three fixed files; no campsite calls.
    with ThreadPoolExecutor(max_workers=2) as pool:
        files = list(pool.map(lambda r: fetch_source(directory, r, budget, offline), REGIONS))
    return files, budget.downloaded


def xyz(lat, lng):
    import numpy as np
    lat, lng = np.radians(lat), np.radians(lng)
    return np.column_stack((np.cos(lat) * np.cos(lng), np.cos(lat) * np.sin(lng), np.sin(lat)))


def nearest_grid(latitudes, longitudes, projection, queries):
    """Nearest actual spherical point, with an independent projected domain gate.

    Scan-normalized lat/lon and data must share ordering. The KD tree includes
    missing-value cells: values never influence which grid cell is selected.
    """
    import numpy as np
    from pyproj import Proj
    from scipy.spatial import cKDTree
    latitudes, longitudes = np.asarray(latitudes), np.asarray(longitudes)
    if (latitudes.shape != longitudes.shape or latitudes.ndim != 2
            or min(latitudes.shape) < 2 or latitudes.size > MAX_GRID_CELLS
            or not np.isfinite(latitudes).all() or not np.isfinite(longitudes).all()):
        raise ForecastError('Invalid or oversized decoded grid')
    ny, nx = latitudes.shape
    project = Proj(projection)
    # The pinned decoder normalizes boustrophedonic scan 80. Test rectangularity
    # using corners and middle points; reject a decoder/projection mismatch.
    rr = np.array([0, 0, ny-1, ny-1, ny//2, 0, 1])
    cc = np.array([0, nx-1, 0, nx-1, nx//2, 1, 0])
    gx, gy = project(longitudes[rr, cc], latitudes[rr, cc])
    dx, dy = (gx[1]-gx[0])/(nx-1), (gy[2]-gy[0])/(ny-1)
    if (not math.isfinite(dx + dy) or min(abs(dx), abs(dy)) < 1
            or not np.allclose(gx, gx[0] + cc*dx, atol=2, rtol=0)
            or not np.allclose(gy, gy[0] + rr*dy, atol=2, rtol=0)):
        raise ForecastError('Projection and normalized array orientation disagree')
    q = np.asarray(queries, dtype=float)
    if q.size == 0:
        return []
    qx, qy = project(q[:, 1], q[:, 0])
    columns, rows = (qx-gx[0])/dx, (qy-gy[0])/dy
    inside = (np.isfinite(columns) & np.isfinite(rows) & (columns >= 0)
              & (columns <= nx-1) & (rows >= 0) & (rows <= ny-1))
    accepted = np.flatnonzero(inside)
    result = [None] * len(queries)
    if not len(accepted):
        return result
    tree = cKDTree(xyz(latitudes.ravel(), longitudes.ravel()), copy_data=False)
    chord, indices = tree.query(xyz(q[accepted, 0], q[accepted, 1]), workers=1,
                               distance_upper_bound=2 * math.sin(MAX_DISTANCE_M / (2*6371200)))
    distances = 2 * 6371200 * np.arcsin(np.minimum(chord / 2, 1))
    for i, index, distance in zip(accepted, indices, distances):
        if index >= latitudes.size or distance > MAX_DISTANCE_M:
            continue
        row, col = divmod(int(index), nx)
        result[i] = {'index': int(index), 'grid_lat': round(float(latitudes[row, col]), 7),
                     'grid_lng': round((float(longitudes[row, col])+180) % 360-180, 7),
                     'grid_distance_m': round(float(distance), 1)}
    return result


def temperature(value):
    if value is None or not math.isfinite(float(value)):
        return None
    value = float(value) - 273.15
    if not -100 <= value <= 70:
        return None
    result = round(value, 3)
    return 0 if result == 0 else result


def inventory(times):
    if not 2 <= len(times) <= 100 or times != sorted(set(times)):
        raise ForecastError('Invalid or duplicate temperature inventory')
    dates = [utc(t) for t in times]
    step = max(int((b-a).total_seconds()) for a, b in zip(dates, dates[1:]))
    if not 0 < step <= 10800:
        raise ForecastError('Temperature inventory has a gap larger than three hours')
    return step


def complete_window(times, values, now, hours, max_step=10800):
    """Audit published samples; this never computes continuous daily extrema."""
    if hours not in (24, 48) or len(times) != len(values):
        return False
    dates = [utc(t) for t in times]
    end = now + timedelta(hours=hours)
    selected = [i for i, date in enumerate(dates) if now <= date <= end]
    if not selected or dates[-1] < end or dates[selected[0]] - now > timedelta(seconds=max_step):
        return False
    if any((b-a).total_seconds() > max_step for a, b in zip(dates, dates[1:])):
        return False
    return all(values[i] is not None and math.isfinite(values[i]) for i in selected)


def decode_region(path, keys):
    import grib2io
    import numpy as np
    if grib2io.__version__ != '2.8.2':
        raise ForecastError('Use the pinned grib2io 2.8.2 environment')
    queries = [list(map(float, key.split(','))) for key in keys]
    times, values, references = [], [], set()
    grid_hash, mappings = None, None
    with grib2io.open(str(path)) as stream:
        for message in stream:
            try:
                if (message.shortName != 'TMP' or message.units != 'K'
                        or int(message.productDefinitionTemplateNumber.value) != 0
                        or int(message.typeOfFirstFixedSurface.value) != 103
                        or message.valueOfFirstFixedSurface != 2):
                    raise ForecastError('Expected instantaneous 2-metre Kelvin temperature')
                if len(times) >= 100:
                    raise ForecastError('Too many temperature messages')
                this_grid = digest(encoded([int(n) for n in message.section3]))
                if grid_hash is None:
                    if message.nx * message.ny > MAX_GRID_CELLS:
                        raise ForecastError('GRIB grid exceeds memory bound')
                    lats, lons = message.grid()
                    mappings = nearest_grid(lats, lons, message.projParameters, queries)
                    grid_hash = this_grid
                elif this_grid != grid_hash:
                    raise ForecastError('Grid changes within one regional source')
                valid = stamp(message.validDate)
                reference = stamp(message.refDate)
                if utc(valid) < utc(reference) or utc(valid) - utc(reference) > timedelta(days=4):
                    raise ForecastError('Invalid temperature forecast lead')
                times.append(valid)
                references.add(reference)
                field = np.ma.asarray(message.data).filled(np.nan).ravel()
                values.append([temperature(field[m['index']]) if m else None for m in mappings])
            finally:
                message.flush_data()
    # Never reorder timestamps independently from sampled values.
    order = sorted(range(len(times)), key=times.__getitem__)
    times = [times[i] for i in order]
    values = [values[i] for i in order]
    step = inventory(times)
    metadata = {'times': times, 'grid_sha256': grid_hash, 'max_step_seconds': step,
                'reference_times': sorted(references)}
    sampled = {}
    for index, key in enumerate(keys):
        mapping = mappings[index]
        if mapping:
            sampled[key] = {**{k: v for k, v in mapping.items() if k != 'index'},
                            'temperatures_c': [field[index] for field in values]}
    return metadata, sampled


def package(rows, catalogue_hash, files, regions, records, output, now):
    expires = stamp(expiry(files, now))
    generated = stamp(now)
    # Include actual evidence in the immutable generation identity.
    hasher = hashlib.sha256(encoded([catalogue_hash, generated, expires, files, regions]))
    for row in rows:
        hasher.update(encoded([row['id'], records[row['id']]]))
    snapshot = hasher.hexdigest()[:24]
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.forecast-stage-', dir=output.parent))
    try:
        states, sizes = {}, []
        for state in sorted(STATES):
            local = {row['id']: records[row['id']] for row in rows if state in row['states']}
            raw = encoded({'version': 1, 'snapshot_id': snapshot, 'state': state,
                           'generated_at': generated, 'expires_at': expires, 'records': local})
            if len(raw) > MAX_RAW_BYTES:
                raise ForecastError(f'{state} exceeds raw state byte limit')
            compressed = gzip.compress(raw, compresslevel=9, mtime=0)
            if len(compressed) > MAX_GZIP_BYTES:
                raise ForecastError(f'{state} exceeds compressed state byte limit')
            name = f'forecast-v1-{snapshot}-{state}.json.gz'
            (staging / name).write_bytes(compressed)
            states[state] = {'asset': name, 'sha256': digest(compressed), 'json_sha256': digest(raw),
                             'bytes': len(compressed), 'json_bytes': len(raw), 'count': len(local)}
            sizes.append(len(compressed))
        known = sum(record['status'] == 'known' for record in records.values())
        manifest = {'version': 1, 'snapshot_id': snapshot, 'catalogue_sha256': catalogue_hash,
                    'generated_at': generated, 'expires_at': expires,
                    'source': {'name': 'NOAA/NWS NDFD', 'files': files}, 'regions': regions,
                    'states': states, 'coverage': {'total': len(rows), 'grid_known': known, 'unknown': len(rows)-known}}
        manifest_bytes = encoded(manifest)
        if len(manifest_bytes) > 256 * 1024:
            raise ForecastError('Manifest exceeds byte limit')
        for asset in staging.iterdir():
            destination = output / asset.name
            if destination.exists() and destination.read_bytes() != asset.read_bytes():
                raise ForecastError('Immutable generation collision')
            os.replace(asset, destination)
        # Only the final atomic manifest makes a complete generation discoverable.
        atomic_bytes(output / 'manifest.json', manifest_bytes)
        return manifest
    finally:
        shutil.rmtree(staging)


def produce(catalogue_path, cache, output, now=None, offline=False):
    started = time.monotonic()
    now = now or datetime.now(UTC)
    rows, catalogue_hash = catalogue(catalogue_path)
    files, downloaded = sources(cache, offline)
    expiry(files, now)
    keys = sorted({row['coordinate_key'] for row in rows})
    regions, best = {}, {}
    for region in REGIONS:
        metadata, samples = decode_region(Path(cache) / f'{region}.bin', keys)
        regions[region] = metadata
        for key, sample in samples.items():
            if key not in best or sample['grid_distance_m'] < best[key]['grid_distance_m']:
                best[key] = {'coordinate_key': key, 'region': region, 'status': 'known', **sample}
    records = {row['id']: best.get(row['coordinate_key'], {'coordinate_key': row['coordinate_key'],
               'status': 'unknown', 'reason': 'outside_forecast_grid'}) for row in rows}
    manifest = package(rows, catalogue_hash, files, regions, records, output, now)
    complete = {}
    for hours in (24, 48):
        complete[str(hours)] = sum(record['status'] == 'known' and complete_window(
            regions[record['region']]['times'], record['temperatures_c'], now, hours,
            regions[record['region']]['max_step_seconds']) for record in records.values())
    return {'snapshot_id': manifest['snapshot_id'], 'catalogue_sha256': catalogue_hash,
            **manifest['coverage'], 'complete_samples': complete, 'source_download_bytes': downloaded,
            'state_gzip_bytes': sum(s['bytes'] for s in manifest['states'].values()),
            'largest_state_gzip_bytes': max(s['bytes'] for s in manifest['states'].values()),
            'largest_state_json_bytes': max(s['json_bytes'] for s in manifest['states'].values()),
            'elapsed_seconds': round(time.monotonic()-started, 3),
            'peak_rss_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalogue', type=Path, default=Path('data/campsites/search-index.json'))
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--offline', action='store_true', help='Use only verified saved NOAA files')
    parser.add_argument('--now', type=utc, help='Dated offline benchmark clock; never makes old evidence current')
    args = parser.parse_args()
    if args.now and not args.offline:
        parser.error('--now is only allowed with --offline')
    print(json.dumps(produce(args.catalogue, args.cache, args.output, args.now, args.offline), sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (ForecastError, OSError, ValueError) as exc:
        raise SystemExit(f'Forecast production failed: {exc}')
