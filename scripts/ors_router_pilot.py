#!/usr/bin/env python3
"""Bounded pilot: does hosted openrouteservice enforce rig height without
excluding roads that are closed only to commercial trucks?

Reads ORS_API_KEY from the environment and never prints it. Uses public
OpenStreetMap geometry from Overpass to build and validate test corridors.
Writes a JSON report and a Markdown summary. Standard library only.
"""
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ORS_BASE = os.environ.get('ORS_BASE', 'https://api.openrouteservice.org')
OVERPASS = os.environ.get('OVERPASS_URL', 'https://overpass-api.de/api/interpreter')
UA = 'KampTrail router pilot (https://kamptrail.com)'
RESTRICTED_WAY = 1212627497          # Blackstone Street, maxheight 9'4" (2.8448 m)
LIMIT_M = 2.8448
NEAR_M = 8.0                          # route must pass this close to both segment ends to "cross"
CORRIDOR_STEPS = (250, 400, 150)      # metres along the street from the segment
VEHICLE_TYPES = ('hgv', 'bus')
PAUSE_S = 2.0                         # keeps well under 40 requests per minute
MAX_ORS_CALLS = 60


def now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def metres(a, b):
    """Distance between [lon, lat] points (equirectangular, fine at this scale)."""
    lat = math.radians((a[1] + b[1]) / 2)
    dx = math.radians(b[0] - a[0]) * math.cos(lat) * 6371008.8
    dy = math.radians(b[1] - a[1]) * 6371008.8
    return math.hypot(dx, dy)


def point_to_segment(p, a, b):
    lat = math.radians(p[1])
    k = 6371008.8 * math.pi / 180
    ax, ay = (a[0] - p[0]) * k * math.cos(lat), (a[1] - p[1]) * k
    bx, by = (b[0] - p[0]) * k * math.cos(lat), (b[1] - p[1]) * k
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
    return math.hypot(ax + t * dx, ay + t * dy)


def distance_to_line(p, line):
    if len(line) == 1:
        return metres(p, line[0])
    return min(point_to_segment(p, line[i], line[i + 1]) for i in range(len(line) - 1))


def passes_through(line, points, tolerance=NEAR_M):
    return bool(line) and all(distance_to_line(p, line) <= tolerance for p in points)


def length(line):
    return sum(metres(line[i], line[i + 1]) for i in range(len(line) - 1))


class Pilot:
    def __init__(self, key, http=urllib.request.urlopen):
        self.key, self.http, self.calls, self.log = key, http, 0, []

    def overpass(self, query):
        body = ('data=' + urllib.parse.quote(query)).encode()
        req = urllib.request.Request(OVERPASS, data=body, headers={'User-Agent': UA})
        with self.http(req, timeout=120) as r:
            return json.load(r)

    def route(self, label, profile, coords, options=None):
        if self.calls >= MAX_ORS_CALLS:
            raise RuntimeError('pilot call budget reached')
        body = {'coordinates': coords, 'instructions': False, 'elevation': False}
        if options:
            body['options'] = options
        req = urllib.request.Request(f'{ORS_BASE}/v2/directions/{profile}/geojson', data=json.dumps(body).encode(),
                                     headers={'Authorization': self.key, 'Content-Type': 'application/json',
                                              'Accept': 'application/geo+json', 'User-Agent': UA})
        self.calls += 1
        record = {'label': label, 'profile': profile, 'request': body, 'at': now()}
        try:
            with self.http(req, timeout=60) as r:
                data = json.load(r)
            feature = data['features'][0]
            record.update(status=200, line=feature['geometry']['coordinates'],
                          distance_m=feature['properties'].get('summary', {}).get('distance'),
                          engine=(data.get('metadata') or {}).get('engine'))
        except urllib.error.HTTPError as e:
            detail = e.read()[:400].decode('utf-8', 'replace')
            record.update(status=e.code, line=None, error=detail)
        time.sleep(PAUSE_S)
        self.log.append({k: v for k, v in record.items() if k != 'line'} | {'points': len(record['line'] or [])})
        return record


def bearing(a, b):
    lat = math.radians((a[1] + b[1]) / 2)
    return math.atan2(math.radians(b[1] - a[1]), math.radians(b[0] - a[0]) * math.cos(lat))


