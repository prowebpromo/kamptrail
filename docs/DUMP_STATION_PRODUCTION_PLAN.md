# KampTrail Dump Station Production Implementation Plan

## Overview

This document outlines the production-grade implementation for dump station data in KampTrail using OpenStreetMap data, PostGIS, and a self-hosted API.

**Status**: Prototype (Overpass API) → Production (PostGIS + self-hosted extract)

---

## Current State (Prototype)

**Data Source**: OpenStreetMap Overpass API
**Coverage**: US including Alaska
**Data Types**:
- Water stations: 2,798 (Recreation.gov campsites)
- Dump stations: TBD (OpenStreetMap)
- Propane stations: TBD (OpenStreetMap)

**Limitations**:
- ❌ Overpass API rate limits and timeouts
- ❌ Shared public endpoints are brittle
- ❌ No offline capability
- ❌ No radius search capability

---

## Production Architecture

### Stack
- **Database**: PostgreSQL 14+ with PostGIS 3.3+
- **Data Pipeline**: osm2pgsql for OSM PBF import
- **API**: Python FastAPI or Node.js Express
- **Caching**: Redis with 7-day TTL
- **Update Cadence**: Weekly refresh (Mondays 2am)

### Data Flow
```
Geofabrik US Extract (PBF)
    ↓
osm2pgsql import
    ↓
PostGIS database with hstore tags
    ↓
Materialized view: us_dump_places
    ↓
GiST index on geography column
    ↓
API endpoint: /v1/dump-places/nearby
    ↓
Redis cache (lat/lng grid)
    ↓
KampTrail frontend
```

---

## Data Rules

### What to Include

#### 1. Standalone Dump Stations
**OSM Tag**: `amenity=sanitary_dump_station`

Include:
- All standalone dump stations in US bounds
- Both nodes and ways/polygons (use ST_PointOnSurface for polygons)

#### 2. Campgrounds with Dump Access
**OSM Tags**:
- `tourism=camp_site` OR `tourism=caravan_site`
- AND `sanitary_dump_station` = `yes` OR `customers`

Include:
- Campgrounds that explicitly offer dump station access
- Both public and customer-only access (labeled accordingly)

### What to Exclude
- Private residential properties (access=private without commercial tag)
- Elements with null/invalid geometry
- Duplicates (same OSM ID + type)

### Access Labeling Rules

**Do not guess or infer access**. Only use explicit OSM tags:

| OSM Tag | Label in API | UI Display |
|---------|--------------|------------|
| `sanitary_dump_station=customers` | `"Customers only"` | "🔒 Customers only" |
| `access=private` | `"Private"` | "🚫 Private" |
| `fee=yes` | `"Fee may apply"` | "💵 Fee may apply" |
| No tag | (omit field) | (no icon) |

---

## Database Schema

### 1. OSM Import (osm2pgsql)

```bash
osm2pgsql --create --database kamptrail \
  --username postgres \
  --hstore \
  --latlong \
  --slim \
  --extra-attributes \
  --output flex \
  --style kamptrail.lua \
  us-latest.osm.pbf
```

**Tables Created**:
- `planet_osm_point` - OSM nodes
- `planet_osm_polygon` - OSM ways/relations
- `planet_osm_line` - OSM lines (not used)
- `planet_osm_roads` - (not used)

### 2. Materialized View

