'use strict';
// The live census must fail on any browser state that differs from the published index, including
// browser listings the index does not have (Codex review of PR #161: expected [A], browser [A, extra]).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {compare, loadFailures} = require('../scripts/acceptance/census-compare');

const A = ['a:1', ['a:1', 'a:legacy']], B = ['b:1', ['b:1']];

test('an exact match passes', () => {
  const r = compare([A, B], [['a:1', ['a:1', 'a:legacy']], ['b:1', ['b:1']]]);
  assert.equal(r.mismatches, 0);
  assert.equal(r.count_differs, false);
});

test('an extra browser listing with an unpublished id fails', () => {
  const r = compare([A], [['a:1', ['a:1', 'a:legacy']], ['x:extra', ['x:extra']]]);
  assert.equal(r.browser_features, 2);
  assert.equal(r.expected_listings, 1);
  assert.equal(r.count_differs, true);
  assert.deepEqual(r.unexpected, ['x:extra: x:extra']);
  assert.ok(r.mismatches >= 2);
});

test('an unpublished id inside a matched listing fails', () => {
  const r = compare([A], [['a:1', ['a:1', 'a:legacy', 'z:9']]]);
  assert.deepEqual(r.unexpected, ['a:1: z:9']);
  assert.ok(r.mismatches > 0);
});

test('a duplicate browser listing of a published id fails as a split and a count difference', () => {
  const r = compare([A], [['a:1', ['a:1', 'a:legacy']], ['a:legacy', ['a:legacy']]]);
  assert.deepEqual(r.split, ['a:1']);
  assert.equal(r.count_differs, true);
  assert.ok(r.mismatches >= 2);
});

test('missing, canonical, source-set and wrong-merge differences fail', () => {
  assert.deepEqual(compare([A, B], [['a:1', ['a:1', 'a:legacy']]]).missing, ['b:1']);
  assert.deepEqual(compare([A], [['a:legacy', ['a:1', 'a:legacy']]]).canonical, ['a:1->a:legacy']);
  assert.equal(compare([A], [['a:1', ['a:1']]]).sourceSet.length, 1);
  const merged = compare([A, B], [['a:1', ['a:1', 'a:legacy', 'b:1']]]);
  assert.deepEqual(merged.wrongMerge, ['a:1']);
  assert.equal(merged.count_differs, true);
});

// Live census on 2.37.0 (2026-11-02): agency files that did not load showed only as a count mismatch.
test('agency load failures are named census failures', () => {
  const ok = {failedStates: [], agencyIndex: 'ok', agencyFailedStates: []};
  assert.deepEqual(loadFailures(ok), []);
  assert.deepEqual(loadFailures({...ok, agencyIndex: 'failed', agencyIndexError: 'HTTP 404'}), ['agency index failed: HTTP 404']);
  assert.deepEqual(loadFailures({...ok, agencyFailedStates: [{state: 'CO', error: 'HTTP 500'}, {state: 'ID', error: 'Request timed out'}]}),
    ['agency file CO failed to load: HTTP 500', 'agency file ID failed to load: Request timed out']);
  assert.deepEqual(loadFailures({...ok, failedStates: [{state: 'NY', error: 'HTTP 503'}]}), ['state NY failed to load: HTTP 503']);
  assert.deepEqual(loadFailures({...ok, agencyIndex: 'pending'}), ['agency index pending']);
  // A build without the agency status cannot prove the agency listings loaded.
  assert.deepEqual(loadFailures({failedStates: []}), ['agency index status unavailable']);
});
