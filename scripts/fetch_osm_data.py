
import requests
import json
import os
import argparse
import time

STATE_BOUNDS = {
    'AL': '30.2,-88.5,35.0,-84.9', 'AK': '51.2,-179.1,71.4,-129.9', 'AZ': '31.3,-114.8,37.0,-109.0',
    'AR': '33.0,-94.6,36.5,-89.6', 'CA': '32.5,-124.4,42.0,-114.1', 'CO': '37.0,-109.1,41.0,-102.0',
    'CT': '41.0,-73.7,42.1,-71.8', 'DE': '38.5,-75.8,39.8,-75.0', 'FL': '24.5,-87.6,31.0,-79.9',
    'GA': '30.4,-85.6,35.0,-80.8', 'HI': '18.9,-160.2,22.2,-154.8', 'ID': '42.0,-117.2,49.0,-111.0',
    'IL': '37.0,-91.5,42.5,-87.5', 'IN': '37.8,-88.1,41.8,-84.8', 'IA': '40.4,-96.6,43.5,-90.1',
    'KS': '37.0,-102.1,40.0,-94.6', 'KY': '36.5,-89.6,39.1,-81.9', 'LA': '29.0,-94.0,33.0,-89.0',
    'ME': '43.1,-71.1,47.5,-66.9', 'MD': '37.9,-79.5,39.7,-75.0', 'MA': '41.2,-73.5,42.9,-69.9',
    'MI': '41.7,-90.4,48.3,-82.4', 'MN': '43.5,-97.2,49.4,-89.5', 'MS': '30.2,-91.7,35.0,-88.1',
    'MO': '36.0,-95.8,40.6,-89.1', 'MT': '45.0,-116.1,49.0,-104.0', 'NE': '40.0,-104.1,43.0,-95.3',
    'NV': '35.0,-120.0,42.0,-114.0', 'NH': '42.7,-72.6,45.3,-70.6', 'NJ': '38.9,-75.6,41.4,-73.9',
    'NM': '31.3,-109.1,37.0,-103.0', 'NY': '40.5,-79.8,45.0,-71.9', 'NC': '33.8,-84.3,36.6,-75.5',
    'ND': '45.9,-104.1,49.0,-96.6', 'OH': '38.4,-84.8,42.3,-80.5', 'OK': '33.6,-103.0,37.0,-94.4',
    'OR': '42.0,-124.6,46.3,-116.5', 'PA': '39.7,-80.5,42.3,-74.7', 'RI': '41.1,-71.9,42.0,-71.1',
    'SC': '32.0,-83.4,35.2,-78.5', 'SD': '42.5,-104.1,45.9,-96.4', 'TN': '35.0,-90.3,36.7,-81.6',
    'TX': '25.8,-106.6,36.5,-93.5', 'UT': '37.0,-114.1,42.0,-109.0', 'VT': '42.7,-73.4,45.0,-71.5',
    'VA': '36.5,-83.7,39.5,-75.2', 'WA': '45.5,-124.8,49.0,-116.9', 'WV': '37.2,-82.6,40.6,-77.7',
    'WI': '42.5,-92.9,47.1,-86.2', 'WY': '41.0,-111.1,45.0,-104.1'
}

def fetch_osm_data(state_code):
    """Fetches campsite data for a state from the Overpass API."""
    if state_code.upper() not in STATE_BOUNDS:
        print(f"Error: State code '{state_code}' not found.")
        return None

    bbox = STATE_BOUNDS[state_code.upper()]
    query = f"""
        [out:json][timeout:60];
        (
          node["tourism"~"camp_site|caravan_site"]({bbox});
          way["tourism"~"camp_site|caravan_site"]({bbox});
          relation["tourism"~"camp_site|caravan_site"]({bbox});
        );
        out center;
    """

    url = "https://overpass-api.de/api/interpreter"
    print(f"Fetching data for {state_code.upper()}...")
    try:
        response = requests.get(url, params={'data': query})
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching data for {state_code.upper()}: {e}")
        return None

def osm_to_geojson(osm_data):
    """Converts OSM JSON data to GeoJSON format."""
    features = []
    for element in osm_data.get('elements', []):
        if 'type' not in element: continue

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
    parser = argparse.ArgumentParser(description='Fetch OpenStreetMap campsite data.')
    parser.add_argument('--state', required=True, help='State code (e.g., CA, CO, WY).')
    args = parser.parse_args()

    state_code = args.state.upper()

    # Fetch data
    osm_data = fetch_osm_data(state_code)
    if not osm_data:
        return

    # Convert to GeoJSON
    geojson_data = osm_to_geojson(osm_data)

    # Create directory and save file
    output_dir = os.path.join('data', 'opencampingmap')
    os.makedirs(output_dir, exist_ok=True)

    output_path = os.path.join(output_dir, f'{state_code}.geojson')
    with open(output_path, 'w') as f:
        json.dump(geojson_data, f)

    print(f"✅ Successfully saved {len(geojson_data['features'])} campsites to {output_path}")

if __name__ == '__main__':
    main()