```sql
CREATE MATERIALIZED VIEW public.us_dump_places AS
WITH
-- Standalone dump stations (nodes)
dump_points AS (
  SELECT
    'dump_station'::text AS place_type,
    'node'::text AS osm_type,
    osm_id::bigint AS osm_id,
    COALESCE(name, tags->'name') AS name,
    tags,
    way AS geom
  FROM planet_osm_point
  WHERE COALESCE(amenity, tags->'amenity') = 'sanitary_dump_station'

  UNION ALL

  -- Standalone dump stations (polygons)
  SELECT
    'dump_station'::text AS place_type,
    'polygon'::text AS osm_type,
    osm_id::bigint AS osm_id,
    COALESCE(name, tags->'name') AS name,
    tags,
    ST_PointOnSurface(way) AS geom
  FROM planet_osm_polygon
  WHERE COALESCE(amenity, tags->'amenity') = 'sanitary_dump_station'
),

-- Campgrounds with dump access (nodes)
campground_points AS (
  SELECT
    'campground'::text AS place_type,
    'point'::text AS osm_type,
    osm_id::bigint AS osm_id,
    COALESCE(name, tags->'name') AS name,
    tags,
    way AS geom
  FROM planet_osm_point
  WHERE
    COALESCE(tourism, tags->'tourism') IN ('camp_site','caravan_site')
    AND COALESCE(tags->'sanitary_dump_station','') IN ('yes','customers')

  UNION ALL

  -- Campgrounds with dump access (polygons)
  SELECT
    'campground'::text AS place_type,
    'polygon'::text AS osm_type,
    osm_id::bigint AS osm_id,
    COALESCE(name, tags->'name') AS name,
    tags,
    ST_PointOnSurface(way) AS geom
  FROM planet_osm_polygon
  WHERE
    COALESCE(tourism, tags->'tourism') IN ('camp_site','caravan_site')
    AND COALESCE(tags->'sanitary_dump_station','') IN ('yes','customers')
)

-- Combine and add geography column
SELECT
  place_type,
  osm_type,
  osm_id,
  name,
  tags,
  geom,
  geom::geography AS geog
FROM dump_points

UNION ALL

SELECT
  place_type,
  osm_type,
  osm_id,
  name,
  tags,
  geom,
  geom::geography AS geog
FROM campground_points;
```

### 3. Indexes

```sql
-- GiST index for fast radius queries
CREATE INDEX us_dump_places_geog_gix
  ON public.us_dump_places
  USING GIST (geog);

-- Index on place type for filtering
CREATE INDEX us_dump_places_type_idx
  ON public.us_dump_places (place_type);

-- Refresh weekly with concurrent option (non-blocking)
CREATE UNIQUE INDEX us_dump_places_unique_idx
  ON public.us_dump_places (osm_type, osm_id);
```

### 4. Refresh Schedule

```sql
-- Refresh weekly (Mondays 2am)
-- Run from cron or systemd timer
REFRESH MATERIALIZED VIEW CONCURRENTLY public.us_dump_places;
```

---

## API Design

### Endpoint: `/v1/dump-places/nearby`

#### Request

**Method**: `GET`

**Query Parameters**:

| Parameter | Type | Required | Default | Max | Description |
|-----------|------|----------|---------|-----|-------------|
| `lat` | float | ✅ Yes | - | - | Latitude |
| `lng` | float | ✅ Yes | - | - | Longitude |
| `radius_miles` | float | No | 20 | 50 | Search radius in miles |
| `limit` | int | No | 50 | 200 | Max results to return |
| `type` | enum | No | `all` | - | Filter: `dump_station`, `campground`, `all` |

**Example**:
```
GET /v1/dump-places/nearby?lat=40.7128&lng=-74.0060&radius_miles=20&limit=50
```

#### SQL Query

```sql
SELECT
  place_type,
  osm_type,
  osm_id,
  name,
  tags->'operator' AS operator,
  tags->'website' AS website,
  tags->'phone' AS phone,
  tags->'opening_hours' AS opening_hours,
  tags->'fee' AS fee,
  tags->'access' AS access,
  tags->'sanitary_dump_station' AS dump_access,
  ST_Y(geom) AS lat,
  ST_X(geom) AS lng,
  ST_Distance(
    geog,
    ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
  ) AS distance_meters
FROM public.us_dump_places
WHERE
  (:type = 'all' OR place_type = :type)
  AND ST_DWithin(
    geog,
    ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
    :radius_meters
  )
ORDER BY distance_meters ASC
LIMIT :limit;
```

**Radius Conversion**:
```python
radius_meters = radius_miles * 1609.344
# 20 miles = 32186.88 meters
```

#### Response

**Status**: `200 OK`

