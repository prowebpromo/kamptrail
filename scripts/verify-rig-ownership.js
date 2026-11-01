#!/usr/bin/env node
'use strict';
// Rig-tag ownership repair check (2.34.0). Compares this checkout with an unchanged baseline checkout.
// Every intended rig change is listed. Any other difference is an unexpected delta and fails (exit code 1).
//
//   node scripts/verify-rig-ownership.js --baseline=/unchanged/checkout [--report=out.json] [--cases=cases.json] [--csv=cases.csv]
//
// Allowed: rig-suitability tags removed from a snapshot row that does not own them, the same values added to
// member evidence on a member that owns them in the retained extract, rig_friendly losing categories its own
// sources do not state, and the rig evidence fields. Must be identical: listing IDs, coordinates, aliases and
// legacy_ids, state partitions, snapshot membership (source_ids), listing type, camping classification,
// fees, fee evidence, access, admission, amenity evidence, sidecar joins and saved-place resolution.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), vm = require('node:vm');
const {execFileSync} = require('node:child_process');

const args = process.argv.slice(2), arg = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!arg('baseline')) throw new Error('Use --baseline=/unchanged/checkout [--report=out.json] [--cases=cases.json] [--csv=cases.csv]');
const root = path.resolve(__dirname, '..'), baseline = path.resolve(arg('baseline'));
if (root === baseline) throw new Error('Baseline must be a separate unchanged checkout');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function loadIsolated(file) {
  const context = {module:{exports:{}}, URL, Date, Set, Map, WeakSet, JSON, Math, Number, String, Object, Array, console};
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, {filename:file});
  return context.module.exports;
}
const NEW = loadIsolated(path.join(root, 'data-quality.js')), OLD = loadIsolated(path.join(baseline, 'data-quality.js'));
const RIG_TAG = NEW.OSM_RIG_TAG, CATS = NEW.RIG_CATEGORIES;
const FEE_ACCESS = k => /(^|:)(fee|charge)(:|$)/.test(k) || /^access(:|$)/.test(k);
const AMENITY_TAG = NEW.OSM_AMENITY_TAG;
// Normalized keys the repair may change. Everything else must be byte-identical.
const RIG_KEYS = new Set(['rig_friendly', 'rig_negatives', 'osm_rig_tags', 'rig_record', 'rig_members', 'ridb_rig_check']);
const unexpected = [], fail = (kind, id, detail = {}) => unexpected.push({kind, id, ...detail});
const states = fs.readdirSync(path.join(root, 'data/campsites')).filter(n => /^[A-Z]{2}_merged\.geojson$/.test(n)).map(n => n.slice(0, 2)).sort();
if (states.length !== 50) throw new Error('Expected 50 state snapshots');

// 1. Retained inputs unchanged.
const inputHashes = {};
for (const sub of ['data/opencampingmap', 'data/campsites', 'data/campsites/agency']) {
  for (const name of fs.readdirSync(path.join(root, sub)).filter(n => /^[A-Z]{2}(?:\(1\))?\.geojson$/.test(n)).sort()) {
    const rel = `${sub}/${name}`; inputHashes[rel] = sha(path.join(root, rel));
    if (inputHashes[rel] !== sha(path.join(baseline, rel))) fail('raw_input_changed', rel);
  }
}
for (const rel of ['data/campsites/ridb-sites.json', 'data/campsites/ridb-amenities.json', 'data/campsites/usfs-site-amenities.json', 'data/campsites/coordinate-index.json', 'data/campsites/index.json', 'data/campsites/agency/index.json']) {
  inputHashes[rel] = sha(path.join(root, rel));
  if (inputHashes[rel] !== sha(path.join(baseline, rel))) fail('unchanged_file_changed', rel);
}

