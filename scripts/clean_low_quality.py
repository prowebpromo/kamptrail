#!/usr/bin/env python3
"""
Clean low-quality campsite data from all GeoJSON files.

Removes entries that are not useful to users:
- Unnamed sites or sites with generic names
- Sites with Unknown type
- Test/placeholder data
"""

import json
import glob
import os

# Placeholder keywords (case-insensitive)
PLACEHOLDER_KEYWORDS = [
    'staff row', 'commie row', 'armstrong mcdonald', 'staff showerhouse',
    'sample campsite', 'sample meadow', 'test site', 'whitestar campground',
    'placeholder', 'example', 'dummy', 'fake'
]

# Generic/unhelpful names
GENERIC_NAMES = [
    'unnamed site',
    'unnamed site (osm)',
    'unnamed campsite',
    'no name',
    'untitled',
    'unknown',
    'site',
    'campsite',
    'camping'
]

# Unhelpful types
BAD_TYPES = ['unknown', 'undefined', None, '']

def is_low_quality(feature):
    """Check if a feature is low-quality and should be removed."""
    props = feature.get('properties', {})
    name = str(props.get('name', '')).lower().strip()
    site_type = str(props.get('type', '')).lower().strip()

    # Check for placeholder keywords
    if any(keyword in name for keyword in PLACEHOLDER_KEYWORDS):
        return True

    # Check for generic/unhelpful names
    if not name or name in GENERIC_NAMES:
        return True

    # Check for unhelpful types
    if site_type in BAD_TYPES or site_type == 'unknown':
        return True

    return False

def clean_file(filepath):
    """Remove low-quality data from a GeoJSON file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        original_count = len(data.get('features', []))

        # Filter out low-quality features
        cleaned_features = [f for f in data.get('features', []) if not is_low_quality(f)]

        removed_count = original_count - len(cleaned_features)

        if removed_count > 0:
            data['features'] = cleaned_features
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(data, f)

            return (os.path.basename(filepath), removed_count, original_count)

        return None

    except Exception as e:
        print(f"Error processing {filepath}: {e}")
        return None

def main():
    print('=' * 70)
    print('REMOVING LOW-QUALITY CAMPSITE DATA')
    print('=' * 70)
    print()
    print('Removing:')
    print('  - Unnamed sites')
    print('  - Sites with Unknown type')
    print('  - Test/placeholder data')
    print()

    files_cleaned = []
    total_removed = 0

    # Scan all geojson files recursively
    for filepath in glob.glob('data/**/*.geojson', recursive=True):
        result = clean_file(filepath)
        if result:
            filename, removed, original = result
            files_cleaned.append((filepath, removed, original))
            total_removed += removed
            print(f'✓ {filepath}: Removed {removed}/{original} entries')

    print()
    print('=' * 70)
    print('SUMMARY')
    print('=' * 70)
    print(f'Files cleaned: {len(files_cleaned)}')
    print(f'Total low-quality entries removed: {total_removed}')

    if files_cleaned:
        print()
        print('Cleaned files:')
        for filepath, removed, original in files_cleaned:
            pct = (removed / original * 100) if original > 0 else 0
            print(f'  - {filepath} ({removed} removed, {pct:.1f}%)')

    print('=' * 70)
    print()

    if total_removed > 0:
        print(f'✅ Removed {total_removed} low-quality entries!')
    else:
        print('✅ No low-quality data found - database is clean!')

if __name__ == '__main__':
    main()