**Body**:
```json
{
  "query": {
    "lat": 40.7128,
    "lng": -74.0060,
    "radius_miles": 20,
    "type": "all"
  },
  "results": [
    {
      "place_type": "dump_station",
      "name": "Flying J Travel Plaza",
      "lat": 40.7489,
      "lng": -73.9680,
      "distance_miles": 4.2,
      "access_label": "Customers only",
      "fee_label": "Fee may apply",
      "operator": "Pilot Flying J",
      "website": "https://...",
      "phone": "+1-555-...",
      "source": "OpenStreetMap",
      "osm_url": "https://www.openstreetmap.org/node/123456"
    },
    {
      "place_type": "campground",
      "name": "Liberty Harbor RV Park",
      "lat": 40.7145,
      "lng": -74.0342,
      "distance_miles": 1.8,
      "access_label": null,
      "fee_label": null,
      "operator": null,
      "website": null,
      "phone": null,
      "source": "OpenStreetMap",
      "osm_url": "https://www.openstreetmap.org/way/789012"
    }
  ],
  "count": 2,
  "source": "OpenStreetMap",
  "license": "ODbL",
  "attribution": "© OpenStreetMap contributors"
}
```

#### Response Field Logic

**Access Label**:
```python
if tags.get('sanitary_dump_station') == 'customers':
    access_label = "Customers only"
elif tags.get('access') == 'private':
    access_label = "Private"
else:
    access_label = None  # Omit field
```

**Fee Label**:
```python
if tags.get('fee') == 'yes':
    fee_label = "Fee may apply"
else:
    fee_label = None  # Omit field
```

**Distance**:
```python
distance_miles = round(distance_meters / 1609.344, 1)
```

**OSM URL**:
```python
osm_url = f"https://www.openstreetmap.org/{osm_type}/{osm_id}"
```

---

## Caching Strategy

### Redis Key Structure

```
cache_key = f"dump_places:{lat_2}:{lng_2}:{radius_miles}:{type}"
```

**Grid Rounding**:
- `lat_2 = round(lat, 2)`
- `lng_2 = round(lng, 2)`

**Grid Size**: 0.01° ≈ 0.7 miles (fine enough for 20-mile searches)

**TTL**: 7 days (604800 seconds)

### Cache Invalidation

- **Weekly**: Flush all cache keys on Mondays at 2am (after materialized view refresh)
- **Manual**: API endpoint `/admin/cache/flush` (authenticated)

---

## Quality Assurance

### Data Validation

```sql
-- Remove null geometries
DELETE FROM us_dump_places WHERE geom IS NULL OR geog IS NULL;

-- Deduplicate exact duplicates
DELETE FROM us_dump_places a
USING us_dump_places b
WHERE a.ctid < b.ctid
  AND a.osm_type = b.osm_type
  AND a.osm_id = b.osm_id;

-- Flag potential duplicates (same site, different OSM elements)
SELECT a.name, a.place_type, b.place_type, ST_Distance(a.geog, b.geog) AS distance_m
FROM us_dump_places a
JOIN us_dump_places b ON a.name = b.name
WHERE a.osm_id != b.osm_id
  AND ST_DWithin(a.geog, b.geog, 50)  -- Within 50 meters
ORDER BY distance_m;
```

### Monitoring Metrics

- Total dump stations count (track weekly growth/decline)
- Total campgrounds with dump access count
- Average query response time (target: <100ms with cache, <500ms without)
- Cache hit rate (target: >80%)
- Failed queries count

---

## Attribution & Licensing

**Data Source**: OpenStreetMap
**License**: Open Database License (ODbL)
**Attribution Required**: Yes

### Required Attribution Text

```
Dump station data © OpenStreetMap contributors
https://www.openstreetmap.org/copyright
```

### Share-Alike Requirement

If you distribute the extracted dump station database, you must:
1. License it under ODbL
2. Provide attribution to OpenStreetMap
3. Allow others to extract and reuse the data

**KampTrail Compliance**:
- ✅ Attribution displayed in UI footer
- ✅ API responses include source and license fields
- ✅ Data available via public API (share-alike compliance)

---

## Implementation Phases

### Phase 1: Prototype (Current) - Complete ✅
- [x] Overpass API integration
- [x] Water stations from Recreation.gov
- [x] Dump stations from OSM
- [x] Propane stations from OSM
- [x] Access labeling (customers, private, fee)

