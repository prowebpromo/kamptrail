/* Fire-weather alert overlay (R12): NWS Red Flag Warnings and Fire Weather Watches.
   Kept apart from fire perimeters, smoke and closures. Alerts come from api/environment.php (kind=firewx),
   zone-only alerts are drawn from NWS zone geometry (kind=zone), and the alert list never depends on geometry.
   Dynamic hazards are never saved for offline use. */
(function (global) {
  'use strict';
  const i18n = () => global.KampTrailI18n || globalThis.KampTrailI18n;
  const t = (key, params) => i18n()?.t(key, params) ?? String(key).replace(/\{([a-zA-Z0-9_]+)\}/g, (token, name) => Object.hasOwn(params || {}, name) ? String(params[name]) : token);
  const EVENTS = ['Red Flag Warning', 'Fire Weather Watch'];
  const MESSAGE_TYPES = ['Alert', 'Update', 'Cancel'];
  const ZONE_PATTERN = /^(fire|forecast|county)\/[A-Z]{2}[CZ]\d{3}$/;
  const FRESH_MS = 15 * 60 * 1000;          // older than this is labelled stale
  const STALE_MAX_MS = 6 * 60 * 60 * 1000;  // older than this is not shown at all
  const REFRESH_MS = 5 * 60 * 1000;
  const ZONE_BUDGET = 12;                   // zone geometries requested per refresh (requests are paced by environment.js)
  const ZONE_RETRY_MS = 10 * 60 * 1000;
  const MAX_FEATURES = 500;
  const SOURCE = { name: 'National Weather Service', url: 'https://www.weather.gov/fire/' };
  const LABEL = 'Fire weather alerts (NWS)';
  const time = value => { const n = Date.parse(value); return Number.isFinite(n) ? n : null; };
  const text = value => typeof value === 'string' ? value : '';
  const node = (tag, content, cls) => { const n = document.createElement(tag); if (content != null) n.textContent = content; if (cls) n.className = cls; return n; };
  const st = { retired: new Set(), map: null, group: null, enabled: false, data: null, failed: false, zones: new Map(), seq: 0, controller: null, timer: null, tick: null, control: null, status: null, list: null, banner: null, renderer: null };

  function geometryOk(g) {
    const check = global.KampTrailEnvironment?.validGeometry;
    if (typeof check !== 'function') throw new Error('Geometry validator missing');
    return check(g);
  }

  /** Throws unless the payload is a complete, well-formed fire-weather snapshot. Staleness is labelled, not thrown, until it is too old to use. */
  function validate(d, now = Date.now()) {
    if (!d || d.ok !== true || d.version !== 1 || d.kind !== 'firewx' || d.partial === true || d.data?.type !== 'FeatureCollection' || !Array.isArray(d.data.features) || d.data.features.length > MAX_FEATURES) throw new Error('Invalid fire weather snapshot');
    const at = time(d.retrieved_at);
    if (at == null || at > now + 60000) throw new Error('Invalid retrieval time');
    if (now - at > STALE_MAX_MS) throw new Error('Snapshot too old');
    for (const f of d.data.features) {
      const p = f?.properties;
      if (f?.type !== 'Feature' || !p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Invalid feature');
      if (!EVENTS.includes(p.event) || !text(p.id) || !MESSAGE_TYPES.includes(p.messageType)) throw new Error('Invalid alert');
      if (time(p.expires) == null && time(p.ends) == null) throw new Error('Alert has no expiry');
      if (f.geometry != null && !geometryOk(f.geometry)) throw new Error('Invalid shape');
      if (p.zones != null && (!Array.isArray(p.zones) || p.zones.length > 60 || !p.zones.every(z => typeof z === 'string' && ZONE_PATTERN.test(z)))) throw new Error('Invalid zones');
      if (p.references != null && (!Array.isArray(p.references) || !p.references.every(r => typeof r === 'string'))) throw new Error('Invalid references');
    }
    const retired = d.data.retired;
    if (retired != null && (!Array.isArray(retired) || retired.length > MAX_FEATURES || !retired.every(id => typeof id === 'string'))) throw new Error('Invalid retired list');
    return d;
  }

  function validateZone(d, id) {
    if (!d || d.ok !== true || d.version !== 1 || d.kind !== 'zone' || d.data?.type !== 'FeatureCollection' || d.data.features?.length !== 1) throw new Error('Invalid zone');
    const f = d.data.features[0];
    if (f?.type !== 'Feature' || f.properties?.id !== id.slice(id.indexOf('/') + 1) || !geometryOk(f.geometry)) throw new Error('Invalid zone shape');
    return f.geometry;
  }

  /** Stale means more than 15 minutes since the last good retrieval (owner decision, 2026-11-01). The proxy's fresh_until and stale fields
    are recorded upstream metadata and do not drive this label. */
  const freshness = (d, now = Date.now()) => now - time(d.retrieved_at) > FRESH_MS ? 'stale' : 'fresh';
  const ageMinutes = (value, now) => Math.max(0, Math.floor((now - time(value)) / 60000));
  const endOf = p => { const ends = [time(p.expires), time(p.ends)].filter(n => n != null); return ends.length ? Math.min(...ends) : null; };

  /** Ids a snapshot says are replaced or cancelled: its own references plus the server's list, which also covers messages that have since expired. */
  function retiredIds(d) {
    const ids = new Set(Array.isArray(d.data.retired) ? d.data.retired : []);
    for (const f of d.data.features) for (const id of f.properties.references || []) ids.add(id);
    return ids;
  }
  /** Which alerts are current. Cancelled, superseded and expired alerts are counted, never returned as active.
      `retired` carries ids retired by earlier snapshots, so a replacement that later expires or leaves the feed cannot revive the original. */
  function select(features, now = Date.now(), retired = []) {
    const cancelled = new Set(), superseded = new Set(retired), latest = new Map();
    for (const f of features) {
      const p = f.properties;
      for (const id of p.references || []) (p.messageType === 'Cancel' ? cancelled : superseded).add(id);
      if (p.messageType === 'Cancel') continue;
      const known = latest.get(p.id);
      if (!known || (time(p.sent) || 0) >= (time(known.properties.sent) || 0)) latest.set(p.id, f);
    }
    const hidden = { cancelled: 0, superseded: 0, expired: 0 }, alerts = [];
    for (const [id, f] of latest) {
      const p = f.properties, end = endOf(p);
      if (cancelled.has(id)) { hidden.cancelled++; continue; }
      if (superseded.has(id)) { hidden.superseded++; continue; }
      if (end == null || end <= now) { hidden.expired++; continue; }
      const onset = time(p.onset);
      alerts.push({ id, event: p.event, headline: text(p.headline), areaDesc: text(p.areaDesc), severity: text(p.severity), sent: p.sent || null, effective: p.effective || null, onset: p.onset || null, expires: p.expires || null, ends: p.ends || null,
        geometry: f.geometry || null, zones: Array.isArray(p.zones) ? p.zones : [], zoneCount: Number.isFinite(p.zone_count) ? p.zone_count : (p.zones || []).length, status: onset != null && onset > now ? 'upcoming' : 'active' });
    }
    alerts.sort((a, b) => (a.event === b.event ? 0 : a.event === EVENTS[0] ? -1 : 1) || endOf(a) - endOf(b) || a.id.localeCompare(b.id));
    return { alerts, hidden };
  }

  const usable = (entry, now) => entry && (entry.geometry || now - entry.at < ZONE_RETRY_MS);

  /** Zone paths still needed for alerts that carry no polygon, capped by budget. */
  function neededZones(alerts, cache, now = Date.now(), budget = ZONE_BUDGET) {
    const out = [];
    for (const a of alerts) {
      if (a.geometry) continue;
      for (const z of a.zones) if (!out.includes(z) && !usable(cache.get(z), now)) out.push(z);
    }
    return out.slice(0, budget);
  }

  /** The area an alert can be drawn with: its own polygon, resolved zones, a partial set, or nothing (the alert is still listed). */
  function resolveShape(alert, cache, now = Date.now()) {
    if (alert.geometry) return { state: 'polygon', geometry: alert.geometry };
    if (!alert.zones.length) return { state: 'none', geometry: null };
    const polygons = []; let resolved = 0, pending = 0;
    for (const z of alert.zones) {
      const e = cache.get(z);
      if (!e || (!e.geometry && now - e.at >= ZONE_RETRY_MS)) { pending++; continue; }
      if (!e.geometry) continue;
      resolved++;
      polygons.push(...(e.geometry.type === 'Polygon' ? [e.geometry.coordinates] : e.geometry.coordinates));
    }
    const total = Math.max(alert.zoneCount, alert.zones.length);
    const stale = alert.zones.some(z => { const e = cache.get(z); return e?.geometry && now - e.at > FRESH_MS; });
    const geometry = polygons.length ? { type: 'MultiPolygon', coordinates: polygons } : null;
    if (!resolved) return { state: pending ? 'pending' : 'unavailable', geometry: null, resolved, total };
    return { state: resolved === total && !pending ? 'zones' : 'partial', geometry, resolved, total, stale };
  }

  // ---- display ---------------------------------------------------------------------------------------------------
  const stamp = value => { const n = time(value); return n == null ? t('Not reported') : new Date(n).toLocaleString(i18n()?.locale?.()); };
  const eventLabel = event => event === EVENTS[0] ? t('Red Flag Warning') : event === EVENTS[1] ? t('Fire Weather Watch') : event;
  function shapeNote(shape) {
    switch (shape.state) {
      case 'polygon': return t('Map area: the alert polygon from NWS.');
      case 'zones': return t('Map area: {0} NWS zones.', { 0: shape.resolved });
      case 'partial': return t('Map area is partial: {0} of {1} NWS zones drawn.', { 0: shape.resolved, 1: shape.total });
      case 'pending': return t('Loading the map area from NWS zones…');
      case 'unavailable': return t('Map area unavailable. This alert is listed without a drawn area.');
      default: return t('NWS gave no map area for this alert.');
    }
  }
  function sourceLink() { const a = node('a', t('{source} source', { source: SOURCE.name })); a.href = SOURCE.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }

  function card(alert, shape, now) {
    const article = node('article', null, 'kt-firewx-alert');
    article.dataset.alertId = alert.id; article.dataset.shape = shape.state; article.dataset.status = alert.status;
    article.dataset.kind = alert.event === EVENTS[0] ? 'warning' : 'watch';
    const bounds = shape.geometry && global.L ? L.geoJSON({ type: 'Feature', geometry: shape.geometry, properties: {} }).getBounds() : null;
    article.append(node('h2', eventLabel(alert.event)));
    if (alert.status === 'upcoming') article.append(node('p', t('Not yet in effect. Begins {0}.', { 0: stamp(alert.onset) }), 'kt-firewx-upcoming'));
    if (alert.headline) { article.append(node('p', t('Original source text (publisher language)'), 'kt-fine'), node('p', alert.headline)); }
    article.append(node('p', t('Issued {0} · effective {1} · expires {2}', { 0: stamp(alert.sent), 1: stamp(alert.effective), 2: stamp(alert.expires) })));
    if (alert.ends && alert.ends !== alert.expires) article.append(node('p', t('Event ends {0}', { 0: stamp(alert.ends) })));
    if (alert.areaDesc) article.append(node('p', alert.areaDesc));
    article.append(node('p', shapeNote(shape), 'kt-fine'));
    if (shape.stale) article.append(node('p', t('Zone shape was retrieved more than 15 minutes ago and may be out of date.'), 'kt-fine kt-firewx-stale-zone'));
    if (bounds?.isValid() && st.map) { const show = node('button', t('Show on map'), 'btn'); show.type = 'button'; show.onclick = () => st.map.fitBounds(bounds, { maxZoom: 9, padding: [24, 24] }); article.append(show); }
    article.append(node('p', t('Source: {0}', { 0: SOURCE.name }), 'kt-fine'), sourceLink());
    return article;
  }

  function setStatus(message) { if (st.status) st.status.textContent = message; }

  /** The snapshot, or null once it is more than six hours past its retrieval. Applied on every render, not only when fetching. */
  const usableSnapshot = (d, now = Date.now()) => d && now - time(d.retrieved_at) <= STALE_MAX_MS ? d : null;

  function render(now = Date.now()) {
    if (!st.control) return;
    st.group.clearLayers(); st.list.replaceChildren(); st.banner.replaceChildren();
    if (st.data && !usableSnapshot(st.data, now)) {
      st.data = null; st.failed = false;
      setStatus(t('Fire weather alerts are unavailable. No alerts or shapes are shown. Check the NWS source.'));
      return;
    }
    const d = st.data;
    if (!d) return;
    const kind = freshness(d, now);
    const fixture = d.fixture ? node('p', d.fixture.synthetic ? t('Synthetic test data, not a current alert.') : t('Historical captured test data, not a current alert.'), 'kt-firewx-fixture') : null;
    if (fixture) st.banner.append(fixture);
    st.banner.append(node('p', t('National Weather Service · retrieved {0}', { 0: stamp(d.retrieved_at) })));
    const minutes = ageMinutes(d.retrieved_at, now);
    st.banner.append(node('p', minutes < 1 ? t('Updated less than a minute ago') : t('Updated {0} min ago', { 0: minutes }), 'kt-firewx-age'));
    if (kind === 'stale' || st.failed) st.banner.append(node('p', t('Stale: retrieved {0}. These alerts may have changed or ended. Check the NWS source.', { 0: stamp(d.retrieved_at) }), 'kt-firewx-stale'));
    const { alerts, hidden } = select(d.data.features, now, st.retired);
    const features = [];
    for (const a of alerts) {
      const shape = resolveShape(a, st.zones, now);
      st.list.append(card(a, shape, now));
      if (shape.geometry) features.push({ type: 'Feature', geometry: shape.geometry, properties: { id: a.id, event: a.event, status: a.status, label: eventLabel(a.event) } });
    }
    const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (features.length) L.geoJSON({ type: 'FeatureCollection', features }, {
      renderer: st.renderer, bubblingMouseEvents: false,
      style: f => ({ color: css(f.properties.event === EVENTS[0] ? '--firewx-warning' : '--firewx-watch'), weight: Number(css('--firewx-stroke')) || 2, fillOpacity: Number(css('--firewx-opacity')) || .2, dashArray: f.properties.event === EVENTS[0] ? null : '6 4', className: 'kt-firewx-shape' }),
      onEachFeature(f, layer) {
        layer.bindPopup(() => { const a = alerts.find(x => x.id === f.properties.id); return a ? card(a, resolveShape(a, st.zones), Date.now()) : node('p', ''); });
        layer.on('add', () => { const e = layer.getElement?.(); if (e) { e.setAttribute('tabindex', '0'); e.setAttribute('role', 'button'); e.setAttribute('data-alert-id', f.properties.id); e.setAttribute('aria-label', `${t('Fire weather alert')}: ${f.properties.label}`); e.addEventListener('keydown', ev => { if (['Enter', ' '].includes(ev.key)) { ev.preventDefault(); ev.stopPropagation(); layer.openPopup(); } }); } });
      } }).addTo(st.group);
    if (!alerts.length) st.list.append(node('p', t('No current Red Flag Warnings or Fire Weather Watches were returned. This does not mean fire danger is low or conditions are safe.'), 'kt-firewx-empty'));
    const hiddenCount = hidden.cancelled + hidden.superseded + hidden.expired;
    if (hiddenCount) st.list.append(node('p', t('{0} ended, cancelled or replaced alerts are not shown.', { 0: hiddenCount }), 'kt-fine'));
    setStatus(t('{0} current alerts. Retrieved {1}.', { 0: alerts.length, 1: stamp(d.retrieved_at) }) + (kind === 'stale' || st.failed ? ' ' + t('Stale.') : ''));
  }

  // ---- loading ---------------------------------------------------------------------------------------------------
  async function loadZones(seq, signal) {
    const { alerts } = select(st.data.data.features, Date.now(), st.retired);
    for (const zone of neededZones(alerts, st.zones)) {
      if (seq !== st.seq || !st.enabled || !navigator.onLine) return;
      try {
        const d = await global.KampTrailEnvironment.request('zone', zone, signal);
        if (seq !== st.seq) return;
        st.zones.set(zone, { geometry: validateZone(d, zone), at: Date.now() });
      } catch {
        if (seq !== st.seq) return;
        if (global.KampTrailEnvironment.retryAfterMs() > 0) return;   // rate limited: ask for nothing more until Retry-After
        st.zones.set(zone, { geometry: null, at: Date.now() });   // geometry failure: the alert stays listed
      }
      render();
    }
  }

  async function refresh() {
    if (!st.enabled) return;
    const seq = ++st.seq; st.controller?.abort(); clearTimeout(st.timer);
    if (!navigator.onLine) { st.data = null; st.failed = false; render(); setStatus(t('Offline: live context is hidden. Reconnect and refresh.')); return; }
    const controller = new AbortController(); st.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 45000);
    setStatus(t('Loading official source…'));
    try {
      const d = validate(await global.KampTrailEnvironment.request('firewx', null, controller.signal));
      if (seq !== st.seq || !st.enabled) return;
      for (const id of retiredIds(d)) st.retired.add(id);
      st.data = d; st.failed = false; render();
      await loadZones(seq, controller.signal);
    } catch {
      if (seq !== st.seq || !st.enabled) return;
      st.failed = true;
      if (st.data && Date.now() - time(st.data.retrieved_at) <= STALE_MAX_MS) { render(); setStatus(t('Could not refresh. Showing alerts retrieved {0}. Stale.', { 0: stamp(st.data.retrieved_at) })); }
      else { st.data = null; render(); setStatus(t('Fire weather alerts are unavailable. No alerts or shapes are shown. Check the NWS source.')); }
    } finally { clearTimeout(timeout); }
    // Poll every five minutes, or at the upstream Retry-After if that is later. Never earlier than Retry-After.
    if (seq === st.seq && st.enabled) st.timer = setTimeout(refresh, Math.max(REFRESH_MS, global.KampTrailEnvironment.retryAfterMs()));
  }

  function panel() {
    const c = L.control({ position: 'bottomleft' });
    c.onAdd = () => {
      const box = node('div', null, 'kt-firewx-control'); box.dataset.firewx = 'panel';
      const details = node('details'); details.open = !matchMedia('(max-width:760px)').matches; details.append(node('summary', t('Fire weather alerts')));
      const body = node('div', null, 'kt-firewx-body');
      body.append(node('p', t('NWS Red Flag Warnings and Fire Weather Watches only. Separate from fire perimeters, smoke and closures. Not an emergency warning service. Check local authorities and posted restrictions before travel.'), 'kt-fine'));
      const line = node('p', t('Not enabled.')); line.setAttribute('role', 'status'); line.setAttribute('aria-live', 'polite'); line.dataset.firewxStatus = '';
      st.status = line; st.banner = node('div', null, 'kt-firewx-banner'); st.list = node('div', null, 'kt-firewx-list');
      const key = node('ul', null, 'kt-firewx-key');
      for (const [cls, label] of [['warning', t('Red Flag Warning (solid outline)')], ['watch', t('Fire Weather Watch (dashed outline)')]]) { const li = node('li'), i = node('i'); i.className = 'kt-firewx-key-' + cls; i.setAttribute('aria-hidden', 'true'); li.append(i, label); key.append(li); }
      const retry = node('button', t('Refresh fire weather alerts'), 'btn'); retry.type = 'button'; retry.onclick = () => { st.zones = new Map([...st.zones].filter(([, e]) => e.geometry)); refresh(); };
      body.append(line, st.banner, st.list, key, retry, sourceLink());
      details.append(body); box.append(details);
      L.DomEvent.disableClickPropagation(box); L.DomEvent.disableScrollPropagation(box);
      return box;
    };
    return c;
  }

  function enable() {
    st.enabled = true;
    if (!st.control) st.control = panel().addTo(st.map);
    clearInterval(st.tick); st.tick = setInterval(() => render(), 60000);   // expiry and staleness apply as time passes
    refresh();
  }
  function disable() {
    st.enabled = false; st.seq++; st.controller?.abort(); clearTimeout(st.timer); clearInterval(st.tick);
    st.group.clearLayers(); st.control?.remove(); st.control = null; st.status = null; st.data = null; st.failed = false;
  }

  function init(map) {
    st.map = map; st.renderer = L.svg(); st.group = L.layerGroup();
    st.group.on('add', enable); st.group.on('remove', disable);
    global.addEventListener('offline', () => st.enabled && refresh());
    global.addEventListener('online', () => st.enabled && refresh());
    document.addEventListener('visibilitychange', () => { if (!document.hidden && st.enabled) refresh(); });
    return { [LABEL]: st.group };
  }

  global.KampTrailFireWeather = { version: '2.35.0', LABEL, EVENTS, FRESH_MS, STALE_MAX_MS, ZONE_BUDGET, init, refresh, render, validate, validateZone, freshness, ageMinutes, select, retiredIds, usableSnapshot, neededZones, resolveShape };
})(typeof window !== 'undefined' ? window : globalThis);
