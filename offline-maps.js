/* Save USGS Topo map tiles for an area so the map works without signal.
   USGS The National Map services are public domain. OSM standard tiles are never bulk saved
   (the OSM tile policy prohibits bulk downloading). */
(function () {
  'use strict';
  const TOPO = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/';
  const MAX_TILES = 3000, AVG_KB = 20, MAX_ZOOM = 16, CONCURRENCY = 3;
  const STORE = 'kt_offline_areas_v1';
  const st = {map: null, panel: null, button: null, running: null};
  const cacheName = () => `kamptrail:${new URL('./', location.href).href}:tiles-v1`;
  const tileUrl = (z, x, y) => `${TOPO}${z}/${y}/${x}`;
  function lon2x(lng, z) { return Math.floor((lng + 180) / 360 * 2 ** z); }
  function lat2y(lat, z) { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); }
  function plan(bounds, zoom) {
    const zmin = Math.max(8, Math.min(Math.round(zoom), MAX_ZOOM)), zmax = Math.min(zmin + 4, MAX_ZOOM);
    const s = Math.max(bounds.getSouth(), -85), n = Math.min(bounds.getNorth(), 85);
    const w = Math.max(bounds.getWest(), -180), e = Math.min(bounds.getEast(), 179.9999);
    const urls = [];
    for (let z = zmin; z <= zmax; z++) {
      const x0 = lon2x(w, z), x1 = lon2x(e, z), y0 = lat2y(n, z), y1 = lat2y(s, z);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) + urls.length > MAX_TILES * 4) return {zmin, zmax, urls, tooMany: true};
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) urls.push(tileUrl(z, x, y));
    }
    return {zmin, zmax, urls, tooMany: urls.length > MAX_TILES};
  }
  function areas() { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; } }
  function saveAreas(list) { try { localStorage.setItem(STORE, JSON.stringify(list)); } catch {} }
  async function download(urls, onProgress, signal) {
    const cache = await caches.open(cacheName());
    let done = 0, failed = 0, next = 0;
    async function worker() {
      while (next < urls.length && !signal.aborted) {
        const url = urls[next++];
        try {
          if (!(await cache.match(url))) {
            const r = await fetch(url, {mode: 'cors', signal});
            if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) throw new Error('bad tile');
            await cache.put(url, r);
            await new Promise(res => setTimeout(res, 60)); // pace requests to the USGS service
          }
        } catch (e) { if (signal.aborted) break; failed++; }
        done++; onProgress(done, failed);
      }
    }
    await Promise.all(Array.from({length: CONCURRENCY}, worker));
    return {done, failed};
  }
  function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
  async function render() {
    const p = st.panel; if (!p) return;
    const list = areas();
    const tiles = list.reduce((n, a) => n + (a.saved || 0), 0);
    let usage = '';
    try { const est = await navigator.storage?.estimate?.(); if (est && est.usage) usage = ` · about ${Math.round(est.usage / 1048576)} MB used by this site`; } catch {}
    p.querySelector('.kt-off-status').textContent = list.length ? `${list.length} saved ${list.length === 1 ? 'area' : 'areas'}, ${tiles.toLocaleString('en-US')} map tiles${usage}` : 'No map areas saved yet.';
    p.querySelector('.kt-off-delete').hidden = !list.length;
  }
  async function saveArea() {
    if (st.running) return;
    if (!navigator.onLine) { window.showToast?.('Connect to the internet to save a map area.', 'error'); return; }
    const pl = plan(st.map.getBounds(), st.map.getZoom());
    if (st.map.getZoom() < 8) { window.showToast?.('Zoom in to the area you will camp in (zoom 8 or closer), then save.', 'error'); return; }
    if (pl.tooMany) { window.showToast?.(`That area needs more than ${MAX_TILES.toLocaleString('en-US')} tiles. Zoom in and save a smaller area.`, 'error'); return; }
    const mb = Math.max(1, Math.round(pl.urls.length * AVG_KB / 1024));
    if (!confirm(`Save the Topo map for this area, zoom ${pl.zmin} to ${pl.zmax}? About ${pl.urls.length.toLocaleString('en-US')} tiles, roughly ${mb} MB. Use Wi-Fi if your data is limited.`)) return;
    try { await navigator.storage?.persist?.(); } catch {}
    const controller = new AbortController(); st.running = controller;
    const bar = st.panel.querySelector('.kt-off-progress'), cancel = st.panel.querySelector('.kt-off-cancel'), btn = st.panel.querySelector('.kt-off-save');
    bar.hidden = false; cancel.hidden = false; btn.disabled = true; bar.max = pl.urls.length; bar.value = 0;
    cancel.onclick = () => controller.abort();
    const b = st.map.getBounds();
    const res = await download(pl.urls, (d) => { bar.value = d; }, controller.signal);
    st.running = null; bar.hidden = true; cancel.hidden = true; btn.disabled = false;
    const saved = res.done - res.failed;
    if (saved > 0) {
      const list = areas(); list.push({s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast(), zmin: pl.zmin, zmax: pl.zmax, saved, at: new Date().toISOString().slice(0, 10)}); saveAreas(list);
    }
    render();
    if (controller.signal.aborted) window.showToast?.(`Stopped. ${saved.toLocaleString('en-US')} tiles were saved.`);
    else window.showToast?.(res.failed ? `Saved ${saved.toLocaleString('en-US')} tiles. ${res.failed} failed. Save again to retry the gaps.` : 'Map area saved. Choose the Topo map to use it offline.', res.failed ? 'error' : 'info', 9000);
  }
  async function clearAll() {
    if (!confirm('Delete all saved map areas from this device?')) return;
    try { await caches.delete(cacheName()); } catch {}
    saveAreas([]); render(); window.showToast?.('Saved map areas deleted.');
  }
  function init(map) {
    st.map = map;
    const c = L.control({position: 'topright'});
    c.onAdd = () => {
      const wrap = L.DomUtil.create('div', 'kt-off leaflet-bar');
      const btn = el('button', 'Offline', 'kt-off-toggle'); btn.type = 'button'; btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'kt-off-panel'); btn.title = 'Save maps for offline use';
      const panel = el('div', null, 'kt-off-panel'); panel.id = 'kt-off-panel'; panel.hidden = true; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Offline maps');
      panel.append(el('strong', 'Offline maps'), el('p', 'Save the USGS Topo map for the area on screen. Campsite listings you have viewed and saved stops already work offline.', 'kt-fine'));
      const save = el('button', 'Save this area', 'kt-off-save'); save.type = 'button';
      const prog = document.createElement('progress'); prog.className = 'kt-off-progress'; prog.hidden = true;
      const cancel = el('button', 'Stop', 'kt-off-cancel'); cancel.type = 'button'; cancel.hidden = true;
      const status = el('p', '', 'kt-off-status kt-muted');
      const del = el('button', 'Delete saved maps', 'kt-off-delete'); del.type = 'button'; del.hidden = true;
      panel.append(save, prog, cancel, status, del, el('p', 'Offline, choose Topo in the layers menu. Areas you did not save stay blank. Forecasts, land lookups, and directions need signal.', 'kt-fine'));
      save.onclick = saveArea; del.onclick = clearAll;
      btn.onclick = () => { panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) render(); };
      wrap.append(btn, panel);
      L.DomEvent.disableClickPropagation(wrap); L.DomEvent.disableScrollPropagation(wrap);
      st.panel = panel; st.button = btn;
      return wrap;
    };
    c.addTo(map);
    const nudge = () => {
      if (!navigator.onLine && areas().length && window.KampTrailLayers?.getBase?.() !== 'Topo') window.showToast?.('You are offline. Choose Topo in the layers menu to see your saved map areas.', 'info', 9000);
    };
    addEventListener('offline', nudge); nudge();
  }
  window.KampTrailOffline = {version: '2.11.1', init, plan, cacheName, TOPO};
})();
