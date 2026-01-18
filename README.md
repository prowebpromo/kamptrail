# 🏕 KampTrail – Lightweight Campsite Mapping PWA

KampTrail is a minimalist Progressive Web App (PWA) for discovering camping locations across the U.S. Designed for speed, offline support, and mobile usability, it's the foundation for a future FreeRoam alternative.

---

## 🚀 Features

- 🌍 Interactive Leaflet map with OpenStreetMap tiles
- 📍 Real campsite data from official federal sources (RIDB)
- 💾 Offline support via Service Worker
- 🧭 Fully installable PWA (Android/iOS/Desktop)
- ⚡ Fast, modern design with minimal dependencies

---

## 📊 Data Sources

**Current Status**: The repository contains placeholder/generated data for demonstration purposes.

**To use real campsite data:**

1. Get a free API key from the [Recreation Information Database (RIDB)](https://ridb.recreation.gov/docs)
2. Run the data fetcher script:
   ```bash
   export RIDB_API_KEY="your-key-here"
   node scripts/fetch-ridb-data-sample.js  # Sample data (8 states)
   # OR
   node scripts/fetch-ridb-data.js  # Full data (all 50 states, ~30-60 min)
   ```
3. See [`scripts/README.md`](scripts/README.md) for detailed instructions

**RIDB provides official data from:**
- USFS (US Forest Service)
- NPS (National Park Service)
- BLM (Bureau of Land Management)
- Army Corps of Engineers
- Other federal recreation sites

**Limitations**: RIDB only includes federal campsites. For a more comprehensive dataset, consider integrating:
- State park APIs
- OpenStreetMap campsite data
- Community-contributed dispersed camping sites

---

## 🛠 Getting Started (Local Dev)

> This is a static PWA — no Node.js build required.

### 1. Download & Extract

```bash
wget https://github.com/prowebpromo/kamptrail/archive/refs/heads/main.zip
unzip main.zip
cd kamptrail-main
