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
      if (!relative.endsWith('.geojson') && relative !== 'data/campsites/index.json') return null;
      return {name:`kamptrail:${scope.href}:data-v1`, url:target.href, index:relative === 'data/campsites/index.json'};
    } catch { return null; }
  }
  function validDataset(data, target) {
    if (target?.index) return Array.isArray(data?.states) && Number.isFinite(data.total_sites) && data.total_sites >= 0;
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
  }
  async function loadState(code,{retry=false}={}) {
    if(!STATE_BOUNDS[code])return;
    if(state.loadedStates.has(code))return;
    if(state.loading.has(code))return state.loading.get(code);
    const last=state.failed.get(code);
    if(!retry&&last&&Date.now()-last.at<15000)return;
    const task=(async()=>{
      try{
        const data=await fetchJSON(`data/campsites/${code}_merged.geojson`);
        if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))throw new Error('Invalid campsite data');
        mergeLoaded(data.features,code);
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
    if(p.fee_status==='paid')return p.cost===null?'Paid · amount not verified':`$${p.cost}/night (source reported)`;
    return 'Fee not verified';
  }
  function popup(site) {
    const p=site.properties,[lng,lat]=site.geometry.coordinates;
    const sourceURL=safeUrl(p.source_url || p.website || p.url);
    const siteId=esc(p.id);
    return `<div class="kt-site-popup" style="min-width:220px;max-width:300px;color:#263443">
      <h3 style="margin:0 0 8px;font-size:15px">${esc(p.name)}</h3>
      <div><strong>Cost:</strong> ${esc(costText(p))}</div>
      <div><strong>Type:</strong> ${esc(p.type)}</div>
      <div><strong>Access reported:</strong> ${esc(p.access || 'Not verified')}</div>
      <div><strong>Amenities reported:</strong> ${p.amenities.length?p.amenities.map(esc).join(', '):'Not verified'}</div>
      ${p.road_difficulty?`<div><strong>Road:</strong> ${esc(p.road_difficulty)}</div>`:''}
      ${p.rig_friendly.length?`<div><strong>Rig types reported:</strong> ${p.rig_friendly.map(esc).join(', ')}</div>`:''}
      ${p.rating!==null?`<div><strong>Rating:</strong> ${p.rating}/5${p.reviews_count?` (${p.reviews_count} reviews)`:''}</div>`:''}
      <p style="font-size:11px;line-height:1.4">Confirm current fees, access, and camping rules with the operator before traveling.${p.attributes_unverified?' Legacy inferred fees and amenities are hidden.':''}</p>
      ${sourceURL?`<p><a href="${esc(sourceURL)}" target="_blank" rel="noopener noreferrer">Check source / operator</a></p>`:''}
      <div style="display:flex;gap:5px;flex-wrap:wrap">
        <button type="button" data-kt-action="trip" data-siteid="${siteId}">Add to Trip</button>
        <button type="button" data-kt-action="compare" data-siteid="${siteId}">Compare</button>
        <a href="https://www.google.com/maps/dir/?api=1&amp;destination=${lat},${lng}" target="_blank" rel="noopener noreferrer">Directions</a>
      </div>
      <div id="photos-container-${siteId}" style="margin-top:10px"><button type="button" class="kt-photos-btn" data-siteid="${siteId}" data-lat="${lat}" data-lng="${lng}">Show nearby photos</button></div>
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
      if(state.markers.has(id)){state.markers.get(id).setPopupContent(popup(site));continue;}
      const [lng,lat]=site.geometry.coordinates,p=site.properties;
      const color=p.fee_status==='free'?'#258543':p.fee_status==='paid'?'#2375b9':'#687780';
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
  const api=window.KampTrailData={
    async init(map,config={}){
      state.map=map;state.config=config;
      state.clusterGroup=L.markerClusterGroup({maxClusterRadius:50,spiderfyOnMaxZoom:true,showCoverageOnHover:false,chunkedLoading:true});
      map.addLayer(state.clusterGroup);
      let timer;
      map.on('moveend',()=>{clearTimeout(timer);timer=setTimeout(()=>loadBatch(getVisibleStates(),false),250);});
      await loadIndex();
      await loadBatch(getVisibleStates(),false);
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
      const list=DataQuality.applyFilters(state.allCampsites,api.getCurrentFilters());
      if(!state.map)return list;
      const b=state.map.getBounds();return list.filter(f=>{const [lon,lat]=f.geometry.coordinates;return b.contains([lat,lon])||b.contains([lat,lon+360])||b.contains([lat,lon-360]);});
    },
    getLoadStatus:()=>({loadedStates:[...state.loadedStates],loadingStates:[...state.loading.keys()],failedStates:[...state.failed].map(([code,f])=>({state:code,error:f.error})),totalSites:state.allCampsites.length,loading:state.loading.size>0}),
    loadStates:codes=>loadBatch(codes,true),
    refresh:()=>loadBatch(getVisibleStates(),true),
    focusCampsite(id){
      const site=api.getCampsiteById(id);if(!site)return false;
      let marker=state.markers.get(site.properties.id);
      if(!marker && typeof window.KampTrailFilters?.reset==='function') {window.KampTrailFilters.reset();marker=state.markers.get(site.properties.id);}
      if(!marker) {window.showToast?.('This campsite is hidden by your filters. Reset Filters to view it on the map.','info',7000);return false;}
      const [lon,lat]=site.geometry.coordinates;state.map.setView([lat,lon],14);
      if(state.clusterGroup.zoomToShowLayer)state.clusterGroup.zoomToShowLayer(marker,()=>marker.openPopup());else marker.openPopup();
      return true;
    },
    addToTrip(id){const site=api.getCampsiteById(id);if(site)state.config.onTripAdd?.(site.properties.id);},
    toggleFavorite(id){state.config.onFavoriteToggle?.(id);},
    async loadNearbyPhotos(id,lat,lng){
      const container=document.getElementById(`photos-container-${id}`);if(!container)return;
      container.textContent='Loading nearby photos…';
      try{
        if(!window.KampTrailPhotos)throw new Error('Photos unavailable');
        const photos=await KampTrailPhotos.getNearbyPhotos(lat,lng);
        container.textContent='';
        for(const photo of photos||[]){
          const url=safeUrl(photo.url),page=safeUrl(photo.pageUrl);if(!url||!page)continue;
          const figure=document.createElement('figure');figure.style.margin='0 0 10px';
          const a=document.createElement('a');a.href=page;a.target='_blank';a.rel='noopener noreferrer';a.title=String(photo.title||'Nearby photo');
          const img=document.createElement('img');img.src=url;img.alt=String(photo.title||'Nearby photo');img.style.height='80px';img.loading='lazy';a.appendChild(img);figure.appendChild(a);
          const caption=document.createElement('figcaption');caption.style.fontSize='11px';
          const author=document.createElement('span');author.textContent=photo.author ? `By ${String(photo.author)} · ` : 'Author: see source · ';caption.appendChild(author);
          const license=document.createElement('a');license.href=safeUrl(photo.licenseUrl)||page;license.target='_blank';license.rel='noopener noreferrer';license.textContent=String(photo.licenseLabel||'See source for license');caption.appendChild(license);
          figure.appendChild(caption);container.appendChild(figure);
        }
        if(!container.children.length)container.textContent='No nearby Wikimedia Commons photos found.';
      }catch{container.textContent='Nearby photos unavailable. Try again later.';}
    }
  };
  document.addEventListener('click',event=>{
    const action=event.target.closest('[data-kt-action]');
    if(action){const id=action.dataset.siteid;if(action.dataset.ktAction==='trip')api.addToTrip(id);if(action.dataset.ktAction==='compare')window.KampTrailCompare?.addToCompare(id);return;}
    const photo=event.target.closest('.kt-photos-btn');
    if(photo){event.preventDefault();api.loadNearbyPhotos(photo.dataset.siteid,+photo.dataset.lat,+photo.dataset.lng);}
  });
})();