// 2. Ownership ground truth: each retained OSM element's own tags, and each agency record's own rig list.
const elements = new Map(), agency = new Map();
for (const name of fs.readdirSync(path.join(root, 'data/opencampingmap')).filter(n => /^[A-Z]{2}\.geojson$/.test(n))) {
  for (const f of read(path.join(root, 'data/opencampingmap', name)).features) { const p = f.properties || {}; if (p.osm_id != null && p.osm_type) elements.set(`osm:${p.osm_type}:${p.osm_id}`, p); }
}
for (const state of states) { const file = path.join(root, 'data/campsites/agency', `${state}.geojson`); if (fs.existsSync(file)) for (const f of read(file).features) agency.set(f.properties.id, f.properties); }
const ownsTag = (id, key, value) => elements.has(id) && Object.hasOwn(elements.get(id), key) && String(elements.get(id)[key]) === String(value);

// 3. Snapshot rows.
const snapshot = {rows:0, rows_changed:0, tags_moved:0, tags_moved_by_key:{}, rows_with_member_rig_evidence:0, states_changed:[]};
for (const state of states) {
  const file = `data/campsites/${state}_merged.geojson`, before = read(path.join(baseline, file)), after = read(path.join(root, file));
  if (sha(path.join(baseline, file)) !== sha(path.join(root, file))) snapshot.states_changed.push(state);
  const strip = o => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'features')));
  if (strip(before) !== strip(after)) fail('snapshot_header', state);
  if (before.features.length !== after.features.length) { fail('snapshot_row_count', state); continue; }
  before.features.forEach((b, i) => {
    const a = after.features[i], bp = b.properties, ap = a.properties, id = bp.id;
    snapshot.rows++;
    if (ap.id !== id) return fail('snapshot_row_order_or_id', id, {state, after:ap.id});
    if (JSON.stringify(a.geometry) !== JSON.stringify(b.geometry) || a.type !== b.type) fail('snapshot_geometry', id, {state});
    const other = p => JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => !RIG_TAG.test(k) && k !== 'member_evidence' && k !== 'rig_friendly')));
    if (other(ap) !== other(bp)) fail('snapshot_non_rig_field', id, {state, keys:[...new Set([...Object.keys(ap), ...Object.keys(bp)])].filter(k => !RIG_TAG.test(k) && k !== 'member_evidence' && k !== 'rig_friendly' && JSON.stringify(ap[k]) !== JSON.stringify(bp[k]))});
    // rig_friendly may only lose values (another record's list), never gain.
    for (const v of ap.rig_friendly || []) if (!(bp.rig_friendly || []).includes(v)) fail('snapshot_rig_list_gained', id, {state, value:v});
    const moved = [];
    for (const k of Object.keys(ap).filter(k => RIG_TAG.test(k))) {
      if (String(ap[k]) !== String(bp[k])) fail('snapshot_rig_tag_added_or_changed', id, {state, key:k});
      if (!/^osm:/.test(id) || !ownsTag(id, k, ap[k])) fail('snapshot_retained_rig_tag_not_owned', id, {state, key:k, value:ap[k]});
    }
    for (const k of Object.keys(bp).filter(k => RIG_TAG.test(k) && !Object.hasOwn(ap, k))) moved.push(k);
    const bm = new Map((bp.member_evidence || []).map(e => [e.source_record_id, e])), am = new Map((ap.member_evidence || []).map(e => [e.source_record_id, e]));
    for (const [rid, e] of bm) {
      const n = am.get(rid);
      if (!n) { fail('member_evidence_record_lost', id, {state, member:rid}); continue; }
      const kept = r => JSON.stringify({...r, fields:Object.fromEntries(Object.entries(r.fields).filter(([k]) => !RIG_TAG.test(k)))});
      if (kept(e) !== kept(n)) fail('member_evidence_non_rig_changed', id, {state, member:rid});
    }
    let rigMember = false;
    for (const [rid, e] of am) {
      if (!(ap.source_ids || []).includes(rid)) fail('member_evidence_not_a_member', id, {state, member:rid});
      for (const [k, v] of Object.entries(e.fields)) {
        if (!RIG_TAG.test(k)) { if (!bm.has(rid) || String(bm.get(rid).fields[k]) !== String(v)) fail('member_evidence_new_non_rig_field', id, {state, member:rid, key:k}); continue; }
        rigMember = true;
        if (!ownsTag(rid, k, v)) fail('member_evidence_rig_tag_not_owned_by_member', id, {state, member:rid, key:k});
      }
    }
    if (rigMember) snapshot.rows_with_member_rig_evidence++;
    for (const k of moved) {
      if (/^osm:/.test(id) && ownsTag(id, k, bp[k])) fail('snapshot_owned_rig_tag_removed', id, {state, key:k});
      if (![...am.values()].some(e => String(e.fields[k]) === String(bp[k]))) fail('snapshot_rig_tag_dropped_without_member_evidence', id, {state, key:k, value:bp[k]});
      snapshot.tags_moved++; snapshot.tags_moved_by_key[k] = (snapshot.tags_moved_by_key[k] || 0) + 1;
    }
    if (moved.length || JSON.stringify(ap.member_evidence) !== JSON.stringify(bp.member_evidence) || JSON.stringify(ap.rig_friendly) !== JSON.stringify(bp.rig_friendly)) snapshot.rows_changed++;
  });
}

