#!/usr/bin/env python3
"""Multi-state height-enforcement test for hosted openrouteservice.

For mapped OSM height restrictions in several states: validate that a car
route crosses the restricted way, then check that a vehicle 0.4 m under the
limit still crosses it and one 0.2 m over avoids it, in both directions,
under the hgv and bus profiles. Restrictions whose corridor cannot be
validated are excluded and counted, never scored. Reads ORS_API_KEY and
never prints it. Standard library only.
"""
import json
import os
import random
import re
import sys
import time
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ors_router_pilot import Pilot, street_chain, passes_through, length, now, distance_to_line  # noqa: E402

STATES = tuple(os.environ.get('ORS_STATES', 'US-NY,US-MA,US-PA,US-OH,US-IL,US-GA,US-CO,US-CA,US-OR,US-WA').split(','))
PER_STATE = 3                  # validated corridors wanted per state
CANDIDATES_PER_STATE = int(os.environ.get('ORS_CANDIDATES', '8'))
PROFILES = ('hgv', 'bus')
UNDER, OVER = 0.4, 0.2
MIN_TEST, MAX_TEST = 2.3, 4.2
MOTOR = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link'
SEED = 20261031
DEADLINE_S = 40 * 60


def parse_height(value):
    """Metres from common OSM maxheight forms, or None when not a plain limit."""
    if not isinstance(value, str):
        return None
    v = value.strip().lower().replace(',', '.')
    m = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(?:m)?', v)
    if m:
        return float(m.group(1))
    m = re.fullmatch(r"(\d+)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:\"|''|in|inches)?)?", v)
    if m:
        return round(int(m.group(1)) * 0.3048 + float(m.group(2) or 0) * 0.0254, 4)
    return None


def overpass_retry(p, query, tries=3):
    for attempt in range(tries):
        try:
            return p.overpass(query)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt == tries - 1:
                raise
            time.sleep(5 * (attempt + 1))


def candidates(p, state):
    q = (f'[out:json][timeout:90];area["ISO3166-2"="{state}"]->.s;'
         f'way(area.s)[highway~"^({MOTOR})$"][maxheight];out body geom;')
    data = overpass_retry(p, q)
    out = []
    for el in data.get('elements', []):
        tags = el.get('tags') or {}
        limit = parse_height(tags.get('maxheight'))
        if limit is None or not (MIN_TEST + UNDER <= limit <= MAX_TEST - OVER):
            continue
        if tags.get('oneway') in ('yes', '1', '-1') or tags.get('access') in ('no', 'private') or 'maxheight:conditional' in tags:
            continue
        line = [[g['lon'], g['lat']] for g in el.get('geometry') or []]
        if len(line) >= 2 and length(line) <= 250:
            out.append({'id': el['id'], 'tags': tags, 'limit_m': limit, 'nodes': el['nodes'], 'line': line})
    return out


