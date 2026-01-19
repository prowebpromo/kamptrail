#!/usr/bin/env python3
"""
Targeted script to fetch Florida OSM data with extended timeout.
Florida is a large state and requires more time than the standard 60s timeout.
"""

import requests
import json
import os

def fetch_florida_osm():
    """Fetches campsite data for Florida with extended timeout."""
    # Florida bounds
    bbox = '24.5,-87.6,31.0,-79.9'

    # Extended timeout for large state
    query = f"""
        [out:json][timeout:180];
        (
          node["tourism"~"camp_site|caravan_site"]({bbox});
          way["tourism"~"camp_site|caravan_site"]({bbox});
          relation["tourism"~"camp_site|caravan_site"]({bbox});
        );
        out center;
    """

    # Try multiple Overpass API mirrors
    mirrors = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.openstreetmap.ru/api/interpreter"
    ]

    for mirror in mirrors:
        print(f"Trying {mirror}...")
        try:
            response = requests.get(mirror, params={'data': query}, timeout=200)
            response.raise_for_status()
            osm_data = response.json()
            print(f"✅ Successfully fetched data from {mirror}")
            return osm_data
        except requests.exceptions.RequestException as e:
            print(f"⚠️ Failed with {mirror}: {e}")
            continue

    print("❌ All mirrors failed")
    return None

def osm_to_geojson(osm_data):
    """Converts OSM JSON data to GeoJSON format."""
    features = []
    for element in osm_data.get('elements', []):
        if 'type' not in element:
            continue

        geom_type = None
        coords = []

        if element['type'] == 'node':
            geom_type = 'Point'
            coords = [element.get('lon', 0), element.get('lat', 0)]
        elif element['type'] in ['way', 'relation'] and 'center' in element:
            geom_type = 'Point'
            coords = [element['center'].get('lon', 0), element['center'].get('lat', 0)]

        if not geom_type or not all(coords):
            continue

        feature = {
            'type': 'Feature',
            'geometry': {
                'type': geom_type,
                'coordinates': coords
            },
            'properties': element.get('tags', {})
        }
        feature['properties']['osm_id'] = element.get('id')
        features.append(feature)

    return {
        'type': 'FeatureCollection',
        'features': features
    }

def main():
    print("=" * 60)
    print("Fetching Florida OSM campsite data with extended timeout")
    print("=" * 60)

    # Fetch data
    osm_data = fetch_florida_osm()
    if not osm_data:
        print("❌ Failed to fetch Florida data")
        exit(1)

    # Convert to GeoJSON
    geojson_data = osm_to_geojson(osm_data)

    # Create directory and save file
    output_dir = os.path.join('data', 'opencampingmap')
    os.makedirs(output_dir, exist_ok=True)

    output_path = os.path.join(output_dir, 'FL.geojson')
    with open(output_path, 'w') as f:
        json.dump(geojson_data, f)

    campsite_count = len(geojson_data['features'])
    print(f"✅ Successfully saved {campsite_count} campsites to {output_path}")
    print(f"📊 Florida campsite count: {campsite_count}")

    return 0

if __name__ == '__main__':
    exit(main())
