'use strict';
// Contributions API end to end against PHP's built-in server and a temporary SQLite database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const hasPhp = spawnSync('php', ['-r', 'exit(extension_loaded("pdo_sqlite")?0:1);']).status === 0;

async function server(configPath, port) {
  const proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', root], {env: {...process.env, KAMPTRAIL_CONFIG: configPath}, stdio: 'ignore'});
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${port}/api/health.php`); return proc; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  proc.kill(); throw new Error('PHP server did not start');
}
function tmpConfig(extra = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-api-'));
  const db = path.join(dir, 'test.sqlite');
  const file = path.join(dir, 'kamptrail-config.php');
  fs.writeFileSync(file, `<?php return ['db'=>['dsn'=>'sqlite:${db}'],'ip_salt'=>'test-salt','moderator_password'=>'correct horse battery','moderator_name'=>'tester'${extra}];`);
  fs.chmodSync(file, 0o600);
  return {dir, file, db};
}
const post = (base, body) => fetch(`${base}/api/submit.php`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
const good = {kind: 'correction', campsite_id: 'usfs:77', campsite_name: 'Tiffany Springs', lat: 48.7, lng: -120, problems: ['fee'], details: 'Sign at the entrance says $10 per night as of October 2026.', source: 'visited 2026-10-20', firsthand: true, elapsed_ms: 8000};

async function adminSession(base) {
  let cookie = '';
  const grab = res => { const c = res.headers.get('set-cookie'); if (c) cookie = c.split(';')[0]; return res; };
  const page = await (grab(await fetch(`${base}/api/admin.php`))).text();
  const csrf = page.match(/name="csrf" value="([a-f0-9]+)"/)[1];
  const form = (fields) => fetch(`${base}/api/admin.php`, {method: 'POST', redirect: 'manual', headers: {'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie}, body: new URLSearchParams({csrf, ...fields})}).then(grab);
  return {form, get: (q = '') => fetch(`${base}/api/admin.php${q}`, {headers: {Cookie: cookie}}).then(grab).then(r => r.text()), csrf: () => csrf};
}

test('missing configuration fails safely without leaking paths or errors', {skip: !hasPhp}, async () => {
  const port = 18901, proc = await server('/nonexistent/kamptrail-config.php', port);
  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health.php`);
    assert.equal(health.status, 503);
    const text = await health.text();
    assert.deepEqual(JSON.parse(text), {ok: false, api: '1.0.0', config: 'missing', database: 'not_configured'});
    assert.ok(!text.includes('nonexistent'));
    const sub = await post(`http://127.0.0.1:${port}`, good);
    assert.equal(sub.status, 503);
    assert.equal((await sub.json()).error, 'unavailable');
  } finally { proc.kill(); }
});

test('unreachable database fails safely and hides the database error', {skip: !hasPhp}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-api-'));
  const file = path.join(dir, 'kamptrail-config.php');
  fs.writeFileSync(file, `<?php return ['db'=>['host'=>'127.0.0.1:1','name'=>'nope','user'=>'nobody','pass'=>'secret-value'],'ip_salt'=>'x','moderator_password'=>'correct horse battery'];`);
  const port = 18902, proc = await server(file, port);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health.php`);
    const text = await res.text();
    assert.equal(res.status, 503);
    assert.equal(JSON.parse(text).database, 'unavailable');
    assert.ok(!/secret-value|SQLSTATE|nobody/.test(text));
    const admin = await (await fetch(`http://127.0.0.1:${port}/api/admin.php`)).text();
    assert.ok(!/secret-value|SQLSTATE/.test(admin));
  } finally { proc.kill(); }
});

