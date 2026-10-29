#!/usr/bin/env python3
"""Assign agency points with verified Census polygons, never nearest-place guessing.

All source files and reference hashes are validated before publishing. Unassignable
points are retained in a quarantine report, rather than being silently moved/dropped.
"""
import copy
import datetime as dt
import gzip
import hashlib
import json
import math
import tempfile
from array import array
from collections import OrderedDict, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [ROOT / 'data/sources/usfs.json', ROOT / 'data/sources/blm.json']
OUT = ROOT / 'data/campsites/agency'
REFERENCE = ROOT / 'data/reference/us-state-boundaries'
STATES = frozenset('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split())
BORDER_METERS = 10.0
MAX_COORDINATES = 750000
MAX_RAW_BYTES = 32 * 1024 * 1024
MAX_COMPRESSED_BYTES = 8 * 1024 * 1024
SOURCE_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/18/query'


def valid_point(point):
    return (isinstance(point, (list, tuple)) and len(point) == 2
            and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in point)
            and abs(point[0]) <= 180 and abs(point[1]) <= 90)


class PreparedRing:
    """Latitude-indexed ray casting, with explicit boundary distance and dateline unwrap."""
    def __init__(self, coordinates):
        if not isinstance(coordinates, list) or len(coordinates) < 4 or coordinates[0] != coordinates[-1]:
            raise ValueError('Invalid or unclosed boundary ring')
        self.points = []
        previous = None
        for point in coordinates:
            if not valid_point(point):
                raise ValueError('Invalid boundary coordinate')
            lng, lat = point
            if previous is not None:
                lng += 360 * round((previous - lng) / 360)
            self.points.append((lng, lat))
            previous = lng
        if self.points[0] != self.points[-1]:
            raise ValueError('Boundary ring wraps around the entire world')
        xs, ys = zip(*self.points)
        self.bounds = (min(xs), min(ys), max(xs), max(ys))
        if self.bounds[2] - self.bounds[0] > 180:
            raise ValueError('Boundary ring spans more than a hemisphere')
        self.edges = defaultdict(lambda: array('I'))
        for i in range(len(self.points) - 1):
            a, b = self.points[i], self.points[i + 1]
            for band in range(math.floor(min(a[1], b[1]) * 4), math.floor(max(a[1], b[1]) * 4) + 1):
                self.edges[band].append(i)

    def relation(self, lng, lat):
        west, south, east, north = self.bounds
        lng += 360 * round(((west + east) / 2 - lng) / 360)
        sy = 110574.0
        sx = max(1000.0, 111320.0 * math.cos(math.radians(lat)))
        dx, dy = BORDER_METERS / sx, BORDER_METERS / sy
        if lng < west - dx or lng > east + dx or lat < south - dy or lat > north + dy:
            return -1
        inside = False
        indices = set()
        for band in range(math.floor((lat - dy) * 4), math.floor((lat + dy) * 4) + 1):
            indices.update(self.edges.get(band, ()))
        for index in indices:
            ax, ay = self.points[index]
            bx, by = self.points[index + 1]
            # Metres in a local projection; only the 10 m ambiguity band uses distance.
            if min(ax, bx) - dx <= lng <= max(ax, bx) + dx and min(ay, by) - dy <= lat <= max(ay, by) + dy:
                vx, vy = (bx - ax) * sx, (by - ay) * sy
                px, py = (lng - ax) * sx, (lat - ay) * sy
                length2 = vx * vx + vy * vy
                t = max(0.0, min(1.0, (px * vx + py * vy) / length2)) if length2 else 0.0
                if (px - t * vx) ** 2 + (py - t * vy) ** 2 <= BORDER_METERS ** 2:
                    return 0
            if (ay > lat) != (by > lat) and lng < ax + (lat - ay) * (bx - ax) / (by - ay):
                inside = not inside
        return 1 if inside else -1


