#!/usr/bin/env python3
"""Refresh explicitly sourced water amenities without deleting saved dump/LPG POIs."""
import json
from pathlib import Path
from fetch_osm_poi import extract_water_stations
from data_integrity import save_geojson, valid_coordinates


def main():
    output_file = Path('data/poi_dump_water_propane.geojson')
    saved = json.loads(output_file.read_text(encoding='utf-8')) if output_file.exists() else {'features': []}
    retained = [feature for feature in saved.get('features', [])
                if feature.get('properties', {}).get('type') != 'water'
                and valid_coordinates(feature.get('geometry', {}).get('coordinates'))]
    water = extract_water_stations()
    if not water:
        raise RuntimeError('No explicitly sourced water amenities found; saved POI file unchanged')
    save_geojson(output_file, {'type': 'FeatureCollection', 'features': retained + water})
    print(f'Saved {len(water)} water amenities and retained {len(retained)} other services')


if __name__ == '__main__':
    main()