test('migrations, submission, validation, status, moderation with audit trail, and persistence', {skip: !hasPhp}, async () => {
  const cfg = tmpConfig();
  const port = 18903, base = `http://127.0.0.1:${port}`;
  let proc = await server(cfg.file, port);
  try {
    // Before migrations the API refuses reports instead of failing halfway.
    let health = await (await fetch(`${base}/api/health.php`)).json();
    assert.equal(health.schema, 'migrations_pending');
    assert.equal((await post(base, good)).status, 503);

    // A moderator applies migrations from the admin page.
    const bad = await adminSession(base);
    const denied = await bad.form({do: 'login', password: 'wrong password!!'});
    assert.ok((await denied.text()).includes('did not work'));
    const admin = await adminSession(base);
    await admin.form({do: 'login', password: 'correct horse battery'});
    assert.ok((await admin.get()).includes('Schema migrations pending'));
    await admin.form({do: 'migrate'});
    health = await (await fetch(`${base}/api/health.php`)).json();
    assert.deepEqual([health.ok, health.database, health.schema, health.config_permissions], [true, 'ok', 'current', 'private']);

    // Validation and spam controls.
    const quick = await post(base, {...good, elapsed_ms: 500});
    assert.equal(quick.status, 422);
    const missing = await (await post(base, {...good, details: 'short', firsthand: false, problems: []})).json();
    assert.deepEqual(Object.keys(missing.fields).sort(), ['details', 'firsthand', 'problems']);
    const honeypot = await post(base, {...good, website: 'http://spam.example'});
    assert.equal(honeypot.status, 202);
    assert.equal((await post(base, {...good, kind: 'new_place', lat: null, lng: null, campsite_name: 'X'})).status, 422);

    // A real report is stored and gets a private status token.
    const created = await post(base, good);
    assert.equal(created.status, 201);
    const {token, status} = await created.json();
    assert.match(token, /^[a-f0-9]{32}$/);
    assert.equal(status, 'received');
    let st = await (await fetch(`${base}/api/status.php?token=${token}`)).json();
    assert.deepEqual([st.status, st.campsite_name, st.note], ['received', 'Tiffany Springs', null]);
    assert.equal((await fetch(`${base}/api/status.php?token=${'0'.repeat(32)}`)).status, 404);
    assert.equal((await fetch(`${base}/api/status.php?token=../../etc`)).status, 400);
    const spamCount = (await (await fetch(`${base}/api/status.php?token=${token}`)).json()).ok;
    assert.equal(spamCount, true);

    // The moderator sees it, accepts it with a public note, and the change is logged.
    const queue = await admin.get();
    assert.ok(queue.includes('Tiffany Springs') && queue.includes('Sign at the entrance'));
    assert.ok(!queue.includes('http://spam.example'), 'Honeypot submissions are not stored');
    const id = queue.match(/name="id" value="(\d+)"/)[1];
    await admin.form({do: 'set', id, status: 'accepted', public_note: 'Thanks. We will update the fee.'});
    await admin.form({do: 'set', id, status: 'applied', public_note: 'Fee updated in the 2026-11 data release.'});
    st = await (await fetch(`${base}/api/status.php?token=${token}`)).json();
    assert.deepEqual([st.status, st.note], ['applied', 'Fee updated in the 2026-11 data release.']);
    const applied = await admin.get('?status=applied');
    assert.ok(applied.includes('received → accepted') && applied.includes('accepted → applied') && applied.includes('tester'));

    // Rate limit: five reports per client per hour.
    for (let i = 0; i < 4; i++) assert.equal((await post(base, good)).status, 201);
    assert.equal((await post(base, good)).status, 429);

    // Data survives a server restart (stands in for a redeploy: the database lives outside the web root).
    proc.kill(); proc = await server(cfg.file, port);
    st = await (await fetch(`${base}/api/status.php?token=${token}`)).json();
    assert.equal(st.status, 'applied');

    // Admin actions require a valid CSRF token.
    const forged = await fetch(`${base}/api/admin.php`, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({do: 'set', id, status: 'rejected', csrf: 'x'})});
    assert.ok([200, 400].includes(forged.status));
    st = await (await fetch(`${base}/api/status.php?token=${token}`)).json();
    assert.equal(st.status, 'applied');
  } finally { proc.kill(); }
});

test('a world-readable configuration is reported without revealing its contents', {skip: !hasPhp}, async () => {
  const cfg = tmpConfig();
  fs.chmodSync(cfg.file, 0o644);
  const port = 18904, proc = await server(cfg.file, port);
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health.php`)).json();
    assert.equal(health.config_permissions, 'too_open');
  } finally { proc.kill(); }
});

test('a pending additive community migration does not interrupt existing campsite corrections', {skip: !hasPhp}, async()=>{
  const cfg=tmpConfig(),port=18907,base=`http://127.0.0.1:${port}`,proc=await server(cfg.file,port);
  try{
    const admin=await adminSession(base);await admin.form({do:'login',password:'correct horse battery'});await admin.form({do:'migrate'});
    const removed=spawnSync('php',['-r',`$p=new PDO('sqlite:${cfg.db}');$p->exec("DELETE FROM schema_migrations WHERE version='002_community'");`]);assert.equal(removed.status,0);
    const h=await(await fetch(base+'/api/health.php')).json();assert.equal(h.accepting_reports,true);assert.equal(h.community,'migrations_pending');
    assert.equal((await post(base,good)).status,201);
    assert.equal((await fetch(base+'/api/community.php?site=usfs:77')).status,503);
  }finally{proc.kill();}
});

