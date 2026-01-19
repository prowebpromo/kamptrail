#!/usr/bin/env python3
"""
Comprehensive Campsite Database Audit Script
Checks for:
- All 50 states coverage (Recreation.gov and OSM)
- Placeholder or test data
- Data quality issues
- Missing or empty files
"""

import json
import os
import sys
from pathlib import Path
from collections import defaultdict

# All 50 US states
ALL_STATES = [
    'AK', 'AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'IA', 'ID', 'IL', 'IN', 'KS', 'KY', 'LA', 'MA', 'MD',
    'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH',
    'NJ', 'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
]

# Placeholder keywords to detect test data
PLACEHOLDER_KEYWORDS = [
    'test', 'placeholder', 'example', 'sample', 'fake', 'dummy',
    'lorem ipsum', 'todo', 'tbd', 'xxx', 'zzz'
]

def check_file_for_placeholders(filepath):
    """Check if a file contains placeholder data"""
    issues = []

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        if not isinstance(data, dict) or 'features' not in data:
            issues.append(f"Invalid GeoJSON structure in {filepath}")
            return issues

        features = data.get('features', [])

        # Check for empty files
        if len(features) == 0:
            issues.append(f"EMPTY FILE: {filepath} has 0 features")
            return issues

        # Check for placeholder content
        for idx, feature in enumerate(features[:5]):  # Check first 5 features
            props = feature.get('properties', {})
            name = props.get('name', '').lower()
            desc = str(props.get('description', '')).lower()

            for keyword in PLACEHOLDER_KEYWORDS:
                if keyword in name or keyword in desc:
                    issues.append(f"PLACEHOLDER DETECTED in {filepath}, feature {idx}: name='{props.get('name')}'")

        # Check for valid coordinates
        for idx, feature in enumerate(features[:10]):
            coords = feature.get('geometry', {}).get('coordinates', [])
            if not coords or len(coords) != 2:
                issues.append(f"INVALID COORDINATES in {filepath}, feature {idx}")
            elif not (-180 <= coords[0] <= 180 and -90 <= coords[1] <= 90):
                issues.append(f"OUT OF RANGE COORDINATES in {filepath}, feature {idx}: {coords}")

    except json.JSONDecodeError as e:
        issues.append(f"JSON PARSE ERROR in {filepath}: {e}")
    except Exception as e:
        issues.append(f"ERROR reading {filepath}: {e}")

    return issues

