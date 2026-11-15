/* Historical identity reservations, separate from current campsite discovery. */
(function (global) {
  'use strict';
  const caches = new WeakMap();
  const idText = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x20\x7f]/.test(value);
  const dateText = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z)?$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value.slice(0,10);
  const reasons = new Set(['source_absent_latest_feed', 'historical_identity_pending_reconciliation', 'no_longer_in_current_catalogue']);
  function validateHistory(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.listings) || data.listings.length > 200000) throw Error('Invalid listing history');
    const claimed = new Set();
    for (const row of data.listings) {
      if (!row || !idText(row.id) || !Array.isArray(row.legacy_ids) || row.legacy_ids.length > 128 || !row.legacy_ids.every(idText)
          || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 1000
          || !Number.isFinite(row.lat) || !Number.isFinite(row.lng) || Math.abs(row.lat) > 90 || Math.abs(row.lng) > 180
          || !Array.isArray(row.states) || !row.states.length || row.states.length > 50 || row.states.some(code => !/^[A-Z]{2}$/.test(code))
          || !reasons.has(row.reason) || !dateText(row.archived_at) || !row.archived_at.includes('T')
          || !Array.isArray(row.source_dates) || row.source_dates.length > 4096 || !Array.isArray(row.source_urls) || row.source_urls.length > 4096) throw Error('Invalid historical listing');
      const ids = [row.id, ...row.legacy_ids];
      for (const id of ids) {
        if (claimed.has(id)) throw Error('Historical identity claimed more than once: ' + id);
        claimed.add(id);
      }
      for (const item of row.source_dates) if (!item || !ids.includes(item.source_record_id)
          || !Object.hasOwn(item, 'retrieved_at') || !Object.hasOwn(item, 'updated_at')
          || [item.retrieved_at, item.updated_at].some(date => date !== null && !dateText(date))) throw Error('Invalid historical source date');
      for (const item of row.source_urls) {
        if (!item || !ids.includes(item.source_record_id) || typeof item.url !== 'string' || item.url.length > 2048) throw Error('Invalid historical source URL');
        let url; try { url = new URL(item.url); } catch { throw Error('Invalid historical source URL'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid historical source URL');
      }
    }
    return data;
  }
  function historyMap(data) {
    if (!data) return new Map();
    if (caches.has(data)) return caches.get(data);
    validateHistory(data);
    const map = new Map();
    for (const row of data.listings) for (const id of [row.id, ...row.legacy_ids]) map.set(id, row);
    caches.set(data, map); return map;
  }
  function reservedIds(data) { return new Set(historyMap(data).keys()); }
  function filterActiveFeature(feature, data) {
    const reserved = historyMap(data), p = feature?.properties;
    if (!p) return feature;
    const own = [p.id != null ? String(p.id) : null,
      p.facility_id != null ? `ridb:${p.facility_id}` : null,
      p.osm_id != null ? `osm:${p.osm_type || 'unknown'}:${p.osm_id}` : null];
    if (own.some(id=>reserved.has(id))) return null;
    const properties = {...p};
    for (const key of ['legacy_ids', 'source_ids']) if (Array.isArray(p[key])) properties[key] = p[key].filter(id => !reserved.has(String(id)));
    return {...feature, properties};
  }
  function historicalFeature(row) {
    validateHistory({version:1, listings:[row]});
    return {type:'Feature', geometry:{type:'Point', coordinates:[row.lng, row.lat]}, properties:{
      id:row.id, name:row.name, legacy_ids:[...row.legacy_ids], state:row.states[0], historical_listing:true, history:row
    }};
  }
  function serializeHistory(data) { return JSON.stringify(validateHistory(data)) + '\n'; }
  const api = {version:'2.47.0', validateHistory, historyMap, reservedIds, filterActiveFeature, historicalFeature, serializeHistory};
  global.KampTrailListingHistory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
