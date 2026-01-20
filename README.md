# 🏕 KampTrail – Lightweight Campsite Mapping PWA

KampTrail is a minimalist Progressive Web App (PWA) for discovering camping locations across the U.S. Designed for speed, offline support, and mobile usability, it's the foundation for a future FreeRoam alternative.

---

## 🚀 Features

- 🌍 Interactive Leaflet map with OpenStreetMap tiles
- 📍 Campsite markers (includes sample data - see below to add real data)
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

### Google Places Photos & Ratings

To enable the Google Places integration for campsite photos and ratings:

1.  **Get a free Google Places API key:**
    *   Go to the [Google Cloud Console](https://console.cloud.google.com/).
    *   Create a new project.
    *   Enable the "**Places API (New)**".
    *   Go to "Credentials" and create a new API key.
    *   **Important:** Restrict your API key to your domain to prevent unauthorized use.

2.  **Create `config.js` file:**
    *   In the root of the project, create a new file named `config.js`.
    *   Add the following content to the file, replacing `YOUR_API_KEY_HERE` with your actual key:
        ```javascript
        // config.js
        window.GOOGLE_API_KEY = 'YOUR_API_KEY_HERE';
        ```
    *   The `config.js` file is ignored by Git, so your key will not be committed.

3.  **How it works:**
    *   When you click on a campsite, a button will appear to "Show Google Photos & Rating".
    *   Clicking this button will fetch data from the Google Places API.
    *   The results are cached for 24 hours to minimize API calls and costs.

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

### Fetch Real Campsite Data

The app includes sample/placeholder campsite data. To populate it with **real campground names, ratings, and GPS coordinates**:

#### 🤖 **RECOMMENDED: Fully Automated (Zero Effort!)**

**Just click a button** - no installation, no command line, runs in GitHub's cloud:

1. **Enable GitHub Actions** (one-time, 30 seconds):
   - Go to **Settings** → **Actions** → **General**
   - Enable **"Read and write permissions"**
   - Save

2. **Click to fetch data** (5-10 minutes):
   - Go to **Actions** tab → **"🎯 Quick Fetch (Single State)"**
   - Click **"Run workflow"** → Select state (e.g., California)
   - Wait for green checkmark ✅
   - Data automatically committed!

3. **Done!** Real campsite data with zero technical skills required.

📖 **[Full Guide: Automated Fetching →](docs/AUTOMATED_FETCHING.md)**

---

#### 🛠️ Alternative Methods (For Technical Users):

<details>
<summary><b>Manual fetch with Recreation.gov API</b></summary>

1. **Get a free Recreation.gov API key:**
   - Visit https://ridb.recreation.gov/docs
   - Sign up for a free account
   - Enable developer access to get your API key

2. **Fetch data for your desired states:**
   ```bash
   # Install dependencies
   pip3 install requests

   # Fetch California campgrounds
   python3 scripts/fetch_recreation_gov_data.py --api-key YOUR_API_KEY --state CA --limit 100

   # Or fetch multiple states
   for state in CA CO UT AZ OR WA; do
     python3 scripts/fetch_recreation_gov_data.py --api-key YOUR_API_KEY --state $state --limit 100
     sleep 5
   done
   ```

3. **Refresh the app** to see real campground names like:
   - "Yosemite Valley Campground" instead of "California Campground 5"
   - "Joshua Tree Jumbo Rocks" instead of "California Established 12"
   - Real amenities, costs, and facility details

</details>

<details>
<summary><b>Browser automation (Playwright scripts)</b></summary>

For users who want to run scripts locally with browser automation:

```bash
# Install dependencies
npm install
npx playwright install chromium

# Fetch data for California
./scripts/fetch_all_campsite_data.sh CA

# Or multiple states
./scripts/fetch_all_campsite_data.sh "CA CO UT AZ OR WA"
```

📚 **[Full Guide: Browser Automation →](scripts/README_BROWSER_AUTOMATION.md)**

</details>

<details>
<summary><b>No-code option (Axiom.ai)</b></summary>

For visual, no-code scraping:

1. Install [Axiom.ai](https://axiom.ai) browser extension
2. Build visual scraper (click, don't code)
3. Download CSV data
4. Use web converter: `axiom-converter.html`
5. Upload to repository

📚 **[Full Guide: Axiom.ai →](scripts/README_AXIOM.md)**

</details>

---