def get_file_stats(filepath):
    """Get statistics about a GeoJSON file"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        features = data.get('features', [])
        sources = set()

        for feature in features:
            source = feature.get('properties', {}).get('source', 'unknown')
            sources.add(source)

        return {
            'count': len(features),
            'sources': list(sources),
            'size_kb': os.path.getsize(filepath) / 1024
        }
    except:
        return {'count': 0, 'sources': [], 'size_kb': 0}

def main():
    base_dir = Path(__file__).parent.parent
    campsites_dir = base_dir / 'data' / 'campsites'
    osm_dir = base_dir / 'data' / 'opencampingmap'

    print("=" * 80)
    print("KAMPTRAIL CAMPSITE DATABASE AUDIT")
    print("=" * 80)

    # Track state coverage
    rec_gov_states = set()
    osm_states = set()

    print("\n1. RECREATION.GOV DATA AUDIT")
    print("-" * 80)

    rec_gov_total = 0
    rec_gov_issues = []

    for state in ALL_STATES:
        # Check for files with various naming patterns
        found = False
        for pattern in [f"{state}.geojson", f"{state}(1).geojson", f"{state}_merged.geojson"]:
            filepath = campsites_dir / pattern
            if filepath.exists():
                found = True
                rec_gov_states.add(state)
                stats = get_file_stats(filepath)
                rec_gov_total += stats['count']

                print(f"  ✓ {state:2s}: {stats['count']:4d} sites ({stats['size_kb']:7.1f} KB) - {', '.join(stats['sources'])}")

                # Check for issues
                issues = check_file_for_placeholders(filepath)
                if issues:
                    rec_gov_issues.extend(issues)

                break  # Use first found file

        if not found:
            print(f"  ✗ {state:2s}: MISSING")

    print(f"\nRecreation.gov Summary:")
    print(f"  States with data: {len(rec_gov_states)}/50")
    print(f"  Total campsites: {rec_gov_total:,}")
    print(f"  Missing states: {', '.join(sorted(set(ALL_STATES) - rec_gov_states))}")

    print("\n2. OPENSTREETMAP DATA AUDIT")
    print("-" * 80)

    osm_total = 0
    osm_issues = []

    for state in ALL_STATES:
        filepath = osm_dir / f"{state}.geojson"
        if filepath.exists():
            osm_states.add(state)
            stats = get_file_stats(filepath)
            osm_total += stats['count']

            print(f"  ✓ {state:2s}: {stats['count']:4d} sites ({stats['size_kb']:7.1f} KB)")

            # Check for issues
            issues = check_file_for_placeholders(filepath)
            if issues:
                osm_issues.extend(issues)
        else:
            print(f"  ✗ {state:2s}: MISSING")

    print(f"\nOpenStreetMap Summary:")
    print(f"  States with data: {len(osm_states)}/50")
    print(f"  Total campsites: {osm_total:,}")
    print(f"  Missing states: {', '.join(sorted(set(ALL_STATES) - osm_states))}")

    print("\n3. DATA QUALITY ISSUES")
    print("-" * 80)

    all_issues = rec_gov_issues + osm_issues

    if all_issues:
        print(f"Found {len(all_issues)} issues:")
        for issue in all_issues:
            print(f"  ⚠ {issue}")
    else:
        print("  ✓ No placeholder or quality issues detected!")

    print("\n4. COVERAGE ANALYSIS")
    print("-" * 80)

    both_sources = rec_gov_states & osm_states
    only_rec_gov = rec_gov_states - osm_states
    only_osm = osm_states - rec_gov_states
    neither = set(ALL_STATES) - rec_gov_states - osm_states

    print(f"  States with BOTH sources: {len(both_sources)}/50")
    print(f"    {', '.join(sorted(both_sources))}")
    print(f"\n  States with ONLY Recreation.gov: {len(only_rec_gov)}")
    print(f"    {', '.join(sorted(only_rec_gov))}")
    print(f"\n  States with ONLY OSM: {len(only_osm)}")
    print(f"    {', '.join(sorted(only_osm))}")
    print(f"\n  States with NO data: {len(neither)}")
    if neither:
        print(f"    {', '.join(sorted(neither))}")
    else:
        print(f"    None - Full coverage achieved!")

    print("\n5. RECOMMENDATIONS")
    print("-" * 80)

    missing_rec_gov = set(ALL_STATES) - rec_gov_states
    missing_osm = set(ALL_STATES) - osm_states

    if missing_rec_gov:
        print(f"  → Fetch Recreation.gov data for {len(missing_rec_gov)} missing states:")
        print(f"    {', '.join(sorted(missing_rec_gov))}")

    if missing_osm:
        print(f"\n  → Fetch OpenStreetMap data for {len(missing_osm)} missing states:")
        print(f"    {', '.join(sorted(missing_osm))}")

    if len(all_issues) > 0:
        print(f"\n  → Fix {len(all_issues)} data quality issues listed above")

    if not missing_rec_gov and not missing_osm and len(all_issues) == 0:
        print("  ✓ Database is complete with all 50 states and no issues!")
        print("  ✓ Ready for 100% deployment!")

    print("\n" + "=" * 80)

    # Exit code based on completeness
    if missing_rec_gov or missing_osm or all_issues:
        sys.exit(1)
    else:
        sys.exit(0)

if __name__ == '__main__':
    main()
