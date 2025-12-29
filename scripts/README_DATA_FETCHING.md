# Fetching Real Campsite Data

This directory contains scripts to fetch real campsite data from various sources and convert them to KampTrail's GeoJSON format.

## Recreation.gov Data Fetcher

The `fetch_recreation_gov_data.py` script fetches campground data from the official Recreation.gov RIDB (Recreation Information Database) API.

### Features

- ✅ **Real campground names** from federal recreation areas
- ✅ **Accurate GPS coordinates**
- ✅ **Facility details** (amenities, cost, type)
- ✅ **Free API** (50 requests/minute limit)
- ✅ **Covers all US states**

### Getting Started

#### 1. Get Your Free API Key

1. Visit https://ridb.recreation.gov/docs
2. Click "Sign up for a free account"
3. Log in and go to your profile
4. Enable developer access to generate your API key

#### 2. Install Dependencies

```bash
pip3 install requests
```

#### 3. Fetch Data

**Fetch a single state (recommended for testing):**
```bash
python3 scripts/fetch_recreation_gov_data.py --api-key YOUR_API_KEY --state CA --limit 100
```

**Fetch multiple states:**
```bash
# Popular camping states
for state in CA CO UT AZ OR WA MT WY; do
  python3 scripts/fetch_recreation_gov_data.py --api-key YOUR_API_KEY --state $state --limit 100
  sleep 5
done
```

**Fetch ALL states (takes ~1 hour):**
```bash
python3 scripts/fetch_recreation_gov_data.py --api-key YOUR_API_KEY --limit 50
```

### Options

```
--api-key YOUR_KEY    RIDB API key (required)
--state CA            Specific state code (optional, fetches all if omitted)
--limit 50            Max facilities per state (default: 50)
--output-dir PATH     Output directory (default: data/campsites)
```

### Output Format

The script generates GeoJSON files compatible with KampTrail:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [-120.425, 37.7343]
      },
      "properties": {
        "id": "CA-001",
        "name": "Yosemite Valley Campground",
        "type": "established",
        "cost": 26,
        "rating": null,
        "reviews_count": 0,
        "amenities": ["toilets", "water", "fire_rings"],
        "rig_friendly": ["tent", "RV"],
        "road_difficulty": "paved",
        "state": "CA",
        "source": "recreation.gov",
        "facility_id": "234059",
        "description": "Located in Yosemite Valley..."
      }
    }
  ]
}
```

### Data Quality

**What the script provides:**
- ✅ Real campground names (e.g., "Joshua Tree Jumbo Rocks" instead of "California Campground 5")
- ✅ Accurate locations
- ✅ Facility type (established, dispersed, backcountry)
- ✅ Estimated cost (parsed from descriptions)
- ✅ Amenities (toilets, water, showers, etc.)
- ✅ RV/tent compatibility
- ⚠️ Ratings/reviews (not available from RIDB, would need separate API)

**Limitations:**
- Only includes federal recreation areas (NFS, NPS, BLM, etc.)
- Does not include private campgrounds
- Does not include dispersed/boondocking spots not listed officially
- Rating data not available (could integrate iOverlander or Campendium for this)

### Rate Limits

- **Recreation.gov RIDB:** 50 requests/minute
- The script automatically respects rate limits with 1.2s delays between requests

### Backup Plan: Download Full Dataset

If you hit rate limits, you can download the complete RIDB dataset:

1. Visit https://ridb.recreation.gov/download
2. Download the full facilities CSV (~100MB)
3. Convert to GeoJSON format manually

## Future Enhancements

### Add More Data Sources

To get comprehensive coverage, consider adding:

1. **iOverlander** - Dispersed/boondocking spots
   - API: https://www.ioverlander.com/
   - Provides: Dispersed camping, parking lots, wild spots
   - Free export available

2. **Campendium** - Reviews and ratings
   - Would need to scrape or request API access
   - Provides: User ratings, reviews, photos

3. **FreeRoam** - Public domain camping data
   - If/when they provide data exports
   - Focused on dispersed camping

4. **OpenStreetMap** - Community-contributed sites
   - Query Overpass API for `tourism=camp_site`
   - Free and open source

### Merge Multiple Sources

Create a script to combine data from multiple sources while de-duplicating based on GPS proximity:

```bash
python3 scripts/merge_campsite_data.py \
  --ridb data/campsites \
  --ioverlander data/ioverlander \
  --output data/campsites_merged
```

## Questions?

- RIDB API Docs: https://ridb.recreation.gov/docs
- Recreation.gov Data: https://www.recreation.gov/use-our-data
- USDA Ag Data Commons: https://data.nal.usda.gov/dataset/recreation-information-database-ridb
