# 🗺️ Public Data Sources Roadmap

This document outlines available public APIs and data sources to enhance KampTrail with additional camping, weather, terrain, and outdoor recreation information.

---

## ✅ Currently Integrated

- **Recreation.gov RIDB API** - 2,600+ campsites across 14 states
- **OpenStreetMap** - Dump stations, propane, water POIs
- **OpenCelliD** - Cell tower coverage data
- **ESRI USA Protected Areas** - Public lands overlay

---

## 🚀 Priority 1: High Value, Easy Integration (0-2 weeks)

### 1. National Park Service (NPS) Data API
**Value:** Official campground data for all US National Parks
**Effort:** Low (similar to Recreation.gov integration)
**API:** Free with key registration

**Implementation:**
- Register for API key at https://www.nps.gov/subjects/digital/nps-data-api.htm
- Fetch campground location, contact, hours, amenities, fees, accessibility
- Merge with existing Recreation.gov data
- Add ~500-1,000 additional campsites

**Data Fields:**
- Campground name, description, location
- Site amenities, fees, accessibility info
- Operating hours, contact information
- Reservation links

---

### 2. Open Camping Map (OpenStreetMap)
**Value:** Community-contributed campground data worldwide
**Effort:** Low (OSM data, hourly updates)
**API:** Free (OpenStreetMap based)

**Implementation:**
- Query OSM Overpass API for campground nodes/ways
- Filter for `tourism=camp_site`, `tourism=caravan_site`
- Add community ratings and descriptions
- Potential for 10,000+ additional sites globally

**Data Fields:**
- Campground type, capacity, facilities
- Community descriptions and notes
- Opening hours, contact info
- Photos (via Wikimedia Commons)

**Website:** https://opencampingmap.org/en/

---

### 3. National Weather Service (NWS) API
**Value:** Free, real-time weather forecasts for any location
**Effort:** Low-Medium (simple REST API)
**API:** Free, no key required

**Implementation:**
- Add weather icon to campsite popups
- Show 7-day forecast on click
- Display temperature, precipitation, wind
- Fire weather warnings

**Data Fields:**
- Current conditions, 7-day forecast
- Severe weather alerts
- Fire weather warnings
- Temperature, precipitation, wind

**API Docs:** https://www.weather.gov/documentation/services-web-api

---

### 4. USGS Fire Danger Forecast
**Value:** Critical safety info for campers
**Effort:** Low (raster overlay or point query)
**API:** Free (USGS public data)

**Implementation:**
- Display fire danger rating in campsite popups
- Color-code campsites by fire risk (green/yellow/orange/red)
- Show current fire perimeters on map
- 7-day fire danger forecast

**Data Fields:**
- Fire danger rating (low/moderate/high/very high/extreme)
- Active fire locations
- Fire weather warnings
- Forecast fire activity

**API Info:** https://www.usgs.gov/fire-danger-forecast

---

## 🎯 Priority 2: High Value, Moderate Effort (2-6 weeks)

### 5. OpenTopography Elevation API
**Value:** Show elevation, terrain difficulty, sunrise/sunset
**Effort:** Medium (API key, rate limits: 100-300 calls/day)
**API:** Free with account

**Implementation:**
- Display elevation in campsite popups
- Calculate sunrise/sunset times
- Show terrain difficulty (slope analysis)
- Add elevation profile for multi-stop trips

**Data Sources:**
- USGS 3DEP DEM (1-meter resolution)
- SRTM (30-meter global)
- ALOS World 3D

**API Docs:** https://opentopography.org/developers

**Rate Limits:**
- 300 calls/day (academic)
- 100 calls/day (non-academic)

---

### 6. iNaturalist Wildlife Observations API
**Value:** Show recent wildlife sightings near campsites
**Effort:** Medium (free API, no key for read-only)
**API:** Free for read-only access

**Implementation:**
- Show recent wildlife observations within 5km radius
- Filter by taxon (mammals, birds, reptiles)
- Display species photos and identification
- Warn about bears, mountain lions, snakes

**Data Fields:**
- Species name, photos
- Observation date/time
- GPS coordinates
- Research-grade quality filter

**API Docs:** https://api.inaturalist.org/v1/docs/

---

### 7. ACTIVE Network / Reserve America API
**Value:** 97% coverage of US/Canada campgrounds
**Effort:** Medium-High (commercial API, may require license)
**API:** Free tier may be limited

**Implementation:**
- Dramatically expand campground coverage
- Real-time availability checking
- Direct reservation links
- Fill in eastern US data gaps

**Data Fields:**
- Campground/campsite details
- Real-time availability
- Pricing, amenities, photos
- Reservation booking links

**API Docs:** https://developer.active.com/docs/read/Campground_APIs

**Note:** May require commercial license for high-volume use.

---

