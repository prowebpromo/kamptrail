#!/usr/bin/env python3
"""Split agency camping records (USFS, BLM) into per-state files the app loads beside each state snapshot.

Input:  data/sources/usfs.json, data/sources/blm.json (written by the fetch scripts)
Output: data/campsites/agency/XX.geojson for every state that has records
A record without a state takes the state of the nearest GeoNames place in data/places-us.json.
"""
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [ROOT / 'data' / 'sources' / 'usfs.json', ROOT / 'data' / 'sources' / 'blm.json']
OUT = ROOT / 'data' / 'campsites' / 'agency'
STATES = set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split())


class NearestState:
    def __init__(self, places):
        self.grid = defaultdict(list)
        for p in places:
            if p.get('state') in STATES:
                self.grid[(math.floor(p['lat']), math.floor(p['lng']))].append((p['lat'], p['lng'], p['state']))

    def __call__(self, lat, lng):
        for radius in range(0, 8):
            best = None
            for dy in range(-radius, radius + 1):
                for dx in range(-radius, radius + 1):
                    for plat, plng, st in self.grid.get((math.floor(lat) + dy, math.floor(lng) + dx), ()):
                        d = (plat - lat) ** 2 + ((plng - lng) * math.cos(math.radians(lat))) ** 2
                        if best is None or d < best[0]:
                            best = (d, st)
            if best:
                return best[1]
        return None


def build():
    nearest = NearestState(json.loads((ROOT / 'data' / 'places-us.json').read_text())['places'])
    by_state = defaultdict(list)
    retrieved = {}
    for path in SOURCES:
        if not path.exists():
            continue
        data = json.loads(path.read_text())
        retrieved[data.get('source', path.stem)] = data.get('retrieved')
        for f in data.get('features', []):
            lng, lat = f['geometry']['coordinates']
            state = f['properties'].get('state')
            if state not in STATES:
                state = nearest(lat, lng)
                f['properties']['state'] = state
            if state:
                by_state[state].append(f)
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*.geojson'):
        if old.stem not in by_state:
            old.unlink()
    for state, features in sorted(by_state.items()):
        features.sort(key=lambda f: f['properties']['id'])
        payload = {'type': 'FeatureCollection', 'sources': retrieved, 'features': features}
        tmp = OUT / f'{state}.geojson.tmp'
        tmp.write_text(json.dumps(payload, separators=(',', ':')))
        tmp.replace(OUT / f'{state}.geojson')
    index = {'version': 1, 'sources': retrieved, 'states': sorted(by_state), 'counts': {s: len(v) for s, v in sorted(by_state.items())}}
    (OUT / 'index.json.tmp').write_text(json.dumps(index, separators=(',', ':')))
    (OUT / 'index.json.tmp').replace(OUT / 'index.json')
    return {s: len(v) for s, v in by_state.items()}


if __name__ == '__main__':
    counts = build()
    print(f'agency snapshots: {sum(counts.values())} records in {len(counts)} states')
