'use strict';
/* Builds synthetic/cases.json. Every alert here is SYNTHETIC: invented to cover edge cases that the previous seven days of real
   NWS data could not (the NWS /alerts record held no Red Flag Warnings or Fire Weather Watches). The only real content is the
   zone geometry, taken from the captured NWS zone files and thinned. Times are offsets from reference_time so specs can rebase them.
   Run: node tests/fixtures/fire-weather/build-synthetic.js   (output is deterministic) */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const dir = __dirname, captured = path.join(dir, 'captured');
const REFERENCE = '2026-11-01T15:00:00Z';
const ref = Date.parse(REFERENCE);
const at = minutes => new Date(ref + minutes * 60000).toISOString().replace('.000Z', 'Z');

function ring(zoneFile) {
  const g = JSON.parse(fs.readFileSync(path.join(captured, 'zones', zoneFile), 'utf8')).geometry;
  const outer = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
  const points = outer.slice(0, -1).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
  const step = Math.ceil(points.length / 40), thin = points.filter((_, i) => i % step === 0);
  return [...thin, thin[0]];
}
const polygon = file => ({ type: 'Polygon', coordinates: [ring(file)] });
const zoneIds = { 'fire/COZ214': 'fire_COZ214.json', 'fire/CAZ281': 'fire_CAZ281.json', 'fire/NMZ104': 'fire_NMZ104.json' };

let n = 0;
function alert(over = {}) {
  n++;
  const id = over.id || `urn:synthetic:alert:${n}`;
  return { type: 'Feature', geometry: over.geometry ?? null, properties: {
    id, name: over.event || 'Red Flag Warning', source_updated_at: at(-60), event: 'Red Flag Warning', headline: `SYNTHETIC Red Flag Warning ${n}`, areaDesc: `Synthetic area ${n}`, severity: 'Severe', messageType: 'Alert', status: 'Actual',
    sent: at(-60), effective: at(-60), onset: at(-30), expires: at(600), ends: at(600), references: [], zone_count: 0, zones: [], ...over.p, ...(over.event ? { event: over.event } : {}) } };
}
const payload = features => ({ ok: true, version: 1, kind: 'firewx', partial: false, retrieved_at: REFERENCE, source: { name: 'National Weather Service active alerts', url: 'https://www.weather.gov/fire/' }, data: { type: 'FeatureCollection', features } });

const cases = {};
const poly = alert({ id: 'urn:synthetic:polygon', geometry: polygon('fire_COZ214.json'), p: { areaDesc: 'Synthetic polygon area' } });
const zoneOnly = alert({ id: 'urn:synthetic:zone-only', event: 'Fire Weather Watch', p: { headline: 'SYNTHETIC Fire Weather Watch (zone only)', onset: at(180), zones: ['fire/CAZ281', 'fire/NMZ104'], zone_count: 2, areaDesc: 'Synthetic zone-only area' } });
cases.polygon = payload([poly]);
cases.zone_only = payload([zoneOnly]);
cases.mixed = payload([poly, zoneOnly]);
cases.expired = payload([alert({ id: 'urn:synthetic:expired', p: { expires: at(-1), ends: at(-1) } }), alert({ id: 'urn:synthetic:ended-early', p: { expires: at(600), ends: at(-5) } }), poly]);
const toCancel = alert({ id: 'urn:synthetic:to-cancel', geometry: polygon('fire_COZ214.json') });
cases.cancelled = payload([toCancel, alert({ id: 'urn:synthetic:cancel-message', p: { messageType: 'Cancel', sent: at(-10), effective: at(-10), expires: at(-10), ends: null, references: [toCancel.properties.id], headline: 'SYNTHETIC cancellation' } })]);
const original = alert({ id: 'urn:synthetic:original', p: { headline: 'SYNTHETIC original' }, geometry: polygon('fire_COZ214.json') });
cases.updated = payload([original, alert({ id: 'urn:synthetic:update', geometry: polygon('fire_COZ214.json'), p: { messageType: 'Update', sent: at(-5), effective: at(-5), references: [original.properties.id], headline: 'SYNTHETIC update replaces original' } })]);
cases.original_only = payload([original]);   // the feed after the Update in `updated` has expired and left it
cases.empty = payload([]);
cases.geometry_failure = payload([alert({ id: 'urn:synthetic:zone-fail', p: { zones: ['fire/COZ214'], zone_count: 1, areaDesc: 'Synthetic zone-only area, zone fetch fails' } })]);
cases.partial_zones = payload([alert({ id: 'urn:synthetic:partial', p: { zones: ['fire/CAZ281', 'fire/COZ214'], zone_count: 2, areaDesc: 'Synthetic partly resolved area' } })]);

const zones = {};
for (const [id, file] of Object.entries(zoneIds)) zones[id] = { ok: true, version: 1, kind: 'zone', retrieved_at: REFERENCE, source: { name: 'National Weather Service zone', url: 'https://www.weather.gov/' },
  data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: polygon(file), properties: { id: id.split('/')[1], name: JSON.parse(fs.readFileSync(path.join(captured, 'zones', file), 'utf8')).properties.name, state: id.slice(5, 7) } }] } };

const manifest = JSON.parse(fs.readFileSync(path.join(captured, 'manifest.json'), 'utf8'));
const out = {
  fixture: { synthetic: true, label: 'SYNTHETIC: alerts are invented for edge-case coverage. Zone geometry is real NWS data, thinned.', reference_time: REFERENCE,
    derived_from: manifest.files.filter(f => f.kind === 'nws-zone').map(f => ({ file: 'captured/' + f.file, url: f.url, retrieved_at: f.retrieved_at, sha256: f.sha256 })) },
  cases, zones };
const text = JSON.stringify(out, null, 1) + '\n';
if (require.main === module) { fs.mkdirSync(path.join(dir, 'synthetic'), { recursive: true }); fs.writeFileSync(path.join(dir, 'synthetic', 'cases.json'), text); console.log('sha256', crypto.createHash('sha256').update(text).digest('hex')); }
module.exports = { text };