### 8. Campflare API
**Value:** Comprehensive campground data aggregation
**Effort:** Medium (invite-only access)
**API:** Free for non-profits/individuals, paid for commercial

**Implementation:**
- Contact contact@campflare.com for API access
- Aggregate data from multiple sources
- User reviews and ratings
- Real-time availability

**API Info:** https://campflare.com/api

**Status:** Currently invite-only (as of 2026)

---

## 💡 Priority 3: Nice to Have (Future)

### 9. AllTrails API (if available)
**Value:** Nearby hiking trails, trailhead parking
**Effort:** Unknown (no public API confirmed)
**API:** Research needed

**Potential Implementation:**
- Show trails within 10 miles of campsite
- Trail difficulty, length, elevation gain
- Trailhead parking availability
- User reviews and photos

---

### 10. Forest Service Road Conditions
**Value:** Current road status, closures
**Effort:** High (fragmented by forest/district)
**API:** Often no unified API

**Potential Implementation:**
- Road closure alerts
- Seasonal gate closures
- 4WD requirements
- Snow/mud conditions

---

### 11. Permit Requirements Database
**Value:** Show required permits (wilderness, day-use, overnight)
**Effort:** High (fragmented data, manual curation)
**API:** No unified API

**Potential Implementation:**
- Display permit requirements per campsite
- Link to permit reservation systems
- Quota/lottery information
- Costs and lead times

---

### 12. Dark Sky / Light Pollution Map
**Value:** Show stargazing quality at campsites
**Effort:** Low (static overlay)
**Data:** Free (Dark Sky Places data, Bortle scale)

**Implementation:**
- Overlay light pollution raster
- Display Bortle class in campsite popup
- Highlight dark sky preserves
- Link to astronomy.org resources

---

## 📊 Implementation Priority Matrix

| Data Source | Value | Effort | Priority | Estimated Sites |
|-------------|-------|--------|----------|----------------|
| NPS Data API | High | Low | 1 | +500-1,000 |
| Open Camping Map | High | Low | 1 | +10,000+ |
| NWS Weather | High | Low | 1 | All sites |
| USGS Fire Danger | High | Low | 1 | All sites |
| OpenTopography Elevation | Medium | Medium | 2 | All sites |
| iNaturalist Wildlife | Medium | Medium | 2 | All sites |
| ACTIVE Network API | Very High | Medium-High | 2 | +20,000+ |
| Campflare API | High | Medium | 2 | +15,000+ |
| AllTrails | Medium | Unknown | 3 | N/A |
| Road Conditions | Medium | High | 3 | N/A |

---

## 🛠️ Implementation Recommendations

### Quick Wins (This Sprint)
1. **NPS Data API** - Easy integration, official data
2. **NWS Weather API** - No key required, critical feature
3. **USGS Fire Danger** - Safety feature, public data

### Next Sprint (High ROI)
4. **Open Camping Map** - Massive data expansion
5. **OpenTopography Elevation** - Enhances every campsite
6. **iNaturalist Wildlife** - Unique differentiator

### Future Consideration
7. **ACTIVE Network API** - Evaluate licensing costs
8. **Campflare API** - Request invite, evaluate data quality

---

## 🔗 Source Links

**Camping Data:**
- [Recreation.gov API](https://www.recreation.gov/use-our-data)
- [NPS Data API](https://www.nps.gov/subjects/digital/nps-data-api.htm)
- [Open Camping Map](https://opencampingmap.org/en/)
- [ACTIVE Network API](https://developer.active.com/docs/read/Campground_APIs)
- [Campflare API](https://campflare.com/api)

**Weather & Fire:**
- [National Weather Service API](https://www.weather.gov/documentation/services-web-api)
- [OpenWeatherMap](https://openweathermap.org/api)
- [USGS Fire Danger Forecast](https://www.usgs.gov/fire-danger-forecast)
- [OpenWeatherMap Fire Index](https://openweathermap.org/api/fire-index-api)

**Elevation & Terrain:**
- [OpenTopography API](https://opentopography.org/developers)
- [USGS 3DEP](https://www.usgs.gov/3d-elevation-program)
- [USGS National Map](https://apps.nationalmap.gov/downloader/)

**Wildlife:**
- [iNaturalist API](https://api.inaturalist.org/v1/docs/)
- [iNaturalist API Reference](https://www.inaturalist.org/pages/api+reference)

---

## 📝 Next Steps

1. Create GitHub issues for Priority 1 items
2. Register for API keys (NPS, OpenTopography)
3. Create feature branches for each integration
4. Write data fetching scripts similar to existing `scripts/fetch_recreation_gov_data.py`
5. Update service worker cache with new data files
6. Add UI toggles for new overlays/features

---

**Last Updated:** 2026-01-17
**Status:** Research Complete, Ready for Implementation
