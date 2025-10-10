# KampTrail Overlays & POI Bundle (Drop‑in)

Adds:
- Toggleable **Public Lands** and **Cell Coverage** overlays (URLs configurable).
- **POIs** (dump, water, propane) clustered from `/data/poi_dump_water_propane.geojson`.
- Sample **campsites loader** filtered by map bounds from `/data/sample_places.geojson`.

## 1) Copy files into your repo
```
/overlays/overlays.css
/overlays/overlays.js
/data/poi_dump_water_propane.geojson
/data/sample_places.geojson
```

## 2) Wire it into `index.html`
In `<head>`:
```html
<link rel="stylesheet" href="/overlays/overlays.css">
```
Before `</body>` (after Leaflet/MarkerCluster):
```html
<script src="/overlays/overlays.js"></script>
<script>
  window.KampTrailOverlays.init(map, {
    publicLandsUrl: '', // e.g. 'https://tiles.example.com/publiclands/{z}/{x}/{y}.png'
    cellCoverageUrl: '' // e.g. 'https://tiles.example.com/cell/{z}/{x}/{y}.png'
  });
</script>
```

## 3) Verify
Reload your site. A control panel appears (top-right) with three toggles. POIs cluster;
panning refreshes sample campsites within the viewport.