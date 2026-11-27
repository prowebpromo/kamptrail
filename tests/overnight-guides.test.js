'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {fetchDirectory, links} = require('../overnight-guides');
const base = 'https://boondockorbust.com/resources/';

function post(id, slug, changes = {}) {
  return {id, slug, status: 'publish', link: base + slug + '/', ...changes};
}

function response(posts, pages) {
  return new Response(JSON.stringify(posts), {
    headers: pages ? {'X-WP-TotalPages': String(pages)} : {}
  });
}

test('published guide permalinks are discovered across pages and matched to exact routes', async () => {
  const pages = [
    [post(1, 'overnight-rv-parking-new-york'), post(2, 'i-9-overnight-rv-parking')],
    [post(3, 'i-90-overnight-rv-parking'), post(4, 'overnight-rv-parking-new-mexico')]
  ];
  const calls = [];
  const directory = await fetchDirectory(async (url, options) => {
    const request = new URL(url);
    assert.equal(request.origin, 'https://boondockorbust.com');
    assert.equal(request.pathname, '/wp-json/wp/v2/posts');
    assert.equal(request.searchParams.get('categories'), '156');
    assert.equal(request.searchParams.get('per_page'), '100');
    assert.equal(options.credentials, 'omit');
    calls.push(Number(request.searchParams.get('page')));
    return response(pages.at(calls.length - 1), pages.length);
  });
  assert.deepEqual(calls, [1, 2]);
  const ny = links(directory, 'NY', ['Interstate 90', 'I-90', 'US 90', 'I-901'], {NY: 'New York'});
  assert.equal(ny.stateUrl, base + 'overnight-rv-parking-new-york/');
  assert.equal(ny.isStateGuide, true);
  assert.deepEqual(ny.interstateGuides, [{route: 'I-90', url: base + 'i-90-overnight-rv-parking/'}]);
  assert.equal(links(directory, 'New Mexico').stateUrl, base + 'overnight-rv-parking-new-mexico/');
  assert.equal(links(directory, 'new-mexico').isStateGuide, true);
});

test('unavailable, unpublished and foreign or noncanonical URLs get the hub fallback', async () => {
  const directory = await fetchDirectory(async () => response([
    post(1, 'overnight-rv-parking-kansas', {status: 'draft'}),
    post(2, 'overnight-rv-parking-ohio', {link: 'https://other.example/resources/overnight-rv-parking-ohio/'}),
    post(3, 'overnight-rv-parking-texas', {link: base + 'a-different-slug/'}),
    post(4, 'i-95-overnight-rv-parking-news')
  ]));
  for (const state of ['Kansas', 'Ohio', 'Texas', 'Nevada', '']) {
    assert.deepEqual(links(directory, state, 'I-95'), links(null, state));
    assert.match(links(directory, state).stateUrl, /\/#state-guides$/);
    assert.equal(links(directory, state).isStateGuide, false);
  }
});

test('WordPress exact-multiple pagination works without exposed headers and propagates real failures', async () => {
  const full = Array.from({length: 100}, (_, i) => post(i + 1, 'another-' + i));
  let count = 0;
  const directory = await fetchDirectory(async () => ++count === 1 ? response(full) :
    new Response(JSON.stringify({code: 'rest_post_invalid_page_number'}), {status: 400}));
  assert.equal(count, 2);
  assert.equal(directory.states.size, 0);
  await assert.rejects(fetchDirectory(async () => response(full)), /same page twice/);
  await assert.rejects(fetchDirectory(async () => new Response('', {status: 503})), /503/);
});
