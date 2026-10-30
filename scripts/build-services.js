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
    const key = p.osm_id != null ? `${p.type}:${p.osm_type || 'unknown'}:${p.osm_id}` : `${p.type}:${lng.toFixed(5)},${lat.toFixed(5)}`;
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



// v2 source validation and immutable spatial delivery. v1 build() remains available
// for compatibility, but the CLI now builds v2 and projects its three legacy kinds.
const crypto = require('node:crypto');
const CATEGORIES = ['dump', 'water', 'lpg', 'showers', 'laundry', 'groceries', 'fuel'];
const TAGS = new Set(['amenity','tourism','sanitary_dump_station','waterway','drinking_water','fuel','fuel:lpg','shop','laundry','self_service','access','access:conditional','fee','charge','opening_hours','operator','brand','website','phone','wheelchair','shower']);
const STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
const MAX_SHARD_BYTES = 512 * 1024, MAX_ROWS = 1500, MAX_MANIFEST_BYTES = 1024 * 1024;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function invariant(condition, reason) { if (!condition) throw new Error(reason); }
function date(value, nullable = false) {
  if (value === null && nullable) return null;
  invariant(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 300000, 'Invalid UTC source date');
  invariant(new Date(value).toISOString().slice(0,19) === value.slice(0,19), 'Invalid UTC calendar date');
  return value;
}
function validateSource(wrapper) {
  invariant(wrapper && wrapper.version === 2 && (wrapper.region === 'legacy' || STATES.has(wrapper.region)) && Array.isArray(wrapper.items) && wrapper.items.length > 0 && wrapper.items.length <= 1000000, 'Invalid source wrapper');
  const source = wrapper.source, legacy = wrapper.region === 'legacy';
  invariant(source && source.kind === (legacy ? 'legacy' : 'geofabrik') && source.license === 'ODbL-1.0' && /^[a-f0-9]{64}$/.test(source.sha256), 'Invalid source provenance');
  invariant(legacy ? source.url === 'https://www.openstreetmap.org' : /^https:\/\/download\.geofabrik\.de\/north-america\/us\/[a-z-]+-latest\.osm\.pbf$/.test(source.url), 'Unapproved source URL');
  date(source.extract_timestamp, legacy); date(source.retrieved_at, legacy);
  if (!legacy) invariant(Date.parse(source.extract_timestamp) <= Date.parse(source.retrieved_at) + 300000, 'Extract date newer than retrieval');
  invariant(Array.isArray(source.categories) && source.categories.length && new Set(source.categories).size === source.categories.length && source.categories.every(c => CATEGORIES.includes(c)), 'Invalid source categories');
  for (const row of wrapper.items) {
    invariant(row && ['node','way','relation'].includes(row.osm_type) && /^[1-9]\d*$/.test(row.osm_id) && row.id === `osm:${row.osm_type}:${row.osm_id}`, 'Invalid exact OSM identity');
    invariant(row.osm_version === null || (Number.isSafeInteger(row.osm_version) && row.osm_version > 0), 'Invalid OSM version');
    date(row.edited_at, true);
    invariant(Array.isArray(row.coordinates) && row.coordinates.length === 2 && row.coordinates.every(Number.isFinite) && Math.abs(row.coordinates[0]) <= 180 && Math.abs(row.coordinates[1]) <= 90, 'Invalid geometry');
    invariant(typeof row.name === 'string' && Buffer.byteLength(row.name) <= 120, 'Invalid service name');
    invariant(Array.isArray(row.categories) && row.categories.length && new Set(row.categories).size === row.categories.length && row.categories.every(c => source.categories.includes(c)), 'Invalid service categories');
    invariant(row.source_region === wrapper.region && Array.isArray(row.states) && row.states.length === 1 && STATES.has(row.states[0]) && (legacy || row.states[0] === wrapper.region), 'Invalid source/state binding');
    invariant(row.tags && typeof row.tags === 'object' && !Array.isArray(row.tags) && Object.entries(row.tags).every(([k,v]) => TAGS.has(k) && typeof v === 'string' && Buffer.byteLength(v) <= 240), 'Invalid evidence tags');
    if (legacy) date(row.retrieved_at, true);
    invariant(Object.keys(row).every(k => ['id','osm_type','osm_id','osm_version','edited_at','coordinates','name','categories','tags','states','source_region','retrieved_at'].includes(k)), 'Unsupported row field');
  }
  return wrapper;
}
function rowDate(row, source) { return source.extract_timestamp || row.retrieved_at || source.retrieved_at || ''; }
function selectRows(sources) {
  const regions = new Map(sources.map(s => [s.region, s]));
  invariant(regions.size === sources.length, 'Duplicate source region');
  const selected = new Map();
  for (const wrapper of [...sources].sort((a,b) => a.region.localeCompare(b.region))) {
    for (const row of [...wrapper.items].sort((a,b) => stable(a).localeCompare(stable(b)))) {
      // A successfully accepted newer state extract owns exactly its Census state.
      const regional = row.source_region === 'legacy' && regions.get(row.states[0]);
      // Legacy has no OSM version/extract edition. A later retrieval timestamp
      // cannot resurrect a removed feature from an accepted complete state source.
      if (regional) continue;
      const candidate = {row, source: wrapper.source};
      const old = selected.get(row.id);
      if (!old) { selected.set(row.id, candidate); continue; }
      const version = (row.osm_version || 0) - (old.row.osm_version || 0);
      const newer = rowDate(row, wrapper.source).localeCompare(rowDate(old.row, old.source));
      if (version > 0 || (version === 0 && newer > 0)) selected.set(row.id, candidate);
      else if (version === 0 && newer === 0 && row.source_region === old.row.source_region) {
        // Old source had a row per category. Combine only equal identity/provenance.
        invariant(stable(row.coordinates) === stable(old.row.coordinates), 'Conflicting equal-version source geometry');
        old.row = {...old.row, categories: CATEGORIES.filter(c => row.categories.includes(c) || old.row.categories.includes(c))};
      }
    }
  }
  return [...selected.values()].map(v => v.row).sort((a,b) => a.id.localeCompare(b.id));
}
function makeV1(rows) {
  const items = [];
  for (const row of rows) for (const category of row.categories) {
    const code = {dump:'d',water:'w',lpg:'p'}[category];
    if (!code) continue;
    const extra = {o:row.osm_id,t:row.osm_type};
    for (const [key, short] of [['fee','f'],['operator','op'],['access','a'],['drinking_water','dw']]) if (row.tags[key]) extra[short] = row.tags[key];
    items.push([...row.coordinates,code,row.name,extra]);
  }
  return {version:1,source:'OpenStreetMap contributors (ODbL)',note:'Compatibility projection of dated Census-validated v2 services. See index.json for source evidence.',items};
}
function buildDatabase(inputSources) {
  const sources = inputSources.map(validateSource).sort((a,b) => a.region.localeCompare(b.region));
  const rows = selectRows(sources);
  invariant(rows.length > 0 && rows.length <= 1000000, 'Invalid database row count');
  const snapshot = hash(stable({schema:2,encoding:'canonical-json-1',sources:sources.map(s => ({region:s.region,source:s.source})),items:rows})).slice(0,24);
  const cells = new Map(), shards = [];
  for (const row of rows) {
    const x = Math.min(179, Math.floor(row.coordinates[0])), y = Math.min(89, Math.floor(row.coordinates[1]));
    const key = `${x},${y}`;
    if (!cells.has(key)) cells.set(key, {bbox:[x,y,x+1,y+1],items:[]});
    cells.get(key).items.push(row);
  }
  function split(items, bbox, id, depth = 0) {
    const raw = Buffer.from(stable({version:2,snapshot_id:snapshot,shard_id:id,items}));
    if (items.length <= MAX_ROWS && raw.length <= MAX_SHARD_BYTES) {
      const counts = Object.fromEntries(CATEGORIES.map(c => [c,items.filter(row => row.categories.includes(c)).length]));
      shards.push({entry:{id,url:`snapshots/${snapshot}/${id}.json`,bbox,sha256:hash(raw),bytes:raw.length,count:items.length,counts},raw});
      invariant(shards.length <= 4096, 'Shard count cap exceeded'); return;
    }
    invariant(depth < 24, 'Unshardable dense coordinate cluster');
    const [w,s,e,n] = bbox, mx=(w+e)/2, my=(s+n)/2;
    const boxes=[[w,s,mx,my],[mx,s,e,my],[w,my,mx,n],[mx,my,e,n]], groups=[[],[],[],[]];
    for (const row of items) groups[(row.coordinates[0]>=mx?1:0)+(row.coordinates[1]>=my?2:0)].push(row);
    for (let i=0;i<4;i++) if (groups[i].length) split(groups[i],boxes[i],`${id}_${i}`,depth+1);
  }
  for (const [key,cell] of [...cells].sort((a,b) => a[0].localeCompare(b[0]))) split(cell.items,cell.bbox,`c_${key.replace('-','m').replace(',','_').replace('-','m')}`);
  const dates = sources.flatMap(s => [s.source.retrieved_at,...(s.region === 'legacy' ? s.items.map(row => row.retrieved_at) : [])]).filter(Boolean).sort((a,b) => Date.parse(a)-Date.parse(b));
  invariant(dates.length > 0, 'No dated source evidence');
  const manifest = {version:2,snapshot_id:snapshot,generated_at:dates[dates.length-1],source:{name:'OpenStreetMap contributors',license:'ODbL-1.0',copyright_url:'https://www.openstreetmap.org/copyright'},coverage:sources.map(s => ({region:s.region,...s.source,count:rows.filter(row => row.source_region===s.region).length})),total:rows.length,shards:shards.map(s => s.entry)};
  const raw = Buffer.from(stable(manifest));
  invariant(raw.length <= MAX_MANIFEST_BYTES, 'Manifest byte cap exceeded');
  return {manifest,raw,shards,compatibility:makeV1(rows)};
}
function writeDatabase(database, destination) {
  fs.mkdirSync(destination, {recursive:true});
  const manifestPath = path.join(destination,'index.json');
  let previous = null;
  if (fs.existsSync(manifestPath)) {
    const prior = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    if (/^[a-f0-9]{24}$/.test(prior.snapshot_id)) previous = prior.snapshot_id;
  }
  // Shards become available before atomic manifest promotion. Never overwrite an
  // existing immutable path with different bytes, and keep old snapshots offline.
  for (const shard of database.shards) {
    const file = path.join(destination,shard.entry.url);
    fs.mkdirSync(path.dirname(file), {recursive:true});
    if (fs.existsSync(file)) invariant(fs.readFileSync(file).equals(shard.raw), 'Immutable snapshot collision');
    else fs.writeFileSync(file,shard.raw,{flag:'wx'});
  }
  const immutableManifest = path.join(destination,'snapshots',database.manifest.snapshot_id,'manifest.json');
  if (fs.existsSync(immutableManifest)) invariant(fs.readFileSync(immutableManifest).equals(database.raw), 'Immutable manifest collision');
  else fs.writeFileSync(immutableManifest,database.raw,{flag:'wx'});
  fs.writeFileSync(path.join(destination,'services.json.tmp'),JSON.stringify(database.compatibility));
  fs.renameSync(path.join(destination,'services.json.tmp'),path.join(destination,'services.json'));
  fs.writeFileSync(path.join(destination,'index.json.tmp'),database.raw);
  fs.renameSync(path.join(destination,'index.json.tmp'),path.join(destination,'index.json'));
  // Bound published generations to current plus two predecessors. Cached old
  // shards remain independently usable offline; unknown disk files are untouched.
  const snapshotsDir = path.join(destination,'snapshots');
  const candidates = fs.readdirSync(snapshotsDir,{withFileTypes:true}).filter(entry => entry.isDirectory() && /^[a-f0-9]{24}$/.test(entry.name)).map(entry => ({id:entry.name,mtime:fs.statSync(path.join(snapshotsDir,entry.name)).mtimeMs})).sort((a,b) => b.mtime-a.mtime || a.id.localeCompare(b.id));
  const keep = new Set([database.manifest.snapshot_id]);
  if (previous) keep.add(previous);
  for (const candidate of candidates) if (keep.size < 3) keep.add(candidate.id);
  for (const candidate of candidates) if (!keep.has(candidate.id)) {
    const directory = path.join(snapshotsDir,candidate.id);
    const files = fs.readdirSync(directory,{withFileTypes:true});
    if (files.every(file => file.isFile() && (file.name === 'manifest.json' || /^c_[a-z0-9_]+\.json$/.test(file.name)))) fs.rmSync(directory,{recursive:true});
  }
}
module.exports = {build,buildDatabase,writeDatabase,validateSource,selectRows,CATEGORIES,MAX_ROWS,MAX_SHARD_BYTES,MAX_MANIFEST_BYTES};

if (require.main === module) {
  const sourceDir = path.join(root, 'data/sources/services');
  const sources = fs.readdirSync(sourceDir).filter(name => /^(legacy|[A-Z]{2})\.json$/.test(name)).sort().map(name => JSON.parse(fs.readFileSync(path.join(sourceDir,name),'utf8')));
  const result = buildDatabase(sources);
  writeDatabase(result,outDir);
  console.log(`services v2: ${result.manifest.total} identities, ${result.shards.length} shards, manifest ${result.raw.length} bytes, snapshot ${result.manifest.snapshot_id}`);
}
