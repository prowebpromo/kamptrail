#!/usr/bin/env python3
"""
Fetch dump stations and propane fill locations from OpenStreetMap via Overpass API
Merge with existing water station data from Recreation.gov campsites
"""

import json
import requests
import time
from pathlib import Path

def fetch_overpass_data(query, description):
    """Fetch data from Overpass API with timeout and retry"""
    overpass_url = "https://overpass-api.de/api/interpreter"

    print(f"Fetching {description} from OpenStreetMap...")

    for attempt in range(3):
        try:
            response = requests.post(overpass_url, data={'data': query}, timeout=120)
            response.raise_for_status()
            data = response.json()
            print(f"✓ Found {len(data.get('elements', []))} {description}")
            return data.get('elements', [])
        except requests.exceptions.Timeout:
            print(f"  Timeout on attempt {attempt + 1}/3, retrying...")
            time.sleep(5)
        except Exception as e:
            print(f"  Error: {e}")
            if attempt < 2:
                time.sleep(5)

    print(f"✗ Failed to fetch {description}")
    return []

def fetch_dump_stations():
    """
    Fetch RV dump stations from OSM
    Includes:
    - Standalone dump stations (amenity=sanitary_dump_station)
    - Campgrounds with dump access (tourism=camp_site/caravan_site + sanitary_dump_station=yes/customers)
    """
    # US bounding box: south,west,north,east (includes Alaska)
    # Continental US + Alaska coverage
    query = """
    [out:json][timeout:180];
    (
      node["amenity"="sanitary_dump_station"](24.0,-125.0,72.0,-66.0);
      way["amenity"="sanitary_dump_station"](24.0,-125.0,72.0,-66.0);
      relation["amenity"="sanitary_dump_station"](24.0,-125.0,72.0,-66.0);
      node["tourism"="camp_site"]["sanitary_dump_station"~"yes|customers"](24.0,-125.0,72.0,-66.0);
      way["tourism"="camp_site"]["sanitary_dump_station"~"yes|customers"](24.0,-125.0,72.0,-66.0);
      node["tourism"="caravan_site"]["sanitary_dump_station"~"yes|customers"](24.0,-125.0,72.0,-66.0);
      way["tourism"="caravan_site"]["sanitary_dump_station"~"yes|customers"](24.0,-125.0,72.0,-66.0);
    );
    out body center;
    """

    return fetch_overpass_data(query, "dump stations")

def fetch_propane_stations():
    """Fetch propane fill stations from OSM"""
    query = """
    [out:json][timeout:120];
    (
      node["fuel"="lpg"](24.0,-125.0,72.0,-66.0);
      node["fuel:lpg"="yes"](24.0,-125.0,72.0,-66.0);
      way["fuel"="lpg"](24.0,-125.0,72.0,-66.0);
    );
    out body center;
    """

    return fetch_overpass_data(query, "propane stations")

def extract_water_stations():
    """Extract water stations from existing Recreation.gov campsite data"""
    campsites_dir = Path('data/campsites')
    water_features = []

    print("Extracting water stations from Recreation.gov campsite data...")

    state_files = sorted(campsites_dir.glob('*.geojson'))
    state_files = [f for f in state_files if f.name != 'index.json']

    for state_file in state_files:
        state_code = state_file.stem.upper().replace('(1)', '').strip()

        with open(state_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        for feature in data.get('features', []):
            coords = feature.get('geometry', {}).get('coordinates', [])
            props = feature.get('properties', {})
            amenities = props.get('amenities', [])
            name = props.get('name', 'Unknown')

            if 'water' in amenities:
                water_features.append({
                    'type': 'Feature',
                    'geometry': {
                        'type': 'Point',
                        'coordinates': coords
                    },
                    'properties': {
                        'name': name,
                        'type': 'water',
                        'state': state_code,
                        'source': 'recreation.gov'
                    }
                })

    print(f"✓ Extracted {len(water_features)} water stations")
    return water_features

def osm_element_to_geojson(element, poi_type, source='openstreetmap'):
    """Convert OSM element to GeoJSON feature with proper access labeling"""
    # Get coordinates
    if element.get('type') == 'node':
        coords = [element.get('lon'), element.get('lat')]
    elif 'center' in element:
        coords = [element['center'].get('lon'), element['center'].get('lat')]
    else:
        return None

    # Get tags
    tags = element.get('tags', {})

    # Determine name
    name = tags.get('name', tags.get('operator', ''))
    if not name:
        # For campgrounds with dump stations, identify them clearly
        tourism = tags.get('tourism')
        if tourism in ['camp_site', 'caravan_site']:
            name = f"Campground with Dump Station"
        else:
            name = f'Dump Station'

    # Determine state from OSM tags (if available)
    state = tags.get('addr:state', '')

    # Access labeling (following OSM data rules)
    access_label = None
    dump_access = tags.get('sanitary_dump_station', '')
    access_tag = tags.get('access', '')

    if dump_access == 'customers':
        access_label = 'Customers only'
    elif access_tag == 'private':
        access_label = 'Private'

    # Fee labeling
    fee_label = None
    fee = tags.get('fee', '')
    if fee == 'yes':
        fee_label = 'Fee may apply'

    properties = {
        'name': name,
        'type': poi_type,
        'state': state,
        'source': source,
        'osm_id': element.get('id')
    }

    # Add optional fields only if they exist
    if access_label:
        properties['access'] = access_label
    if fee_label:
        properties['fee'] = fee_label

    # Add operator if available
    operator = tags.get('operator')
    if operator:
        properties['operator'] = operator

    return {
        'type': 'Feature',
        'geometry': {
            'type': 'Point',
            'coordinates': coords
        },
        'properties': properties
    }

def main():
    print("=" * 60)
    print("  KampTrail POI Data Updater")
    print("  Fetching from Recreation.gov + OpenStreetMap")
    print("=" * 60)
    print()

    all_features = []

    # 1. Extract water stations from Recreation.gov data
    water_stations = extract_water_stations()
    all_features.extend(water_stations)

    # 2. Fetch dump stations from OSM
    dump_elements = fetch_dump_stations()
    for element in dump_elements:
        feature = osm_element_to_geojson(element, 'dump')
        if feature:
            all_features.append(feature)

    # 3. Fetch propane stations from OSM
    propane_elements = fetch_propane_stations()
    for element in propane_elements:
        feature = osm_element_to_geojson(element, 'propane')
        if feature:
            all_features.append(feature)

    # 4. Create GeoJSON output
    output = {
        'type': 'FeatureCollection',
        'features': all_features
    }

    # 5. Save to file
    output_file = Path('data/poi_dump_water_propane.geojson')
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)

    # 6. Print summary
    print()
    print("=" * 60)
    print("  SUMMARY")
    print("=" * 60)
    water_count = len([f for f in all_features if f['properties']['type'] == 'water'])
    dump_count = len([f for f in all_features if f['properties']['type'] == 'dump'])
    propane_count = len([f for f in all_features if f['properties']['type'] == 'propane'])

    print(f"Water stations:   {water_count:5} (Recreation.gov)")
    print(f"Dump stations:    {dump_count:5} (OpenStreetMap)")
    print(f"Propane stations: {propane_count:5} (OpenStreetMap)")
    print(f"{'─' * 60}")
    print(f"TOTAL POIs:       {len(all_features):5}")
    print()
    print(f"✓ Saved to {output_file}")
    print()

if __name__ == '__main__':
    main()