// 4. Full published catalogue in both checkouts, exactly as the index build makes it.
function catalogue(dir, DQ) {
  const directory = path.join(dir, 'data/campsites'), details = read(path.join(directory, 'ridb-sites.json')).facilities;
  const ridb = read(path.join(directory, 'ridb-amenities.json')), usfs = read(path.join(directory, 'usfs-site-amenities.json'));
  const idx = read(path.join(baseline, 'data/campsites/search-index.json')).sites, preferredIds = new Set(idx.map(s => s.id)), previousHosts = new Map();
  for (const s of idx) for (const alias of s.legacy_ids || []) previousHosts.set(alias, s.id);
  const attach = f => { DQ.attachSiteDetails(f, details); DQ.attachRIDBAmenities(f, ridb); DQ.attachUSFSSiteAmenities(f, usfs); };
  const input = [];
  for (const state of states) {
    const features = read(path.join(directory, `${state}_merged.geojson`)).features, ag = path.join(directory, 'agency', `${state}.geojson`);
    if (fs.existsSync(ag)) features.push(...read(ag).features);
    for (const raw of DQ.publicationCandidates(features, {state})) { const f = DQ.normalizeFeature(raw, {state}); if (f) { attach(f); input.push(f); } }
  }
  const out = DQ.cleanAndDedupeGeoJSON({type:'FeatureCollection', features:input}, {preferredIds, previousHosts}).features;
  out.forEach(attach);
  return out;
}
const oldCat = catalogue(baseline, OLD), newCat = catalogue(root, NEW);
const O = new Map(oldCat.map(f => [f.properties.id, f])), N = new Map(newCat.map(f => [f.properties.id, f]));
if (O.size !== N.size || [...O.keys()].some(id => !N.has(id))) fail('catalogue_identity', 'catalogue', {before:O.size, after:N.size});
const indexBefore = read(path.join(baseline, 'data/campsites/search-index.json')), indexAfter = read(path.join(root, 'data/campsites/search-index.json'));
const indexIds = new Set(indexAfter.sites.map(s => s.id));
if (N.size !== indexIds.size || [...N.keys()].some(id => !indexIds.has(id))) fail('catalogue_differs_from_index', 'catalogue');
const comparable = p => JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => !RIG_KEYS.has(k) && !RIG_TAG.test(k) && k !== 'member_evidence').sort(([x], [y]) => x < y ? -1 : 1)));