def test_one(p, state, c):
    mid = c['line'][len(c['line']) // 2]
    data = overpass_retry(p, f'[out:json][timeout:60];way(around:600,{mid[1]},{mid[0]})[highway];out body geom;')
    name = c['tags'].get('name', '')
    ends, _ = street_chain(data['elements'], [c['nodes'][0], c['nodes'][-1]], name, (250, 400))
    row = {'state': state, 'way': c['id'], 'name': name or None, 'highway': c['tags'].get('highway'),
           'maxheight': c['tags'].get('maxheight'), 'limit_m': c['limit_m'], 'length_m': round(length(c['line']), 1)}
    a_opts, b_opts = ends.get(c['nodes'][0], []), ends.get(c['nodes'][-1], [])
    corridor = None
    for i in range(min(len(a_opts), len(b_opts))):
        a, b = a_opts[i][1], b_opts[i][1]
        ctl = p.route(f"{state} {c['id']} car control", 'driving-car', [a, b])
        row.setdefault('control_attempts', []).append({'status': ctl['status'], 'a': a, 'b': b, 'distance_m': ctl.get('distance_m'),
            'miss_m': [round(distance_to_line(pt, ctl['line']), 1) for pt in (c['line'][0], c['line'][-1])] if ctl.get('line') else None,
            'error': (ctl.get('error') or '')[:200]})
        if ctl['status'] == 200 and passes_through(ctl['line'], [c['line'][0], c['line'][-1]]):
            corridor = (a, b)
            row['control_distance_m'] = ctl['distance_m']
            break
    if not corridor:
        row['validated'] = False
        return row
    row['validated'] = True
    under = round(max(MIN_TEST, c['limit_m'] - UNDER), 2)
    over = round(min(MAX_TEST, c['limit_m'] + OVER), 2)
    row['under_m'], row['over_m'], row['checks'] = under, over, []
    for vt in PROFILES:
        for label, coords in (('A to B', [corridor[0], corridor[1]]), ('B to A', [corridor[1], corridor[0]])):
            for h, want_cross in ((under, True), (over, False)):
                r = p.route(f"{state} {c['id']} {vt} {h} {label}", 'driving-hgv', coords,
                            {'vehicle_type': vt, 'profile_params': {'restrictions': {'height': h}}})
                crossed = r['status'] == 200 and passes_through(r['line'], [c['line'][0], c['line'][-1]])
                ok = crossed == want_cross if r['status'] == 200 else (not want_cross and r['status'] in (404,))
                row['checks'].append({'profile': vt, 'direction': label, 'height_m': h, 'status': r['status'],
                                      'crossed': crossed, 'expected': 'cross' if want_cross else 'avoid',
                                      'distance_m': r.get('distance_m'), 'pass': ok})
    row['pass'] = all(x['pass'] for x in row['checks'])
    return row


def main(out_dir):
    key = os.environ.get('ORS_API_KEY', '').strip()
    if not key:
        print('ORS_API_KEY is not set', file=sys.stderr)
        return 2
    import ors_router_pilot
    ors_router_pilot.MAX_ORS_CALLS = 420
    os.makedirs(out_dir, exist_ok=True)
    p = Pilot(key)
    rng = random.Random(SEED)
    t0 = time.time()
    report = {'started': now(), 'states': STATES, 'under_m': UNDER, 'over_m': OVER, 'seed': SEED, 'rows': [], 'state_notes': {}}
    try:
        for state in STATES:
            if time.time() - t0 > DEADLINE_S:
                report['error'] = 'time budget reached; later states not tested'
                break
            try:
                pool = candidates(p, state)
            except Exception as e:
                report['state_notes'][state] = f'candidate query failed: {type(e).__name__}'
                continue
            rng.shuffle(pool)
            report['state_notes'][state] = f'{len(pool)} eligible mapped restrictions'
            got = 0
            for c in pool[:CANDIDATES_PER_STATE]:
                if got >= PER_STATE or time.time() - t0 > DEADLINE_S:
                    break
                try:
                    row = test_one(p, state, c)
                except RuntimeError:
                    raise
                except Exception as e:
                    row = {'state': state, 'way': c['id'], 'validated': False, 'error': f'{type(e).__name__}'}
                report['rows'].append(row)
                with open(os.path.join(out_dir, 'multistate-partial.json'), 'w') as f:
                    f.write(json.dumps(report).replace(key, '***'))
                got += 1 if row.get('validated') else 0
                time.sleep(3)
    except RuntimeError as e:
        report['error'] = str(e)
    tested = [r for r in report['rows'] if r.get('validated')]
    passed = [r for r in tested if r.get('pass')]
    checks = [c for r in tested for c in r['checks']]
    report.update(finished=now(), ors_calls=p.calls, tested=len(tested), passed=len(passed),
                  excluded=len(report['rows']) - len(tested), checks=len(checks),
                  checks_passed=sum(c['pass'] for c in checks))
    text = json.dumps(report, indent=1).replace(key, '***')
    with open(os.path.join(out_dir, 'multistate-report.json'), 'w') as f:
        f.write(text)
    lines = ['### openrouteservice multi-state height test', '',
             f"{report['passed']} of {report['tested']} validated restrictions passed every check "
             f"({report['checks_passed']} of {report['checks']} individual checks). "
             f"{report['excluded']} candidates excluded for an unvalidated corridor. ORS calls: {p.calls}.", '']
    for s, note in report['state_notes'].items():
        lines.append(f'- {s}: {note}')
    lines.append('')
    for r in report['rows']:
        if not r.get('validated'):
            continue
        fails = [f"{c['profile']} {c['height_m']} m {c['direction']} {'crossed' if c['crossed'] else 'avoided'} (HTTP {c['status']})" for c in r['checks'] if not c['pass']]
        lines.append(f"- {r['state']} way {r['way']} {r.get('name')} maxheight {r['maxheight']} ({r['limit_m']} m): "
                     f"{'PASS' if r['pass'] else 'FAIL: ' + '; '.join(fails)}")
    if report.get('error'):
        lines += ['', f"Stopped early: {report['error']}"]
    md = '\n'.join(lines) + '\n'
    with open(os.path.join(out_dir, 'multistate-summary.md'), 'w') as f:
        f.write(md)
    print(md)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else 'ors-multistate'))
