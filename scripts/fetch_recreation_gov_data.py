#!/usr/bin/env python3
"""
Fetch real campsite data from Recreation.gov RIDB API and convert to KampTrail format.

Usage:
    python3 scripts/fetch_recreation_gov_data.py --api-key YOUR_API_KEY [--state CA]

Get your free API key at: https://ridb.recreation.gov/docs
"""

import requests
import json
import argparse
import time
import re
import html
from data_integrity import valid_coordinates, save_geojson
from pathlib import Path
from typing import Dict, List, Any

# State codes and names
US_STATES = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
    'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
    'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
    'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
    'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
    'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
    'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
    'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
    'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
    'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
    'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
    'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
    'WI': 'Wisconsin', 'WY': 'Wyoming'
}

BASE_URL = "https://ridb.recreation.gov/api/v1"

class RIDBFetcher:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {'apikey': api_key}
        self.rate_limit_delay = 1.2  # 50 requests/min = 1.2s between requests

    def fetch_facilities_by_state(self, state_code: str, limit: int = 50) -> List[Dict]:
        """Fetch camping facilities for a given state."""
        facilities = []
        offset = 0

        print(f"Fetching facilities for {state_code}...")

        while True:
            url = f"{BASE_URL}/facilities"
            params = {
                'state': state_code,
                'activity': 9,  # Camping activity ID
                'limit': limit,
                'offset': offset,
                'full': 'true'
            }

            try:
                response = requests.get(url, headers=self.headers, params=params, timeout=30)
                response.raise_for_status()
                data = response.json()

                if not isinstance(data, dict) or not isinstance(data.get('RECDATA'), list):
                    raise ValueError('Invalid RIDB response; refusing partial state data')
                if not data['RECDATA']:
                    break

                batch = data['RECDATA']
                facilities.extend(batch)
                print(f"  Fetched {len(batch)} facilities (total: {len(facilities)})")

                if len(batch) < limit:
                    break

                offset += limit
                time.sleep(self.rate_limit_delay)

            except Exception as e:
                # Do not publish a partial state when a later page fails.
                raise RuntimeError(f"Incomplete RIDB fetch for {state_code}") from e

        return facilities

    def convert_to_geojson(self, facilities: List[Dict], state_code: str) -> Dict:
        """Convert RIDB facilities to KampTrail GeoJSON format."""
        features = []
        site_counter = 1

        for facility in facilities:
            try:
                coords = [float(facility['FacilityLongitude']), float(facility['FacilityLatitude'])]
            except (KeyError, TypeError, ValueError):
                continue
            if not valid_coordinates(coords) or not all(coords) or not facility.get('FacilityID'):
                continue

            # A mention of water, roads or RVs in prose is not an amenity or
            # vehicle-access claim. Preserve the source prose for the reader.
            fee_description = html.unescape(re.sub(r'<[^>]+>', ' ', facility.get('FacilityUseFeeDescription', '') or ''))
            fee_description = ' '.join(fee_description.split())
            cost = None
            fee_status = 'unknown'
            if re.fullmatch(r'(?:camping (?:is )?)?(?:free|no (?:camping )?fees?)[.!]?', fee_description, re.I):
                cost, fee_status = 0, 'free'
            else:
                match = re.fullmatch(r'\$([0-9]+(?:\.[0-9]{1,2})?)\s*(?:/\s*night|per night|nightly)[.!]?', fee_description, re.I)
                if match:
                    cost, fee_status = float(match.group(1)), 'paid'
            facility_type = (facility.get('FacilityTypeDescription') or '').lower()
            if any(word in facility_type for word in ['dispersed', 'primitive']):
                camp_type = 'dispersed'
            elif 'backcountry' in facility_type:
                camp_type = 'backcountry'
            elif any(word in facility_type for word in ['campground', 'campsite']):
                camp_type = 'established'
            else:
                camp_type = 'other'

            feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        float(facility['FacilityLongitude']),
                        float(facility['FacilityLatitude'])
                    ]
                },
                "properties": {
                    "id": f"ridb:{facility['FacilityID']}",
                    "schema_version": 3,
                    "name": facility.get('FacilityName', f'{US_STATES[state_code]} Site {site_counter}'),
                    "type": camp_type,
                    "cost": cost,
                    "fee_status": fee_status,
                    "fee_description": fee_description,
                    "field_provenance": {"cost": "FacilityUseFeeDescription" if cost is not None else "unknown",
                                         "amenities": "unknown", "rig_friendly": "unknown", "road_difficulty": "unknown"},
                    "rating": None,  # Would need separate reviews API
                    "reviews_count": 0,
                    "amenities": [],
                    "rig_friendly": [],
                    "road_difficulty": None,
                    "state": state_code,
                    "source": "recreation.gov",
                    "facility_id": facility.get('FacilityID'),
                    "description": facility.get('FacilityDescription', ''),
                    "source_url": f"https://www.recreation.gov/camping/campgrounds/{facility['FacilityID']}",
                    "source_retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                }
            }

            # Keep source field names and values on the original facility for citation.
            # An omitted field, a null, and an empty string remain distinguishable.
            for field in ('FacilityTypeDescription', 'LastUpdatedDate'):
                if field in facility:
                    feature['properties'][field] = facility[field]

            features.append(feature)
            site_counter += 1

        return {
            "type": "FeatureCollection",
            "features": features
        }


