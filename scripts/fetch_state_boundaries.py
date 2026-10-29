#!/usr/bin/env python3
"""Fetch detailed Census BAS 2026 state polygons; publish only a complete verified set.

Reference inputs are pipeline-only. Geometry is neither simplified nor rounded.
"""
import concurrent.futures
import datetime as dt
import gzip
import hashlib
import http.client
import json
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'data/reference/us-state-boundaries'
SERVICE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer'
LAYER = SERVICE + '/18'
SOURCE_URL = LAYER + '/query'
VINTAGE = '2026-01-01'
STATES = frozenset('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split())
MAX_RAW_BYTES = 32 * 1024 * 1024
MAX_COMPRESSED_BYTES = 8 * 1024 * 1024
MAX_TOTAL_COMPRESSED_BYTES = 64 * 1024 * 1024
MAX_COORDINATES = 750000
LICENSE_URL = 'https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2020/TGRSHP2020_TechDoc.pdf'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def download(url):
    if url.split('?')[0] not in {SERVICE, LAYER, SOURCE_URL}:
        raise ValueError('Boundary URL is not allowlisted')
    request = urllib.request.Request(url, headers={'User-Agent': 'KampTrail/1.0 (state-boundary reference build)', 'Accept': 'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=45) as response:
                if response.status != 200:
                    raise ValueError('Boundary provider unavailable')
                raw = response.read(MAX_RAW_BYTES + 1)
            break
        except urllib.error.HTTPError as error:
            if error.code not in {429, 502, 503, 504} or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead):
            if attempt == 2:
                raise
        time.sleep(attempt + 1)
    if len(raw) > MAX_RAW_BYTES:
        raise ValueError('Boundary response exceeds byte cap')
    data = json.loads(raw)
    if not isinstance(data, dict) or 'error' in data:
        raise ValueError('Boundary provider returned an invalid response')
    return raw, data


def query(parameters):
    return SOURCE_URL + '?' + urllib.parse.urlencode(parameters)


def validate_collection(data, state):
    # Reuse exactly the geometry validation used by the offline builder.
    from build_agency_states import PreparedState
    if data.get('type') != 'FeatureCollection' or len(data.get('features', [])) != 1:
        raise ValueError('Expected exactly one state feature')
    if data.get('exceededTransferLimit') or data.get('properties', {}).get('exceededTransferLimit'):
        raise ValueError('Truncated state geometry')
    feature = data['features'][0]
    if feature.get('properties', {}).get('STUSAB') != state:
        raise ValueError('State geometry identity mismatch')
    prepared = PreparedState(feature['geometry'])
    return prepared.coordinate_count, prepared.bounds


def fetch(destination=DEST, reader=download):
    destination = Path(destination)
    _, service = reader(SERVICE + '?f=json')
    layers = {item['id']: item for item in service.get('layers', [])}
    if layers.get(18, {}).get('name') != 'States' or layers.get(18, {}).get('parentLayerId') != 17 or layers.get(17, {}).get('name') != 'BAS 2026':
        raise ValueError('Census layer identity/vintage changed')
    _, metadata = reader(LAYER + '?f=json')
    if metadata.get('geometryType') != 'esriGeometryPolygon' or 'January 1, 2026' not in metadata.get('description', '') or 'geoJSON' not in metadata.get('supportedQueryFormats', ''):
        raise ValueError('Unexpected Census state layer metadata')
    where = 'STUSAB IN (' + ','.join("'" + s + "'" for s in sorted(STATES)) + ')'
    _, count = reader(query({'where': where, 'returnCountOnly': 'true', 'f': 'json'}))
    _, identities = reader(query({'where': where, 'returnGeometry': 'false', 'outFields': 'STUSAB,STATE,NAME', 'f': 'json'}))
    rows = identities.get('features', [])
    codes = [row.get('attributes', {}).get('STUSAB') for row in rows]
    if count.get('count') != 50 or len(codes) != 50 or set(codes) != STATES or identities.get('exceededTransferLimit'):
        raise ValueError('Incomplete Census state inventory')
    names = {row['attributes']['STUSAB']: row['attributes']['NAME'] for row in rows}
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='state-boundaries-stage-', dir=destination.parent) as temp:
        stage = Path(temp) / 'reference'
        stage.mkdir()
        notice = destination / 'README.md'
        if notice.is_file():
            # Keep the checked-in source/repackaging notice when replacing data.
            (stage / 'README.md').write_bytes(notice.read_bytes())
        entries = {}
        def one(state):
            url = query({'where': "STUSAB='" + state + "'", 'outFields': 'STUSAB,STATE,NAME', 'outSR': '4326', 'returnGeometry': 'true', 'f': 'geojson'})
            raw, data = reader(url)
            if len(raw) > MAX_RAW_BYTES:
                raise ValueError('Boundary response exceeds byte cap')
            coordinates, bounds = validate_collection(data, state)
            compressed = gzip.compress(raw, compresslevel=9, mtime=0)
            if len(compressed) > MAX_COMPRESSED_BYTES:
                raise ValueError('Compressed boundary exceeds cap')
            filename = state + '.geojson.gz'
            (stage / filename).write_bytes(compressed)
            return state, {'file': filename, 'name': names[state], 'source_url': url, 'sha256': hashlib.sha256(compressed).hexdigest(), 'raw_sha256': hashlib.sha256(raw).hexdigest(), 'compressed_bytes': len(compressed), 'raw_bytes': len(raw), 'coordinate_count': coordinates, 'bounds': bounds}
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = {pool.submit(one, state): state for state in sorted(STATES)}
            for future in concurrent.futures.as_completed(futures):
                state, entry = future.result()
                entries[state] = entry
                print(f'{state}: {entry["coordinate_count"]} coordinates, {entry["compressed_bytes"]} compressed bytes', flush=True)
        if set(entries) != STATES or sum(e['compressed_bytes'] for e in entries.values()) > MAX_TOTAL_COMPRESSED_BYTES:
            raise ValueError('Incomplete or oversized boundary reference')
        manifest = {'version': 1, 'complete': True, 'source': 'U.S. Census Bureau TIGERweb BAS 2026 detailed States', 'source_url': SOURCE_URL, 'vintage': VINTAGE, 'retrieved_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'geometry_policy': 'Finest-scale BAS 2026 layer; WGS84; no simplification or coordinate rounding requested.', 'license': 'U.S. Government work; public domain under 17 USC 105. Credit U.S. Census Bureau.', 'license_url': LICENSE_URL, 'limitations': 'Statistical boundaries, not legal land descriptions. Source positional accuracy is not guaranteed.', 'expected_states': sorted(STATES), 'states': dict(sorted(entries.items()))}
        (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        from build_agency_states import StateBoundaries
        StateBoundaries(stage)  # Hash/completeness check before replacing any existing reference.
        backup = Path(temp) / 'previous'
        if destination.exists():
            destination.rename(backup)
        try:
            stage.rename(destination)
        except BaseException:
            if backup.exists():
                backup.rename(destination)
            raise
    return manifest


if __name__ == '__main__':
    result = fetch()
    print(f'Published {len(result["states"])} verified state boundaries')
