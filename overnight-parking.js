/* Dedicated overnight map. Each marker carries the evidence for that location. */
(function (root) {
  'use strict';
  const VERSION = '2.51.0';
  const disclaimer = 'A pin is a place to ask about, not permission to stay.';
  const kindNames = {casino: 'Casinos', 'truck-stop': 'Truck-stop chains', rest: 'Rest areas', dump: 'Dump stations'};
  let session;

  function element(tag, text) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  }
  function link(label, url) {
    const anchor = element('a', label);
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    return anchor;
  }
  function button(label, action) {
    const node = element('button', label);
    node.type = 'button';
    node.className = 'btn';
    node.onclick = action;
    return node;
  }
  function choice(label, values) {
    const wrapper = element('label', label + ' ');
    const select = element('select');
    for (const [value, text] of values) {
      const option = element('option', text);
      option.value = value;
      select.append(option);
    }
    wrapper.append(select);
    return {wrapper, select};
  }
  function seedRow(s) {
    const coordinates = [s.lng, s.lat];
    const snapshot = {type: 'Feature', geometry: {type: 'Point', coordinates}, properties: {
      id: s.id, name: s.name, type: 'spot', overnight_status: s.status, overnight_source: s.source,
      overnight_policy: s.policy, overnight_checked: s.checked
    }};
    return {...s, coordinates, states: [s.state], snapshot};
  }
  function restRow({r, d}) {
    const rest = root.KampTrailRestAreas;
    const policy = rest.policyFor(r, d);
    const verified = policy.sources.length > 0 && policy.rules.overnight_parking !== 'unknown';
    const interstates = interstateRoutes(r.location + ' ' + r.name);
    return {id: r.id, type: 'rest', states: [r.state], name: r.name, coordinates: r.coordinates,
      status: verified ? 'official-policy' : 'unverified', checked: (policy.sources[0]?.retrieved_at || d.source.retrieved_at).slice(0, 10),
      source: r.source_url, policySources: policy.sources, policy: rest.describe(r, d), interstates,
      prohibitsOvernight: [policy.rules.overnight_parking, policy.rules.sleeping_in_vehicle].includes('prohibited'),
      snapshot: rest.feature(r, d)};
  }
  function interstateRoutes(text) {
    const matches = String(text).matchAll(/\b(?:interstate(?:\s+highway)?|ih|i)[\s-]*([1-9]\d{0,2})\b/gi);
    return [...new Set(Array.from(matches, match => 'I-' + match[1]))];
  }
  function dumpRow(item, manifest) {
    const features = root.KampTrailServices;
    const checked = item.retrieved_at || manifest.coverage.find(c => c.region === item.source_region)?.retrieved_at;
    return {id: item.id, type: 'dump', states: item.states, name: item.name || 'Dump station', coordinates: item.coordinates,
      status: 'unverified', checked: checked?.slice(0, 10), source: 'https://www.openstreetmap.org/' + item.osm_type + '/' + item.osm_id,
      policy: features.describe(item, manifest), snapshot: features.feature(item, manifest)};
  }
  function addGuides(container, row, directory) {
    const links = new Map();
    for (const state of row.states?.length ? row.states : ['']) {
      const result = root.KTOvernightGuides.links(directory, state, row.interstates);
      links.set(result.stateUrl, result.isStateGuide ? (root.KampTrailStateNames[state] || state) + ' parking guide' : 'State parking guide index');
      for (const guide of result.interstateGuides) links.set(guide.url, guide.route + ' parking guide');
    }
    container.replaceChildren();
    for (const [url, text] of links) container.append(link(text, url));
  }
  function popup(row, s) {
    const box = element('div');
    box.className = 'kt-overnight-popup';
    box.dataset.overnightId = row.id;
    box.append(element('h2', row.name), element('strong', row.status === 'official-policy' ? 'Official policy' : 'Unverified. Call ahead.'),
      element('p', row.policy.replace(/; /g, '. ')), element('p', disclaimer));
    if (row.address) box.append(element('p', row.address));
    if (row.checked) box.append(element('p', 'Source checked ' + row.checked));
    const actions = element('div');
    actions.className = 'kt-popup-actions';
    actions.append(link('Location source', row.locationSource || row.source));
    if (row.locationSource && row.locationSource !== row.source) actions.append(link('Operator source', row.source));
    for (const evidence of row.policySources || []) actions.append(link('Agency policy', evidence.url));
    if (row.phone) actions.append(link('Call ' + row.phone, 'tel:' + row.phone.replace(/[^+0-9]/g, '')));
    const [lng, lat] = row.coordinates;
    if (row.type === 'dump') actions.append(link('© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'));
    actions.append(link('Directions', row.directions || 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng),
      button('Save stop', () => {
        const feature = {...row.snapshot, properties: {...row.snapshot.properties, overnight_states: row.states,
          overnight_interstates: row.interstates || [], overnight_policy: row.policy, overnight_checked: row.checked || null,
          overnight_source: row.source, overnight_status: row.status}};
        root.KampTrailTrip.addStop(feature.properties.id, feature);
      }));
    const guides = element('nav');
    guides.setAttribute('aria-label', 'Boondock or Bust parking guides');
    addGuides(guides, row, s.directory);
    s.openGuide = {guides, row};
    box.append(actions, guides);
    return box;
  }
  function tonightCandidate(row, date = new Date()) {
    if (row.prohibitsOvernight) return false;
    if (!row.openMonths) return true;
    const month = Number(new Intl.DateTimeFormat('en-US', {month: 'numeric', timeZone: row.timeZone}).format(date));
    return row.openMonths.includes(month);
  }
  function matches(row, s) {
    return s.kinds.has(row.type) && (!s.verified || row.status === 'official-policy') &&
      (!s.casinoState || row.type === 'casino' && row.states.includes(s.casinoState)) &&
      (!s.origin || tonightCandidate(row) && root.KampTrailServices.distance(s.origin, row.coordinates) <= s.radius);
  }
  function render(s) {
    if (s !== session) return;
    const items = [...s.seed, ...s.rest, ...s.dumps].filter(row => matches(row, s));
    const next = new Set(items.map(r => r.id));
    for (const [id, marker] of s.markers) {
      if (!next.has(id)) { s.layer.removeLayer(marker); s.markers.delete(id); }
    }
    for (const row of items) {
      if (s.markers.has(row.id)) continue;
      const [lng, lat] = row.coordinates;
      const marker = root.L.marker([lat, lng], {title: row.name, keyboard: true});
      marker.bindPopup(() => popup(row, s), {maxWidth: 290});
      s.layer.addLayer(marker);
      s.markers.set(row.id, marker);
    }
    const bounds = s.map.getBounds();
    const visible = items.filter(row => bounds.contains([row.coordinates[1], row.coordinates[0]]));
    if (s.origin) visible.sort((a, b) => root.KampTrailServices.distance(s.origin, a.coordinates) - root.KampTrailServices.distance(s.origin, b.coordinates));
    s.list.replaceChildren();
    for (const row of visible.slice(0, 50)) {
      const li = element('li');
      li.append(button(row.name, () => s.markers.get(row.id)?.openPopup()));
      s.list.append(li);
    }
    s.status.textContent = visible.length + ' stops in this view.' + (visible.length > 50 ? ' The list shows the first 50. Zoom in to narrow it.' : '') +
      (s.origin ? ' Within ' + s.radius + ' miles of your location.' : '') +
      (s.seedNote ? ' ' + s.seedNote : '') + (s.restNote ? ' ' + s.restNote : '') + (s.dumpNote ? ' ' + s.dumpNote : '');
  }
  async function loadSources(s, force = false) {
    s.request?.abort();
    const request = s.request = new AbortController();
    const current = () => session === s && !request.signal.aborted;
    const zoomed = !!s.origin || s.map.getZoom() >= 6;
    if (!zoomed || !s.kinds.has('rest') || s.casinoState) s.rest = [];
    if (!zoomed || !s.kinds.has('dump') || s.casinoState || s.verified) s.dumps = [];
    s.restNote = s.kinds.has('rest') && !zoomed ? 'Zoom in for regional rest areas.' : '';
    s.dumpNote = s.kinds.has('dump') && !zoomed ? 'Zoom in for dump stations.' : '';
    const bounds = s.map.getBounds();
    const box = {west: bounds.getWest(), east: bounds.getEast(), north: bounds.getNorth(), south: bounds.getSouth()};
    render(s);
    if (!zoomed || s.casinoState) return;
    if (s.kinds.has('rest')) {
      s.restNote = 'Loading official rest areas.';
      root.KampTrailLayers.overnightRestRecords(force).then(data => {
        if (!current()) return;
        s.rest = data.rows.filter(({r}) => root.KampTrailRestAreas.within(r.coordinates, box)).map(restRow);
        s.restNote = data.missing.length ? 'Rest-area data unavailable in ' + data.missing.join(', ') + '.' : '';
      }).catch(() => { if (current()) { s.rest = []; s.restNote = 'Rest-area data unavailable. Retry sources.'; } }).finally(() => { if (current()) render(s); });
    }
    if (s.kinds.has('dump') && !s.verified) {
      s.dumpNote = 'Loading dump stations.';
      root.KampTrailServices.loadBounds(box, {categories: ['dump'], signal: request.signal, force}).then(data => {
        if (!current()) return;
        s.dumps = data.items.map(item => dumpRow(item, data.manifest));
        s.dumpNote = data.partial ? 'Some dump-station records could not load.' : '';
        if (data.offline) s.dumpNote += ' Showing saved dump-station records.';
      }).catch(() => { if (current()) { s.dumps = []; s.dumpNote = 'Dump-station data unavailable. Retry sources.'; } }).finally(() => { if (current()) render(s); });
    }
    render(s);
  }
  async function loadSeed(s) {
    s.seedNote = 'Loading operator locations.';
    try {
      const response = await root.fetch('data/overnight/stops.json');
      if (!response.ok) throw Error('Operator locations unavailable');
      const rows = await response.json();
      if (session !== s) return;
      s.seed = rows.map(seedRow);
      const states = [...new Set(s.seed.filter(row => row.type === 'casino').flatMap(row => row.states))].sort();
      for (const state of states) {
        const option = element('option', root.KampTrailStateNames[state] || state);
        option.value = state;
        s.stateSelect.append(option);
      }
      s.seedNote = '';
      if (s.initialOverview && s.map.getZoom() === s.startZoom && s.map.getCenter().equals(s.startCenter) && s.seed.length) {
        s.map.fitBounds(s.seed.map(row => [row.coordinates[1], row.coordinates[0]]), {padding: [28, 28], maxZoom: 8, animate: false});
      }
      s.initialOverview = false;
    } catch { s.seedNote = 'Operator locations unavailable. Retry sources.'; }
    render(s);
  }
  function open(container, map) {
    close();
    const s = session = {map, kinds: new Set(Object.keys(kindNames)), verified: false, casinoState: '', origin: null, radius: 50,
      markers: new Map(), layer: root.L.layerGroup().addTo(map), seed: [], rest: [], dumps: [], seedNote: '', restNote: '', dumpNote: ''};
    const entry = root.KampTrailBeta.entry;
    let hasSavedView = false;
    try { hasSavedView = !!root.localStorage.getItem('kt_last_position'); } catch {}
    s.startCenter = map.getCenter();
    s.startZoom = map.getZoom();
    s.initialOverview = !entry.state && !entry.near && !hasSavedView;
    root.KampTrailLayers.pauseOverlays(true);
    document.body.classList.add('kt-overnight-mode');
    const controls = element('fieldset');
    controls.className = 'kt-overnight-controls';
    controls.append(element('legend', 'Overnight parking filters'));
    function toggle(label, checked, change) {
      const node = element('label'), input = element('input');
      input.type = 'checkbox'; input.checked = checked;
      input.onchange = () => { change(input.checked); loadSources(s); };
      node.append(input, ' ' + label); controls.append(node);
    }
    for (const [kind, name] of Object.entries(kindNames)) toggle(name, true, enabled => enabled ? s.kinds.add(kind) : s.kinds.delete(kind));
    toggle('Verified policy only', false, checked => { s.verified = checked; });
    const radius = choice('Radius', [10, 25, 50, 100].map(n => [String(n), n + ' miles']));
    radius.select.value = String(s.radius);
    radius.select.onchange = () => { s.radius = Number(radius.select.value); near(s.origin); };
    const casino = choice('Casino parking by state', [['', 'All stops']]);
    s.stateSelect = casino.select;
    casino.select.onchange = () => {
      s.casinoState = casino.select.value;
      const rows = s.seed.filter(row => row.type === 'casino' && row.states.includes(s.casinoState));
      if (rows.length) {
        if (s.origin) document.getElementById('near').click();
        s.kinds.add('casino'); controls.querySelector('input').checked = true;
        map.fitBounds(rows.map(row => [row.coordinates[1], row.coordinates[0]]), {maxZoom: 10});
      }
      loadSources(s);
    };
    s.near = button('Tonight near me', () => document.getElementById('near').click());
    controls.append(casino.wrapper, radius.wrapper, s.near, button('Retry sources', () => {
      if (!s.seed.length) loadSeed(s);
      loadSources(s, true); loadGuides();
    }));
    const help = element('p', 'Official policy means a published operator or agency rule. Unverified locations require a call ahead. Dump stations provide a service and have no verified overnight permission.');
    s.status = element('p'); s.status.setAttribute('role', 'status');
    const details = element('details');
    s.list = element('ul'); details.append(element('summary', 'Stops in this map view'), s.list);
    container.append(controls, help, s.status, details);
    s.refresh = () => { clearTimeout(s.timer); s.timer = setTimeout(() => loadSources(s), 150); };
    map.on('moveend', s.refresh);
    // Saved trip markers and spot checks can open independently of the overnight layer.
    s.popupOpened = ({popup: opened}) => {
      const content = opened.getElement()?.querySelector('.leaflet-popup-content');
      if (!content || content.querySelector('.kt-overnight-popup, .kt-extra-overnight')) return;
      const extra = element('div');
      extra.className = 'kt-extra-overnight';
      const guides = element('nav');
      const saved = content.querySelector('[data-overnight-saved-id]')?.dataset.overnightSavedId;
      const snapshot = saved && root.KampTrailTrip.getStops().find(stop => stop.id === saved)?.feature;
      const id = opened._source?.kamptrailId;
      const place = id && root.KampTrailData.getCampsiteById(id);
      const row = {states: snapshot?.properties?.overnight_states || place?.properties?.states || root.KampTrailSearchRegions?.get(String(id)) || [],
        interstates: snapshot?.properties?.overnight_interstates};
      addGuides(guides, row, s.directory);
      s.openGuide = {guides, row};
      extra.append(element('p', disclaimer), guides);
      content.append(extra);
    };
    map.on('popupopen', s.popupOpened);
    function loadGuides() {
      root.KTOvernightGuides.load().then(directory => {
        if (session !== s) return;
        s.directory = directory;
        if (s.openGuide) addGuides(s.openGuide.guides, s.openGuide.row, directory);
      });
    }
    loadSeed(s); loadSources(s); loadGuides();
  }
  function near(coordinates) {
    if (!session) return;
    session.origin = coordinates;
    session.near.textContent = coordinates ? 'Clear nearby radius' : 'Tonight near me';
    if (coordinates) {
      const b = root.KampTrailServices.radiusBounds(coordinates, session.radius);
      session.map.fitBounds([[b.south, b.west], [b.north, b.east < b.west ? b.east + 360 : b.east]]);
    }
    render(session);
  }
  function close() {
    if (!session) return;
    const s = session; session = null;
    clearTimeout(s.timer); s.request?.abort();
    s.map.off('moveend', s.refresh);
    s.map.off('popupopen', s.popupOpened);
    s.map.closePopup();
    s.layer.remove();
    root.KampTrailLayers.pauseOverlays(false);
    document.body.classList.remove('kt-overnight-mode');
  }
  const api = {version: VERSION, open, close, near, matches, tonightCandidate, interstateRoutes, seedRow, disclaimer};
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document) root.KampTrailOvernight = api;
})(typeof window === 'object' ? window : globalThis);
