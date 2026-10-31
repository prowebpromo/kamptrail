#!/usr/bin/env node
'use strict';
// R8 amenity-ownership repair check (2.31.0). Compares this checkout with an unchanged
// baseline checkout. Every intended amenity change is reported. Any other difference is an
// unexpected delta and fails the check (exit code 1).
//
//   node scripts/verify-amenity-ownership.js --baseline=/unchanged/checkout [--report=out.json] [--cases=cases.json]
//
// Invariants, for every listing and snapshot row: listing IDs, coordinates, aliases and legacy_ids,
// state partitions, snapshot membership (source_ids), fees, fee evidence, access classifications,
// admission, type, rig data and saved-place resolution. Only amenity tags may move, and only into
// attributed member evidence on an element that really carries them in the retained OSM extract.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

const args = process.argv.slice(2), arg = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!arg('baseline')) throw new Error('Use --baseline=/unchanged/checkout [--report=out.json] [--cases=cases.json]');
const root = path.resolve(__dirname, '..'), baseline = path.resolve(arg('baseline'));
if (root === baseline) throw new Error('Baseline must be a separate unchanged checkout');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const NEW = require(path.join(root, 'data-quality.js'));
const OLD = loadIsolated(path.join(baseline, 'data-quality.js'));
const AMENITY_TAG = NEW.OSM_AMENITY_TAG;
const FEE_ACCESS = k => /(^|:)(fee|charge)(:|$)/.test(k) || /^access(:|$)/.test(k);
// Normalized keys the repair is allowed to change. Everything else must be byte-identical.
const AMENITY_KEYS = new Set(['amenities', 'amenity_negatives', 'osm_amenity_tags', 'amenity_members', 'amenity_record']);
const unexpected = [];
const fail = (kind, id, detail) => unexpected.push({kind, id, ...detail});

function loadIsolated(file) {
  // Each data-quality.js copy registers on its own global so baseline and repair never share state.
  const vm = require('node:vm'), context = {module:{exports:{}}, URL, Date, Set, Map, WeakSet, JSON, Math, Number, String, Object, Array, console};
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, {filename:file});
  return context.module.exports;
}

const states = fs.readdirSync(path.join(root, 'data/campsites')).filter(n => /^[A-Z]{2}_merged\.geojson$/.test(n)).map(n => n.slice(0, 2)).sort();
if (states.length !== 50) throw new Error('Expected 50 state snapshots');

// 1. Retained raw inputs are unchanged (no source refresh).
const inputHashes = {};
for (const sub of ['data/opencampingmap', 'data/campsites', 'data/campsites/agency']) {
  for (const name of fs.readdirSync(path.join(root, sub)).filter(n => /^[A-Z]{2}(?:\(1\))?\.geojson$/.test(n)).sort()) {
    const rel = `${sub}/${name}`;
    inputHashes[rel] = sha(path.join(root, rel));
    if (inputHashes[rel] !== sha(path.join(baseline, rel))) fail('raw_input_changed', rel, {});
  }
}
for (const rel of ['data/campsites/ridb-sites.json', 'data/campsites/ridb-amenities.json', 'data/campsites/usfs-site-amenities.json', 'data/campsites/coordinate-index.json', 'data/campsites/index.json', 'data/campsites/agency/index.json']) {
  inputHashes[rel] = sha(path.join(root, rel));
  if (inputHashes[rel] !== sha(path.join(baseline, rel))) fail('unchanged_file_changed', rel, {});
}

// 2. Retained OSM element tags, the ownership ground truth.
const elements = new Map();
for (const name of fs.readdirSync(path.join(root, 'data/opencampingmap')).filter(n => /^[A-Z]{2}\.geojson$/.test(n))) {
  for (const f of read(path.join(root, 'data/opencampingmap', name)).features) {
    const p = f.properties || {};
    if (p.osm_id != null && p.osm_type) elements.set(`osm:${p.osm_type}:${p.osm_id}`, p);
  }
}
const ownsTag = (id, key, value) => elements.has(id) && Object.hasOwn(elements.get(id), key) && String(elements.get(id)[key]) === String(value);