def street_chain(elements, start_ids, name, steps):
    """Walk outward from each restricted-segment end along connected roads.

    Prefers ways with the restricted street's name, then the straightest
    continuation, so the corridor runs through the restriction rather than
    around it.
    """
    nodes, adj = {}, {}
    for el in elements:
        if el.get('type') != 'way' or 'highway' not in (el.get('tags') or {}):
            continue
        tags = el['tags']
        if tags['highway'] in ('footway', 'cycleway', 'path', 'steps', 'pedestrian', 'service', 'track', 'bridleway', 'corridor', 'proposed', 'construction'):
            continue
        ids, geom = el.get('nodes') or [], el.get('geometry') or []
        for nid, g in zip(ids, geom):
            nodes[nid] = [g['lon'], g['lat']]
        same = tags.get('name') == name
        for a, b in zip(ids, ids[1:]):
            adj.setdefault(a, {})[b] = same or adj.get(a, {}).get(b, False)
            adj.setdefault(b, {})[a] = same or adj.get(b, {}).get(a, False)
    seg = set(start_ids)
    found = {}
    for end in start_ids:
        other = start_ids[1] if end == start_ids[0] else start_ids[0]
        for target in steps:
            prev, cur, walked, seen = other, end, 0.0, set(seg)
            while walked < target:
                options = [(n, same) for n, same in adj.get(cur, {}).items() if n not in seen]
                if not options:
                    break
                heading = bearing(nodes[prev], nodes[cur]) if prev in nodes else 0.0
                def score(item):
                    n, same = item
                    turn = abs((bearing(nodes[cur], nodes[n]) - heading + math.pi) % (2 * math.pi) - math.pi)
                    return (0 if same else 1, turn)
                nxt = min(options, key=score)[0]
                prev, cur = cur, nxt
                seen.add(cur)
                walked += metres(nodes[prev], nodes[cur])
            if walked >= target * 0.6:
                found.setdefault(end, []).append((target, nodes[cur], round(walked)))
    return found, nodes


def height_tests(p, report):
    q = f'[out:json][timeout:60];way({RESTRICTED_WAY});out body geom;way(around:700,41.89296,-71.38510)[highway];out body geom;'
    data = p.overpass(q)
    restricted = next(e for e in data['elements'] if e.get('id') == RESTRICTED_WAY)
    tags = restricted.get('tags') or {}
    seg_ids = restricted['nodes']
    seg_pts = [[g['lon'], g['lat']] for g in restricted['geometry']]
    report['restricted_way'] = {'id': RESTRICTED_WAY, 'tags': tags, 'nodes': len(seg_ids), 'length_m': round(length(seg_pts), 1)}
    ends, _ = street_chain(data['elements'], [seg_ids[0], seg_ids[-1]], tags.get('name', 'Blackstone Street'), CORRIDOR_STEPS)
    corridor = None
    for i in range(len(CORRIDOR_STEPS)):
        a_opts, b_opts = ends.get(seg_ids[0], []), ends.get(seg_ids[-1], [])
        if i >= len(a_opts) or i >= len(b_opts):
            continue
        a, b = a_opts[i][1], b_opts[i][1]
        control = p.route(f'control car {a_opts[i][0]} m', 'driving-car', [a, b])
        if control['status'] == 200 and passes_through(control['line'], seg_pts):
            corridor = {'a': a, 'b': b, 'walk_m': [a_opts[i][2], b_opts[i][2]], 'control_distance_m': control['distance_m']}
            break
    report['corridor'] = corridor
    report['corridor_candidates'] = {str(k): [(t, c, w) for t, c, w in v] for k, v in ends.items()}
    if not corridor:
        report['height_result'] = 'NOT VALIDATED: no car control route crossed the restricted segment'
        return
    results = []
    for vt in VEHICLE_TYPES:
        for direction, coords in (('A to B', [corridor['a'], corridor['b']]), ('B to A', [corridor['b'], corridor['a']])):
            for h in (2.5, 3.0):
                r = p.route(f'{vt} {h} m {direction}', 'driving-hgv', coords,
                            {'vehicle_type': vt, 'profile_params': {'restrictions': {'height': h}}})
                crossed = r['status'] == 200 and passes_through(r['line'], seg_pts)
                expected = 'cross' if h < LIMIT_M else 'avoid or no route'
                ok = crossed if h < LIMIT_M else (not crossed)
                results.append({'vehicle_type': vt, 'height_m': h, 'direction': direction, 'status': r['status'],
                                'crossed_segment': crossed, 'distance_m': r.get('distance_m'), 'expected': expected,
                                'pass': ok, 'error': r.get('error')})
    report['height_tests'] = results
    report['height_result'] = 'PASS' if all(x['pass'] for x in results) else 'FAIL'


