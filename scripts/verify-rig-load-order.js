#!/usr/bin/env node
'use strict';
// Rig-tag ownership load-order check (2.32.0). Loads the real committed state snapshots in the browser in
// several orders and compares, for every listing the repair changes (tests/fixtures/rig-tag-ownership-cases.json):
// the source identities merged into it (canonical id plus legacy_ids), the popup rig line and the Tents and
// Trailers filter outcomes. The canonical id the browser elects is reported but is not the comparison key.
//
//   node scripts/verify-rig-load-order.js [--out=docs/RIG_TAG_LOAD_ORDER_2.32.0.json] [--port=8791]
//
// Scenarios: default (all affected states in one batch), sequential forward, sequential reversed, one delayed
// state response, and each multi-state listing's states one at a time in both orders.
const fs = require('node:fs'), path = require('node:path'), {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const args = process.argv.slice(2), arg = (n, d) => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const root = path.resolve(__dirname, '..'), port = Number(arg('port', '8791')), out = path.resolve(root, arg('out', 'docs/RIG_TAG_LOAD_ORDER_2.32.0.json'));
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/rig-tag-ownership-cases.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(root, 'data/campsites/search-index.json'), 'utf8')).sites, byId = new Map(index.map(s => [s.id, s]));
const cases = fixture.cases.map(c => ({...c, states:byId.get(c.id).states, ids:[c.id, ...byId.get(c.id).legacy_ids]}));
const allStates = [...new Set(cases.flatMap(c => c.states))].sort();
const multi = cases.filter(c => c.states.length > 1);
const delayed = (() => { const n = {}; for (const c of multi) for (const s of c.states) n[s] = (n[s] || 0) + 1; return Object.entries(n).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]; })();

async function scenario(browser, name, plan, watch, delay = null) {
  const context = await browser.newContext({serviceWorkers:'block', viewport:{width:1280, height:900}});
  const page = await context.newPage();
  await context.route(/^https:\/\//, r => r.fulfill({status:204, body:''}));
  if (delay) await page.route(`**/data/campsites/${delay}_merged.geojson`, async r => { await new Promise(x => setTimeout(x, 4000)); await r.continue(); });
  await page.addInitScript(() => localStorage.setItem('kt_last_position', JSON.stringify({lat:39.5, lng:-98.5, zoom:4})));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.KampTrailData && window.DataQuality?.rigLine && typeof KampTrailData.loadStates === 'function');
  // Optional sidecars load asynchronously at startup. Wait for site details so Recreation.gov checks are present.
  await page.waitForTimeout(1500);
  const result = await page.evaluate(async ([plan, watch]) => {
    for (const step of plan) await KampTrailData.loadStates(step);
    const loaded = KampTrailData.getLoadedStates().sort(), all = KampTrailData.getAllCampsites(), by = new Map();
    for (const f of all) for (const id of [f.properties.id, ...(f.properties.legacy_ids || [])]) if (!by.has(id)) by.set(id, f);
    const T = new Set(DataQuality.applyFilters(all, {rigSize:'tent'}).map(f => f.properties.id)), R = new Set(DataQuality.applyFilters(all, {rigSize:'trailer'}).map(f => f.properties.id));
    const parse = html => { const d = new DOMParser().parseFromString(html, 'text/html').querySelector('.kt-rig-evidence'); return d ? d.textContent.replace(/\s+/g, ' ').trim() : ''; };
    return {loaded, rows:watch.map(([id, ids]) => {
      const f = ids.map(i => by.get(i)).find(Boolean);
      if (!f) return {id, found:false};
      const p = f.properties;
      return {id, found:true, browser_id:p.id, identities:[...new Set([p.id, ...(p.legacy_ids || [])])].sort(), rig_line:DataQuality.rigLine(p), popup_rig:parse(KampTrailData.popupHTML(f)), tents:T.has(p.id), trailers:R.has(p.id)};
    })};
  }, [plan, watch]);
  await context.close();
  return {name, plan, delayed:delay, ...result};
}

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'scripts/serve.js')], {env:{...process.env, PORT:String(port)}, stdio:'ignore'});
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({args:['--no-sandbox', '--disable-dev-shm-usage']});
  const runs = [];
  try {
    const watchAll = cases.map(c => [c.id, c.ids]);
    runs.push(await scenario(browser, 'default_batch', [allStates], watchAll));
    runs.push(await scenario(browser, 'sequential_forward', allStates.map(s => [s]), watchAll));
    runs.push(await scenario(browser, 'sequential_reversed', [...allStates].reverse().map(s => [s]), watchAll));
    runs.push(await scenario(browser, `delayed_${delayed}`, [allStates], watchAll, delayed));
    for (const c of multi) for (const order of [c.states, [...c.states].reverse()]) {
      runs.push(await scenario(browser, `listing ${c.id} ${order.join('>')}`, order.map(s => [s]), [[c.id, c.ids]]));
    }
  } finally { await browser.close(); server.kill(); }
  // Compare every listing across every run that contains it, and against the published fixture.
  const listings = cases.map(c => {
    const seen = runs.flatMap(r => r.rows.filter(x => x.id === c.id).map(x => ({run:r.name, ...x})));
    const key = x => JSON.stringify([x.identities, x.rig_line, x.popup_rig, x.tents, x.trailers]);
    const variants = [...new Set(seen.filter(x => x.found).map(key))];
    const missing = seen.filter(x => !x.found).map(x => x.run);
    const fixtureMismatch = seen.filter(x => x.found && (x.tents !== c.tents_after || x.trailers !== c.trailers_after || x.rig_line !== c.popup_after)).map(x => x.run);
    const identityVariants = [...new Set(seen.filter(x => x.found).map(x => JSON.stringify(x.identities)))].length;
    const rigVariants = [...new Set(seen.filter(x => x.found).map(x => JSON.stringify([x.rig_line, x.popup_rig, x.tents, x.trailers])))].length;
    return {id:c.id, states:c.states, runs:seen.length, browser_ids:[...new Set(seen.filter(x => x.found).map(x => x.browser_id))], stable:variants.length === 1 && !missing.length,
      identity_stable:identityVariants <= 1, rig_and_filter_stable:rigVariants <= 1, matches_fixture:!fixtureMismatch.length, fixture_mismatch_runs:fixtureMismatch, missing_runs:missing,
      variants:variants.length > 1 ? seen.filter(x => x.found).map(x => ({run:x.run, browser_id:x.browser_id, identities:x.identities, rig_line:x.rig_line, tents:x.tents, trailers:x.trailers})) : undefined};
  });
  const summary = {listings:listings.length, multi_state_listings:multi.length, scenarios:runs.length, affected_states:allStates, delayed_state:delayed,
    stable:listings.filter(l => l.stable).length, identity_unstable:listings.filter(l => !l.identity_stable).map(l => l.id), rig_or_filter_unstable:listings.filter(l => !l.rig_and_filter_stable).map(l => l.id),
    fixture_mismatch:listings.filter(l => !l.matches_fixture).map(l => l.id), missing:listings.filter(l => l.missing_runs.length).map(l => l.id),
    browser_id_differs_from_index:listings.filter(l => l.browser_ids.some(b => b !== l.id)).map(l => [l.id, l.browser_ids])};
  fs.writeFileSync(out, JSON.stringify({version:1, generated_from:fixture.generated_from, summary, listings}, null, 1) + '\n');
  console.log(JSON.stringify(summary, null, 1));
  if (summary.rig_or_filter_unstable.length || summary.identity_unstable.length || summary.missing.length) process.exitCode = 2;
})().catch(e => { console.error(e); process.exitCode = 1; });