def main():
    parser = argparse.ArgumentParser(description='Fetch Recreation.gov campsite data')
    parser.add_argument('--api-key', required=True, help='RIDB API key (get from ridb.recreation.gov)')
    parser.add_argument('--state', help='Specific state code (e.g., CA, CO). If omitted, fetches all states.')
    parser.add_argument('--limit', type=int, default=50, help='API page size, 1–50 (all pages are fetched)')
    parser.add_argument('--output-dir', default='data/campsites', help='Output directory')

    args = parser.parse_args()

    if args.limit < 1:
        parser.error('--limit must be positive')
    args.limit = min(args.limit, 50)

    # Create output directory
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    fetcher = RIDBFetcher(args.api_key)

    # Determine which states to process
    states_to_fetch = [args.state.upper()] if args.state else list(US_STATES.keys())

    total_sites = 0
    state_counts = []

    for state_code in states_to_fetch:
        if state_code not in US_STATES:
            print(f"Warning: Invalid state code {state_code}, skipping...")
            continue

        print(f"\n{'='*60}")
        print(f"Processing {US_STATES[state_code]} ({state_code})")
        print(f"{'='*60}")

        # Fetch facilities
        facilities = fetcher.fetch_facilities_by_state(state_code, limit=args.limit)

        if not facilities:
            print(f"  No facilities found for {state_code}")
            continue

        # Convert to GeoJSON
        geojson = fetcher.convert_to_geojson(facilities, state_code)
        site_count = len(geojson['features'])

        if site_count == 0:
            print(f"  No valid campsites (all missing coordinates)")
            continue

        # Save to file
        output_file = output_dir / f"{state_code}.geojson"
        save_geojson(output_file, geojson)

        print(f"  ✅ Saved {site_count} campsites to {output_file}")
        total_sites += site_count
        state_counts.append({"state": state_code, "count": site_count})

    # Rebuild counts from the datasets actually used by the app, preserving
    # states untouched by this fetch. Never claim a one-state run is the total.
    state_counts = []
    for saved_file in sorted(output_dir.glob('*_merged.geojson')):
        saved_data = json.loads(saved_file.read_text(encoding='utf-8'))
        state_counts.append({"state": saved_file.stem[:2], "count": len(saved_data.get('features', []))})
    if not state_counts:
        for saved_file in sorted(output_dir.glob('[A-Z][A-Z].geojson')):
            saved_data = json.loads(saved_file.read_text(encoding='utf-8'))
            state_counts.append({"state": saved_file.stem, "count": len(saved_data.get('features', []))})
    total_sites = sum(row['count'] for row in state_counts)
    index_data = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                  "total_sites": total_sites, "states": state_counts,
                  "source": "saved-state-files", "version": "3.0"}

    index_file = output_dir / "index.json"
    with open(index_file, 'w') as f:
        json.dump(index_data, f, indent=2)

    print(f"\n{'='*60}")
    print(f"✅ COMPLETE: Fetched {total_sites} campsites from {len(state_counts)} states")
    print(f"📊 Index updated: {index_file}")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
