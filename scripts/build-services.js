/* Build the compact services layer (dump stations, water fill points, propane) from OSM-tagged records only.
   Recreation.gov "water" records are excluded: they were inferred from facility listings,
   not from a tagged water point, so they cannot be shown as a confirmed water source. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const input = path.join(root, 'data', 'poi_dump_water_propane.geojson');
const outDir = path.join(root, 'data', 'services');
const output = path.join(outDir, 'services.json');

function build(source) {
  const seen = new Set();
  const items = [];
  for (const f of source.features || []) {
    const p = f.properties || {};
    if (p.source !== 'openstreetmap' || !['dump', 'propane', 'water'].includes(p.type)) continue;
    // Water must come from an explicit OSM water_point tag (schema 3 fetcher), never from campground prose.
    if (p.type === 'water' && !(p.osm_id != null && Number(p.schema_version) >= 3)) continue;
    const c = f.geometry && f.geometry.coordinates;
    if (!Array.isArray(c) || !c.slice(0, 2).every(Number.isFinite)) continue;
    const [lng, lat] = c;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const key = p.osm_id != null ? `${p.type}:${p.osm_id}` : `${p.type}:${lng.toFixed(5)},${lat.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5, ({dump: 'd', propane: 'p', water: 'w'})[p.type], String(p.name || '').slice(0, 120)];
    const extra = {};
    if (p.osm_id != null) extra.o = String(p.osm_id);
    if (p.fee) extra.f = String(p.fee).slice(0, 60);
    if (p.operator) extra.op = String(p.operator).slice(0, 80);
    if (p.access && p.access !== 'unknown') extra.a = String(p.access).slice(0, 40);
    if (/^(node|way|relation)$/.test(p.osm_type || '')) extra.t = p.osm_type;
    if (p.type === 'water' && p.drinking_water) extra.dw = String(p.drinking_water).slice(0, 10);
    if (Object.keys(extra).length) row.push(extra);
    items.push(row);
  }
  return {version: 1, source: 'OpenStreetMap contributors (ODbL)', note: 'Element type (t) is present only for records fetched after the 2.3.0 fetcher update.', items};
}

if (require.main === module) {
  const data = build(JSON.parse(fs.readFileSync(input, 'utf8')));
  fs.mkdirSync(outDir, {recursive: true});
  fs.writeFileSync(output, JSON.stringify(data));
  const counts = data.items.reduce((a, r) => (a[r[2]] = (a[r[2]] || 0) + 1, a), {});
  console.log(`services.json: ${data.items.length} items (dump ${counts.d || 0}, water ${counts.w || 0}, propane ${counts.p || 0})`);
}
module.exports = {build};
