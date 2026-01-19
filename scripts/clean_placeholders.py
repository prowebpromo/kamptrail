#!/usr/bin/env python3
"""
Clean placeholder/test data from OpenStreetMap files.

Removes entries with suspicious names that appear to be test data.
"""

import json
import glob
import os

# Placeholder names to remove
PLACEHOLDER_NAMES = [
    'Staff Row',
    'Commie Row',
    'Armstrong McDonald',
    'Staff Showerhouse'
]

# Coordinates of known placeholder sites
PLACEHOLDER_COORDS = [
    [-96.5867918, 41.4314415],  # Staff Row (NE/IA)
    [-96.5860439, 41.4310916],  # Commie Row (NE/IA)
    [-96.5853365, 41.4311546],  # Armstrong McDonald (NE/IA)
    [-91.2815206, 44.057368],   # Staff Row (WI/MN)
]

def is_placeholder(feature):
    """Check if a feature is placeholder data."""
    name = feature.get('properties', {}).get('name', '')
    coords = feature.get('geometry', {}).get('coordinates', [])

    # Check by name
    if any(placeholder in str(name) for placeholder in PLACEHOLDER_NAMES):
        return True

    # Check by coordinates
    if coords and len(coords) == 2:
        for p_coords in PLACEHOLDER_COORDS:
            if abs(coords[0] - p_coords[0]) < 0.0001 and abs(coords[1] - p_coords[1]) < 0.0001:
                return True

    return False

def clean_file(filepath):
    """Remove placeholder data from a GeoJSON file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        original_count = len(data.get('features', []))

        # Filter out placeholder features
        cleaned_features = [f for f in data.get('features', []) if not is_placeholder(f)]

        removed_count = original_count - len(cleaned_features)

        if removed_count > 0:
            data['features'] = cleaned_features
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(data, f)

            return (os.path.basename(filepath), removed_count)

        return None

    except Exception as e:
        print(f"Error processing {filepath}: {e}")
        return None

def main():
    print('=' * 70)
    print('CLEANING PLACEHOLDER DATA FROM OSM FILES')
    print('=' * 70)
    print()

    files_cleaned = []
    total_removed = 0

    for filepath in glob.glob('data/opencampingmap/*.geojson'):
        result = clean_file(filepath)
        if result:
            filename, count = result
            files_cleaned.append((filename, count))
            total_removed += count
            print(f'✓ {filename}: Removed {count} placeholder entries')

    print()
    print('=' * 70)
    print('SUMMARY')
    print('=' * 70)
    print(f'Files cleaned: {len(files_cleaned)}')
    print(f'Total placeholder entries removed: {total_removed}')

    if files_cleaned:
        print()
        print('Cleaned files:')
        for filename, count in files_cleaned:
            print(f'  - {filename} ({count} removed)')

    print('=' * 70)
    print()
    print('✅ Cleanup complete!')

if __name__ == '__main__':
    main()
