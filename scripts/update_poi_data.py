#!/usr/bin/env python3
"""
Update POI data by extracting water stations from all state campsite files
"""

import json
import os
from pathlib import Path

def extract_water_stations():
    """Extract water stations from all state geojson files"""
    campsites_dir = Path('data/campsites')
    poi_features = []

    # Get all state geojson files
    state_files = sorted(campsites_dir.glob('*.geojson'))
    state_files = [f for f in state_files if f.name != 'index.json' and not f.name.endswith('_merged.geojson')]

    print(f"Processing {len(state_files)} state files...")

    states_with_water = {}

    for state_file in state_files:
        state_code = state_file.stem.upper()

        try:
            with open(state_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            water_count = 0
            for feature in data.get('features', []):
                coords = feature.get('geometry', {}).get('coordinates', [])
                props = feature.get('properties', {})
                amenities = props.get('amenities', [])
                name = props.get('name', 'Unknown')

                if not coords or len(coords) < 2:
                    continue

                # Check for water amenities
                if 'water' in amenities:
                    poi_features.append({
                        'type': 'Feature',
                        'geometry': {
                            'type': 'Point',
                            'coordinates': coords
                        },
                        'properties': {
                            'name': name,
                            'type': 'water',
                            'state': state_code
                        }
                    })
                    water_count += 1

            if water_count > 0:
                states_with_water[state_code] = water_count
                print(f"  ✓ {state_code}: {water_count} water stations")

        except Exception as e:
            print(f"  ✗ {state_code}: Error - {e}")

    # Create GeoJSON output
    output = {
        'type': 'FeatureCollection',
        'features': poi_features
    }

    # Write to file
    output_file = Path('data/poi_dump_water_propane.geojson')
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)

    print(f"\n{'='*60}")
    print(f"✅ SUCCESS!")
    print(f"{'='*60}")
    print(f"Total water stations: {len(poi_features)}")
    print(f"States with water: {len(states_with_water)}")
    print(f"\nTop 10 states by water station count:")
    for state, count in sorted(states_with_water.items(), key=lambda x: x[1], reverse=True)[:10]:
        print(f"  {state}: {count}")
    print(f"\nOutput: {output_file}")
    print(f"{'='*60}")

    return len(poi_features), len(states_with_water)

if __name__ == '__main__':
    try:
        extract_water_stations()
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        exit(1)
