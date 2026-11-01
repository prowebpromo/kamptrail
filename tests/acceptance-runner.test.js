'use strict';
// The live acceptance runner must fail on a census mismatch, a script error, a timeout, and a missing
// or non-PASS result, and pass only when every step passes. Uses a local fake site and stub check scripts.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');

const RUNNER = path.resolve(__dirname, '../scripts/acceptance/run-live-acceptance.sh');
const SHA = 'a'.repeat(40);
let server, base, stubs;

before(async () => {
  const files = {
    '/release.json': JSON.stringify({source_commit: SHA}),
    '/data/campsites/search-index.json': JSON.stringify({version: 1, sites: [{id: 'x:1'}]}),
    '/data/campsites/identity-hosts.json': JSON.stringify({version: 1, hosts: {}}),
  };
  server = http.createServer((req, res) => {
    const body = files[req.url.split('?')[0]];
    if (body) { res.writeHead(200, {'content-type': 'application/json'}); res.end(body); } else { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  stubs = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-stubs-'));
  // One stub serves both check names. STUB_<NAME> chooses its behaviour; the default passes.
  const stub = `
    const mode = process.env['STUB_' + require('path').basename(process.argv[1], '.js').replace(/-/g, '_').toUpperCase()] || 'pass';
    const release = {source_commit: process.env.EXPECTED_SHA};
    if (mode === 'pass') { console.log(JSON.stringify({result: 'PASS', release})); }
    else if (mode === 'wrong-release') { console.log(JSON.stringify({result: 'PASS', release: {source_commit: 'c'.repeat(40)}})); }
    else if (mode === 'no-release') { console.log(JSON.stringify({result: 'PASS'})); }
    else if (mode === 'mismatch') { console.log(JSON.stringify({result: 'FAIL', mismatches: 1, missing: ['x:1']})); process.exitCode = 1; }
    else if (mode === 'error') { throw new Error('stub script error'); }
    else if (mode === 'timeout') { setTimeout(() => {}, 60000); }
    else if (mode === 'silent') { /* exits 0 with no output */ }
    else if (mode === 'badjson') { console.log('{not json'); }
    else if (mode === 'fail-exit-0') { console.log(JSON.stringify({result: 'FAIL'})); }
  `;
  fs.writeFileSync(path.join(stubs, 'live-identity-census.js'), stub);
  fs.writeFileSync(path.join(stubs, 'live-saved-stop-reopen.js'), stub);
});

after(() => { server.close(); fs.rmSync(stubs, {recursive: true, force: true}); });

// Async spawn: the fake site runs in this process, so a blocking spawn would deadlock its replies.
function run(env = {}, sha = SHA) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-out-'));
  return new Promise(resolve => {
    const child = spawn('bash', [RUNNER, sha, out], {env: {...process.env, BASE: base, ACCEPTANCE_SCRIPTS: stubs, STEP_TIMEOUT: '3', ...env}, stdio: 'ignore'});
    const kill = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.on('close', status => {
      clearTimeout(kill);
      const log = fs.existsSync(path.join(out, 'log.txt')) ? fs.readFileSync(path.join(out, 'log.txt'), 'utf8') : '';
      fs.rmSync(out, {recursive: true, force: true});
      resolve({status, log});
    });
  });
}

test('every step passing gives exit 0', async () => {
  const r = await run();
  assert.equal(r.status, 0, r.log);
  assert.match(r.log, /end PASS/);
});

test('a census mismatch fails the run', async () => {
  const r = await run({STUB_LIVE_IDENTITY_CENSUS: 'mismatch'});
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.log, /end PASS/);
});

test('a script error fails the run', async () => {
  assert.notEqual((await run({STUB_LIVE_SAVED_STOP_REOPEN: 'error'})).status, 0);
});

test('a step that exceeds its time limit fails the run', async () => {
  const r = await run({STUB_LIVE_IDENTITY_CENSUS: 'timeout'});
  assert.notEqual(r.status, 0);
  assert.match(r.log, /FAILED \(exit or timeout\)/);
});

test('missing, unparsable or non-PASS output fails even when the script exits 0', async () => {
  for (const mode of ['silent', 'badjson', 'fail-exit-0']) {
    const r = await run({STUB_LIVE_SAVED_STOP_REOPEN: mode});
    assert.notEqual(r.status, 0, mode);
    assert.match(r.log, /missing, empty or non-PASS result/, mode);
  }
});

test('a step result from another release fails the run, even when it says PASS', async () => {
  for (const mode of ['wrong-release', 'no-release']) {
    const r = await run({STUB_LIVE_IDENTITY_CENSUS: mode});
    assert.notEqual(r.status, 0, mode);
    assert.match(r.log, /wrong release/, mode);
    assert.doesNotMatch(r.log, /end PASS/, mode);
  }
});

test('a different deployed SHA fails before any check runs', async () => {
  const r = await run({}, 'b'.repeat(40));
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.log, /step census/);
});
