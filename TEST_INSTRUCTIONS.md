# Testing Instructions for Google Places Integration

## What Was Fixed:
1. ✅ Removed ALL inline onclick handlers (data-loader.js, campsite-compare.js, gpx-importer.js)
2. ✅ Replaced with event delegation pattern using data-* attributes
3. ✅ Added cache-busting parameters to ALL JS files (?v=1770393022)
4. ✅ Google Places API key configured in config.js

## To Test:

### Step 1: Start Fresh Dev Server
```bash
cd /home/user/kamptrail
python3 -m http.server 3000
```

### Step 2: Clear Browser Cache
1. Open DevTools (F12)
2. Right-click the Refresh button
3. Click "Empty Cache and Hard Reload"

### Step 3: Test Syntax Errors Are Gone
1. Open Console tab in DevTools
2. Look for: ✅ `[Google Places] Service initialized.`
3. Should NOT see: ❌ `Uncaught SyntaxError: expected expression, got '}'`

### Step 4: Test Google Places Button
1. Click any campsite marker on the map
2. Click "📷 Show Google Photos & Rating" button
3. Should see: "Loading Google data..." then photos/ratings appear

## Expected Console Output:
```
✅ Service worker unregistered (dev mode)
🚀 Initializing KampTrail Data Loader...
📊 Initializing Campsite Comparison...
📍 Initializing GPX Importer...
[Google Places] Service initialized.
🗺️ Viewport: lat X.XX to Y.YY, lng Z.ZZ to W.WW
```

## If Google Places Button Still Doesn't Work:
Check console for:
- `[Google Places] Cache HIT...` or `Cache MISS...`
- Any network errors from places.googleapis.com
- API key errors (403/429 status codes)

## Common Issues:
- **Still see syntax error**: Browser cached old files - do Step 2 again
- **"API key not configured"**: Check config.js has your actual API key
- **"No Google data found"**: Campsite name not found in Google Places
- **Network errors**: Check API key is valid and Places API (New) is enabled