class PreparedState:
    def __init__(self, geometry):
        if not isinstance(geometry, dict) or geometry.get('type') not in {'Polygon', 'MultiPolygon'}:
            raise ValueError('State reference requires polygon geometry')
        coordinates = geometry.get('coordinates')
        polygons = [coordinates] if geometry['type'] == 'Polygon' else coordinates
        if not isinstance(polygons, list) or not polygons or len(polygons) > 10000:
            raise ValueError('Invalid state polygon collection')
        self.polygons = []
        self.coordinate_count = 0
        points = []
        for polygon in polygons:
            if not isinstance(polygon, list) or not polygon or len(polygon) > 10000:
                raise ValueError('Invalid state polygon')
            rings = []
            for ring in polygon:
                self.coordinate_count += len(ring)
                if self.coordinate_count > MAX_COORDINATES:
                    raise ValueError('State coordinate cap exceeded')
                rings.append(PreparedRing(ring))
            self.polygons.append(rings)
            points.extend(polygon[0])
        self.bounds = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]

    def relation(self, lng, lat):
        inside = False
        for rings in self.polygons:
            outer = rings[0].relation(lng, lat)
            if outer == 0:
                return 0
            if outer != 1:
                continue
            in_hole = False
            for hole in rings[1:]:
                relation = hole.relation(lng, lat)
                if relation == 0:
                    return 0
                if relation == 1:
                    in_hole = True
                    break
            if not in_hole:
                inside = True
        return 1 if inside else -1


class StateBoundaries:
    def __init__(self, directory=REFERENCE):
        self.directory = Path(directory)
        self.manifest = json.loads((self.directory / 'manifest.json').read_text())
        m = self.manifest
        if m.get('version') != 1 or m.get('complete') is not True or m.get('source_url') != SOURCE_URL or m.get('vintage') != '2026-01-01' or set(m.get('expected_states', [])) != STATES or set(m.get('states', {})) != STATES:
            raise ValueError('Missing, incomplete, or unsupported Census reference')
        retrieved = dt.datetime.fromisoformat(m.get('retrieved_at', ''))
        if retrieved.tzinfo is None or retrieved > dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5):
            raise ValueError('Invalid boundary retrieval timestamp')
        total_bytes = 0
        for state, entry in m['states'].items():
            path = self.directory / (state + '.geojson.gz')
            if entry.get('file') != path.name or not path.is_file() or path.is_symlink():
                raise ValueError('Missing or unsafe state reference file')
            compressed = path.read_bytes()
            if not 0 < len(compressed) <= MAX_COMPRESSED_BYTES or len(compressed) != entry.get('compressed_bytes') or hashlib.sha256(compressed).hexdigest() != entry.get('sha256'):
                raise ValueError('Corrupt state reference file')
            total_bytes += len(compressed)
            if total_bytes > 64 * 1024 * 1024:
                raise ValueError('Boundary reference byte cap exceeded')
            if not isinstance(entry.get('bounds'), list) or len(entry['bounds']) != 4 or not all(isinstance(v, (float, int)) and math.isfinite(v) for v in entry['bounds']):
                raise ValueError('Invalid state reference bounds')
        self.cache = OrderedDict()
        self.names = {entry['name'].strip().upper(): state for state, entry in m['states'].items()}
        # Validate the entire pinned reference, including states with no input points.
        # The small LRU bounds memory while detecting malformed compressed contents.
        for state in sorted(STATES):
            self.prepared(state)

    def canonical(self, state):
        if not isinstance(state, str):
            return None
        value = state.strip().upper()
        return value if value in STATES else self.names.get(value)

    def prepared(self, state):
        if state in self.cache:
            self.cache.move_to_end(state)
            return self.cache[state]
        entry = self.manifest['states'][state]
        with gzip.open(self.directory / entry['file'], 'rb') as handle:
            raw = handle.read(MAX_RAW_BYTES + 1)
        if len(raw) > MAX_RAW_BYTES or len(raw) != entry.get('raw_bytes') or hashlib.sha256(raw).hexdigest() != entry.get('raw_sha256'):
            raise ValueError('Corrupt uncompressed state reference')
        data = json.loads(raw)
        if data.get('type') != 'FeatureCollection' or len(data.get('features', [])) != 1 or data['features'][0].get('properties', {}).get('STUSAB') != state:
            raise ValueError('Invalid state reference identity')
        prepared = PreparedState(data['features'][0]['geometry'])
        if prepared.coordinate_count != entry.get('coordinate_count') or prepared.bounds != entry['bounds']:
            raise ValueError('Boundary reference geometry metadata mismatch')
        self.cache[state] = prepared
        if len(self.cache) > 6:
            self.cache.popitem(last=False)
        return prepared

    def classify(self, lng, lat):
        if not valid_point([lng, lat]):
            return {'state': None, 'reason': 'invalid_coordinates', 'candidates': []}
        inside, boundary = [], []
        # A conservative margin admits the whole 10 m ambiguity band at all US latitudes.
        for state, entry in self.manifest['states'].items():
            west, south, east, north = entry['bounds']
            if not south - .001 <= lat <= north + .001:
                continue
            if state != 'AK' and not west - .001 <= lng <= east + .001:
                continue
            relation = self.prepared(state).relation(lng, lat)
            if relation == 0:
                boundary.append(state)
            elif relation == 1:
                inside.append(state)
        candidates = sorted(set(inside + boundary))
        if boundary or len(inside) > 1:
            return {'state': None, 'reason': 'boundary_ambiguous', 'candidates': candidates}
        if len(inside) == 1:
            return {'state': inside[0], 'reason': 'contained', 'candidates': inside}
        return {'state': None, 'reason': 'outside_supported_states', 'candidates': []}

    def classify_many(self, points):
        """Prepare each state's geometry once for a build, keeping the LRU bounded."""
        unique = {tuple(point) for point in points if valid_point(point)}
        matches = {point: [[], []] for point in unique}
        for state, entry in self.manifest['states'].items():
            west, south, east, north = entry['bounds']
            candidates = [point for point in unique if south - .001 <= point[1] <= north + .001 and (state == 'AK' or west - .001 <= point[0] <= east + .001)]
            if not candidates:
                continue
            prepared = self.prepared(state)
            for point in candidates:
                relation = prepared.relation(*point)
                if relation >= 0:
                    matches[point][0 if relation == 1 else 1].append(state)
        results = {}
        for point, (inside, boundary) in matches.items():
            ambiguous = bool(boundary) or len(inside) > 1
            state = inside[0] if len(inside) == 1 and not ambiguous else None
            results[point] = {'state': state, 'reason': 'contained' if state else ('boundary_ambiguous' if ambiguous else 'outside_supported_states'), 'candidates': sorted(set(inside + boundary))}
        return results


