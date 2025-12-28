# 🏕 KampTrail – Lightweight Campsite Mapping PWA

KampTrail is a minimalist Progressive Web App (PWA) for discovering camping locations across the U.S. Designed for speed, offline support, and mobile usability, it's the foundation for a future FreeRoam alternative.

---

## 🚀 Features

- 🌍 Interactive Leaflet map with OpenStreetMap tiles
- 📍 Preloaded dummy campsite markers
- 🗺️ Public lands overlay (national parks, forests, BLM land)
- 📡 Cell tower locations (OpenCelliD integration)
- 🚰 POI markers (dump stations, water, propane)
- 📥 GPX import/export for route planning
- 🔄 Campsite comparison tool
- 💾 Offline support via Service Worker
- 🧭 Fully installable PWA (Android/iOS/Desktop)
- ⚡ Fast, modern design with minimal dependencies

---

## 🛠 Getting Started (Local Dev)

> This is a static PWA — no Node.js build required.

### 1. Download & Extract

```bash
wget https://github.com/prowebpromo/kamptrail/archive/refs/heads/main.zip
unzip main.zip
cd kamptrail-main
```

### 2. Serve Locally

```bash
python3 -m http.server 8000
# Open http://localhost:8000
```

---

## ⚙️ Configuration

### Cell Tower Overlay (OpenCelliD)

To enable the cell tower overlay:

1. **Get a free API key:**
   - Visit https://opencellid.org
   - Create a free account
   - Get your API token from the dashboard

2. **Add the key to `index.html`:**
   - Open `index.html`
   - Find the `KampTrailOverlays.init` section (around line 229)
   - Add your API key to the `openCelliDKey` field:
   ```javascript
   openCelliDKey: 'your-api-key-here',
   ```

3. **How it works:**
   - Toggle "Cell towers" in the map controls
   - Zoom in to level 8+ to view towers
   - Color-coded by technology: GSM (red), UMTS (blue), LTE (green), 5G (purple)
   - Click markers for tower details (range, samples, carrier info)
   - Limited to 500 towers per view to respect API limits

**Note:** OpenCelliD has a 5,000 requests/day limit for free accounts. The app caches results to minimize API calls.

---
