/* Share links (#site=ID, #spot=lat,lng) and community correction links (GitHub issue forms). */
(function () {
  'use strict';
  const REPO = 'https://github.com/prowebpromo/kamptrail';
  function baseUrl() { return location.href.split('#')[0].split('?')[0]; }
  function linkFor(target) {
    if (target.site != null) return `${baseUrl()}#site=${encodeURIComponent(String(target.site))}`;
    if (Array.isArray(target.spot)) return `${baseUrl()}#spot=${target.spot[0].toFixed(5)},${target.spot[1].toFixed(5)}`;
    return baseUrl();
  }
  async function share(target, title) {
    const url = linkFor(target);
    try {
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '')) { await navigator.share({title: `${title} | KampTrail`, url}); return url; }
    } catch (e) { if (e && e.name === 'AbortError') return url; }
    try { await navigator.clipboard.writeText(url); window.showToast?.('Link copied. Anyone with the link can open this location in KampTrail.'); }
    catch { window.prompt?.('Copy this link:', url); }
    return url;
  }
  function parse(hash = location.hash) {
    const h = String(hash || '').replace(/^#/, '');
    const site = h.match(/^site=(.+)$/);
    if (site) { try { return {site: decodeURIComponent(site[1]).slice(0, 200)}; } catch { return null; } }
    const spot = h.match(/^spot=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    if (spot) { const lat = +spot[1], lng = +spot[2]; if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return {spot: [lat, lng]}; }
    return null;
  }
  function issueUrl(kind, site) {
    const p = new URLSearchParams();
    if (kind === 'new') {
      p.set('template', 'new-campsite.yml');
      p.set('title', 'New campsite: ');
      if (site && site.lat != null) p.set('coordinates', `${site.lat.toFixed(5)}, ${site.lng.toFixed(5)}`);
    } else {
      const props = site.properties, [lng, lat] = site.geometry.coordinates;
      p.set('template', 'campsite-correction.yml');
      p.set('title', `Correction: ${String(props.name || '').slice(0, 80)}`);
      p.set('campsite', `${props.name} (${props.id})`);
      p.set('link', linkFor({site: props.id}));
      p.set('coordinates', `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    }
    return `${REPO}/issues/new?${p}`;
  }
  window.KampTrailShare = {version: '2.11.1', linkFor, share, parse, issueUrl, REPO};
})();
