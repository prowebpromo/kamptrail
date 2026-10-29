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
    document.getElementById('status-text').textContent = navigator.onLine ? 'Online' : 'Offline: viewed listings, saved stops and saved Topo maps work';
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

  if (document.querySelector('meta[name="kamptrail-version"]')?.content !== '2.10.0' || [window.DataQuality,window.KampTrailData,window.KampTrailTrip,window.KampTrailFilters,window.KampTrailSpot,window.KampTrailLayers,window.KampTrailShare,window.KampTrailOffline,window.KampTrailContrib,window.KampTrailCommunity,window.KampTrailMVUM,window.KampTrailRoutes,window.KampTrailDiscovery,window.KampTrailEnvironment].some(module=>module?.version!=='2.10.0')) {
    showToast('Updating KampTrail. This page will reload automatically when the update is ready.','info',0);
    document.getElementById('result-summary').textContent='Updating the saved app…';
    return;
  }
  const dataDialog = document.getElementById('data-dialog');
  document.getElementById('about-data').addEventListener('click', () => {updateCatalogueSummary();dataDialog.showModal();});
  document.getElementById('kt-my-reports')?.addEventListener('click', () => {dataDialog.close();KampTrailContrib.showReports();});
  document.getElementById('kt-my-reviews')?.addEventListener('click', () => {dataDialog.close();KampTrailCommunity.mine();});
  dataDialog.addEventListener('click', event => { if (event.target === dataDialog) {
    const box=dataDialog.getBoundingClientRect();
    if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dataDialog.close();
  }});
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
  KampTrailLayers.init(map);
  KampTrailOffline.init(map);
  const key=L.control({position:'bottomright'});
  key.onAdd=()=>{
    const el=L.DomUtil.create('div','map-key');
    el.innerHTML='<span><i style="background:#258543"></i>Reported free</span><span><i style="background:#b07d10"></i>Free with conditions</span><span><i style="background:#2375b9"></i>Paid</span><span><i style="background:#687780"></i>Fee unknown</span>';
    L.DomEvent.disableClickPropagation(el);return el;
  };key.addTo(map);
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
      map.setView([lat,lng], 8);
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
    // Listings show from the detail zoom. Large states open at their center instead of a view that only shows totals.
    if (map.getZoom() < KampTrailData.DETAIL_ZOOM) map.setView([(b.s+b.n)/2,(b.w+b.e)/2], KampTrailData.DETAIL_ZOOM);
    KampTrailData.loadStates([code]).catch(() => showToast('Some listings could not load. Use Retry in the campsite list.', 'error'));
    stateSelect.value = code;
    document.getElementById('search-results').hidden = true;
  }
  stateSelect.onchange = () => { if (stateSelect.value) jumpState(stateSelect.value); };

  function renderResults() {
    const status = KampTrailData.getLoadStatus();
    const sites = KampTrailData.getVisibleCampsites();
    const summary = document.getElementById('result-summary');
    if (status.overview) {
      summary.textContent = `Zoomed out · about ${status.catalogueTotal.toLocaleString('en-US')} source listings nationwide`;
      const note = document.createElement('p'); note.className = 'list-empty';
      note.textContent = 'Zoom in, search, or select a state bubble to see campsites. Listings load for the area you view, which keeps the map fast on a weak signal.';
      document.getElementById('data-errors').hidden = true;
      document.getElementById('result-list').replaceChildren(note);
      return;
    }
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
    const active = window.kamptrailFilters || {};
    sorted.slice(0,100).forEach(site => {
      const p = site.properties;
      const card = document.createElement('article'); card.className = 'site-card';
      const heading = document.createElement('h3'); heading.textContent = p.name;
      const details = document.createElement('p');
      const rigLen = +((window.kamptrailFilters || {}).rigLength || 0);
      const cost = p.fee_status === 'free' ? 'Reported free' : p.fee_status === 'conditional' ? 'Free with conditions' : p.fee_status === 'paid' ? (Number.isFinite(p.cost) ? `Reported $${p.cost}` : 'Paid · amount unknown') : 'Fee unknown';
      details.textContent = `${cost} · ${p.type === 'established' ? 'Campground' : (p.type || 'Type unknown')} · ${p.state || ''}${(rigLen > 0 || (active.hookups || []).length) && !DataQuality.matchingSites(p, rigLen, active.hookups || [], false) ? ' · RV fit not documented' : ''}`;
      const actions = document.createElement('div'); actions.className = 'site-actions';
      const view = document.createElement('button'); view.textContent = 'View on map'; view.onclick = () => { KampTrailData.focusCampsite(p.id); if (innerWidth < 761) setList(false); };
      const trip = document.createElement('button'); trip.textContent = 'Save stop'; trip.onclick = () => KampTrailTrip.addStop(p.id);
      actions.append(view, trip); card.append(heading,details);const evidence=window.KampTrailDiscovery?.summary(p);if(evidence){const note=document.createElement('p');note.className='kt-fine';note.textContent=`${(evidence.rating_sum/evidence.rating_count).toFixed(1)}/5 · ${evidence.rating_count} published ${evidence.rating_count===1?'review':'reviews'} · latest visit ${evidence.latest_visit}`;card.append(note);const match=window.KampTrailDiscovery.matchNote(p,active);if(match){const n=document.createElement('p');n.className='kt-fine';n.textContent=match;card.append(n);}}card.append(actions); fragment.append(card);
    });
    if (+active.rigLength > 0 && !active.rigIncludeUnknown) {
      const withUnknown = DataQuality.applyFilters(KampTrailData.getAllCampsites(), {...active, rigIncludeUnknown:true});
      const b = map.getBounds();
      const hidden = withUnknown.filter(f => { const [lon,lat] = f.geometry.coordinates; return b.contains([lat,lon]); }).length - sites.length;
      if (hidden > 0) {
        const tip = document.createElement('div'); tip.className = 'free-tip';
        const p1 = document.createElement('p');
        p1.textContent = `${hidden.toLocaleString('en-US')} more ${hidden === 1 ? 'listing matches' : 'listings match'} your other filters here but ${hidden === 1 ? 'has' : 'have'} no documented RV length. Most free and dispersed sites never publish one.`;
        const inc = document.createElement('button'); inc.type = 'button'; inc.textContent = 'Include them, labeled';
        inc.onclick = () => KampTrailFilters.setIncludeUnknownLength(true);
        tip.append(p1, inc); fragment.append(tip);
      }
    }
    if ((active.cost === 'free' || active.cost === 'conditional') && sites.length < 15) {
      const tip = document.createElement('div'); tip.className = 'free-tip';
      const p1 = document.createElement('p');
      p1.textContent = 'Few listings report free camping. Most free camping is dispersed camping on public land. BLM says most of its land allows dispersed camping unless posted closed. National forests set their own rules.';
      const show = document.createElement('button'); show.type = 'button'; show.textContent = 'Show public land';
      show.onclick = () => { KampTrailLayers.showLand(); showToast('Public land is on. Long-press any spot to see who manages it and its stay rules.'); };
      tip.append(p1, show); fragment.append(tip);
    }
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
  let places = [], campsiteIndex = [];
  const placeLoad = fetch('data/places-us.json').then(r => {if (!r.ok) throw new Error('Place index unavailable');return r.json();}).then(d => {places = d.places || [];}).catch(() => {});
  // The national name index is large, so it loads on first search or shared link, not on page load.
  const ensureSiteIndex = () => KampTrailData.loadSearchIndex().then(data=>{campsiteIndex=data.sites;}).catch(()=>{});
  async function updateHealth() {
    const box = document.getElementById('kt-health'); if (!box) return;
    let sum = null;
    try { const r = await fetch('data/health.json', {cache: 'no-cache'}); if (r.ok) sum = DataQuality.summarizeHealth(await r.json()); } catch {}
    box.replaceChildren();
    const p = (text, cls) => { const e = document.createElement('p'); if (cls) e.className = cls; e.textContent = text; return e; };
    if (!sum) { box.append(p('Data freshness is unavailable right now.', 'kt-muted')); return; }
    if (sum.runFailed) box.append(p(`Degraded: the last data refresh (${sum.lastRun}) did not save any new data. Saved data is shown.`, 'kt-health-warn'));
    else if (sum.degraded) box.append(p(`Some sources are out of date: ${sum.rows.filter(r => r.status === 'stale' || r.status === 'failing').map(r => r.label).join(', ')}.`, 'kt-health-warn'));
    const table = document.createElement('table'); table.className = 'kt-health-table';
    table.innerHTML = '<caption>Data freshness</caption><thead><tr><th scope="col">Source</th><th scope="col">Last downloaded</th><th scope="col">Status</th></tr></thead>';
    const tb = document.createElement('tbody');
    const label = {current: 'Current', partial: 'Partly refreshed', stale: 'Out of date', failing: 'Refresh failing'};
    for (const r of sum.rows) {
      const tr = document.createElement('tr');
      const when = !r.newest ? 'Unknown' : r.oldest && r.oldest !== r.newest ? `${r.oldest} to ${r.newest}` : r.newest;
      const status = label[r.status] + (r.note ? `. ${r.note}` : '');
      for (const [i, t] of [r.label, when, status].entries()) { const c = document.createElement(i ? 'td' : 'th'); if (!i) c.scope = 'row'; c.textContent = t; tr.append(c); }
      tr.dataset.status = r.status; tb.append(tr);
    }
    table.append(tb); box.append(table);
    if (sum.lastRun) box.append(p(`Last refresh run: ${sum.lastRun}.`, 'kt-muted'));
  }
  function updateCatalogueSummary() {
    updateHealth();
    const totals = KampTrailData.getStateTotals ? KampTrailData.getStateTotals() : {};
    const n = Object.values(totals).reduce((a,b) => a + b, 0), states = Object.keys(totals).filter(k => totals[k] > 0).length;
    document.getElementById('catalogue-summary').textContent = n ? `About ${n.toLocaleString('en-US')} source listings across ${states} states in the current catalogue, before duplicates are merged. Coverage is incomplete.` : 'Catalogue count is unavailable. Source coverage is incomplete.';
  }
  const normalize = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const searchResults = document.getElementById('search-results');
  function addChoice(label, action) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.onclick = async () => {searchResults.hidden=true;try{await action();}catch{showToast('The selected location could not load. Please try again.', 'error');}};
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
    await Promise.all([placeLoad,ensureSiteIndex()]);
    searching = false;
    const key = normalize(query);
    searchResults.replaceChildren();
    Object.entries(stateNames).filter(([c,n]) => key === normalize(c) || key === normalize(n)).forEach(([c,n]) => addChoice(`${n} · State`, () => jumpState(c)));
    const indexedSites = campsiteIndex.length ? campsiteIndex : KampTrailData.getAllCampsites().map(s=>({id:s.properties.id,name:s.properties.name,states:[],lat:s.geometry.coordinates[1],lng:s.geometry.coordinates[0]}));
    const campsiteMatches = indexedSites.filter(s=>normalize(s.name).includes(key)).slice(0,8);
    campsiteMatches.forEach(site=>addChoice(`${site.name} · Campsite`,async()=>{
      showToast('Opening campsite…');
      await KampTrailData.loadStates(site.states);
      if(!KampTrailData.focusCampsite(site.id))showToast('This campsite area could not load. Connect to the internet and retry.', 'error');
      else {document.getElementById('toast').classList.remove('show');if(innerWidth<761)setList(false);}
    }));
    const words = key.split(' ');
    const cityMatches = places.filter(p => {
      const city = normalize(p.name), state = normalize(p.state), fullState = normalize(stateNames[p.state] || 'District of Columbia');
      const names = [city,...(p.aliases || []).map(normalize)];
      return words.every(w => names.some(n => n.split(' ').includes(w)) || state === w || fullState.split(' ').includes(w));
    }).sort((a,b) => {
      const exact = p => normalize(p.name) === key || normalize(`${p.name} ${p.state}`) === key;
      return Number(exact(b)) - Number(exact(a)) || b.population - a.population;
    }).slice(0,8);
    cityMatches.forEach(p => addChoice(`${p.name}, ${p.state} · City`, () => {map.setView([p.lat,p.lng],8);KampTrailData.refresh();}));
    if (!searchResults.childNodes.length) {
      const note = document.createElement('p');
      note.textContent = 'No match. Try a city and state (Albany, NY), choose a state, or enter latitude, longitude. Try a campground name or a nearby city.';
      searchResults.append(note);
    }
    searchResults.hidden = false;
  };
  document.addEventListener('keydown', e => {if(e.key === 'Escape') searchResults.hidden = true;});
  document.addEventListener('click', e => {if (!e.target.closest('.search-bar')) searchResults.hidden = true;});

  // Initialize controls before requesting data. Slow sources cannot disable tools.
  KampTrailFilters.init(map);
  KampTrailTrip.init(map);
  // Shared links: #site=<id> opens a campsite, #spot=lat,lng opens the spot check.
  async function openSharedLink() {
    const target = KampTrailShare.parse();
    if (!target) return;
    if (target.spot) { map.setView(target.spot, 13); KampTrailLayers.openSpot(L.latLng(target.spot[0], target.spot[1])); return; }
    await ensureSiteIndex();
    const entry = campsiteIndex.find(s => s.id === target.site);
    if (entry) { map.setView([entry.lat, entry.lng], 12); await KampTrailData.loadStates(entry.states); }
    if (!KampTrailData.focusCampsite(target.site)) showToast('That shared campsite could not be found. It may have been removed from the catalogue.', 'error');
  }
  addEventListener('hashchange', () => openSharedLink().catch(() => {}));
  KampTrailData.init(map, {maxMarkers:5000,onTripAdd:id=>KampTrailTrip.addStop(id)}).then(() => { renderResults(); return openSharedLink(); }).catch(err => {
    console.error(err);setLoading(false);
    showToast('Some campsite listings could not load. Open the campsite list and retry.', 'error');
  });


})();
