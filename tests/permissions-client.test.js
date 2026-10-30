const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../permissions.js'), 'utf8');
const place = {kind: 'campsite', id: 'usfs:77', name: 'Test campsite', coordinates: [-108.7, 39.33]};
function setup(fetcher) {
  const stored = new Map(), requests = [], windowEvents = {}, documentEvents = {}, timers = new Map(); let timerID = 0;
  let document;
  class Element {
    constructor(tag) {this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.isConnected = true; this.open = false; this._text = '';}
    setAttribute(key, value) {this.attributes[key] = String(value);}
    append(...children) {this.children.push(...children);}
    replaceChildren(...children) {this._text = ''; this.children = children;}
    set textContent(text) {this._text = String(text); this.children = [];}
    get textContent() {return this._text + this.children.map(n => typeof n === 'string' ? n : n.textContent).join(' ');}
    addEventListener(event, handler) {this.listeners[event] = handler;}
    querySelector(tag) {for (const child of this.children) {if (child.tag === tag) return child; const found = child.querySelector?.(tag); if (found) return found;} return null;}
    showModal() {this.open = true;}
    focus() {document.activeElement = this;}
  }
  document = {addEventListener: (name, fn) => {documentEvents[name] = fn;}, visibilityState: 'visible', body: new Element('body'), activeElement: new Element('button'), createElement: tag => new Element(tag), createTextNode: text => ({textContent: text})};
  const context = {window: {addEventListener: (name, fn) => {windowEvents[name] = fn;}}, document, AbortController, URL, Date, setTimeout: (fn, delay) => {timers.set(++timerID, {fn, delay}); return timerID;}, clearTimeout: id => timers.delete(id), navigator: {onLine: true}, localStorage: {getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value)}, fetch: async (url, options) => {requests.push({url, options, payload: JSON.parse(options.body)}); return fetcher ? fetcher(url, options) : {ok: true, json: async () => ({ok: true, reports_available: true, count: 0, reports: [], official: {activity: 'overnight_occupancy', status: 'unknown', evidence: []}})};}};
  vm.runInNewContext(source, context);
  return {api: context.window.KampTrailPermissions, context, document, requests, stored, windowEvents, documentEvents, timers};
}
test('public reads send location only in JSON POST, bypass browser cache, and save no public data', async () => {
  const env = setup(); await env.api.open(place);
  assert.equal(env.api.version, require('../package.json').version);
  assert.equal(env.requests.length, 1);
  const {url, options, payload} = env.requests[0];
  assert.equal(url, 'api/permissions.php'); assert.equal(options.method, 'POST'); assert.equal(options.cache, 'no-store');
  assert.equal(options.headers['Content-Type'], 'application/json'); assert.equal(options.headers.Authorization, undefined);
  assert.deepEqual(payload.place, place); assert.equal(payload.activity, 'overnight_occupancy'); assert.equal(env.stored.size, 0);
});
test('spot descriptors use canonical signed rounding without changing caller snapshots', async () => {
  const env = setup(), spot = {kind: 'spot', id: 'old', name: 'Saved spot', coordinates: [-1.234575, -0.000004]};
  const before = JSON.stringify(spot); await env.api.open(spot);
  assert.deepEqual(env.requests[0].payload.place.coordinates, [-1.23458, 0]);
  assert.equal(env.requests[0].payload.place.id, 'spot:0.00000,-1.23458'); assert.equal(JSON.stringify(spot), before);
});
test('superseded requests are aborted and a late old response cannot replace newer location data', async () => {
  const pending = [], env = setup((_url, options) => new Promise(resolve => pending.push({options, resolve})));
  const old = env.api.open({...place, name: 'Old place'}), next = env.api.open({...place, id: 'usfs:88', name: 'New place'});
  assert.equal(pending[0].options.signal.aborted, true);
  pending[1].resolve({ok: true, json: async () => ({reports_available: true, count: 0, reports: [], official: {activity: 'overnight_occupancy', status: 'unknown', summary: 'New source summary', evidence: []}})}); await next;
  pending[0].resolve({ok: true, json: async () => ({reports_available: true, count: 0, reports: [], official: {activity: 'overnight_occupancy', status: 'allowed', summary: 'Old unsafe source summary', evidence: []}})}); await old;
  assert.match(env.document.body.textContent, /New source summary/); assert.doesNotMatch(env.document.body.textContent, /Old unsafe source summary/);
});
test('pending or wrong-scope reports stay out of public view and unavailable storage never becomes a zero count', async () => {
  const env = setup(async () => ({ok: true, json: async () => ({reports_available: true, count: 0, reports: [{id: 1, activity: 'overnight_occupancy', status: 'pending', body: 'PENDING_SECRET'}, {id: 2, activity: 'unoccupied_vehicle_parking', status: 'published', body: 'PARKING_ONLY'}], official: {activity: 'unoccupied_vehicle_parking', status: 'allowed', summary: 'Parking granted', evidence: []}})}));
  await env.api.open(place);
  assert.doesNotMatch(env.document.body.textContent, /PENDING_SECRET|PARKING_ONLY|Parking granted/); assert.match(env.document.body.textContent, /permission unknown for overnight occupancy/);
  const unavailable = setup(async () => ({ok: true, json: async () => ({reports_available: false, reports: [], official: {activity: 'overnight_occupancy', status: 'unknown'}})}));
  await unavailable.api.open(place); assert.match(unavailable.document.body.textContent, /Published reports are unavailable/); assert.doesNotMatch(unavailable.document.body.textContent, /0 published/);
});

test('going offline clears already displayed public evidence and reports without automatic reconnect requests', async () => {
  const env = setup(async () => ({ok: true, json: async () => ({reports_available: true, count: 1, reports: [{id: 1, activity: 'overnight_occupancy', status: 'published', body: 'LIVE_PUBLIC_REPORT'}], official: {activity: 'overnight_occupancy', status: 'allowed', summary: 'CURRENT_SOURCE', as_of: new Date().toISOString(), evidence: []}})}));
  await env.api.open(place); assert.match(env.document.body.textContent, /LIVE_PUBLIC_REPORT|CURRENT_SOURCE/);
  env.context.navigator.onLine = false; env.windowEvents.offline();
  assert.doesNotMatch(env.document.body.textContent, /LIVE_PUBLIC_REPORT|CURRENT_SOURCE|1 published/);
  assert.match(env.document.body.textContent, /Offline: current permission information and reports are unavailable/);
  assert.equal(env.requests[0].options.signal.aborted, true); assert.equal(env.timers.size, 0);
  env.context.navigator.onLine = true; assert.equal(env.windowEvents.online, undefined); assert.equal(env.requests.length, 1);
});
test('review deadlines invalidate public information without polling and visible resume fetches fresh data', async () => {
  const review = new Date(Date.now() + 20000).toISOString();
  const env = setup(async () => ({ok: true, json: async () => ({reports_available: true, count: 0, reports: [], official: {activity: 'overnight_occupancy', status: 'allowed', summary: 'CURRENT_SOURCE', as_of: new Date().toISOString(), evidence: [{freshness: 'current', review_after: review}]}})}));
  await env.api.open(place); const timer = [...env.timers.values()][0]; assert.ok(timer.delay > 0 && timer.delay <= 20000);
  timer.fn(); assert.match(env.document.body.textContent, /no longer current/); assert.doesNotMatch(env.document.body.textContent, /CURRENT_SOURCE/); assert.equal(env.requests.length, 1);
  env.documentEvents.visibilitychange(); await new Promise(setImmediate);
  assert.equal(env.requests.length, 2); assert.match(env.document.body.textContent, /CURRENT_SOURCE/);
});
