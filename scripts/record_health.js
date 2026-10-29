#!/usr/bin/env node
'use strict';
// Records data refresh health in data/health.json so the app can show how fresh each source is
// and whether the last refresh run failed. Nothing here touches campsite data.
//
//   node scripts/record_health.js start                      begin a refresh run
//   node scripts/record_health.js record <source> <scope> <fresh|failed|skipped>
//   node scripts/record_health.js seed                       fill last_success from git history where no record exists
//
// fresh   = new data fetched and saved
// failed  = the fetch failed; the saved data was kept
// skipped = not attempted (for example, no API key); the saved data was kept
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const FILE = process.env.KT_HEALTH_FILE || path.join(ROOT, 'data', 'health.json');
const STATES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
const SOURCES = {
  ridb: {label: 'Recreation.gov campgrounds', scope: 'state', files: s => [`data/campsites/${s}.geojson`, `data/campsites/${s}(1).geojson`]},
  osm: {label: 'OpenStreetMap campsites', scope: 'state', files: s => [`data/opencampingmap/${s}.geojson`]},
  usfs: {label: 'Forest Service recreation sites', scope: 'national', files: () => ['data/sources/usfs.json']},
  blm: {label: 'BLM recreation sites', scope: 'national', files: () => ['data/sources/blm.json']},
  ridb_sites: {label: 'Recreation.gov site details', scope: 'national', files: () => ['data/campsites/ridb-sites.json']},
  services: {label: 'RV services (OpenStreetMap)', scope: 'national', files: () => ['data/services/services.json']},
};
const OUTCOMES = ['fresh', 'failed', 'skipped'];
// A source is stale when its oldest successful update is older than this.
const STALE_DAYS = 45;

function load() {
  try {
    const h = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (h && h.version === 1 && h.sources) return h;
  } catch {}
  return {version: 1, stale_after_days: STALE_DAYS, run: null, sources: {}};
}
function save(h) {
  h.generated = new Date().toISOString();
  h.stale_after_days = STALE_DAYS;
  for (const [id, def] of Object.entries(SOURCES)) {
    const s = h.sources[id] || (h.sources[id] = {scopes: {}});
    s.label = def.label;
    const scopes = Object.values(s.scopes);
    const ok = scopes.map(x => x.last_success).filter(Boolean).sort();
    s.oldest_success = ok[0] || null;
    s.newest_success = ok[ok.length - 1] || null;
    s.never_succeeded = scopes.filter(x => !x.last_success).length;
    s.last_outcomes = Object.fromEntries(['fresh', 'failed', 'skipped', 'not_recorded'].map(o => [o, scopes.filter(x => x.outcome === o).length]).filter(([, n]) => n));
  }
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(h, null, 1) + '\n');
  fs.renameSync(tmp, FILE);
}
function check(source, scope) {
  const def = SOURCES[source];
  if (!def) throw new Error(`Unknown source: ${source}`);
  if (def.scope === 'state' ? !STATES.includes(scope) : scope !== 'US') throw new Error(`Invalid scope for ${source}: ${scope}`);
}
function record(h, source, scope, outcome, at = new Date().toISOString()) {
  check(source, scope);
  if (!OUTCOMES.includes(outcome)) throw new Error(`Invalid outcome: ${outcome}`);
  const s = h.sources[source] || (h.sources[source] = {scopes: {}});
  const prev = s.scopes[scope] || {};
  s.scopes[scope] = {last_attempt: at, last_success: outcome === 'fresh' ? at : (prev.last_success || null), outcome};
  if (h.run) h.run.counts[outcome] = (h.run.counts[outcome] || 0) + 1;
}
// Best known date the saved data was fetched: a "retrieved" date inside the file, else the last commit by
// the refresh workflow, else the last commit that changed the file (which can be a reprocessing commit).
function knownDate(files) {
  const existing = files.filter(f => fs.existsSync(path.join(ROOT, f)));
  if (!existing.length) return null;
  for (const f of existing) {
    try {
      const head = fs.readFileSync(path.join(ROOT, f), 'utf8').slice(0, 2000).match(/"retrieved"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
      if (head) return new Date(head[1] + 'T00:00:00Z').toISOString();
    } catch {}
  }
  for (const author of ['github-actions', '']) {
    try {
      const out = execFileSync('git', ['log', '-1', '--format=%cI', ...(author ? ['--author=' + author] : []), '--', ...existing], {cwd: ROOT, encoding: 'utf8'}).trim();
      if (out) return new Date(out).toISOString();
    } catch {}
  }
  return null;
}
function seed(h) {
  for (const [id, def] of Object.entries(SOURCES)) {
    const s = h.sources[id] || (h.sources[id] = {scopes: {}});
    for (const scope of def.scope === 'state' ? STATES : ['US']) {
      if (s.scopes[scope]) continue;
      const files = def.files(scope);
      if (!files.some(f => fs.existsSync(path.join(ROOT, f)))) continue;
      // The commit date is when saved data last changed. Attempts before this recorder existed are unknown.
      s.scopes[scope] = {last_attempt: null, last_success: knownDate(files), outcome: 'not_recorded'};
    }
  }
}

function main(argv) {
  const [cmd, ...args] = argv;
  const h = load();
  if (cmd === 'start') h.run = {started: new Date().toISOString(), counts: {}};
  else if (cmd === 'record') record(h, ...args);
  else if (cmd === 'seed') seed(h);
  else throw new Error('Usage: record_health.js start | record <source> <scope> <fresh|failed|skipped> | seed');
  save(h);
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}
module.exports = {SOURCES, STATES, load, save, record, seed, main, STALE_DAYS};