### Phase 2: Production Database (2-3 weeks)
- [ ] Set up PostgreSQL + PostGIS server
- [ ] Download US OSM extract from Geofabrik
- [ ] Import with osm2pgsql
- [ ] Create materialized view
- [ ] Add GiST indexes
- [ ] Set up weekly refresh cron job

### Phase 3: API Development (1-2 weeks)
- [ ] Build FastAPI or Express.js endpoint
- [ ] Implement radius search query
- [ ] Add response formatting with access/fee labels
- [ ] Add Redis caching layer
- [ ] Add monitoring and logging

### Phase 4: Frontend Integration (1 week)
- [ ] Update overlay.js to call new API endpoint
- [ ] Add "Search nearby dump stations" UI
- [ ] Display access labels in popups
- [ ] Add OSM attribution to map footer

### Phase 5: Testing & Launch (1 week)
- [ ] Load testing (10k queries/minute target)
- [ ] QA validation of dump station data
- [ ] Monitor cache hit rates
- [ ] Deploy to production

---

## Cost Estimate

### Infrastructure (Monthly)

| Resource | Provider | Specs | Cost |
|----------|----------|-------|------|
| PostgreSQL/PostGIS | DigitalOcean | 4GB RAM, 80GB SSD | $48/mo |
| API Server | DigitalOcean | 2GB RAM | $18/mo |
| Redis Cache | DigitalOcean | 1GB | $15/mo |
| CDN/Edge Caching | Cloudflare | Free tier | $0 |
| **Total** | | | **$81/mo** |

### Alternative (Serverless)

| Resource | Provider | Specs | Cost |
|----------|----------|-------|------|
| Database | Supabase | Free tier (500MB) | $0 |
| Database (paid) | Supabase | Pro (8GB) | $25/mo |
| API Functions | Cloudflare Workers | 100k req/day | $0 |
| API Functions (paid) | Cloudflare Workers | 10M req/mo | $5/mo |
| **Total** | | | **$30/mo** |

---

## Alternative: Enhanced Prototype

If production infrastructure is too costly, enhance the Overpass prototype:

### Improvements
1. **Client-side caching**: Store OSM results in browser localStorage (7-day TTL)
2. **Regional queries**: Break US into 10 regions, cache separately
3. **Lazy loading**: Only fetch dump stations when overlay is toggled on
4. **Rate limit handling**: Exponential backoff and retry logic
5. **Fallback data**: Ship static GeoJSON dump station file as fallback

### Benefits
- $0 infrastructure cost
- No server maintenance
- Works offline (after first load)

### Limitations
- Initial load may timeout for large regions
- Dependent on Overpass API uptime
- No custom radius search (20-mile specific)

---

## Questions for Decision

1. **Budget**: Can you allocate $81/mo for production infrastructure?
2. **Timeline**: 4-6 weeks for full production vs. 1 week for enhanced prototype?
3. **Scale**: Expected user count and queries per day?
4. **Maintenance**: Who will manage weekly data refreshes and server updates?

---

## Next Steps

**Immediate** (Prototype):
1. Pull latest code from GitHub (fixed Overpass queries)
2. Run `FETCH_POI_DATA.bat`
3. Verify dump stations appear on map
4. Test access labeling in popups

**Production** (If approved):
1. Provision PostgreSQL + PostGIS server
2. Download US OSM extract
3. Follow database schema setup
4. Build API endpoint
5. Integrate with frontend

---

## Resources

- [OpenStreetMap Wiki: Sanitary Dump Station](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dsanitary_dump_station)
- [OSM Taginfo: sanitary_dump_station](https://taginfo.openstreetmap.org/keys/sanitary_dump_station)
- [Geofabrik Downloads](https://download.geofabrik.de/north-america/us.html)
- [osm2pgsql Documentation](https://osm2pgsql.org/doc/manual.html)
- [PostGIS Distance Functions](https://postgis.net/docs/ST_DWithin.html)
- [ODbL License Summary](https://opendatacommons.org/licenses/odbl/summary/)

---

**Document Version**: 1.0
**Last Updated**: 2025-12-31
**Author**: Claude (Anthropic)
**Status**: Ready for Review
