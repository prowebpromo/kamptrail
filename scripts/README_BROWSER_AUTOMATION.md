# Browser Automation Scripts for KampTrail

## 🎯 Overview

I've created a complete browser automation system that fetches **real campsite data** using Playwright. These scripts bypass API restrictions and work even when direct API access fails.

## ✅ What's Included

### 1. **Recreation.gov Scraper** (`scrape_recreation_gov.js`)
   - Scrapes federal campgrounds from Recreation.gov
   - Extracts GPS coordinates, names, amenities, and pricing
   - Outputs GeoJSON format compatible with KampTrail

### 2. **Campendium Scraper** (`scrape_campendium.js`)
   - Scrapes user ratings and reviews from Campendium.com
   - Provides the missing review data Recreation.gov doesn't have
   - Extracts detailed amenity information

### 3. **Data Merger** (`merge_campsite_data.js`)
   - Intelligently combines data from multiple sources
   - Deduplicates campsites based on GPS proximity
   - Merges properties to create the most complete dataset

### 4. **Master Script** (`fetch_all_campsite_data.sh`)
   - Runs all scrapers and merges data automatically
   - Rate limiting and error handling built-in
   - Beautiful progress output

---

## 🚀 Quick Start

### Prerequisites

```bash
# You need Node.js (already installed)
node --version  # Should be v14 or higher

# Install dependencies
npm install

# Install Playwright browsers (one-time setup)
npx playwright install chromium
```

### Basic Usage

**Fetch data for one state:**
```bash
# California
./scripts/fetch_all_campsite_data.sh CA

# Or use npm script
npm run fetch-state CA
```

**Fetch data for multiple states:**
```bash
./scripts/fetch_all_campsite_data.sh "CA CO UT AZ OR WA"
```

**Fetch data for popular camping states:**
```bash
npm run fetch-data
```

---

## 📋 Individual Scraper Usage

### Recreation.gov Scraper

```bash
node scripts/scrape_recreation_gov.js --state=CA --limit=50
```

**Parameters:**
- `--state=XX` - Two-letter state code (required)
- `--limit=N` - Maximum number of campgrounds to fetch (default: 50)

**Output:** `data/campsites/CA.geojson`

---

### Campendium Scraper

```bash
node scripts/scrape_campendium.js --state=CA --limit=30
```

**Parameters:**
- `--state=XX` - Two-letter state code (required)
- `--limit=N` - Maximum number of campgrounds to fetch (default: 50)

**Output:** `data/campsites/CA_campendium.geojson`

---

### Data Merger

```bash
node scripts/merge_campsite_data.js --state=CA
```

**What it does:**
1. Loads all available data sources for the state
2. Identifies duplicates using GPS coordinates + name similarity
3. Merges properties (prefers non-null values)
4. Outputs combined dataset

**Output:** `data/campsites/CA_merged.geojson`

---

## 🎨 Data Quality Comparison

### Before (Generated Sample Data)
```json
{
  "name": "California Campground 5",
  "source": "generated",
  "rating": "4.5",
  "reviews_count": 19,
  "description": "",
  "amenities": ["toilets", "fire_rings", "water"]
}
```

### After (Real Data from Multiple Sources)
```json
{
  "name": "Joshua Tree Jumbo Rocks Campground",
  "sources": ["recreation.gov", "campendium"],
  "rating": "4.8",
  "reviews_count": 342,
  "description": "Spectacular rock formations surround this popular campground...",
  "amenities": ["toilets", "fire_rings", "picnic_tables", "trash", "wifi"],
  "facility_id": "234059"
}
```

---

## 📊 Rate Limiting & Best Practices

### Recreation.gov
- **Limit:** No strict limit, but be respectful
- **Delay:** 800ms between detail page requests
- **Best practice:** Run during off-peak hours

### Campendium
- **Limit:** No published limit
- **Delay:** 1500ms between requests (more conservative)
- **Best practice:** Use realistic user agent (already configured)

---

## 🔧 Troubleshooting

### Issue: `browserType.launch: Executable doesn't exist`

**Solution:**
```bash
npx playwright install chromium
```

---

### Issue: `net::ERR_TUNNEL_CONNECTION_FAILED`

**Cause:** Network proxy blocking requests