test('visitor clearance reports: moderated submission, applied-only publication and bounded public reads', {skip: !hasPhp}, async () => {
  const cfg = tmpConfig();
  const port = 18931, base = `http://127.0.0.1:${port}`;
  const proc = await server(cfg.file, port);
  const report = {kind: 'clearance', lat: 41.81, lng: -71.45, details: 'Sign on the rail bridge over Main St, northbound side.', source: 'visited 2026-10-20', firsthand: true, elapsed_ms: 8000,
    clearance: {posted: `12'9"`, observed_on: '2026-10-20', direction: 'one_direction', osm_ref: 'osm:way:123456'}};
  const sql = code => spawnSync('php', ['-r', `$p=new PDO('sqlite:${cfg.db}');` + code], {encoding: 'utf8'}).stdout;
  try {
    const admin = await adminSession(base);
    await admin.form({do: 'login', password: 'correct horse battery'});
    await admin.form({do: 'migrate'});
    assert.match(sql(`echo $p->query("SELECT COUNT(*) FROM schema_migrations WHERE version='006_clearance_reports'")->fetchColumn();`), /^1$/);
    // Validation: the posted value uses the same syntax as the map data, and no field is guessed.
    for (const bad of [{posted: '12 ft'}, {posted: `12' 9"`}, {posted: '0'}, {observed_on: '2999-01-01'}, {direction: 'north'}, {osm_ref: 'way:1'}])
      assert.equal((await post(base, {...report, clearance: {...report.clearance, ...bad}})).status, 422, JSON.stringify(bad));
    assert.equal((await post(base, {...report, lat: null, lng: null})).status, 422);
    const res = await post(base, report);
    assert.equal(res.status, 201);
    const {token} = await res.json();
    const box = '-71.5,41.7,-71.4,41.9', read = async (q = box) => fetch(`${base}/api/clearance-reports.php?bbox=${q}`);
    // Received and accepted reports are not published.
    assert.deepEqual((await (await read()).json()).reports, []);
    const id = Number(sql(`echo $p->query("SELECT id FROM submissions WHERE public_token='${token}'")->fetchColumn();`));
    assert.ok((await admin.get('?status=received')).includes('Posted clearance:</strong> 12&#039;9&quot;'));
    await admin.form({do: 'set', id: String(id), status: 'accepted', public_note: 'Checking'});
    assert.deepEqual((await (await read()).json()).reports, []);
    // Applied publishes only structured fields: no prose, email, token or client hash.
    await admin.form({do: 'set', id: String(id), status: 'applied', public_note: 'Matches the sign'});
    const body = await (await read()).json();
    assert.equal(body.reports.length, 1);
    const r = body.reports[0];
    assert.deepEqual(Object.keys(r).sort(), ['direction', 'hundredths', 'id', 'lat', 'lng', 'observed_on', 'osm_ref', 'posted', 'published_at']);
    assert.deepEqual([r.posted, r.hundredths, r.observed_on, r.direction, r.osm_ref], [`12'9"`, 15300, '2026-10-20', 'one_direction', 'osm:way:123456']);
    assert.match(r.published_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.ok(!JSON.stringify(body).includes('rail bridge') && !JSON.stringify(body).includes(token));
    assert.equal(require('../clearances.js').validReport(r), true, 'the client accepts what the server publishes');
    assert.deepEqual((await (await read('-100,30,-99,31')).json()).reports, [], 'outside the box');
    // Hidden again by a moderator, the report disappears.
    await admin.form({do: 'set', id: String(id), status: 'rejected', public_note: ''});
    assert.deepEqual((await (await read()).json()).reports, []);
    assert.match(sql(`echo $p->query("SELECT COUNT(*) FROM moderation_log WHERE submission_id=${id}")->fetchColumn();`), /^3$/);
    for (const q of ['', 'a,b,c,d', '-180,-90,180,90', '1,1,0,0'])assert.equal((await read(q)).status, 422, q);
    // The status page works for the submitter as for any report.
    assert.equal((await (await fetch(`${base}/api/status.php?token=${token}`)).json()).status, 'rejected');
  } finally { proc.kill(); fs.rmSync(cfg.dir, {recursive: true, force: true}); }
});

test('clearance reports wait for their migration and never break campsite corrections', {skip: !hasPhp}, async () => {
  const cfg = tmpConfig();
  const port = 18932, base = `http://127.0.0.1:${port}`;
  const proc = await server(cfg.file, port);
  try {
    const admin = await adminSession(base);
    await admin.form({do: 'login', password: 'correct horse battery'});
    await admin.form({do: 'migrate'});
    spawnSync('php', ['-r', `$p=new PDO('sqlite:${cfg.db}');$p->exec("DELETE FROM schema_migrations WHERE version='006_clearance_reports'");`]);
    assert.equal((await post(base, {kind: 'clearance', lat: 41.8, lng: -71.4, details: 'Bridge sign seen in person.', firsthand: true, elapsed_ms: 8000, clearance: {posted: '4.1', observed_on: '2026-10-01', direction: 'both'}})).status, 503);
    assert.equal((await fetch(`${base}/api/clearance-reports.php?bbox=-72,41,-71,42`)).status, 503);
    assert.equal((await post(base, good)).status, 201);
  } finally { proc.kill(); fs.rmSync(cfg.dir, {recursive: true, force: true}); }
});
