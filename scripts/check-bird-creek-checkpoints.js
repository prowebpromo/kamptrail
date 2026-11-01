#!/usr/bin/env node
'use strict';
// Bird Creek partial-load trace (2.35.0, docs/DETERMINISTIC_IDENTITY.md).
// Loads NV and CA one at a time, in both orders, and after each state load records what the browser
// shows for the two published Bird Creek listings: the expected listing ids from search-index.json,
// what getCampsiteById returns for every published id, and every browser listing named Bird Creek.
// Exit 0 when no checkpoint breaks the owner rule and every listing matches the index once all its states
// have loaded. Exit 1 otherwise, 2 on a script error.
// Usage: BASE_URL=http://127.0.0.1:8822 [CHROMIUM_PATH=...] node scripts/check-bird-creek-checkpoints.js [--out file.json]
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8797';
const outArg = process.argv.indexOf('--out'), OUT = outArg >= 0 ? process.argv[outArg + 1] : null;
const LISTINGS = ['usfs:65184', 'osm:way:1236741631'];
const ORDERS = [['NV', 'CA'], ['CA', 'NV']];

const index = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/campsites/search-index.json'), 'utf8'));
const expected = LISTINGS.map(id => {
  const s = index.sites.find(x => x.id === id);
  if (!s) throw new Error('listing not in index: ' + id);
  return {id: s.id, ids: [...new Set([s.id, ...(s.legacy_ids || [])])].sort(), states: s.states, name: s.name};
});

(async () => {
  const browser = await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}), args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const record = {start: new Date().toISOString(), base: BASE, browser: browser.version(), expected, runs: []};
  let mismatches = 0;
  try {
    for (const order of ORDERS) {
      const context = await browser.newContext({serviceWorkers: 'block'}), page = await context.newPage();
      await page.route('**/api/**', r => r.fulfill({status: 404, body: '{}'}));
      await page.addInitScript(() => localStorage.setItem('kt_last_position', JSON.stringify({lat: -10, lng: -140, zoom: 9})));
      await page.goto(BASE + '/?n=' + Date.now(), {waitUntil: 'domcontentloaded', timeout: 90000});
      await page.waitForFunction(() => window.KampTrailData && KampTrailData.getIdentityStatus?.().hosts === 'published', null, {timeout: 90000});
      const run = {order: order.join('>'), version: await page.evaluate(() => KampTrailData.version), checkpoints: []};
      const loaded = [];
      for (const st of order) {
        await page.evaluate(s => KampTrailData.loadStates([s]), st);
        loaded.push(st);
        const observed = await page.evaluate(exp => {
          const ids = f => [...new Set([f.properties.id, ...(f.properties.legacy_ids || [])])].sort();
          const resolve = {};
          for (const e of exp) for (const id of e.ids) { const f = KampTrailData.getCampsiteById(id); resolve[id] = f ? {id: f.properties.id, ids: ids(f)} : null; }
          const named = KampTrailData.getAllCampsites().filter(f => /bird creek/i.test(f.properties.name || '')).map(f => ({id: f.properties.id, ids: ids(f), name: f.properties.name}));
          return {resolve, named};
        }, expected);
        // Owner rule, at every checkpoint: a published id resolves only to a browser listing whose ids all
        // belong to that id's index listing, and no browser listing mixes two index listings.
        // Completeness, once every state of a listing has loaded: canonical id and full id set match the index.
        // Before that, a listing may show under a member id or with a partial id set (recorded, not a failure).
        const owner = new Map(); expected.forEach(e => e.ids.forEach(id => owner.set(id, e.id)));
        const problems = [], partial = [];
        for (const f of observed.named) { const o = new Set(f.ids.map(id => owner.get(id))); if (o.size > 1) problems.push(`wrong merge: ${f.id} holds [${f.ids.join('|')}] from ${[...o].join(' and ')}`); }
        for (const e of expected) {
          const complete = e.states.every(s => loaded.includes(s)), any = e.states.some(s => loaded.includes(s));
          for (const id of e.ids) {
            const got = observed.resolve[id];
            if (got && got.ids.some(x => owner.get(x) !== e.id)) { problems.push(`wrong resolution: ${id} -> ${got.id} [${got.ids.join('|')}], index listing ${e.id}`); continue; }
            if (complete) {
              if (!got) problems.push(`unresolved: ${id}`);
              else if (got.id !== e.id || JSON.stringify(got.ids) !== JSON.stringify(e.ids)) problems.push(`incomplete after all states: ${id} -> ${got.id} [${got.ids.join('|')}], expected ${e.id} [${e.ids.join('|')}]`);
            } else if (any && (!got || got.id !== e.id || JSON.stringify(got.ids) !== JSON.stringify(e.ids))) {
              partial.push(`${id} -> ${got ? `${got.id} [${got.ids.join('|')}]` : 'not yet loaded'} (listing ${e.id} also needs ${e.states.filter(s => !loaded.includes(s)).join(',')})`);
            }
          }
        }
        mismatches += problems.length;
        run.checkpoints.push({after: loaded.join('>'), observed, problems, partial_pending_states: partial, result: problems.length ? 'FAIL' : 'PASS'});
      }
      record.runs.push(run);
      await context.close();
    }
    record.mismatches = mismatches;
    record.result = mismatches ? 'FAIL' : 'PASS';
    process.exitCode = mismatches ? 1 : 0;
  } catch (e) {
    record.result = 'ERROR'; record.error = e.message; process.exitCode = 2;
  } finally {
    record.end = new Date().toISOString();
    const text = JSON.stringify(record, null, 1);
    if (OUT) fs.writeFileSync(OUT, text + '\n');
    console.log(text);
    await browser.close();
  }
})();