// 3. Snapshot rows.
const snapshot = {rows:0, rows_changed:0, tags_moved:0, tags_moved_by_key:{}, rows_with_member_amenity_evidence:0, states_changed:[]};
for (const state of states) {
  const file = `data/campsites/${state}_merged.geojson`;
  const before = read(path.join(baseline, file)), after = read(path.join(root, file));
  if (sha(path.join(baseline, file)) !== sha(path.join(root, file))) snapshot.states_changed.push(state);
  const strip = o => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'features'));
  if (JSON.stringify(strip(before)) !== JSON.stringify(strip(after))) fail('snapshot_header', state, {});
  if (before.features.length !== after.features.length) { fail('snapshot_row_count', state, {before:before.features.length, after:after.features.length}); continue; }
  before.features.forEach((b, i) => {
    const a = after.features[i], bp = b.properties, ap = a.properties, id = bp.id;
    snapshot.rows++;
    if (ap.id !== id) return fail('snapshot_row_order_or_id', id, {state, after:ap.id});
    if (JSON.stringify(a.geometry) !== JSON.stringify(b.geometry) || a.type !== b.type) fail('snapshot_geometry', id, {state});
    const other = p => JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => !AMENITY_TAG.test(k) && k !== 'member_evidence')));
    if (other(ap) !== other(bp)) {
      const keys = [...new Set([...Object.keys(ap), ...Object.keys(bp)])].filter(k => !AMENITY_TAG.test(k) && k !== 'member_evidence' && JSON.stringify(ap[k]) !== JSON.stringify(bp[k]));
      fail('snapshot_non_amenity_field', id, {state, keys});
    }
    // Amenity tags may only be removed, never added or changed.
    const moved = [];
    for (const k of Object.keys(ap).filter(k => AMENITY_TAG.test(k))) if (String(ap[k]) !== String(bp[k])) fail('snapshot_amenity_tag_added_or_changed', id, {state, key:k});
    for (const k of Object.keys(bp).filter(k => AMENITY_TAG.test(k) && !Object.hasOwn(ap, k))) moved.push(k);
    // Tags retained on the row must belong to the row's own element.
    for (const k of Object.keys(ap).filter(k => AMENITY_TAG.test(k))) if (!/^osm:/.test(id) || !ownsTag(id, k, ap[k])) fail('snapshot_retained_tag_not_owned', id, {state, key:k, value:ap[k]});
    // Member evidence: fee and access fields unchanged, new fields amenity-only, members are real members.
    const bm = new Map((bp.member_evidence || []).map(e => [e.source_record_id, e])), am = new Map((ap.member_evidence || []).map(e => [e.source_record_id, e]));
    for (const [rid, e] of bm) {
      const n = am.get(rid);
      if (!n) { fail('member_evidence_record_lost', id, {state, member:rid}); continue; }
      const feeFields = r => JSON.stringify(Object.fromEntries(Object.entries(r.fields).filter(([k]) => FEE_ACCESS(k))));
      const meta = r => JSON.stringify({...r, fields:undefined});
      if (feeFields(e) !== feeFields(n) || meta(e) !== meta(n)) fail('member_evidence_fee_access_changed', id, {state, member:rid});
    }
    let hasAmenityMember = false;
    for (const [rid, e] of am) {
      if (!(ap.source_ids || []).includes(rid)) fail('member_evidence_not_a_member', id, {state, member:rid});
      for (const [k, v] of Object.entries(e.fields)) {
        if (FEE_ACCESS(k)) { if (!bm.has(rid) || String(bm.get(rid).fields[k]) !== String(v)) fail('member_evidence_new_fee_access_field', id, {state, member:rid, key:k}); continue; }
        if (!AMENITY_TAG.test(k)) { fail('member_evidence_unexpected_field', id, {state, member:rid, key:k}); continue; }
        hasAmenityMember = true;
        if (!ownsTag(rid, k, v)) fail('member_evidence_tag_not_owned_by_member', id, {state, member:rid, key:k});
      }
      if (e.retrieved_at && !Number.isFinite(Date.parse(e.retrieved_at))) fail('member_evidence_date', id, {state, member:rid});
    }
    if (hasAmenityMember) snapshot.rows_with_member_amenity_evidence++;
    // Every removed tag is either not owned by the row, and is retained on a member that owns it.
    for (const k of moved) {
      if (/^osm:/.test(id) && ownsTag(id, k, bp[k])) fail('snapshot_owned_tag_removed', id, {state, key:k});
      if (![...am.values()].some(e => String(e.fields[k]) === String(bp[k]))) fail('snapshot_tag_dropped_without_member_evidence', id, {state, key:k, value:bp[k]});
      snapshot.tags_moved++;
      snapshot.tags_moved_by_key[k] = (snapshot.tags_moved_by_key[k] || 0) + 1;
    }
    if (moved.length || JSON.stringify(ap.member_evidence) !== JSON.stringify(bp.member_evidence)) snapshot.rows_changed++;
  });
}

