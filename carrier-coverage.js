/* FCC provider-reported mobile coverage. Each selected carrier uses its published tiles only. */
(function (global) {
  'use strict';
  const VERSION = '2.49.0';
  const ROOT = 'data/fcc-coverage/';
  const CARRIERS = {verizon: 'Verizon', att: 'AT&T', 't-mobile': 'T-Mobile'};
  const t = (key, params) => global.KampTrailI18n?.t(key, params) ??
    key.replace(/\{(\w+)\}/g, (token, name) => params?.[name] ?? token);
  const statusText = {
    covered: 'Map center: modeled coverage.',
    uncovered: 'Map center: no modeled coverage.',
    missing: 'Map center: no published data here.',
    unavailable: 'Map center: coverage tile unavailable.',
    loading: 'Loading coverage at the map center…',
    zoom: 'Zoom in to see coverage at the map center.'
  };
  function day(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
  }
  function validBounds(b) {
    if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) return false;
    const [w,s,e,n] = b;
    return -180 <= w && w < e && e <= 180 && -85.052 <= s && s < n && n <= 85.052;
  }
  function footprints(region) { return region.footprints || [region.bounds]; }
  function validManifest(m, now = Date.now()) {
    if (!m || ![1,2].includes(m.schema) || typeof m.release !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(m.release)) return false;
    const asOf = day(m.asOf), retrieved = day(m.retrievedAt);
    if (!(asOf <= retrieved && retrieved <= now) ||
        typeof m.technology !== 'string' || !m.technology.trim() || m.technology.length > 75 ||
        typeof m.environment !== 'string' || !m.environment.trim() || m.environment.length > 100 ||
        !Array.isArray(m.carriers) || !m.carriers.length || m.carriers.length > 3) return false;
    const seen = new Set();
    return m.carriers.every(carrier => {
      if (!carrier || !Object.hasOwn(CARRIERS, carrier.id) || seen.has(carrier.id) ||
          !Array.isArray(carrier.regions) || !carrier.regions.length || carrier.regions.length > 100) return false;
      seen.add(carrier.id);
      const areas = new Set();
      return carrier.regions.every(region => {
        if (!region || typeof region.id !== 'string' || !/^[A-Z]{2}(?:-[A-Za-z0-9]+)?$/.test(region.id) ||
            areas.has(region.id)) return false;
        const packed = region.archive !== undefined;
        if (packed && (m.schema !== 2 || region.archive?.format !== 'pmtiles-v3' ||
            !Number.isSafeInteger(region.archive.bytes) || region.archive.bytes < 127 ||
            region.archive.bytes > 2 ** 40 || !/^[0-9a-f]{64}$/.test(region.archive.sha256))) return false;
        if (!packed && !validBounds(region.bounds)) return false;
        if (region.footprints && (!packed || !Array.isArray(region.footprints) ||
            !region.footprints.length || region.footprints.length > 8 || !region.footprints.every(validBounds))) return false;
        if (packed && !region.footprints && !validBounds(region.bounds)) return false;
        areas.add(region.id);
        return Number.isInteger(region.minZoom) && Number.isInteger(region.maxZoom) &&
          region.minZoom >= 0 && region.minZoom <= region.maxZoom && region.maxZoom <= 19;
      });
    });
  }
  function pixelStatus([r,g,b,a]) {
    if (a === 0) return 'missing';
    if (a === 255 && r === 24 && g === 96 && b === 176) return 'covered';
    if (a === 255 && r === 112 && g === 112 && b === 112) return 'uncovered';
    return 'unavailable';
  }
  function freshness(m, offline, fallback, now = Date.now()) {
    if (offline) return 'Offline copy, not current.';
    if (fallback) return 'Saved copy, not current.';
    // Filings are semiannual. Always show the filing date; flag filings over a year old.
    return now - day(m.asOf) > 365 * 86400000 ? 'Older filing, not current.' : '';
  }
  function tileTemplate(m, carrier, region) {
    return ROOT + [m.release, carrier.id, region.id, '{z}', '{x}', '{y}.png'].join('/');
  }
  async function loadManifest(url, storage, online, request = global.fetch.bind(global)) {
    const key = 'kt_fcc_manifest:' + url;
    const parse = raw => {
      if (!raw || raw.length > 128 * 1024) return null;
      const value = JSON.parse(raw);
      return validManifest(value) ? value : null;
    };
    const forget = () => { try { storage?.removeItem(key); } catch {} };
    if (online) {
      let response;
      try { response = await request(url, {cache:'no-store', signal:AbortSignal.timeout(12000)}); } catch {}
      if (response && response.status < 500 && response.status !== 429) {
        try {
          if (response.ok && Number(response.headers.get('Content-Length')) <= 128 * 1024) {
            const raw = await response.text(), value = parse(raw);
            if (value) {
              try { storage?.setItem(key, raw); } catch {}
              return {value, fallback:false};
            }
          }
        } catch {}
        forget();
        return null;
      }
    }
    try {
      const value = parse(storage?.getItem(key));
      return value ? {value, fallback:true} : null;
    } catch { return null; }
  }
  function samplesAtCenter(map, entries, readPixel) {
    const point = map.wrapLatLng(map.getCenter()), zoom = map.getZoom();
    let result = 'missing';
    const priority = ['missing','zoom','loading','unavailable','uncovered','covered'];
    for (const {region, tiles} of entries) {
      const [w,s,e,n] = region.bounds;
      if (point.lng < w || point.lng > e || point.lat < s || point.lat > n) continue;
      let state = 'zoom';
      if (zoom >= region.minZoom) {
        const z = Math.min(zoom, region.maxZoom);
        const pixel = map.project(point, z).floor();
        const x = Math.floor(pixel.x / 256), y = Math.floor(pixel.y / 256);
        const tile = tiles.get([z,x,y].join('/'));
        state = tile?.state || 'loading';
        if (state === 'ready') state = readPixel(tile.image, pixel.x - x * 256, pixel.y - y * 256);
      }
      if (priority.indexOf(state) > priority.indexOf(result)) result = state;
    }
    return result;
  }
  function archiveTiles(L, reader, options) {
    const ArchiveLayer = L.TileLayer.extend({
      createTile(coords, done) {
        const image = document.createElement('img'), cancel = new AbortController();
        image.alt = ''; image.role = 'presentation'; image.ktCancel = cancel;
        reader().then(read => read(coords,cancel.signal)).then(blob => {
          if (cancel.signal.aborted) return;
          image.ktObjectURL = URL.createObjectURL(blob);
          image.onload = () => { if (!cancel.signal.aborted) done(null,image); };
          image.onerror = () => { if (!cancel.signal.aborted) done(Error('Coverage PNG unavailable'),image); };
          image.src = image.ktObjectURL;
        }).catch(() => { if (!cancel.signal.aborted) done(Error('Coverage tile unavailable'),image); });
        return image;
      }
    });
    const layer = new ArchiveLayer('',options);
    layer.on('tileunload',({tile}) => {
      tile.ktCancel?.abort(); tile.onload = tile.onerror = null;
      if (tile.ktObjectURL) URL.revokeObjectURL(tile.ktObjectURL);
    });
    return layer;
  }
  function init(map, layerControl) {
    const doc = global.document, L = global.L;
    const panel = layerControl.getContainer().querySelector('.leaflet-control-layers-list');
    const readout = doc.getElementById('fcc-coverage-readout');
    if (!panel || !readout) return;
    const select = doc.createElement('select'), label = doc.createElement('label');
    label.className = 'kt-coverage-picker';
    label.append(t('FCC mobile coverage'), select);
    const areas = doc.createElement('select'), areaLabel = doc.createElement('label');
    areaLabel.className = 'kt-coverage-area';
    areaLabel.append(t('Published coverage area'), areas);
    areas.addEventListener('change', () => {
      const region = entries.find(entry => entry.region.id === areas.value)?.region;
      if (!region) return;
      const [w,s,e,n] = region.bounds;
      const bounds = L.latLngBounds([s,w],[n,e]);
      const zoom = Math.max(region.minZoom, Math.min(region.maxZoom, map.getBoundsZoom(bounds, false, [30,30])));
      map.setView(bounds.getCenter(), zoom);
      areas.value = '';
    });
    const details = doc.createElement('span'), legend = doc.createElement('span'), center = doc.createElement('span');
    center.setAttribute('role', 'status');
    const mark = doc.createElement('span');
    mark.className = 'kt-coverage-center';
    mark.setAttribute('aria-hidden', 'true');
    const colors = [['covered','Modeled coverage'],['uncovered','No modeled coverage'],['missing','No data']];
    for (const [state, name] of colors) {
      const item = doc.createElement('span'), swatch = doc.createElement('i');
      swatch.className = 'kt-coverage-key-' + state;
      item.append(swatch, t(name)); legend.append(item);
    }
    legend.className = 'kt-coverage-key';
    const source = doc.createElement('a');
    source.href = 'https://broadbandmap.fcc.gov/'; source.target = '_blank'; source.rel = 'noopener';
    source.textContent = t('Map layer based on FCC BDC.');
    source.title = t('FCC National Broadband Map');
    const boundarySource = doc.createElement('span');
    boundarySource.textContent = t('State boundaries: U.S. Census Bureau.');
    readout.replaceChildren(details, source, boundarySource, legend, center);
    const scope = doc.createElement('span'), assumption = doc.createElement('span');
    details.after(scope, assumption);
    const regionName = region => global.KampTrailStateNames?.[region.id] || (region.id === 'DC' ? 'District of Columbia' : region.id);
    const canvas = doc.createElement('canvas');
    canvas.width = canvas.height = 1;
    let ctx, data, entries = [], generation = 0, storage;
    try { storage = global.localStorage; } catch {}
    function readPixel(image, x, y) {
      try {
        ctx ||= canvas.getContext('2d', {willReadFrequently:true});
        ctx.clearRect(0,0,1,1);
        ctx.drawImage(image,x,y,1,1,0,0,1,1);
        return pixelStatus(ctx.getImageData(0,0,1,1).data);
      } catch { return 'unavailable'; }
    }
    function render() {
      const id = select.value;
      if (!id || !data || !entries.length) return;
      const m = data.value;
      const markDate = global.KampTrailI18n?.date(m.asOf) || m.asOf;
      const note = freshness(m, !global.navigator.onLine, data.fallback);
      const description = t('{carrier} · {technology} · {environment} · FCC filing {date}.', {
        carrier:CARRIERS[id],technology:t(m.technology),environment:t(m.environment),date:markDate
      }) + (note ? ' ' + t(note) : '');
      if (details.textContent !== description) details.textContent = description;
      const status = t(statusText[samplesAtCenter(map, entries, readPixel)]);
      if (center.textContent !== status) center.textContent = status;
    }
    function selectCarrier() {
      const previous = entries;
      entries = [];
      previous.forEach(entry => entry.layer.remove());
      mark.remove();
      readout.hidden = true;
      areaLabel.remove();
      const m = data?.value, carrier = m?.carriers.find(c => c.id === select.value);
      if (!carrier) return;
      scope.textContent = carrier.regions.length <= 3
        ? t('Published areas: {areas}.', {areas:carrier.regions.map(regionName).join(', ')})
        : t('Published areas: {count}.', {count:carrier.regions.length});
      assumption.textContent = /^4G LTE\b/i.test(m.technology) && /outdoor/i.test(m.environment)
        ? t('Outdoor LTE model: at least 5 Mbps down and 1 Mbps up. Signal inside your RV may differ.')
        : t('Signal inside your RV may differ from this model.');
      areas.replaceChildren(new Option(t('Go to area…'), ''));
      label.after(areaLabel);
      for (const region of carrier.regions) {
        areas.add(new Option(regionName(region), region.id));
        let reader;
        if (region.archive) {
          const url = new URL(ROOT + [m.release,carrier.id,region.id+'.pmtiles'].join('/'),doc.baseURI);
          url.searchParams.set('sha256',region.archive.sha256);
          const moduleURL = new URL('vendor/fcc-pmtiles/reader.js',doc.baseURI).href;
          // Start the lazy import only when Leaflet actually requests a visible tile.
          let pending;
          reader = () => {
            pending ||= import(moduleURL).then(mod => mod.openCoverageArchive(url.href,region,new URL('./',doc.baseURI).href));
            return pending;
          };
        }
        for (const bounds of footprints(region)) {
          const [w,s,e,n] = bounds;
          const options = {
            bounds:[[s,w],[n,e]], noWrap:true, minZoom:region.minZoom, maxNativeZoom:region.maxZoom,
            maxZoom:19, opacity:0.55, updateWhenIdle:true, keepBuffer:0, className:'kt-coverage-tiles'
          };
          const layer = reader ? archiveTiles(L,reader,options) : L.tileLayer(tileTemplate(m,carrier,region),options);
          const tiles = new Map();
          const key = e => [e.coords.z,e.coords.x,e.coords.y].join('/');
          layer.on('tileloadstart', e => tiles.set(key(e), {state:'loading',image:e.tile}));
          layer.on('tileload', e => {
            tiles.set(key(e), {state:e.tile.naturalWidth === 256 && e.tile.naturalHeight === 256 ? 'ready' : 'unavailable',image:e.tile});
            render();
          });
          layer.on('tileerror', e => { tiles.set(key(e), {state:'unavailable',image:e.tile}); render(); });
          layer.on('tileunload', e => { if (tiles.get(key(e))?.image === e.tile) tiles.delete(key(e)); });
          entries.push({region:{...region,bounds},tiles,layer}); layer.addTo(map);
        }
      }
      map.getContainer().append(mark);
      readout.hidden = false;
      render();
    }
    async function refresh() {
      const current = ++generation, url = new URL(ROOT + 'manifest.json', doc.baseURI).href;
      const loaded = await loadManifest(url, storage, global.navigator.onLine);
      if (current !== generation) return;
      const previous = select.value;
      data = loaded;
      select.replaceChildren();
      if (!loaded) { label.remove(); selectCarrier(); return; }
      select.add(new Option(t('Off'), ''));
      for (const carrier of loaded.value.carriers) select.add(new Option(CARRIERS[carrier.id], carrier.id));
      if (loaded.value.carriers.some(c => c.id === previous)) select.value = previous;
      if (!label.isConnected) panel.append(label);
      selectCarrier();
    }
    select.addEventListener('change', selectCarrier);
    map.on('moveend zoomend', render);
    global.addEventListener('offline', render);
    global.addEventListener('online', refresh);
    map.once('unload', () => {
      ++generation;
      global.removeEventListener('offline', render);
      global.removeEventListener('online', refresh);
    });
    refresh();
  }
  const api = {version:VERSION, validManifest, pixelStatus, freshness, tileTemplate, loadManifest, samplesAtCenter, init};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.KampTrailCoverage = api;
})(typeof window !== 'undefined' ? window : globalThis);
