(function (root) {
  'use strict';

  const VERSION = '2.51.0';
  const site = 'https://boondockorbust.com';
  const hub = site + '/boondocking-guide/free-rv-parking-is-disappearing-fast-where-you-can-still-stay-overnight/#state-guides';
  const endpoint = site + '/wp-json/wp/v2/posts';
  const pageSize = 100;

  function addPost(directory, post) {
    if (!post || post.status !== 'publish' || typeof post.slug !== 'string') return;
    const state = /^overnight-rv-parking-([a-z]+(?:-[a-z]+)*)$/.exec(post.slug);
    const interstate = /^i-([1-9]\d{0,2})-overnight-rv-parking$/.exec(post.slug);
    if (!state && !interstate) return;

    // The post's own permalink must match its canonical guide path on BoB.
    if (post.link !== site + '/resources/' + post.slug + '/') return;
    if (state) directory.states.set(state[1], post.link);
    if (interstate) directory.interstates.set(interstate[1], post.link);
  }

  async function fetchDirectory(fetchImpl) {
    const directory = {states: new Map(), interstates: new Map()};
    let previousFirstId;
    for (let page = 1; ; page++) {
      const url = new URL(endpoint);
      url.search = new URLSearchParams({
        categories: '156', per_page: String(pageSize), status: 'publish',
        orderby: 'id', order: 'asc', _fields: 'id,slug,link,status', page: String(page)
      }).toString();
      const response = await fetchImpl(url.href, {credentials: 'omit'});
      if (!response.ok) {
        // A full final page with unexposed pagination headers requires one extra request.
        if (page > 1 && response.status === 400) {
          const error = await response.json();
          if (error && error.code === 'rest_post_invalid_page_number') return directory;
        }
        throw new Error('BoB guide directory returned HTTP ' + response.status);
      }
      const posts = await response.json();
      if (!Array.isArray(posts)) throw new Error('Invalid BoB guide directory');
      if (posts.length && page > 1 && posts[0].id === previousFirstId) {
        throw new Error('BoB returned the same page twice');
      }
      posts.forEach(post => addPost(directory, post));
      const totalPages = Number(response.headers.get('X-WP-TotalPages'));
      if (Number.isInteger(totalPages) && totalPages > 0 ? page >= totalPages : posts.length < pageSize) {
        return directory;
      }
      previousFirstId = posts[0] && posts[0].id;
    }
  }

  let pending;
  function load() {
    if (!pending) {
      pending = fetchDirectory((url, options) => root.fetch(url, options)).catch(() => {
        // Offline or interrupted discovery uses the hub. A later mode entry can retry.
        pending = undefined;
        return null;
      });
    }
    return pending;
  }

  function links(directory, state, interstates, stateNames = root.KampTrailStateNames || {}) {
    const value = String(state || '').trim();
    const name = Object.prototype.hasOwnProperty.call(stateNames, value.toUpperCase())
      ? stateNames[value.toUpperCase()] : value;
    const stateSlug = name.toLowerCase().replace(/\s+/g, '-');
    const stateUrl = directory && directory.states.get(stateSlug);
    const interstateGuides = [];
    const seen = new Set();
    for (const route of Array.isArray(interstates) ? interstates : [interstates]) {
      const match = /^(?:(?:interstate|i)[\s-]*)?([1-9]\d{0,2})$/i.exec(String(route || '').trim());
      if (!match || seen.has(match[1]) || !directory) continue;
      const url = directory.interstates.get(match[1]);
      if (url) {
        seen.add(match[1]);
        interstateGuides.push({route: 'I-' + match[1], url});
      }
    }
    return {stateUrl: stateUrl || hub, isStateGuide: Boolean(stateUrl), interstateGuides};
  }

  const api = {version: VERSION, load, links, fetchDirectory};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KTOvernightGuides = api;
})(typeof window === 'undefined' ? globalThis : window);