// 4. National index: every field except the amenity filter metadata is unchanged.
const indexBefore = read(path.join(baseline, 'data/campsites/search-index.json')), indexAfter = read(path.join(root, 'data/campsites/search-index.json'));
const index = {sites:indexAfter.sites.length, m_a_changed:0, m_s_added:0};
{
  const head = d => JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => !['sites', 'amenity_version'].includes(k))));
  if (head(indexBefore) !== head(indexAfter)) fail('index_header', 'search-index.json', {});
  if (indexAfter.amenity_version !== 1) fail('index_amenity_version', 'search-index.json', {});
  if (indexBefore.sites.length !== indexAfter.sites.length) fail('index_count', 'search-index.json', {before:indexBefore.sites.length, after:indexAfter.sites.length});
  indexBefore.sites.forEach((b, i) => {
    const a = indexAfter.sites[i];
    if (!a || a.id !== b.id) return fail('index_order_or_id', b.id, {after:a?.id});
    const strip = s => JSON.stringify({...s, m:Object.fromEntries(Object.entries(s.m).filter(([k]) => k !== 'a' && k !== 's'))});
    if (strip(a) !== strip(b)) fail('index_non_amenity_field', b.id, {});
    if (JSON.stringify(a.m.a || []) !== JSON.stringify(b.m.a || [])) index.m_a_changed++;
    if (a.m.s) index.m_s_added++;
  });
}