def truck_only_tests(p, report, limit=3):
    q = ('[out:json][timeout:90];area["ISO3166-2"="US-RI"]->.ri;'
         'way(area.ri)[highway~"^(trunk|primary|secondary|tertiary|unclassified|residential)$"]["hgv"="no"];out body geom;')
    data = p.overpass(q)
    skip = ('maxheight', 'maxheight:physical', 'maxweight', 'maxwidth', 'maxlength', 'access', 'motor_vehicle', 'motorcar', 'oneway')
    candidates = []
    for el in data['elements']:
        tags = el.get('tags') or {}
        if any(k in tags for k in skip):
            continue
        line = [[g['lon'], g['lat']] for g in el.get('geometry') or []]
        if len(line) >= 3 and 300 <= length(line) <= 3000:
            candidates.append((el['id'], tags, line))
    candidates.sort(key=lambda c: -length(c[2]))
    report['truck_only_candidates'] = len(candidates)
    results = []
    for wid, tags, line in candidates[:limit * 3]:
        if len([r for r in results if r.get('car_uses_way')]) >= limit:
            break
        a, b = line[0], line[-1]
        sample = [line[len(line) // 4], line[len(line) // 2], line[3 * len(line) // 4]]
        car = p.route(f'truck-only control way {wid}', 'driving-car', [a, b])
        row = {'way': wid, 'name': tags.get('name'), 'highway': tags.get('highway'), 'hgv': tags.get('hgv'),
               'length_m': round(length(line)), 'car_status': car['status'],
               'car_uses_way': car['status'] == 200 and passes_through(car['line'], sample, 12)}
        if row['car_uses_way']:
            for vt in VEHICLE_TYPES:
                r = p.route(f'{vt} small way {wid}', 'driving-hgv', [a, b],
                            {'vehicle_type': vt, 'profile_params': {'restrictions': {'height': 2.0, 'width': 2.0, 'length': 6.0, 'weight': 3.5}}})
                used = r['status'] == 200 and passes_through(r['line'], sample, 12)
                row[f'{vt}_status'] = r['status']
                row[f'{vt}_uses_way'] = used
                row[f'{vt}_distance_m'] = r.get('distance_m')
        results.append(row)
    report['truck_only_tests'] = results
    tested = [r for r in results if r.get('car_uses_way')]
    excluded = [r for r in tested if not all(r.get(f'{vt}_uses_way') for vt in VEHICLE_TYPES)]
    report['truck_only_result'] = ('NOT VALIDATED: no candidate road had a usable car control' if not tested
                                   else f'{len(excluded)} of {len(tested)} hgv=no roads excluded for a small vehicle under at least one profile')


def summary_md(report):
    lines = ['### openrouteservice rig-routing pilot', '', f"Run {report['started']} to {report.get('finished')}. ORS calls: {report.get('ors_calls')}.", '']
    rw = report.get('restricted_way') or {}
    lines.append(f"Restricted way {rw.get('id')} {rw.get('tags', {}).get('name')} maxheight {rw.get('tags', {}).get('maxheight')}, {rw.get('length_m')} m.")
    lines.append(f"Height result: **{report.get('height_result')}**")
    for t in report.get('height_tests') or []:
        lines.append(f"- {t['vehicle_type']} {t['height_m']} m {t['direction']}: HTTP {t['status']}, crossed={t['crossed_segment']}, expected {t['expected']}, {'PASS' if t['pass'] else 'FAIL'}")
    lines += ['', f"Truck-only roads: **{report.get('truck_only_result')}** ({report.get('truck_only_candidates')} candidates)"]
    for t in report.get('truck_only_tests') or []:
        lines.append(f"- way {t['way']} {t.get('name')} ({t['highway']}, {t['length_m']} m): car uses={t['car_uses_way']}, hgv uses={t.get('hgv_uses_way')}, bus uses={t.get('bus_uses_way')}")
    if report.get('error'):
        lines += ['', f"Error: {report['error']}"]
    return '\n'.join(lines) + '\n'


def main(out_dir):
    key = os.environ.get('ORS_API_KEY', '').strip()
    if not key:
        print('ORS_API_KEY is not set', file=sys.stderr)
        return 2
    os.makedirs(out_dir, exist_ok=True)
    p = Pilot(key)
    report = {'started': now(), 'ors_base': ORS_BASE, 'limit_m': LIMIT_M, 'near_tolerance_m': NEAR_M}
    try:
        height_tests(p, report)
        truck_only_tests(p, report)
    except Exception as e:  # report what happened, never the key
        report['error'] = f'{type(e).__name__}: {str(e).replace(key, "***")[:300]}'
    report.update(finished=now(), ors_calls=p.calls, calls=p.log)
    text = json.dumps(report, indent=1).replace(key, '***')
    with open(os.path.join(out_dir, 'report.json'), 'w') as f:
        f.write(text)
    md = summary_md(json.loads(text))
    with open(os.path.join(out_dir, 'summary.md'), 'w') as f:
        f.write(md)
    print(md)
    return 0 if not report.get('error') else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else 'ors-pilot'))