def assign_feature(feature, boundaries, assignment=None):
    result = copy.deepcopy(feature)
    props = result['properties']
    original = props.get('source_state', props.get('state'))
    props['source_state'] = original
    geometry = result.get('geometry')
    point = geometry.get('coordinates') if isinstance(geometry, dict) and geometry.get('type') == 'Point' else None
    if assignment is None:
        assignment = boundaries.classify(*point) if valid_point(point) else {'state': None, 'reason': 'invalid_coordinates', 'candidates': []}
    state = assignment['state']
    if state is None:
        safe_point = [value if isinstance(value, (str, int, float)) and not (isinstance(value, float) and not math.isfinite(value)) else None for value in point[:4]] if isinstance(point, list) else None
        return None, {'id': props.get('id'), 'source': props.get('source'), 'source_state': original, 'previous_state': props.get('state'), 'coordinates': safe_point, 'reason': assignment['reason'], 'candidates': assignment['candidates']}
    props['state'] = state
    canonical = boundaries.canonical(original)
    props['state_assignment'] = {'method': 'census_polygon', 'boundary_vintage': boundaries.manifest['vintage'], 'status': 'verified' if canonical == state else ('assigned' if original is None else 'corrected')}
    provenance = props.setdefault('field_provenance', {})
    if not isinstance(provenance, dict):
        raise ValueError('Invalid field provenance')
    provenance['state'] = 'U.S. Census Bureau BAS 2026 polygon containment; 10 m boundary ambiguity excluded'
    return result, None


