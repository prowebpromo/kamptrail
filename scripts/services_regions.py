"""Pinned public Geofabrik index projection, shared by importer and orchestration."""
import datetime as dt
import json
import re
from pathlib import Path
from build_agency_states import STATES

REGISTRY_PATH = Path(__file__).with_name('services-regions.json')
REGISTRY = json.loads(REGISTRY_PATH.read_bytes())
URLS = {state: row['url'] for state, row in REGISTRY['regions'].items()}
if set(URLS) != STATES or len(set(URLS.values())) != 50:
    raise ValueError('Geofabrik registry must bind exactly 50 Census states')
for state, row in REGISTRY['regions'].items():
    if row['iso3166_2'] != 'US-' + state or not re.fullmatch(r'https://download\.geofabrik\.de/north-america/us/[a-z-]+-latest\.osm\.pbf', row['url']):
        raise ValueError('Invalid pinned public region registry')


def validate_resolved_url(region, url):
    """Only requested canonical extract, or its valid same-region dated variant."""
    canonical = URLS[region]
    if url == canonical:
        return None
    prefix = canonical.removesuffix('latest.osm.pbf')
    if not url.startswith(prefix) or not re.fullmatch('[0-9]{6}\\.osm\\.pbf', url[len(prefix):]):
        raise ValueError('PBF redirect outside fixed same-state public extract')
    try:
        day = dt.datetime.strptime(url[len(prefix):len(prefix) + 6], '%y%m%d').date()
    except ValueError as exc:
        raise ValueError('Invalid dated extract redirect') from exc
    if day > dt.datetime.now(dt.timezone.utc).date():
        raise ValueError('Future dated extract redirect')
    return day