// 5. Full published catalogue, exactly as the map and the index build it, in both checkouts.
function catalogue(dir, DQ) {
  const directory = path.join(dir, 'data/campsites'), details = read(path.join(directory, 'ridb-sites.json')).facilities;
  const ridb = read(path.join(directory, 'ridb-amenities.json')), usfs = read(path.join(directory, 'usfs-site-amenities.json'));
  const idx = read(path.join(directory, 'search-index.json')).sites, preferredIds = new Set(idx.map(s => s.id)), previousHosts = new Map();
  for (const s of idx) for (const alias of s.legacy_ids || []) previousHosts.set(alias, s.id);
  const attach = f => { DQ.attachSiteDetails(f, details); DQ.attachRIDBAmenities(f, ridb); DQ.attachUSFSSiteAmenities(f, usfs); };
  const input = [];
  for (const state of states) {
    const features = read(path.join(directory, `${state}_merged.geojson`)).features, agency = path.join(directory, 'agency', `${state}.geojson`);
    if (fs.existsSync(agency)) features.push(...read(agency).features);
    for (const raw of DQ.publicationCandidates(features, {state})) { const f = DQ.normalizeFeature(raw, {state}); if (f) { attach(f); input.push(f); } }
  }
  const out = DQ.cleanAndDedupeGeoJSON({type:'FeatureCollection', features:input}, {preferredIds, previousHosts}).features;
  out.forEach(attach);
  return out;
}
const oldCat = catalogue(baseline, OLD), newCat = catalogue(root, NEW);
const O = new Map(oldCat.map(f => [f.properties.id, f])), N = new Map(newCat.map(f => [f.properties.id, f]));
if (O.size !== N.size || [...O.keys()].some(id => !N.has(id))) fail('catalogue_identity', 'catalogue', {before:O.size, after:N.size});
const indexIds = new Set(indexAfter.sites.map(s => s.id));
if (N.size !== indexIds.size || [...N.keys()].some(id => !indexIds.has(id))) fail('catalogue_differs_from_index', 'catalogue', {});
const evidenceKeys = new Set(['ridb_amenity_evidence', 'usfs_site_evidence']);
const comparable = p => JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => !AMENITY_KEYS.has(k) && !AMENITY_TAG.test(k) && !evidenceKeys.has(k) && k !== 'member_evidence').sort(([x], [y]) => x < y ? -1 : 1)));
const evidenceIds = p => JSON.stringify([Object.keys(p.ridb_amenity_evidence?.facilities || {}).sort(), Object.keys(p.usfs_site_evidence?.facilities || {}).sort()]);
const saved = {aliases_checked:0};
const sitesBy = new Map(indexAfter.sites.map(s => [s.id, s])), resolveIn = sites => { const m = new Map(); for (const s of sites) for (const id of [s.id, ...(s.legacy_ids || [])]) if (!m.has(id)) m.set(id, s.id); return m; };
const resolveBefore = resolveIn(indexBefore.sites), resolveAfter = resolveIn(indexAfter.sites);
for (const [id, host] of resolveBefore) { saved.aliases_checked++; if (resolveAfter.get(id) !== host) fail('saved_place_resolution', id, {before:host, after:resolveAfter.get(id)}); }
const changes = [];
for (const [id, o] of O) {
  const n = N.get(id); if (!n) continue;
  const op = o.properties, np = n.properties;
  if (JSON.stringify(o.geometry) !== JSON.stringify(n.geometry)) fail('catalogue_geometry', id, {});
  if (comparable(op) !== comparable(np)) {
    const keys = [...new Set([...Object.keys(op), ...Object.keys(np)])].filter(k => !AMENITY_KEYS.has(k) && !AMENITY_TAG.test(k) && !evidenceKeys.has(k) && k !== 'member_evidence' && JSON.stringify(op[k]) !== JSON.stringify(np[k]));
    fail('catalogue_non_amenity_field', id, {keys});
  }
  if (evidenceIds(op) !== evidenceIds(np)) fail('catalogue_sidecar_join_changed', id, {});
  if ((np.amenity_members || []).length >= 128) fail('amenity_member_cap_reached', id, {});
  // Every value the new popup and filter treat as the listing's own must be owned by it.
  for (const [k, v] of Object.entries(np.osm_amenity_tags || {})) if (!ownsTag(id, k, v)) fail('catalogue_tag_not_owned', id, {key:k});
  for (const m of np.amenity_members || []) for (const [k, v] of Object.entries(m.fields)) if (/^osm:/.test(m.source_record_id) && !ownsTag(m.source_record_id, k, v)) fail('catalogue_member_tag_not_owned', id, {member:m.source_record_id, key:k});
  const beforeShown = [...op.amenities].sort(), sets = NEW.amenityFilterSets(np);
  const afterOwn = [...np.amenities].sort();
  const beforeFilter = NEW.FILTER_AMENITIES.filter(a => op.amenities.includes(a)), afterFilter = NEW.FILTER_AMENITIES.filter(a => NEW.amenityMatches(np, [a], {}));
  if (JSON.stringify(beforeShown) !== JSON.stringify(afterOwn) || JSON.stringify(beforeFilter) !== JSON.stringify(afterFilter) || (np.amenity_members || []).length) {
    changes.push({id, name:np.name, before_shown:beforeShown, after_own_osm:afterOwn, removed:beforeShown.filter(a => !afterOwn.includes(a)), before_filter:beforeFilter, after_filter:afterFilter, after_filter_campground:sets.g, after_filter_campsite_records:sets.s, members:(np.amenity_members || []).map(m => m.source_record_id)});
  }
}