// Expected own-source state, computed from the retained inputs, not from the guard.
const ownTags = id => { const e = /^osm:/.test(id) ? elements.get(id) : null, o = {}; if (e) for (const k of Object.values(CATS)) if (e[k] != null && e[k] !== '') o[k] = String(e[k]); return o; };
const ownList = id => { const a = agency.get(id); return a && Array.isArray(a.rig_friendly) ? [...new Set(a.rig_friendly.map(v => v === 'RV' ? 'rv' : v))] : []; };
const expectedAfter = (id, p) => {
  const o = ownTags(id), s = new Set(ownList(id));
  for (const [c, k] of Object.entries(CATS)) if (o[k] === 'yes') s.add(c);
  // Own yes contradicted by an own Recreation.gov count of 0 RV-type sites is a conflict, not a match.
  const check = p.facility_id != null ? {t:p.site_count, r:p.rv_sites} : p.ridb_rig_check;
  if (check && check.t > 0 && check.r === 0 && Object.keys(o).length) for (const c of ['trailer', 'rv']) if (o[CATS[c]] === 'yes') s.delete(c);
  return [...s].sort();
};
const labels = {tent:'Tents', trailer:'Trailers and caravans', rv:'RV'};
const beforeLine = p => p.rig_friendly.length ? p.rig_friendly.map(c => labels[c] || c).join(', ') : '';
// Membership as the merged snapshot rows record it, for attributing borrowed values to their member.
const rowMembers = new Map();
for (const state of states) for (const f of read(path.join(baseline, `data/campsites/${state}_merged.geojson`)).features) {
  const p = f.properties; if (!rowMembers.has(p.id)) rowMembers.set(p.id, new Set()); for (const m of p.source_ids || []) if (m !== p.id) rowMembers.get(p.id).add(m);
}
const membersOf = p => [...new Set([...(p.legacy_ids || []).filter(m => m !== p.id), ...[p.id, ...(p.legacy_ids || [])].flatMap(i => [...(rowMembers.get(i) || [])])])].filter(m => m !== p.id).sort();

const saved = {aliases_checked:0};
const resolveIn = sites => { const m = new Map(); for (const s of sites) for (const id of [s.id, ...(s.legacy_ids || [])]) if (!m.has(id)) m.set(id, s.id); return m; };
const rb = resolveIn(indexBefore.sites), ra = resolveIn(indexAfter.sites);
for (const [id, host] of rb) { saved.aliases_checked++; if (ra.get(id) !== host) fail('saved_place_resolution', id, {before:host, after:ra.get(id)}); }

const cases = [], popupOnly = {own_negative_or_unrecognized_shown:0, merged_rig_tags_listed:0};
for (const [id, o] of O) {
  const n = N.get(id); if (!n) continue;
  const op = o.properties, np = n.properties;
  if (JSON.stringify(o.geometry) !== JSON.stringify(n.geometry)) fail('catalogue_geometry', id);
  if (comparable(op) !== comparable(np)) fail('catalogue_non_rig_field', id, {keys:[...new Set([...Object.keys(op), ...Object.keys(np)])].filter(k => !RIG_KEYS.has(k) && !RIG_TAG.test(k) && k !== 'member_evidence' && JSON.stringify(op[k]) !== JSON.stringify(np[k]))});
  for (const k of ['id', 'legacy_ids', 'type', 'camping_classification', 'camping_evidence', 'fee_status', 'cost', 'access', 'access_status']) if (JSON.stringify(op[k]) !== JSON.stringify(np[k])) fail('catalogue_' + k, id);
  for (const [k, v] of Object.entries(np.osm_rig_tags || {})) if (!ownsTag(id, k, v)) fail('catalogue_rig_tag_not_owned', id, {key:k});
  for (const m of np.rig_members || []) for (const [k, v] of Object.entries(m.fields)) if (/^osm:/.test(m.source_record_id) && k !== 'rig_friendly' && !ownsTag(m.source_record_id, k, v)) fail('catalogue_member_rig_tag_not_owned', id, {member:m.source_record_id, key:k});
  if ((np.rig_members || []).length >= 128) fail('rig_member_cap_reached', id);
  const before = [...op.rig_friendly].sort(), after = NEW.rigFilterSet(np).sort(), expect = expectedAfter(id, np);
  if (JSON.stringify(after) !== JSON.stringify(expect)) fail('rig_after_state_not_own_source', id, {after, expected:expect});
  const lineBefore = beforeLine(op), lineAfter = NEW.rigLine(np);
  const own = ownTags(id), list = ownList(id);
  const borrowed = before.filter(c => !expect.includes(c));
  const members = membersOf(np), memberValues = {};
  for (const m of members) {
    const e = elements.get(m), v = {};
    if (e) for (const k of Object.values(CATS)) if (e[k] != null && e[k] !== '') v[k] = String(e[k]);
    const a = agency.get(m); if (a && Array.isArray(a.rig_friendly) && a.rig_friendly.length) v.rig_friendly = a.rig_friendly.join(';');
    if (Object.keys(v).length) memberValues[m] = v;
  }
  const borrowedFrom = Object.fromEntries(borrowed.map(c => [c, Object.entries(memberValues).filter(([, v]) => v[CATS[c]] === 'yes' || String(v.rig_friendly || '').split(';').map(x => x === 'RV' ? 'rv' : x).includes(c)).map(([m]) => m)]));
  for (const c of borrowed) if (!borrowedFrom[c].length) fail('borrowed_value_without_member_source', id, {category:c});
  const contradiction = Object.entries(memberValues).some(([, v]) => Object.values(CATS).some(k => /^(yes|no)$/.test(own[k] || '') && /^(yes|no)$/.test(v[k] || '') && own[k] !== v[k]));
  const conflict = Object.values(NEW.rigEvidence(np).categories).some(x => x.status === 'conflict');
  const tentsBefore = before.includes('tent'), tentsAfter = NEW.applyFilters([n], {rigSize:'tent'}).length === 1, trailersBefore = before.includes('trailer'), trailersAfter = NEW.applyFilters([n], {rigSize:'trailer'}).length === 1;
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  if (!changed && !contradiction && !conflict) {
    if (lineBefore !== lineAfter) popupOnly.own_negative_or_unrecognized_shown++;
    if ((np.rig_members || []).length) popupOnly.merged_rig_tags_listed++;
    continue;
  }
  const evidence = [...Object.entries(own).map(([k, v]) => `${id} ${k}=${v}`), ...list.map(c => `${id} rig_friendly ${c}`)];
  if (np.facility_id != null && np.site_count != null) evidence.push(`Recreation.gov ${id}: ${np.rv_sites} of ${np.site_count} campsite records list RV or trailer equipment`);
  if (np.ridb_rig_check) evidence.push(`Recreation.gov ridb:${np.ridb_rig_check.fid}: ${np.ridb_rig_check.r} of ${np.ridb_rig_check.t} campsite records list RV or trailer equipment`);
  cases.push({id, name:np.name, own_values:own, own_record_rig_list:list, borrowed:borrowedFrom, member_values:memberValues,
    popup_before:lineBefore, popup_after:lineAfter, tents_before:tentsBefore, tents_after:tentsAfter, trailers_before:trailersBefore, trailers_after:trailersAfter,
    rv_before:before.includes('rv'), rv_after:after.includes('rv'), contradiction, conflict, after_evidence:evidence.length ? evidence : ['no own rig source']});
}

