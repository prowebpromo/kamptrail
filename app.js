/* KampTrail application shell. All map code and place search ship with the app. */
(function () {
  'use strict';
  let toastTimer;
  window.escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.showToast = function (message, type = 'info', duration = 6000) {
    const el = document.getElementById('toast');
    clearTimeout(toastTimer);
    el.textContent = message;
    el.className = `toast show ${type}`;
    if (duration > 0) toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  };
  window.setLoading = on => { document.getElementById('loading').hidden = !on; };
  function updateOnline() {
    document.getElementById('status-dot').style.color = navigator.onLine ? '#287d45' : '#b06719';
    document.getElementById('status-text').textContent = navigator.onLine ? 'Online' : 'Offline: saved listings; maps need internet';
  }
  addEventListener('online', updateOnline);
  addEventListener('offline', updateOnline);
  updateOnline();

  if ('serviceWorker' in navigator) {
    let refreshing = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      // First install controls this page without a reload. Reload only on request.
      if (hadController || window.ktReloadForUpdate) { refreshing = true; location.reload(); }
    });
    navigator.serviceWorker.register('service-worker.js', {updateViaCache:'none'}).then(reg => {
      function offer(sw) {
        const toast = document.getElementById('toast');
        showToast('An updated KampTrail is ready.', 'info', 0);
        const button = document.createElement('button');button.textContent = 'Reload update';
        button.onclick = () => {window.ktReloadForUpdate = true;sw.postMessage('SKIP_WAITING');};toast.append(button);
      }
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {if (sw.state === 'installed' && navigator.serviceWorker.controller) offer(sw);});
      });
    }).catch(() => {showToast('Offline saving is unavailable. You can still use the map online.');});
  }

  if (!window.L || !L.markerClusterGroup) {
    showToast('Map files could not load. Reload the page when connected.', 'error', 0);
    document.getElementById('result-summary').textContent = 'The map could not start.';
    return;
  }
  const map = window.map = L.map('map', {zoomControl:true, preferCanvas:true, minZoom:3, worldCopyJump:true});
  let saved;
  try { saved = JSON.parse(localStorage.getItem('kt_last_position')); } catch (_) {}
  if (saved && [saved.lat,saved.lng,saved.zoom].every(Number.isFinite) && Math.abs(saved.lat) <= 85 && Math.abs(saved.lng) <= 180 && saved.zoom >= 3 && saved.zoom <= 19) {
    map.setView([saved.lat, saved.lng], saved.zoom);
  } else map.setView([39.8283, -98.5795], 4);
  map.on('moveend', () => {
    const c = map.getCenter().wrap();
    try { localStorage.setItem('kt_last_position', JSON.stringify({lat:c.lat,lng:c.lng,zoom:map.getZoom()})); } catch (_) {}
  });
  const resize = () => map.invalidateSize();
  addEventListener('resize', resize);
  new ResizeObserver(resize).observe(document.getElementById('map'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resize(); });

  // A single, replaceable location marker. Permission failure never blocks the app.
  let locationLayer;
  const near = document.getElementById('near');
  near.addEventListener('click', () => {
    if (locationLayer) {
      map.removeLayer(locationLayer); locationLayer = null;
      near.classList.remove('active'); near.setAttribute('aria-pressed', 'false');
      return;
    }
    if (!navigator.geolocation) return showToast('Your browser does not support location. Search a city or choose a state.', 'error');
    near.disabled = true;
    navigator.geolocation.getCurrentPosition(pos => {
      const {latitude:lat, longitude:lng, accuracy} = pos.coords;
      locationLayer = L.circle([lat,lng], {radius:Math.min(accuracy || 100,5000),color:'#2a7850',fillOpacity:.15}).addTo(map);
      map.setView([lat,lng], 10);
      near.disabled = false; near.classList.add('active'); near.setAttribute('aria-pressed','true');
      showToast('Showing campsite listings near your location.');
    }, () => {
      near.disabled = false; near.classList.remove('active'); near.setAttribute('aria-pressed','false');
      showToast('Location is unavailable or permission was denied. Search a city or choose a state.', 'error');
    }, {enableHighAccuracy:false,timeout:10000,maximumAge:60000});
  });

  const main = document.querySelector('main');
  const listToggle = document.getElementById('results-toggle');
  const setList = open => {
    main.classList.toggle('list-closed', !open);
    listToggle.setAttribute('aria-expanded', String(open));
    resize();
  };
  setList(matchMedia('(min-width:761px)').matches);
  listToggle.onclick = () => setList(main.classList.contains('list-closed'));

  const stateNames = {AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
  const stateSelect = document.getElementById('state-select');
  Object.entries(stateNames).sort((a,b)=>a[1].localeCompare(b[1])).forEach(([code,name]) => {
    const option = document.createElement('option'); option.value = code; option.textContent = name; stateSelect.append(option);
  });
  function jumpState(code) {
    const b = KampTrailData.getStateBounds()[code];
    if (!b) return;
    map.fitBounds([[b.s,b.w],[b.n,b.e]], {padding:[16,16],maxZoom:8});
    KampTrailData.loadStates([code]).catch(() => showToast('Some listings could not load. Use Retry in the campsite list.', 'error'));
    stateSelect.value = code;
    document.getElementById('search-results').hidden = true;
  }
  stateSelect.onchange = () => { if (stateSelect.value) jumpState(stateSelect.value); };

  function renderResults() {
    const status = KampTrailData.getLoadStatus();
    const sites = KampTrailData.getVisibleCampsites();
    const summary = document.getElementById('result-summary');
    summary.textContent = `${sites.length.toLocaleString()} in this view · ${status.totalSites.toLocaleString()} loaded${status.loading ? ' · Loading…' : ''}`;
    const errors = document.getElementById('data-errors');
    errors.replaceChildren(); errors.hidden = !status.failedStates.length;
    if (status.failedStates.length) {
      const message = document.createElement('div');
      message.textContent = `Could not load: ${status.failedStates.map(s => s.state).join(', ')}. Saved listings remain available.`;
      const retry = document.createElement('button'); retry.textContent = 'Retry missing data'; retry.onclick = () => KampTrailData.refresh();
      errors.append(message, retry);
    }
    const list = document.getElementById('result-list');
    const fragment = document.createDocumentFragment();
    const center = map.getCenter();
    const sorted = sites.slice().sort((a,b) => {
      const [x,y] = a.geometry.coordinates, [u,v] = b.geometry.coordinates;
      return map.distance(center,[y,x]) - map.distance(center,[v,u]);
    });
    sorted.slice(0,100).forEach(site => {
      const p = site.properties;
      const card = document.createElement('article'); card.className = 'site-card';
      const heading = document.createElement('h3'); heading.textContent = p.name;
      const details = document.createElement('p');
      const cost = p.fee_status === 'free' ? 'Reported free' : p.fee_status === 'paid' ? (Number.isFinite(p.cost) ? `Reported $${p.cost}` : 'Paid · amount unknown') : 'Fee unknown';
      details.textContent = `${cost} · ${p.type === 'established' ? 'Campground' : (p.type || 'Type unknown')} · ${p.state || ''}`;
      const actions = document.createElement('div'); actions.className = 'site-actions';
      const view = document.createElement('button'); view.textContent = 'View on map'; view.onclick = () => { KampTrailData.focusCampsite(p.id); if (innerWidth < 761) setList(false); };
      const trip = document.createElement('button'); trip.textContent = 'Add to trip'; trip.onclick = () => KampTrailTrip.addStop(p.id);
      actions.append(view, trip); card.append(heading,details,actions); fragment.append(card);
    });
    if (!sites.length || sites.length > 100) {
      const note = document.createElement('p'); note.className = 'list-empty';
      note.textContent = !sites.length ? (status.loading ? 'Loading listings for this area…' : 'No matching campsite listings in this view. Reset filters, zoom out, or choose another state. Coverage is incomplete.') : 'Showing the nearest 100 matching campsites. Zoom in to narrow this list.';
      fragment.append(note);
    }
    list.replaceChildren(fragment);
  }
  addEventListener('kamptrail:dataupdated', renderResults);
  map.on('moveend', renderResults);

  // Search local cities, loaded campsite names, states, and literal coordinates.
  // No keystrokes or location searches are sent to an external geocoder.
  let places = [];
  const placeLoad = fetch('data/places-us.json').then(r => {if (!r.ok) throw new Error('Place index unavailable');return r.json();}).then(d => {places = d.places || [];}).catch(() => {});
  const normalize = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const searchResults = document.getElementById('search-results');
  function addChoice(label, action) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.onclick = () => { action(); searchResults.hidden = true; };
    searchResults.append(button);
  }
  let searching = false;
  document.getElementById('search-form').onsubmit = async e => {
    e.preventDefault();
    if (searching) return;
    const query = document.getElementById('destination').value.trim();
    if (!query) {searchResults.hidden = true;return;}
    const coords = query.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coords) {
      const lat = +coords[1],lng = +coords[2];
      if (Math.abs(lat) > 85 || Math.abs(lng) > 180) return showToast('Enter valid latitude, longitude coordinates.', 'error');
      map.setView([lat,lng],11); searchResults.hidden = true; return;
    }
    searching = true;
    await placeLoad;
    searching = false;
    const key = normalize(query);
    searchResults.replaceChildren();
    Object.entries(stateNames).filter(([c,n]) => key === normalize(c) || key === normalize(n)).forEach(([c,n]) => addChoice(`${n} · State`, () => jumpState(c)));
    const campsiteMatches = KampTrailData.getAllCampsites().filter(s => normalize(s.properties.name).includes(key)).slice(0,8);
    campsiteMatches.forEach(site => addChoice(`${site.properties.name} · Campsite`, () => KampTrailData.focusCampsite(site.properties.id)));
    const words = key.split(' ');
    const cityMatches = places.filter(p => {
      const city = normalize(p.name), state = normalize(p.state), fullState = normalize(stateNames[p.state] || 'District of Columbia');
      const names = [city,...(p.aliases || []).map(normalize)];
      return words.every(w => names.some(n => n.split(' ').includes(w)) || state === w || fullState.split(' ').includes(w));
    }).sort((a,b) => {
      const exact = p => normalize(p.name) === key || normalize(`${p.name} ${p.state}`) === key;
      return Number(exact(b)) - Number(exact(a)) || b.population - a.population;
    }).slice(0,8);
    cityMatches.forEach(p => addChoice(`${p.name}, ${p.state} · City`, () => {map.setView([p.lat,p.lng],10);KampTrailData.refresh();}));
    if (!searchResults.childNodes.length) {
      const note = document.createElement('p');
      note.textContent = 'No match. Try a city and state (Albany, NY), choose a state, or enter latitude, longitude. Campsite name search covers loaded listings.';
      searchResults.append(note);
    }
    searchResults.hidden = false;
  };
  document.addEventListener('keydown', e => {if(e.key === 'Escape') searchResults.hidden = true;});
  document.addEventListener('click', e => {if (!e.target.closest('.search-bar')) searchResults.hidden = true;});

  // Initialize controls before requesting data. Slow sources cannot disable tools.
  KampTrailAdvanced.init(map);
  KampTrailOverlays.init(map, {
    publicLandsUrl:'https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/PADUS3_0PublicAccess/MapServer/tile/{z}/{y}/{x}',
    openCelliDKey:'',
    poiUrl:'data/poi_dump_water_propane.geojson'
  });
  KampTrailFilters.init(map);
  KampTrailTrip.init(map);
  KampTrailGPX.init(map);
  KampTrailCompare.init(map);
  KampTrailData.init(map, {maxMarkers:5000,onTripAdd:id=>KampTrailTrip.addStop(id)}).then(renderResults).catch(err => {
    console.error(err);setLoading(false);
    showToast('Some campsite listings could not load. Open the campsite list and retry.', 'error');
  });


})();
