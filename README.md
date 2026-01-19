# 🏕 KampTrail – Lightweight Campsite Mapping PWA

KampTrail is a minimalist Progressive Web App (PWA) for discovering camping locations across the U.S. Designed for speed, offline support, and mobile usability, it's the foundation for a future FreeRoam alternative.

---

## 🚀 Features

- 🌍 Interactive Leaflet map with OpenStreetMap tiles
- 📍 Curated real campground data from popular destinations
- 💾 Offline support via Service Worker
- 🧭 Fully installable PWA (Android/iOS/Desktop)
- ⚡ Fast, modern design with minimal dependencies

---

## 📊 Data Sources

**Current Dataset**: The repository includes curated real campground data for popular destinations.

**Included (47 campgrounds across 8 states):**
- ✅ Real campground names (Yosemite Valley, Grand Canyon, etc.)
- ✅ Accurate GPS coordinates
- ✅ Verified costs and amenities
- ✅ Proper categorization (established/dispersed/backcountry)

**States with data:** CA, CO, UT, AZ, WA, OR, MT, WY

**Want to expand the dataset?**
- See [`scripts/README.md`](scripts/README.md) for RIDB API integration
- See `fetch-osm-campsites.js` for OpenStreetMap data fetching
- See `generate-realistic-data.js` to add more curated locations

**Data sources you can integrate:**
- [RIDB API](https://ridb.recreation.gov/docs) - Federal campgrounds (USFS, NPS, BLM)
- [OpenStreetMap](https://www.openstreetmap.org/) - Community-contributed sites
- State park APIs - Varies by state
- User submissions - Build your own database

---

## 🛠 Getting Started (Local Dev)

> This is a static PWA — no Node.js build required.

### 1. Download & Extract

```bash
wget https://github.com/prowebpromo/kamptrail/archive/refs/heads/main.zip
unzip main.zip
cd kamptrail-main
