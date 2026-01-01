# POI Fix Deployment Guide

## Problem
The live site only shows water markers (2,798) instead of all 6,994 POIs (water + dump + propane).

**Root Cause**: GitHub Pages is serving the POI file as 403 Forbidden instead of the full 2.43 MB file.

## Solution
Use jsDelivr CDN to load the POI data instead of GitHub Pages path.

---

## Option 1: Pull from Container (Recommended if git credentials work)

On your Windows machine in PowerShell/CMD:

```bash
cd C:\Users\chuck\OneDrive\Documents\GitHub\kamptrail
git pull origin main
```

This will bring in 3 commits from the container:
- `.nojekyll` file (bypasses Jekyll processing)
- Raw GitHub URL attempt
- jsDelivr CDN fix (the actual solution)

Then push to GitHub:
```bash
git push origin main
```

---

## Option 2: Manual Edit (If pull doesn't work)

### Step 1: Create `.nojekyll` file

1. Navigate to: `C:\Users\chuck\OneDrive\Documents\GitHub\kamptrail`
2. Create a new empty file named `.nojekyll` (no extension, just the dot and name)
3. On Windows, you may need to use Command Prompt:
   ```cmd
   cd C:\Users\chuck\OneDrive\Documents\GitHub\kamptrail
   type nul > .nojekyll
   ```

### Step 2: Edit index.html

Open `C:\Users\chuck\OneDrive\Documents\GitHub\kamptrail\index.html`

Find line 232 (around line 232, inside the `KampTrailOverlays.init()` call):

**CHANGE FROM:**
```javascript
poiUrl: 'https://raw.githubusercontent.com/prowebpromo/kamptrail/main/data/poi_dump_water_propane.geojson',
```

**CHANGE TO:**
```javascript
poiUrl: 'https://cdn.jsdelivr.net/gh/prowebpromo/kamptrail@main/data/poi_dump_water_propane.geojson',
```

**KEY DIFFERENCE**:
- ❌ OLD: `raw.githubusercontent.com/prowebpromo/kamptrail/main`
- ✅ NEW: `cdn.jsdelivr.net/gh/prowebpromo/kamptrail@main`

### Step 3: Commit and Push via GitHub Desktop

1. Open GitHub Desktop
2. You should see 2 changed files:
   - `.nojekyll` (new file)
   - `index.html` (modified)
3. Summary: `Use jsDelivr CDN for POI data`
4. Description: `Fixes POI overlay - switches from GitHub Pages path to jsDelivr CDN to load dump/water/propane markers`
5. Click "Commit to main"
6. Click "Push origin"

---

## Verification (After Deploy)

1. Wait 2-3 minutes for GitHub Pages to rebuild
2. Go to: https://prowebpromo.github.io/kamptrail/
3. Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
4. Check browser console (F12) for POI loading:
   - Should see: "Loading POI data from jsDelivr..."
   - Should NOT see 403 errors
5. Toggle "Dump/Water/Propane" overlay ON
6. Zoom to populated area (California, Texas, etc.)
7. You should now see:
   - 💧 W markers (water - green)
   - 🚽 D markers (dump - purple)
   - ⛽ P markers (propane - orange)

**Expected Result**: All 6,994 POI markers should load and display on the map.

---

## Current File Locations

**Container (this session):**
- ✅ `.nojekyll` exists
- ✅ `index.html` line 232 uses jsDelivr CDN
- ❌ Can't push due to authentication

**Your Windows Machine:**
- ❓ Unknown state (likely missing these changes)
- Need to apply changes manually or pull from remote after container pushes

**GitHub Remote:**
- ❌ Missing these 3 commits
- Still using old path (GitHub Pages direct)

---

## Why This Fixes It

1. **GitHub Pages Issue**: GitHub Pages was returning 403 Forbidden for the 2.43 MB GeoJSON file
2. **jsDelivr CDN**: Properly serves GitHub files via CDN
3. **Faster**: CDN caching makes it faster than direct GitHub serving
4. **Reliable**: jsDelivr is a production-grade CDN specifically designed for serving GitHub files

---

## Rollback Plan (If Something Goes Wrong)

If the jsDelivr CDN doesn't work, revert to the old local path:

```javascript
poiUrl: 'data/poi_dump_water_propane.geojson',
```

Then investigate alternative CDN options or self-hosting.
