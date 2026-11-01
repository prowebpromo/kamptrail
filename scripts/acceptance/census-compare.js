'use strict';
// Pure census comparison, shared by live-identity-census.js and its tests.
// expected: [[canonicalId, sortedSourceIds], ...] from the published search index.
// browser:  [[id, [id, ...legacy_ids]], ...], one entry per browser listing.
// Every index listing must map to exactly one browser listing with the same canonical id and source-id set,
// every browser listing must hold only published ids of one index listing, and the counts must be equal.
function compare(expected, browser) {
  const byId = new Map();
  browser.forEach(([, ids], i) => { for (const id of new Set(ids)) byId.set(id, (byId.get(id) || []).concat(i)); });
  const owner = new Map();
  expected.forEach(([, ids], k) => ids.forEach(x => owner.set(x, k)));
  const out = {missing: [], split: [], canonical: [], sourceSet: [], wrongMerge: [], unexpected: [], unmatched: []};
  const matched = new Set();
  for (const [id, ids] of expected) {
    const hit = new Set();
    ids.forEach(x => (byId.get(x) || []).forEach(i => hit.add(i)));
    if (!hit.size) { out.missing.push(id); continue; }
    if (hit.size > 1) { out.split.push(id); hit.forEach(i => matched.add(i)); continue; }
    const i = [...hit][0];
    matched.add(i);
    const [gotId, gotIds] = browser[i], got = [...new Set(gotIds)].sort();
    if (gotId !== id) out.canonical.push(`${id}->${gotId}`);
    if (JSON.stringify(got) !== JSON.stringify(ids)) out.sourceSet.push(`${id}: ${got.join('|')} vs ${ids.join('|')}`);
  }
  browser.forEach(([id, ids], i) => {
    const unknown = [...new Set(ids)].filter(x => !owner.has(x));
    if (unknown.length) out.unexpected.push(`${id}: ${unknown.join('|')}`);
    const owners = new Set(ids.filter(x => owner.has(x)).map(x => owner.get(x)));
    if (owners.size > 1) out.wrongMerge.push(id);
    if (!matched.has(i) && !unknown.length) out.unmatched.push(id);
  });
  const countDiffers = expected.length !== browser.length;
  const mismatches = out.missing.length + out.split.length + out.canonical.length + out.sourceSet.length
    + out.wrongMerge.length + out.unexpected.length + out.unmatched.length + (countDiffers ? 1 : 0);
  return {expected_listings: expected.length, browser_features: browser.length, count_differs: countDiffers, mismatches, ...out};
}

module.exports = {compare};
