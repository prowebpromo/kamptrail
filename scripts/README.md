# KampTrail Data Integration Scripts

This directory contains scripts for fetching real campsite data from official sources.

## Quick Start

### 1. Get an API Key

Get a free RIDB API key:
1. Visit https://ridb.recreation.gov/docs
2. Sign in or create an account
3. Click your name in the top right → API Keys
4. Copy your API key

### 2. Set Up Environment

```bash
export RIDB_API_KEY="your-api-key-here"
```

### 3. Fetch Data

**Test with a few states (recommended first):**
```bash
node scripts/fetch-ridb-data-sample.js
```

**Fetch all 50 states (takes 30+ minutes):**
```bash
node scripts/fetch-ridb-data.js
```

## Scripts

### `fetch-ridb-data.js`
Fetches campsite data from the Recreation Information Database (RIDB) for all 50 states.

**Data Sources:**
- USFS (US Forest Service)
- NPS (National Park Service)
- BLM (Bureau of Land Management)
- Army Corps of Engineers
- Other federal agencies

**Rate Limits:**
- 50 requests per minute
- Script automatically handles rate limiting
- Full data fetch takes 30-60 minutes

**Output:**
- 50 state GeoJSON files (`data/campsites/XX.geojson`)
- Updated index file (`data/campsites/index.json`)

### `fetch-ridb-data-sample.js`
Fetches data for a small sample of states for testing (CA, CO, UT, AZ, WA, OR, MT, WY).

**Use this for:**
- Testing the integration
- Development
- Quick data updates

## Data Schema

Each campsite in the GeoJSON files has these properties:

```json
{
  "id": "CA-RIDB-12345",
  "name": "Campsite Name",
  "facility": "Parent Campground/Facility Name",
  "type": "established|dispersed|backcountry",
  "cost": 25,
  "rating": null,
  "reviews_count": 0,
  "amenities": ["toilets", "water", "accessible"],
  "rig_friendly": ["RV", "trailer"],
  "road_difficulty": null,
  "max_length": 32,
  "reservable": true,
  "state": "CA",
  "source": "RIDB",
  "ridb_facility_id": 12345,
  "ridb_campsite_id": 67890
}
```

## Limitations of RIDB Data

The RIDB API provides official federal campsite data, but has some limitations:

1. **Only Federal Sites**: RIDB only includes federal campsites (USFS, NPS, BLM, etc.). State parks and private campgrounds are not included.

2. **Incomplete Coordinates**: Some facilities may not have accurate lat/long coordinates. The script skips these.

3. **Limited Metadata**: RIDB doesn't include:
   - User ratings/reviews
   - Road difficulty
   - Detailed amenity lists
   - Photos

4. **No Dispersed Camping**: Most truly dispersed/boondocking sites are not in RIDB.

## Future Enhancements

To get more comprehensive data, consider adding:

1. **OpenStreetMap Integration**: Community-contributed dispersed camping sites
2. **State Park APIs**: Some states offer APIs for state park data
3. **User Submissions**: Allow users to contribute sites
4. **Data Enrichment**: Combine RIDB data with other sources for ratings, photos, etc.

## Troubleshooting

### "API key not set" error
Make sure you've exported the environment variable:
```bash
export RIDB_API_KEY="your-key-here"
echo $RIDB_API_KEY  # Should print your key
```

### Rate limit errors
The script has built-in rate limiting, but if you still hit limits:
- Increase `RATE_LIMIT_DELAY` in the script (default: 1200ms)
- Try again later

### No campsites found for a state
Some states may have very few federal campsites in RIDB. This is normal for states with mostly state/private campgrounds.

## Resources

- [RIDB API Documentation](https://ridb.recreation.gov/docs)
- [RIDB Official Portal](https://ridb.recreation.gov/)
- [Recreation.gov Data Usage](https://www.recreation.gov/use-our-data)
- [USDA Forest Service Open Data](https://data.fs.usda.gov/geodata/edw/datasets.php)