// 5. National index: only m.r may change, and only to the catalogue's rig filter set.
const index = {sites:indexAfter.sites.length, m_r_changed:0};
{
  const head = d => JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'sites')));
  if (head(indexBefore) !== head(indexAfter)) fail('index_header', 'search-index.json');
  if (indexBefore.sites.length !== indexAfter.sites.length) fail('index_count', 'search-index.json');
  indexBefore.sites.forEach((b, i) => {
    const a = indexAfter.sites[i];
    if (!a || a.id !== b.id) return fail('index_order_or_id', b.id, {after:a?.id});
    const strip = s => JSON.stringify({...s, m:Object.fromEntries(Object.entries(s.m).filter(([k]) => k !== 'r'))});
    if (strip(a) !== strip(b)) fail('index_non_rig_field', b.id);
    const want = N.has(a.id) ? NEW.rigFilterSet(N.get(a.id).properties) : null;
    if (want && JSON.stringify(a.m.r || []) !== JSON.stringify(want)) fail('index_rig_differs_from_catalogue', a.id, {index:a.m.r || [], catalogue:want});
    if (JSON.stringify(a.m.r || []) !== JSON.stringify(b.m.r || [])) index.m_r_changed++;
  });
}

// 6. Every changed listing is expected, and every expected change happened.
const changedIds = cases.filter(c => c.tents_before !== c.tents_after || c.trailers_before !== c.trailers_after || c.rv_before !== c.rv_after).map(c => c.id);
const filterChanges = {
  tents_removed:cases.filter(c => c.tents_before && !c.tents_after).map(c => c.id), tents_added:cases.filter(c => !c.tents_before && c.tents_after).map(c => c.id),
  trailers_removed:cases.filter(c => c.trailers_before && !c.trailers_after).map(c => c.id), trailers_added:cases.filter(c => !c.trailers_before && c.trailers_after).map(c => c.id),
  rv_label_removed:cases.filter(c => c.rv_before && !c.rv_after).map(c => c.id)
};
for (const id of [...filterChanges.tents_added, ...filterChanges.trailers_added]) fail('filter_gained_listing', id);
const popupChanges = cases.filter(c => c.popup_before !== c.popup_after).map(c => c.id);
const count = (cat, fn) => cat.filter(fn).length;
const summary = {
  listings:N.size, listings_with_rig_change:changedIds.length,
  by_class:changedIds.reduce((t, id) => (t[id.split(':')[0]] = (t[id.split(':')[0]] || 0) + 1, t), {}),
  tents_filter:{before:count(oldCat, f => f.properties.rig_friendly.includes('tent')), after:count(newCat, f => NEW.rigMatches(f.properties, 'tent'))},
  trailers_filter:{before:count(oldCat, f => f.properties.rig_friendly.includes('trailer')), after:count(newCat, f => NEW.rigMatches(f.properties, 'trailer'))},
  rv_label:{before:count(oldCat, f => f.properties.rig_friendly.includes('rv')), after:count(newCat, f => NEW.rigMatches(f.properties, 'rv'))},
  filter_changes:Object.fromEntries(Object.entries(filterChanges).map(([k, v]) => [k, v.length])),
  listings_with_tents_or_trailers_filter_change:cases.filter(c => c.tents_before !== c.tents_after || c.trailers_before !== c.trailers_after).length,
  popup_rig_line_changes_in_cases:popupChanges.length,
  popup_only_changes_outside_cases:popupOnly,
  contradictions:cases.filter(c => c.contradiction).map(c => c.id), conflicts:cases.filter(c => c.conflict).map(c => c.id),
  listings_with_rig_members:count(newCat, f => (f.properties.rig_members || []).length > 0)
};
const report = {baseline_commit:execFileSync('git', ['rev-parse', 'HEAD'], {cwd:baseline, encoding:'utf8'}).trim(), input_hashes:inputHashes,
  output_hashes:Object.fromEntries([...states.map(s => `data/campsites/${s}_merged.geojson`), 'data/campsites/search-index.json', 'data/campsites/coordinate-index.json'].map(rel => [rel, sha(path.join(root, rel))])),
  snapshot, index, saved_places:saved, summary, filter_changes:filterChanges, popup_changes:popupChanges,
  unexpected_delta_count:unexpected.length, unexpected_deltas:unexpected.slice(0, 500)};
