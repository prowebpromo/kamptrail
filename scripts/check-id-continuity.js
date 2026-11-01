#!/usr/bin/env node
'use strict';
// Every listing id ever published (canonical or legacy) must keep resolving to the same listing.
// Compares a previous search index with a new one. Fails on any id that no longer resolves, or that
// now resolves to a different canonical listing, unless data/campsites/withdrawn.json lists it with
// that same host. Usage: node scripts/check-id-continuity.js <previous-index.json> <new-index.json> [withdrawn.json]
const fs = require('fs');

function hostMap(index) {
  // Collect every host claiming each id first, so a conflict is found whatever the row order.
  const hosts = new Map();
  for (const site of index.sites || []) for (const id of new Set([site.id, ...(site.legacy_ids || [])])) {
    if (!hosts.has(id)) hosts.set(id, new Set());
    hosts.get(id).add(site.id);
  }
  const map = new Map(), conflicts = [];
  for (const [id, set] of hosts) {
    if (set.size > 1) conflicts.push({id, hosts: [...set].sort()});
    else map.set(id, [...set][0]);
  }
  map.conflicts = conflicts;
  return map;
}

function withdrawnMap(withdrawn) {
  // withdrawn.json lists retired facilities with their aliases. An id listed there keeps resolving to a notice.
  const map = new Map();
  // Format: {version, note, listings: [{id, legacy_ids, ...}]}.
  for (const e of (withdrawn && withdrawn.listings) || []) {
    for (const id of [e.id, ...(e.legacy_ids || [])].filter(Boolean)) map.set(id, e.id);
  }
  return map;
}

function check(previous, next, withdrawn) {
  const before = hostMap(previous), after = hostMap(next), retired = withdrawnMap(withdrawn);
  const lost = [], moved = [];
  for (const [id, host] of before) {
    if (after.has(id)) { if (after.get(id) !== host) moved.push({id, from: host, to: after.get(id)}); }
    else if (retired.get(id) !== host) lost.push({id, host});
  }
  // An id claimed by two listings cannot resolve to one place. Fail in either index.
  const conflicts = [...before.conflicts.map(c => ({index: 'previous', ...c})), ...after.conflicts.map(c => ({index: 'new', ...c}))];
  return {previous_ids: before.size, next_ids: after.size, lost, moved, conflicts};
}

if (require.main === module) {
  const [prevPath, nextPath, withdrawnPath] = process.argv.slice(2);
  if (!prevPath || !nextPath) { console.error('Usage: check-id-continuity.js <previous-index> <new-index> [withdrawn.json]'); process.exit(2); }
  const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
  const withdrawn = withdrawnPath && fs.existsSync(withdrawnPath) ? read(withdrawnPath) : null;
  const result = check(read(prevPath), read(nextPath), withdrawn);
  console.log(`Previous published ids: ${result.previous_ids}. New: ${result.next_ids}. No longer resolving: ${result.lost.length}. Moved to another listing: ${result.moved.length}. Claimed by more than one listing: ${result.conflicts.length}.`);
  for (const x of result.conflicts.slice(0, 50)) console.log(`  conflict (${x.index}) ${x.id} claimed by ${x.hosts.join(', ')}`);
  for (const x of result.lost.slice(0, 50)) console.log(`  lost  ${x.id} (was ${x.host})`);
  for (const x of result.moved.slice(0, 50)) console.log(`  moved ${x.id} ${x.from} -> ${x.to}`);
  process.exit(result.lost.length || result.moved.length || result.conflicts.length ? 1 : 0);
}

module.exports = {check, hostMap, withdrawnMap};