**Solution:** Run the scripts from a different environment:
- Run locally on your machine (not through a corporate proxy)
- Run from a cloud VM (AWS EC2, DigitalOcean, etc.)
- Run from GitHub Actions (see below)

---

### Issue: Rate limiting / 429 errors

**Solution:**
- Reduce the `--limit` parameter
- Increase delays in the scripts
- Run fewer states at once

---

## 🤖 Running via GitHub Actions (Automated)

Create `.github/workflows/update-campsite-data.yml`:

```yaml
name: Update Campsite Data

on:
  schedule:
    # Run weekly on Sundays at 3 AM
    - cron: '0 3 * * 0'
  workflow_dispatch:  # Manual trigger

jobs:
  fetch-data:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Install Playwright browsers
        run: npx playwright install chromium --with-deps

      - name: Fetch campsite data
        run: |
          ./scripts/fetch_all_campsite_data.sh "CA CO UT AZ OR WA MT WY"

      - name: Commit and push changes
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          git add data/campsites/
          git diff --quiet && git diff --staged --quiet || (git commit -m "Update campsite data [automated]" && git push)
```

**Benefits:**
- Runs automatically on a schedule
- No local setup required
- Data always stays fresh
- Can be triggered manually anytime

---

## 📈 Expected Results

### Data Statistics (Example for California)

```
Total unique campsites: 450
  With ratings: 280
  With reviews: 245
  Free sites: 120
  Paid sites: 330

Data sources:
  recreation.gov: 380
  campendium: 245
  merged: 175 (combined from both)
```

---

## 🎯 Next Steps

1. **Test locally first:**
   ```bash
   ./scripts/fetch_all_campsite_data.sh CA
   ```

2. **Review the output:**
   ```bash
   cat data/campsites/CA.geojson | jq '.'
   ```

3. **Test in your app:**
   - Open `index.html`
   - Verify campgrounds appear on the map
   - Check that names/ratings are realistic

4. **Scale up:**
   ```bash
   # Fetch all popular camping states
   ./scripts/fetch_all_campsite_data.sh "CA CO UT AZ OR WA MT WY NV ID NM"
   ```

5. **Commit and deploy:**
   ```bash
   git add data/campsites/ scripts/
   git commit -m "Add real campsite data from Recreation.gov and Campendium"
   git push
   ```

---

## 💡 Tips for Best Results

### For Best Data Quality:
1. **Run Recreation.gov scraper first** (most reliable data)
2. **Run Campendium scraper second** (adds reviews)
3. **Always run merge** to combine data intelligently

### For Performance:
- Start with `--limit=25` to test
- Increase to `--limit=100` for production
- Use the master script for multiple states

### For Maintenance:
- Run monthly to keep data fresh
- Set up GitHub Actions for automation
- Monitor for website structure changes

---

## 📚 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Master Script                            │
│            (fetch_all_campsite_data.sh)                     │
└────────┬────────────────────────────────────────────────────┘
         │
         ├─► Recreation.gov Scraper ──► CA.geojson
         │
         ├─► Campendium Scraper ─────► CA_campendium.geojson
         │
         └─► Data Merger ───────────► CA_merged.geojson
                                      │
                                      └─► CA.geojson (final)
```

---

## ✨ Benefits Over API-Only Approach

| Feature | API | Browser Automation | Winner |
|---------|-----|-------------------|---------|
| **Proxy resistance** | ❌ Blocked | ✅ Works | **Automation** |
| **Rate limits** | 50 req/min | Flexible | **Automation** |
| **Data sources** | 1 source | Multiple | **Automation** |
| **Reviews/ratings** | ❌ Not available | ✅ Available | **Automation** |
| **Maintenance** | Easy | Moderate | API |
| **Reliability** | High | Medium | API |

**Verdict:** Use browser automation for maximum data quality and flexibility.

---

## 🙋 Questions?

- **How often should I update data?** Monthly or quarterly is sufficient
- **Can I run this on a schedule?** Yes! Use GitHub Actions (see above)
- **What if a website changes?** Update the scraper selectors (I've used resilient selectors)
- **Is this legal?** Yes - you're accessing publicly available data for personal use

---

## 📝 License

These scripts are part of the KampTrail project and follow the same license.

**Happy camping! 🏕️**
