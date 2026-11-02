'use strict';
/* Loads synthetic fire-weather cases. Times are rebased to a chosen "now" so a case always looks as it did at its reference time.
   Without a now the original reference times are kept, and the payload is historical. Every payload carries a fixture label. */
const fs = require('node:fs'), path = require('node:path');
const file = JSON.parse(fs.readFileSync(path.join(__dirname, 'synthetic/cases.json'), 'utf8'));
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
function rebase(value, delta) {
  if (typeof value === 'string') return ISO.test(value) ? new Date(Date.parse(value) + delta).toISOString().replace('.000Z', 'Z') : value;
  if (Array.isArray(value)) return value.map(v => rebase(v, delta));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rebase(v, delta)]));
  return value;
}
const delta = now => now == null ? 0 : now - Date.parse(file.fixture.reference_time);
const payload = (name, now) => { if (!file.cases[name]) throw new Error('No fixture ' + name); return { ...rebase(file.cases[name], delta(now)), fixture: { synthetic: true, label: file.fixture.label } }; };
const zone = (id, now) => rebase(file.zones[id], delta(now));
module.exports = { payload, zone, file, reference: Date.parse(file.fixture.reference_time), names: Object.keys(file.cases), zoneIds: Object.keys(file.zones) };