def build(sources=None, out=None, reference=REFERENCE, boundaries=None, quarantine_path=None):
    sources = SOURCES if sources is None else sources
    out = OUT if out is None else Path(out)
    quarantine_path = Path(quarantine_path) if quarantine_path is not None else (ROOT / 'data/sources/agency-quarantine.json' if out == OUT else out.parent / (out.name + '-quarantine.json'))
    boundaries = boundaries or StateBoundaries(reference)
    by_state, retrieved, quarantine = defaultdict(list), {}, []
    seen_ids = set()
    all_features = []
    for path in map(Path, sources):
        data = json.loads(path.read_text())  # Missing/broken sources fail before touching output.
        if data.get('type') != 'FeatureCollection' or not isinstance(data.get('features'), list) or not data['features']:
            raise ValueError(f'Incomplete agency source: {path.name}')
        retrieved[data.get('source', path.stem)] = data.get('retrieved')
        for feature in data['features']:
            if not isinstance(feature, dict) or feature.get('type') != 'Feature' or not isinstance(feature.get('properties'), dict) or not isinstance(feature['properties'].get('id'), str):
                raise ValueError('Invalid agency feature')
            identity = feature['properties']['id']
            if identity in seen_ids:
                raise ValueError('Duplicate agency source identity')
            seen_ids.add(identity)
            all_features.append(feature)
    points = [feature.get('geometry', {}).get('coordinates') for feature in all_features if isinstance(feature.get('geometry'), dict) and feature['geometry'].get('type') == 'Point']
    assignments = boundaries.classify_many(points)
    for feature in all_features:
        geometry = feature.get('geometry')
        point = geometry.get('coordinates') if isinstance(geometry, dict) and geometry.get('type') == 'Point' else None
        assignment = assignments.get(tuple(point)) if valid_point(point) else None
        assigned, rejected = assign_feature(feature, boundaries, assignment)
        if rejected:
            quarantine.append(rejected)
        else:
            by_state[assigned['properties']['state']].append(assigned)
    if not by_state:
        raise ValueError('No assignable agency records; preserving existing snapshots')
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='agency-stage-', dir=out.parent) as temp:
        stage, backup = Path(temp) / 'next', Path(temp) / 'previous'
        stage.mkdir()
        for state, features in sorted(by_state.items()):
            features.sort(key=lambda f: f['properties']['id'])
            payload = {'type': 'FeatureCollection', 'sources': retrieved, 'features': features}
            (stage / f'{state}.geojson').write_text(json.dumps(payload, separators=(',', ':'), allow_nan=False))
        reasons = defaultdict(int)
        for item in quarantine:
            reasons[item['reason']] += 1
        report = {'version': 1, 'boundary_source': SOURCE_URL, 'boundary_vintage': boundaries.manifest['vintage'], 'border_ambiguity_meters': BORDER_METERS, 'count': len(quarantine), 'reasons': dict(sorted(reasons.items())), 'records': sorted(quarantine, key=lambda x: x['id'])}
        staged_report = Path(temp) / 'quarantine.json'
        staged_report.write_text(json.dumps(report, separators=(',', ':'), allow_nan=False))
        index = {'version': 1, 'sources': retrieved, 'states': sorted(by_state), 'counts': {s: len(v) for s, v in sorted(by_state.items())}, 'state_assignment': {'method': 'census_polygon', 'boundary_vintage': boundaries.manifest['vintage'], 'quarantined': len(quarantine), 'quarantine_reasons': report['reasons']}}
        (stage / 'index.json').write_text(json.dumps(index, separators=(',', ':'), allow_nan=False))
        quarantine_path.parent.mkdir(parents=True, exist_ok=True)
        previous_report = Path(temp) / 'previous-quarantine.json'
        published = False
        try:
            if quarantine_path.exists():
                quarantine_path.rename(previous_report)
            if out.exists():
                out.rename(backup)
            stage.rename(out)
            published = True
            staged_report.rename(quarantine_path)
        except BaseException:
            if published:
                out.rename(stage)
            if backup.exists():
                backup.rename(out)
            if previous_report.exists():
                previous_report.rename(quarantine_path)
            raise
    return {s: len(v) for s, v in by_state.items()}


if __name__ == '__main__':
    counts = build()
    print(f'agency snapshots: {sum(counts.values())} assigned records in {len(counts)} states; see data/sources/agency-quarantine.json for exclusions')
