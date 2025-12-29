#!/usr/bin/env python3
"""
Fetch campsite data from Campflare API and convert to KampTrail format.

Usage:
    python3 scripts/fetch_campflare_data.py --api-key YOUR_API_KEY [--state CA]

Get your free API key at: https://campflare.com/api
"""

import requests
import json
import argparse
import time
from pathlib import Path
from typing import Dict, List, Any

# State codes
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

BASE_URL = "https://api.campflare.com/v1"

class CampflareFetcher:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {
            'accept': 'application/json',
            'authorization': api_key
        }

    def test_connection(self) -> bool:
        """Test API key with ping endpoint."""
        try:
            response = requests.get(f"{BASE_URL}/ping", headers=self.headers, timeout=10)
            if response.status_code == 200:
                data = response.json()
                if data.get('ping') == 'pong':
                    print("✅ API key validated successfully")
                    return True
            elif response.status_code == 401:
                print("❌ API key is invalid or unauthorized")
                return False
            else:
                print(f"⚠️ Unexpected response: {response.status_code}")
                return False
        except Exception as e:
            print(f"❌ Connection test failed: {e}")
            return False

    def fetch_campgrounds_by_state(self, state_code: str) -> List[Dict]:
        """
        Fetch campgrounds for a given state.

        Note: The exact endpoint may vary. Common patterns:
        - /campgrounds?state=CA
        - /search?state=CA
        - /campgrounds/state/CA

        Adjust based on Campflare's actual API documentation.
        """
        campgrounds = []

        # Try common endpoint patterns
        endpoints_to_try = [
            f"/campgrounds?state={state_code}",
            f"/search?state={state_code}",
            f"/campgrounds/state/{state_code}",
            f"/campground?state={state_code}",
        ]

        for endpoint in endpoints_to_try:
            try:
                url = f"{BASE_URL}{endpoint}"
                print(f"  Trying: {endpoint}")

                response = requests.get(url, headers=self.headers, timeout=30)

                if response.status_code == 200:
                    data = response.json()

                    # Handle different response structures
                    if isinstance(data, list):
                        campgrounds = data
                    elif isinstance(data, dict):
                        # Try common keys
                        campgrounds = (data.get('campgrounds') or
                                     data.get('results') or
                                     data.get('data') or
                                     data.get('items') or [])

                    if campgrounds:
                        print(f"  ✅ Found {len(campgrounds)} campgrounds")
                        return campgrounds

                elif response.status_code == 404:
                    continue  # Try next endpoint
                elif response.status_code == 401:
                    print(f"  ❌ Unauthorized - check API key")
                    return []
                else:
                    print(f"  ⚠️ HTTP {response.status_code}: {response.text[:100]}")

            except Exception as e:
                print(f"  Error: {e}")
                continue

        print(f"  ⚠️ Could not find working endpoint for {state_code}")
        print(f"  📚 Check Campflare API docs at https://campflare.com/api")
        return []

    def convert_to_geojson(self, campgrounds: List[Dict], state_code: str) -> Dict:
        """Convert Campflare data to KampTrail GeoJSON format."""
        features = []
        site_counter = 1

        for camp in campgrounds:
            # Extract coordinates (adjust field names based on actual API response)
            lat = camp.get('latitude') or camp.get('lat') or camp.get('coords', {}).get('lat')
            lon = camp.get('longitude') or camp.get('lon') or camp.get('lng') or camp.get('coords', {}).get('lon')

            if not lat or not lon:
                continue

            # Extract campground details
            name = camp.get('name') or camp.get('title') or f"{US_STATES[state_code]} Site {site_counter}"

            # Determine type
            camp_type = 'established'
            type_field = (camp.get('type') or camp.get('campgroundType') or '').lower()
            if 'dispersed' in type_field or 'primitive' in type_field:
                camp_type = 'dispersed'
            elif 'backcountry' in type_field:
                camp_type = 'backcountry'

            # Cost
            cost = 0
            if 'cost' in camp or 'price' in camp or 'fee' in camp:
                cost_val = camp.get('cost') or camp.get('price') or camp.get('fee')
                if isinstance(cost_val, (int, float)):
                    cost = int(cost_val)
                elif cost_val and '$' in str(cost_val):
                    import re
                    match = re.search(r'\$?(\d+)', str(cost_val))
                    if match:
                        cost = int(match.group(1))

            # Amenities
            amenities = []
            amenities_raw = camp.get('amenities') or camp.get('facilities') or []
            if isinstance(amenities_raw, list):
                for a in amenities_raw:
                    a_lower = str(a).lower()
                    if 'toilet' in a_lower or 'restroom' in a_lower:
                        amenities.append('toilets')
                    elif 'water' in a_lower:
                        amenities.append('water')
                    elif 'shower' in a_lower:
                        amenities.append('showers')
                    elif 'fire' in a_lower:
                        amenities.append('fire_rings')

            # RV/tent friendly
            rig_friendly = []
            desc = str(camp.get('description') or '').lower()
            if 'tent' in desc:
                rig_friendly.append('tent')
            if 'rv' in desc or 'trailer' in desc:
                rig_friendly.append('RV')
                rig_friendly.append('trailer')

            feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(lon), float(lat)]
                },
                "properties": {
                    "id": f"{state_code}-{site_counter:03d}",
                    "name": name,
                    "type": camp_type,
                    "cost": cost,
                    "rating": camp.get('rating'),
                    "reviews_count": camp.get('reviewCount') or camp.get('reviews_count') or 0,
                    "amenities": list(set(amenities)),  # Remove duplicates
                    "rig_friendly": list(set(rig_friendly)),
                    "road_difficulty": "paved",  # Default
                    "state": state_code,
                    "source": "campflare",
                    "campflare_id": camp.get('id') or camp.get('campgroundId'),
                    "description": str(camp.get('description') or '')[:200]
                }
            }

            features.append(feature)
            site_counter += 1

        return {
            "type": "FeatureCollection",
            "features": features
        }


def main():
    parser = argparse.ArgumentParser(description='Fetch Campflare campsite data')
    parser.add_argument('--api-key', required=True, help='Campflare API key (get from campflare.com/api)')
    parser.add_argument('--state', help='Specific state code (e.g., CA, CO). If omitted, fetches all states.')
    parser.add_argument('--output-dir', default='data/campsites', help='Output directory')

    args = parser.parse_args()

    # Create output directory
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    fetcher = CampflareFetcher(args.api_key)

    # Test connection
    print("Testing API connection...")
    if not fetcher.test_connection():
        print("\n❌ API connection failed. Please check your API key.")
        print("Get a free API key at: https://campflare.com/api")
        return

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

        # Fetch campgrounds
        campgrounds = fetcher.fetch_campgrounds_by_state(state_code)

        if not campgrounds:
            print(f"  No campgrounds found for {state_code}")
            continue

        # Convert to GeoJSON
        geojson = fetcher.convert_to_geojson(campgrounds, state_code)
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

        time.sleep(0.5)  # Be nice to the API

    # Update index.json
    index_data = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_sites": total_sites,
        "states": state_counts,
        "source": "campflare",
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