// 6. Borrowed-amenity listings (188) and Recreation.gov toilet-record listings (221), from the baseline.
const ownedAmenity = (p, a) => /^osm:/.test(p.id) && ({toilet:'toilets', water:'drinking_water', dump:'sanitary_dump_station', fire_ring:'fireplace', picnic_table:'picnic_table', shower:'shower'}[a] || null) && String(elements.get(p.id)?.[{toilet:'toilets', water:'drinking_water', dump:'sanitary_dump_station', fire_ring:'fireplace', picnic_table:'picnic_table', shower:'shower'}[a]] || '').toLowerCase() === 'yes';
const borrowed = oldCat.filter(f => f.properties.amenities.some(a => !ownedAmenity(f.properties, a)));
const ridbToilets = oldCat.filter(f => Object.values(f.properties.ridb_amenity_evidence?.facilities || {}).some(r => r.amenities.toilet?.reported > 0));
const rig = {rigLength:20};
const caseRow = f => {
  const id = f.properties.id, op = f.properties, np = N.get(id).properties;
  const out = {id, name:np.name, class:id.split(':')[0], borrowed:borrowed.includes(f), ridb_toilet_records:ridbToilets.includes(f),
    before_shown:[...op.amenities].sort(), borrowed_values:op.amenities.filter(a => !ownedAmenity(op, a)).sort(),
    before_toilet_filter:op.amenities.includes('toilet'), before_water_filter:op.amenities.includes('water')};
  for (const [key, a, filters] of [['toilet', 'toilet', {}], ['water', 'water', {}], ['toilet_with_length_filter', 'toilet', rig]]) out[key] = NEW.amenityFilterReason(np, a, filters);
  return out;
};
const cases = [...new Map([...borrowed, ...ridbToilets].map(f => [f.properties.id, f])).values()].map(caseRow).sort((a, b) => a.id < b.id ? -1 : 1);
const tally = (rows, key) => rows.reduce((t, r) => { const k = r[key].included ? 'included' : 'excluded:' + r[key].reason; t[k] = (t[k] || 0) + 1; return t; }, {});
const summary = {
  borrowed_listings:borrowed.length, borrowed_by_class:borrowed.reduce((t, f) => (t[f.properties.id.split(':')[0]] = (t[f.properties.id.split(':')[0]] || 0) + 1, t), {}),
  ridb_toilet_listings:ridbToilets.length,
  ridb_toilet_before_hidden_by_filter:ridbToilets.filter(f => !f.properties.amenities.includes('toilet')).length,
  borrowed_toilet:tally(cases.filter(c => c.borrowed), 'toilet'), borrowed_water:tally(cases.filter(c => c.borrowed), 'water'),
  ridb_toilet_toilet:tally(cases.filter(c => c.ridb_toilet_records), 'toilet'), ridb_toilet_water:tally(cases.filter(c => c.ridb_toilet_records), 'water'),
  ridb_toilet_toilet_with_length_filter:tally(cases.filter(c => c.ridb_toilet_records), 'toilet_with_length_filter')
};

const report = {
  baseline_commit:execFileSync('git', ['rev-parse', 'HEAD'], {cwd:baseline, encoding:'utf8'}).trim(),
  input_hashes:inputHashes,
  output_hashes:Object.fromEntries([...states.map(s => `data/campsites/${s}_merged.geojson`), 'data/campsites/search-index.json', 'data/campsites/coordinate-index.json'].map(rel => [rel, sha(path.join(root, rel))])),
  snapshot, index, saved_places:saved, catalogue:{listings:N.size, listings_with_amenity_change:changes.length,
    listings_losing_a_shown_value:changes.filter(c => c.removed.length).length,
    filter_hits_before:Object.fromEntries(NEW.FILTER_AMENITIES.map(a => [a, oldCat.filter(f => f.properties.amenities.includes(a)).length])),
    filter_hits_after:Object.fromEntries(NEW.FILTER_AMENITIES.map(a => [a, newCat.filter(f => NEW.amenityMatches(f.properties, [a], {})).length])),
    filter_hits_after_with_length_filter:Object.fromEntries(NEW.FILTER_AMENITIES.map(a => [a, newCat.filter(f => NEW.amenityMatches(f.properties, [a], rig)).length])),
    listings_with_member_amenity_evidence:newCat.filter(f => (f.properties.amenity_members || []).length).length,
    no_amenity_source:newCat.filter(f => NEW.amenityEvidence(f.properties).state === 'no_source').length},
  cases_summary:summary,
  unexpected_delta_count:unexpected.length, unexpected_deltas:unexpected.slice(0, 500),
  intended_changes:changes
};
report.output_digest = crypto.createHash('sha256').update(JSON.stringify(report.output_hashes)).digest('hex');
if (arg('report')) { fs.mkdirSync(path.dirname(path.resolve(arg('report'))), {recursive:true}); fs.writeFileSync(path.resolve(arg('report')), JSON.stringify(report, null, 2) + '\n'); }
if (arg('cases')) fs.writeFileSync(path.resolve(arg('cases')), JSON.stringify({version:1, generated_from:{baseline_commit:report.baseline_commit, output_digest:report.output_digest}, length_filter_used:rig, summary, cases}, null, 1) + '\n');
console.log(JSON.stringify({output_digest:report.output_digest, snapshot, index, saved_places:saved, catalogue:report.catalogue, cases_summary:summary, unexpected_delta_count:unexpected.length, first_unexpected:unexpected.slice(0, 10)}, null, 2));
if (unexpected.length) process.exitCode = 1;
