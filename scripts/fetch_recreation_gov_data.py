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

                if 'RECDATA' not in data or not data['RECDATA']:
                    break

                batch = data['RECDATA']
                facilities.extend(batch)
                print(f"  Fetched {len(batch)} facilities (total: {len(facilities)})")

                if len(batch) < limit:
                    break

                offset += limit
                time.sleep(self.rate_limit_delay)

            except Exception as e:
                print(f"  Error fetching facilities: {e}")
                break

        return facilities

    def convert_to_geojson(self, facilities: List[Dict], state_code: str) -> Dict:
        """Convert RIDB facilities to KampTrail GeoJSON format."""
        features = []
        site_counter = 1

        for facility in facilities:
            # Skip facilities without coordinates
            if not facility.get('FacilityLatitude') or not facility.get('FacilityLongitude'):
                continue

            # Determine cost
            cost = 0
            if facility.get('FacilityUseFeeDescription'):
                # Try to parse cost from description
                desc = facility['FacilityUseFeeDescription'].lower()
                if 'free' in desc:
                    cost = 0
                elif '$' in desc:
                    # Try to extract a number
                    import re
                    match = re.search(r'\$(\d+)', desc)
                    if match:
                        cost = int(match.group(1))
                    else:
                        cost = 15  # Default estimate
                else:
                    cost = 15  # Default estimate if description exists

            # Determine campsite type
            facility_type = facility.get('FacilityTypeDescription', '').lower()
            if 'campground' in facility_type or 'campsite' in facility_type:
                camp_type = 'established'
            elif 'dispersed' in facility_type or 'primitive' in facility_type:
                camp_type = 'dispersed'
            elif 'backcountry' in facility_type:
                camp_type = 'backcountry'
            else:
                camp_type = 'established'

            # Build amenities list
            amenities = []
            desc_lower = facility.get('FacilityDescription', '').lower()
            if 'toilet' in desc_lower or 'restroom' in desc_lower:
                amenities.append('toilets')
            if 'water' in desc_lower or 'potable' in desc_lower:
                amenities.append('water')
            if 'shower' in desc_lower:
                amenities.append('showers')
            if 'fire' in desc_lower:
                amenities.append('fire_rings')
            if 'picnic' in desc_lower or 'table' in desc_lower:
                amenities.append('picnic_tables')
            if 'trash' in desc_lower or 'garbage' in desc_lower:
                amenities.append('trash')

            # Determine rig friendly
            rig_friendly = []
            if 'tent' in desc_lower:
                rig_friendly.append('tent')
            if 'rv' in desc_lower or 'trailer' in desc_lower:
                rig_friendly.append('RV')
                rig_friendly.append('trailer')

            # Road difficulty (estimate)
            road = 'paved'
            if 'unpaved' in desc_lower or 'dirt' in desc_lower or 'gravel' in desc_lower:
                road = 'dirt' if 'dirt' in desc_lower else 'gravel'

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
                    "id": f"{state_code}-{site_counter:03d}",
                    "name": facility.get('FacilityName', f'{US_STATES[state_code]} Site {site_counter}'),
                    "type": camp_type,
                    "cost": cost,
                    "rating": None,  # Would need separate reviews API
                    "reviews_count": 0,
                    "amenities": amenities,
                    "rig_friendly": rig_friendly,
                    "road_difficulty": road,
                    "state": state_code,
                    "source": "recreation.gov",
                    "facility_id": facility.get('FacilityID'),
                    "description": facility.get('FacilityDescription', '')[:200]  # Truncate
                }
            }

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
    parser.add_argument('--limit', type=int, default=50, help='Max sites per state (default: 50)')
    parser.add_argument('--output-dir', default='data/campsites', help='Output directory')

    args = parser.parse_args()

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
        with open(output_file, 'w') as f:
            json.dump(geojson, f, indent=2)

        print(f"  ✅ Saved {site_count} campsites to {output_file}")
        total_sites += site_count
        state_counts.append({"state": state_code, "count": site_count})

    # Update index.json
    index_data = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_sites": total_sites,
        "states": state_counts,
        "source": "recreation.gov",
        "version": "2.0"
    }

    index_file = output_dir / "index.json"
    with open(index_file, 'w') as f:
        json.dump(index_data, f, indent=2)

    print(f"\n{'='*60}")
    print(f"✅ COMPLETE: Fetched {total_sites} campsites from {len(state_counts)} states")
    print(f"📊 Index updated: {index_file}")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