report.output_digest = crypto.createHash('sha256').update(JSON.stringify(report.output_hashes)).digest('hex');
cases.sort((a, b) => a.id < b.id ? -1 : 1);
if (arg('report')) { fs.mkdirSync(path.dirname(path.resolve(arg('report'))), {recursive:true}); fs.writeFileSync(path.resolve(arg('report')), JSON.stringify(report, null, 2) + '\n'); }
if (arg('cases')) fs.writeFileSync(path.resolve(arg('cases')), JSON.stringify({version:1, generated_from:{baseline_commit:report.baseline_commit, output_digest:report.output_digest}, summary}, null, 1).replace(/\n}$/, ',\n "cases": [\n') + cases.map(c => JSON.stringify(c)).join(',\n') + '\n]}\n');
if (arg('csv')) {
  const q = v => { const s = typeof v === 'string' ? v : JSON.stringify(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const cols = ['id', 'name', 'own_values', 'own_record_rig_list', 'borrowed', 'popup_before', 'popup_after', 'tents_before', 'tents_after', 'trailers_before', 'trailers_after', 'rv_before', 'rv_after', 'contradiction', 'conflict', 'after_evidence'];
  fs.writeFileSync(path.resolve(arg('csv')), cols.join(',') + '\n' + cases.map(c => cols.map(k => q(k === 'after_evidence' ? c[k].join(' | ') : c[k])).join(',')).join('\n') + '\n');
}
console.log(JSON.stringify({output_digest:report.output_digest, snapshot, index, saved_places:saved, summary, unexpected_delta_count:unexpected.length, first_unexpected:unexpected.slice(0, 10)}, null, 2));
if (unexpected.length) process.exitCode = 1;
