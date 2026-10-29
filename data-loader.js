/* Campsite loading, source normalization, map markers, and recovery. */
(function () {
  'use strict';
  const state={allCampsites:[],loadedStates:new Set(),loading:new Map(),failed:new Map(),index:null,clusterGroup:null,config:{},map:null,markers:new Map()};
  const STATE_BOUNDS = {
    'AL': { s: 30.2, w: -88.5, n: 35.0, e: -84.9 },
    'AK': { s: 51.2, w: -179.1, n: 71.4, e: -129.9 },
    'AZ': { s: 31.3, w: -114.8, n: 37.0, e: -109.0 },
    'AR': { s: 33.0, w: -94.6, n: 36.5, e: -89.6 },
    'CA': { s: 32.5, w: -124.4, n: 42.0, e: -114.1 },
    'CO': { s: 37.0, w: -109.1, n: 41.0, e: -102.0 },
    'CT': { s: 41.0, w: -73.7, n: 42.1, e: -71.8 },
    'DE': { s: 38.5, w: -75.8, n: 39.8, e: -75.0 },
    'FL': { s: 24.5, w: -87.6, n: 31.0, e: -79.9 },
    'GA': { s: 30.4, w: -85.6, n: 35.0, e: -80.8 },
    'HI': { s: 18.9, w: -160.2, n: 22.2, e: -154.8 },
    'ID': { s: 42.0, w: -117.2, n: 49.0, e: -111.0 },
    'IL': { s: 37.0, w: -91.5, n: 42.5, e: -87.5 },
    'IN': { s: 37.8, w: -88.1, n: 41.8, e: -84.8 },
    'IA': { s: 40.4, w: -96.6, n: 43.5, e: -90.1 },
    'KS': { s: 37.0, w: -102.1, n: 40.0, e: -94.6 },
    'KY': { s: 36.5, w: -89.6, n: 39.1, e: -81.9 },
    'LA': { s: 29.0, w: -94.0, n: 33.0, e: -89.0 },
    'ME': { s: 43.1, w: -71.1, n: 47.5, e: -66.9 },
    'MD': { s: 37.9, w: -79.5, n: 39.7, e: -75.0 },
    'MA': { s: 41.2, w: -73.5, n: 42.9, e: -69.9 },
    'MI': { s: 41.7, w: -90.4, n: 48.3, e: -82.4 },
    'MN': { s: 43.5, w: -97.2, n: 49.4, e: -89.5 },
    'MS': { s: 30.2, w: -91.7, n: 35.0, e: -88.1 },
    'MO': { s: 36.0, w: -95.8, n: 40.6, e: -89.1 },
    'MT': { s: 45.0, w: -116.1, n: 49.0, e: -104.0 },
    'NE': { s: 40.0, w: -104.1, n: 43.0, e: -95.3 },
    'NV': { s: 35.0, w: -120.0, n: 42.0, e: -114.0 },
    'NH': { s: 42.7, w: -72.6, n: 45.3, e: -70.6 },
    'NJ': { s: 38.9, w: -75.6, n: 41.4, e: -73.9 },
    'NM': { s: 31.3, w: -109.1, n: 37.0, e: -103.0 },
    'NY': { s: 40.5, w: -79.8, n: 45.0, e: -71.9 },
    'NC': { s: 33.8, w: -84.3, n: 36.6, e: -75.5 },
    'ND': { s: 45.9, w: -104.1, n: 49.0, e: -96.6 },
    'OH': { s: 38.4, w: -84.8, n: 42.3, e: -80.5 },
    'OK': { s: 33.6, w: -103.0, n: 37.0, e: -94.4 },
    'OR': { s: 42.0, w: -124.6, n: 46.3, e: -116.5 },
    'PA': { s: 39.7, w: -80.5, n: 42.3, e: -74.7 },
    'RI': { s: 41.1, w: -71.9, n: 42.0, e: -71.1 },
    'SC': { s: 32.0, w: -83.4, n: 35.2, e: -78.5 },
    'SD': { s: 42.5, w: -104.1, n: 45.9, e: -96.4 },
    'TN': { s: 35.0, w: -90.3, n: 36.7, e: -81.6 },
    'TX': { s: 25.8, w: -106.6, n: 36.5, e: -93.5 },
    'UT': { s: 37.0, w: -114.1, n: 42.0, e: -109.0 },
    'VT': { s: 42.7, w: -73.4, n: 45.0, e: -71.5 },
    'VA': { s: 36.5, w: -83.7, n: 39.5, e: -75.2 },
    'WA': { s: 45.5, w: -124.8, n: 49.0, e: -116.9 },
    'WV': { s: 37.2, w: -82.6, n: 40.6, e: -77.7 },
    'WI': { s: 42.5, w: -92.9, n: 47.1, e: -86.2 },
    'WY': { s: 41.0, w: -111.1, n: 45.0, e: -104.1 }
  };  const defaults=()=>({cost:'all',type:'all',rigSize:'all',roadDifficulty:'all',amenities:[],minRating:0});
  const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl=value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)?u.href:null;}catch{return null;}};
  function getVisibleStates(map=state.map) {
    if(!map)return [];
    const b=map.getBounds(),s=b.getSouth(),n=b.getNorth(),west=b.getWest(),east=b.getEast();
    if(east-west>=360)return Object.keys(STATE_BOUNDS).filter(code=>STATE_BOUNDS[code].n>=s&&STATE_BOUNDS[code].s<=n);
    const ranges=[];
    const w=((west+180)%360+360)%360-180, width=east-west, e=w+width;
    if(e>180)ranges.push([w,180],[-180,e-360]);else ranges.push([w,e]);
    return Object.keys(STATE_BOUNDS).filter(code=>{const a=STATE_BOUNDS[code];return a.n>=s&&a.s<=n&&ranges.some(([left,right])=>a.e>=left&&a.w<=right);});
  }
  function datasetCacheTarget(url) {
    try {
      if (!window.caches || !window.location?.href) return null;
      const scope = new URL('./', window.location.href), target = new URL(url, window.location.href);
      if (target.origin !== scope.origin || !target.href.startsWith(scope.href)) return null;
      const relative = target.pathname.slice(scope.pathname.length);
      const kinds={'data/campsites/index.json':'index','data/campsites/agency/index.json':'agencyIndex','data/campsites/ridb-sites.json':'sites','data/services/services.json':'services'};
      if (!relative.endsWith('.geojson') && !kinds[relative]) return null;
      return {name:`kamptrail:${scope.href}:data-v1`, url:target.href, index:kinds[relative]==='index', kind:kinds[relative]||'geojson'};
    } catch { return null; }
  }
  function validDataset(data, target) {
    if (target?.index) return Array.isArray(data?.states) && Number.isFinite(data.total_sites) && data.total_sites >= 0;
    if (target?.kind === 'agencyIndex') return data?.version === 1 && Array.isArray(data.states);
    if (target?.kind === 'sites') return [1, 2].includes(data?.version) && !!data.facilities && typeof data.facilities === 'object';
    if (target?.kind === 'services') return data?.version === 1 && Array.isArray(data.items);
    return data?.type === 'FeatureCollection' && Array.isArray(data.features);
  }
  async function fetchJSON(url) {
    const controller=new AbortController(), target=datasetCacheTarget(url);
    const timer=setTimeout(()=>controller.abort(),12000);
    try {
      const response=await fetch(url,{signal:controller.signal});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const copy=target && typeof response.clone==='function' ? response.clone() : null;
      const data=await response.json();
      if (target && !validDataset(data,target)) throw new Error('Invalid campsite data');
      // Persist the original, validated response even before a service worker controls this visit.
      if (target && copy) {
        try { const cache=await window.caches.open(target.name);await cache.put(target.url,copy); }
        catch(error) { console.warn('Offline data cache unavailable:',error.message); }
      }
      return data;
    } catch(error) {
      if (target) {
        try {
          const cache=await window.caches.open(target.name), cached=await cache.match(target.url);
          if (cached?.ok) { const data=await cached.json();if(validDataset(data,target))return data; }
        } catch(cacheError) { console.warn('Saved data could not be read:',cacheError.message); }
      }
      throw error;
    } finally {clearTimeout(timer);}
  }

  function notify() {
    const detail=api.getLoadStatus();
    if(typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('kamptrail:dataupdated',{detail}));
  }
  async function loadIndex() {
    try{state.index=await fetchJSON('data/campsites/index.json');}catch(err){console.warn('Campsite index unavailable; state loading is still available.',err.message);}
  }
  function mergeLoaded(features,stateCode) {
    const cleaned=DataQuality.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:[...state.allCampsites,...features]}, {state:stateCode});
    state.allCampsites=cleaned.features;
    if(state.siteDetails)state.allCampsites.forEach(f=>DataQuality.attachSiteDetails(f,state.siteDetails));
  }
  async function loadAgencyIndex() {
    try{const data=await fetchJSON('data/campsites/agency/index.json');if(Array.isArray(data?.states)){state.agencyStates=new Set(data.states);state.agencyCounts=data.counts&&typeof data.counts==='object'?data.counts:{};}}
    catch(err){console.warn('Agency campsite index unavailable; Recreation.gov and OSM listings still load.',err.message);}
  }
  async function loadSiteDetails() {
    try{const data=await fetchJSON('data/campsites/ridb-sites.json');if(data&&typeof data.facilities==='object')state.siteDetails=data.facilities;}
    catch(err){console.warn('Campsite RV details unavailable; listings still load.',err.message);}
  }
  async function loadState(code,{retry=false}={}) {
    if(!STATE_BOUNDS[code])return;
    if(state.loadedStates.has(code))return;
    if(state.loading.has(code))return state.loading.get(code);
    const last=state.failed.get(code);
    if(!retry&&last&&Date.now()-last.at<15000)return;
    const task=(async()=>{
      try{
        const agency=state.agencyStates?.has(code)?fetchJSON(`data/campsites/agency/${code}.geojson`).catch(err=>{console.warn(`Agency listings for ${code} unavailable: ${err.message}`);return null;}):null;
        const data=await fetchJSON(`data/campsites/${code}_merged.geojson`);
        if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))throw new Error('Invalid campsite data');
        const extra=await agency;
        mergeLoaded([...data.features,...(extra?.type==='FeatureCollection'&&Array.isArray(extra.features)?extra.features:[])],code);
        state.loadedStates.add(code);state.failed.delete(code);
      }catch(error){
        const message=error.name==='AbortError'?'Request timed out':error.message;
        state.failed.set(code,{error:message,at:Date.now()});
        console.warn(`Campsites for ${code} could not load: ${message}`);
      }finally{state.loading.delete(code);}
    })();
    state.loading.set(code,task);notify();
    await task;
  }
  function costText(p) {
    if(p.fee_status==='free')return 'Free (source reported)';
    if(p.fee_status==='conditional')return 'Free with conditions (see wording)';
    if(p.fee_status==='paid')return p.cost===null?'Paid · amount not verified':`$${p.cost}/night (source reported)`;
    return 'Fee not verified';
  }
  function rvText(p) {
    if(!p.site_count)return '';
    const parts=[];
    const rig=+(window.kamptrailFilters?.rigLength||0);
    if(p.rv_sites)parts.push(`${p.rv_sites} of ${p.site_count} sites allow RVs or trailers`);
    else parts.push(`${p.site_count} sites listed, none list RV or trailer use`);
    if(p.rv_max_length)parts.push(`longest reported ${p.rv_max_length} ft`);
    const hooks=(window.kamptrailFilters?.hookups)||[];
    if(rig>0||hooks.length){const n=DataQuality.matchingSites(p,rig,hooks,false);parts.push(`${n} ${n===1?'site lists':'sites list'} ${[rig>0?`${rig} ft or more`:'',hooks.length?`${hooks.join(' + ')} hookups`:''].filter(Boolean).join(' with ')} on the same site`);}
    const h=p.hookups||{},hk=[['electric','electric'],['water','water'],['sewer','sewer']].filter(([k])=>h[k]>0).map(([k,l])=>`${l} at ${h[k]}`);
    return `<div><strong>RV sites (Recreation.gov):</strong> ${esc(parts.join(' · '))}</div>${hk.length?`<div><strong>Hookups reported:</strong> ${esc(hk.join(', '))} sites</div>`:''}`;
  }
  function popup(site) {
    const p=site.properties,[lng,lat]=site.geometry.coordinates;
    const sourceURL=safeUrl(p.source_url || p.website || p.url);
    const siteId=esc(p.id);
    return `<div class="kt-site-popup" style="min-width:220px;max-width:300px;color:#263443">
      <h3 style="margin:0 0 8px;font-size:15px">${esc(p.name)}</h3>
      <div><strong>Cost:</strong> ${esc(costText(p))}${p.fee_evidence?` <span class="kt-muted">(${esc(p.fee_evidence)})</span>`:''}</div>
      ${p.fee_text?`<div class="kt-fee-evidence"><span class="kt-muted">${esc(p.fee_source||'Source')}${p.fee_checked?`, imported ${esc(p.fee_checked)}`:''}:</span> “${esc(p.fee_text.length>220?p.fee_text.slice(0,217)+'…':p.fee_text)}”</div>`:''}
      ${p.fee_status==='free'||p.fee_status==='conditional'?'<div class="kt-fine">This is the camping fee only. Entrance fees, passes, permits, or reservation charges may still apply.</div>':''}
      ${p.fee_conflict?'<div class="kt-fine">Sources disagree on the fee, so it shows as unknown.</div>':''}
      ${p.open_status&&p.open_status!=='none'?`<div><strong>Status (agency):</strong> ${esc(p.open_status)}${p.season?` · season ${esc(p.season)}`:''}</div>`:''}
      ${p.restrictions?`<div><strong>Restrictions:</strong> ${esc(p.restrictions.length>180?p.restrictions.slice(0,177)+'…':p.restrictions)}</div>`:''}
      ${p.stay_limit?`<div><strong>Stay limit:</strong> ${esc(p.stay_limit)}</div>`:''}
      ${p.reservable?'<div class="kt-fine">Reservable on Recreation.gov. Reservation charges may apply. That alone does not show the camping fee.</div>':''}
      <div><strong>Type:</strong> ${esc(p.type)}</div>
      <div><strong>GPS:</strong> <span class="kt-coordinates">${lat.toFixed(5)}, ${lng.toFixed(5)}</span></div>
      <div><strong>Access reported:</strong> ${esc(p.access_label || p.access || 'Not verified')}</div>
      <div><strong>Amenities reported:</strong> ${p.amenities.length?p.amenities.map(esc).join(', '):'Not verified'}</div>
      ${p.road_difficulty?`<div><strong>Road:</strong> ${esc(p.road_difficulty)}</div>`:''}
      ${p.rig_friendly.length?`<div><strong>Rig types reported:</strong> ${p.rig_friendly.map(esc).join(', ')}</div>`:''}
      ${rvText(p)}
      ${p.rating!==null?`<div><strong>Rating:</strong> ${p.rating}/5${p.reviews_count?` (${p.reviews_count} reviews)`:''}</div>`:''}
      <p style="font-size:11px;line-height:1.4">Confirm current fees, access, and camping rules with the operator before traveling.${p.attributes_unverified?' Legacy inferred fees and amenities are hidden.':''}</p>
      ${sourceURL?`<p><a href="${esc(sourceURL)}" target="_blank" rel="noopener noreferrer">Check source / operator</a></p>`:''}
      <div class="kt-popup-actions">
        <button type="button" data-kt-action="trip" data-siteid="${siteId}">Save stop</button>
        <a href="https://www.google.com/maps/dir/?api=1&amp;destination=${lat},${lng}" target="_blank" rel="noopener noreferrer">Directions</a>
        <button type="button" data-kt-action="share" data-siteid="${siteId}">Share</button>
      </div>
      <div class="kt-popup-actions kt-popup-more">
        <button type="button" data-kt-action="weather" data-siteid="${siteId}">Forecast + elevation</button>
        <button type="button" data-kt-action="land" data-siteid="${siteId}">Land manager</button>
        <button type="button" data-kt-action="nearby" data-siteid="${siteId}">Nearest RV services</button>
      </div>
      <div class="kt-popup-extra"></div>
      <p><button type="button" class="btn" data-kt-action="reviews" data-siteid="${siteId}">Reviews and photos</button></p>
      <p class="kt-fine"><button type="button" class="kt-linkbtn" data-kt-action="fix" data-siteid="${siteId}">Suggest a fix</button> No account needed. A moderator reviews every report.</p>
    </div>`;
  }
  function updateMarkers() {
    if(!state.map||!state.clusterGroup)return;
    const filtered=DataQuality.applyFilters(state.allCampsites,api.getCurrentFilters());
    const activeIds=new Set(filtered.map(f=>f.properties.id));
    for(const [id,marker] of state.markers){if(!activeIds.has(id)){state.clusterGroup.removeLayer(marker);state.markers.delete(id);}}
    const additions=[];
    for(const site of filtered){
      const id=site.properties.id;
      if(state.markers.has(id)){const m=state.markers.get(id);if(!m.isPopupOpen?.())m.setPopupContent(popup(site));continue;}
      const [lng,lat]=site.geometry.coordinates,p=site.properties;
      const color=p.fee_status==='free'?'#258543':p.fee_status==='conditional'?'#b07d10':p.fee_status==='paid'?'#2375b9':'#687780';
      const icon=L.divIcon({html:`<span style="display:block;background:${color};width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px #333"></span>`,className:'custom-marker',iconSize:[16,16],iconAnchor:[8,8]});
      const marker=L.marker([lat,lng],{icon,title:p.name}).bindPopup(popup(site));
      marker.kamptrailId=id;state.markers.set(id,marker);additions.push(marker);
    }
    if(additions.length)state.clusterGroup.addLayers?state.clusterGroup.addLayers(additions):additions.forEach(m=>state.clusterGroup.addLayer(m));
    state.config.onFilterUpdate?.(filtered.length,state.allCampsites.length);
    notify();
  }
  async function loadBatch(codes,retry=false) {
    const list=[...new Set(codes)].filter(c=>STATE_BOUNDS[c]);let next=0;
    async function worker(){while(next<list.length){const code=list[next++];await loadState(code,{retry});updateMarkers();}}
    await Promise.all(Array.from({length:Math.min(4,list.length)},worker));
    updateMarkers();
    return api.getLoadStatus();
  }
  // ---- Zoom-gated loading: below DETAIL_ZOOM show per-state totals and download nothing. ----
  const DETAIL_ZOOM=8;
  const detailVisible=()=>!!state.map&&state.map.getZoom()>=DETAIL_ZOOM;
  const short=n=>n>=1000?`${(n/1000).toFixed(n>=10000?0:1).replace(/\.0$/,'')}k`:String(n);
  function stateTotals() {
    const totals={};
    for(const s of state.index?.states||[])if(STATE_BOUNDS[s.state]&&Number.isFinite(s.count))totals[s.state]=(totals[s.state]||0)+s.count;
    for(const [code,n] of Object.entries(state.agencyCounts||{}))if(STATE_BOUNDS[code]&&Number.isFinite(n))totals[code]=(totals[code]||0)+n;
    return totals;
  }
  function buildOverview() {
    const group=L.layerGroup();
    for(const [code,n] of Object.entries(stateTotals())){
      if(!n)continue;const b=STATE_BOUNDS[code];
      const size=n>=5000?46:n>=1000?40:34;
      const icon=L.divIcon({className:'kt-state-bubble',html:`<span style="width:${size}px;height:${size}px">${short(n)}</span>`,iconSize:[size,size],iconAnchor:[size/2,size/2]});
      const m=L.marker([(b.s+b.n)/2,(b.w+b.e)/2],{icon,title:`${code}: about ${n.toLocaleString('en-US')} source listings. Select to zoom in.`,keyboard:true});
      m.on('click',()=>{state.map.fitBounds([[b.s,b.w],[b.n,b.e]],{maxZoom:9});if(state.map.getZoom()<DETAIL_ZOOM)state.map.setView([(b.s+b.n)/2,(b.w+b.e)/2],DETAIL_ZOOM);});
      group.addLayer(m);
    }
    return group;
  }
  function syncMode() {
    if(!state.map||!state.clusterGroup)return;
    const detail=detailVisible();
    if(detail){
      if(state.overview&&state.map.hasLayer(state.overview))state.map.removeLayer(state.overview);
      if(!state.map.hasLayer(state.clusterGroup))state.map.addLayer(state.clusterGroup);
    } else {
      if(state.map.hasLayer(state.clusterGroup))state.map.removeLayer(state.clusterGroup);
      if(!state.overview)state.overview=buildOverview();
      if(!state.map.hasLayer(state.overview))state.map.addLayer(state.overview);
    }
  }
  function onView() {
    syncMode();
    if(detailVisible())return loadBatch(getVisibleStates(),false);
    notify();return Promise.resolve(api.getLoadStatus());
  }
  const api=window.KampTrailData={
    version:'2.6.0',
    DETAIL_ZOOM,
    async init(map,config={}){
      state.map=map;state.config=config;
      state.clusterGroup=L.markerClusterGroup({maxClusterRadius:50,spiderfyOnMaxZoom:true,showCoverageOnHover:false,chunkedLoading:true});
      let timer;
      map.on('moveend',()=>{syncMode();clearTimeout(timer);timer=setTimeout(onView,250);});
      await Promise.all([loadIndex(),loadSiteDetails(),loadAgencyIndex()]);
      state.overview=null;
      await onView();
    },
    getDefaultFilters:defaults,
    getCurrentFilters:()=>window.kamptrailFilters || defaults(),
    updateFilters(filters){window.kamptrailFilters={...defaults(),...filters};updateMarkers();},
    getAllCampsites:()=>state.allCampsites,
    getCampsiteById(id){const key=String(id);return state.allCampsites.find(s=>s.properties.id===key||s.properties.legacy_ids?.includes(key));},
    getLoadedStates:()=>[...state.loadedStates],
    getVisibleStates,
    getStateBounds:()=>STATE_BOUNDS,
    getVisibleCampsites(){
      if(state.map&&!detailVisible())return [];
      const list=DataQuality.applyFilters(state.allCampsites,api.getCurrentFilters());
      if(!state.map)return list;
      const b=state.map.getBounds();return list.filter(f=>{const [lon,lat]=f.geometry.coordinates;return b.contains([lat,lon])||b.contains([lat,lon+360])||b.contains([lat,lon-360]);});
    },
    getLoadStatus:()=>({loadedStates:[...state.loadedStates],loadingStates:[...state.loading.keys()],failedStates:[...state.failed].map(([code,f])=>({state:code,error:f.error})),totalSites:state.allCampsites.length,loading:state.loading.size>0,overview:!detailVisible(),catalogueTotal:Object.values(stateTotals()).reduce((a,b)=>a+b,0)}),
    loadStates:codes=>loadBatch(codes,true),
    refresh:()=>detailVisible()?loadBatch(getVisibleStates(),true):Promise.resolve(api.getLoadStatus()),
    getStateTotals:stateTotals,
    focusCampsite(id){
      const site=api.getCampsiteById(id);if(!site)return false;
      let marker=state.markers.get(site.properties.id);
      if(!marker && typeof window.KampTrailFilters?.reset==='function') {window.KampTrailFilters.reset();marker=state.markers.get(site.properties.id);}
      if(!marker) {window.showToast?.('This campsite is hidden by your filters. Reset Filters to view it on the map.','info',7000);return false;}
      const [lon,lat]=site.geometry.coordinates;state.map.setView([lat,lon],14);syncMode();
      // Chunked cluster loading can lag behind a focus request, so wait until the marker is placed.
      let tries=0;
      const attempt=()=>{
        if(!state.clusterGroup.zoomToShowLayer){marker.openPopup();return;}
        if(marker.__parent||state.map.hasLayer(marker)){
          const fallback=()=>{if(!marker.isPopupOpen?.()&&!state.map._popup?.isOpen?.())L.popup({maxWidth:320}).setLatLng([lat,lon]).setContent(popup(site)).openOn(state.map);};
          state.clusterGroup.zoomToShowLayer(marker,()=>{if(marker._map)marker.openPopup();else fallback();});
          // markercluster can drop the callback, or leave the marker inside a cluster. Open the same popup at the point instead.
          setTimeout(fallback,1500);
          return;
        }
        if(++tries<50){setTimeout(attempt,100);return;}
        L.popup({maxWidth:320}).setLatLng([lat,lon]).setContent(popup(site)).openOn(state.map);
      };
      attempt();
      return true;
    },
    addToTrip(id){const site=api.getCampsiteById(id);if(site)state.config.onTripAdd?.(site.properties.id);},
    toggleFavorite(id){state.config.onFavoriteToggle?.(id);},
    loadServices(){
      if(!state.services)state.services=fetchJSON('data/services/services.json').then(d=>Array.isArray(d?.items)?d.items:[]).catch(e=>{state.services=null;throw e;});
      return state.services;
    },
    nearestServices(items,lat,lng){
      const rad=v=>v*Math.PI/180;
      const mi=(a,b,c,d)=>{const h=Math.sin(rad(c-a)/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(rad(d-b)/2)**2;return 3958.8*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));};
      const best={};
      for(const row of items){const k=row[2];const d=mi(lat,lng,row[1],row[0]);if(!best[k]||d<best[k].miles)best[k]={row,miles:d};}
      return best;
    },
    renderNearbyServices(box,lat,lng){
      box.textContent='Finding the nearest RV services…';
      return api.loadServices().then(items=>{
        const best=api.nearestServices(items,lat,lng);box.replaceChildren();
        const list=document.createElement('ul');
        [['d','Dump station'],['w','Water fill'],['p','Propane']].forEach(([k,label])=>{
          const li=document.createElement('li');const b=best[k];
          if(!b){li.textContent=`${label}: none in the data`;list.append(li);return;}
          const [x,y,,name]=b.row;
          li.textContent=`${label}: ${name||label}, about ${b.miles<10?b.miles.toFixed(1):Math.round(b.miles)} mi straight-line `;
          const a=document.createElement('a');a.href=`https://www.google.com/maps/dir/?api=1&destination=${y},${x}`;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Directions';li.append(a);list.append(li);
        });
        const note=document.createElement('p');note.className='kt-fine';note.textContent='From OpenStreetMap contributors. Coverage is incomplete and hours are not verified. Call ahead.';
        box.append(list,note);window.KampTrailSpot?.relayout(box);
      }).catch(()=>{box.textContent='Service locations could not load. Try again when connected.';});
    },

  };
  document.addEventListener('click',event=>{
    const action=event.target.closest('[data-kt-action]');
    if(action){
      const id=action.dataset.siteid,kind=action.dataset.ktAction;
      if(kind==='trip'){api.addToTrip(id);return;}
      const site=api.getCampsiteById(id);if(!site)return;
      const [lng,lat]=site.geometry.coordinates;
      if(kind==='reviews'){window.KampTrailCommunity?.open(site);return;}
      if(kind==='share'){window.KampTrailShare?.share({site:site.properties.id},site.properties.name);return;}
      if(kind==='fix'){if(window.KampTrailContrib)KampTrailContrib.open({kind:'correction',site});else if(window.KampTrailShare)window.open(KampTrailShare.issueUrl('fix',site),'_blank','noopener');return;}
      const extra=action.closest('.kt-site-popup')?.querySelector('.kt-popup-extra');if(!extra)return;
      const box=document.createElement('div');extra.append(box);action.disabled=true;
      if(kind==='weather')window.KampTrailSpot?.renderForecast(box,lat,lng);
      else if(kind==='land')window.KampTrailSpot?.renderLand(box,lat,lng);
      else if(kind==='nearby')api.renderNearbyServices(box,lat,lng);
      return;
    }

  });
})();
