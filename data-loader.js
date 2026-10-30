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
      const kinds={'data/campsites/index.json':'index','data/campsites/agency/index.json':'agencyIndex','data/campsites/ridb-sites.json':'sites','data/campsites/ridb-amenities.json':'amenityEvidence','data/campsites/search-index.json':'search'};
      if (!relative.endsWith('.geojson') && !kinds[relative]) return null;
      return {name:`kamptrail:${scope.href}:data-v1`, url:target.href, index:kinds[relative]==='index', kind:kinds[relative]||'geojson'};
    } catch { return null; }
  }
  function validDataset(data, target) {
    if (target?.index) return Array.isArray(data?.states) && Number.isFinite(data.total_sites) && data.total_sites >= 0;
    if (target?.kind === 'agencyIndex') return data?.version === 1 && Array.isArray(data.states);
    if (target?.kind === 'sites') return [1, 2].includes(data?.version) && !!data.facilities && typeof data.facilities === 'object';
    if (target?.kind === 'amenityEvidence') return DataQuality.validRIDBAmenities(data);
    if (target?.kind === 'search') return data?.version===1 && Array.isArray(data.sites);
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
  // Static terrain samples have a separate validated cache. A stable per-state alias
  // survives manifest rotation; coordinate identity is checked again before use.
  const elevationSnapshots=new Map(),elevationTasks=new Map(),elevationStatus=new Map();
  let elevationManifestTask;
  function elevationCache(){
    if(!window.location?.href)return null;
    const scope=new URL('./',window.location.href);
    return{scope,name:`kamptrail:${scope.href}:elevation-v1`,root:new URL('data/campsites/elevation/',scope)};
  }
  async function elevationFetch(url,limit){
    if(typeof navigator!=='undefined'&&navigator.onLine===false)throw new Error('Offline');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{const r=await fetch(url,{signal:controller.signal,cache:'no-store',redirect:'error'});if(!r.ok)throw new Error('Elevation unavailable');const text=await r.text();if(text.length>limit)throw new Error('Elevation response too large');return text;}finally{clearTimeout(timer);}
  }
  async function elevationDigest(text){
    if(!window.crypto?.subtle)throw new Error('Elevation validation unavailable');
    return [...new Uint8Array(await window.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function elevationManifest(force=false){
    if(force)elevationManifestTask=null;
    if(!elevationManifestTask)elevationManifestTask=(async()=>{
      const target=elevationCache();if(!target)throw new Error('Elevation unavailable');
      const url=new URL('index.json',target.root).href;
      try{const text=await elevationFetch(url,1000000),d=JSON.parse(text);if(!DataQuality.validElevationManifest(d))throw new Error('Invalid elevation index');try{const c=await window.caches.open(target.name);await c.put(url,new Response(text));}catch{}return d;}
      catch(error){try{const c=await window.caches.open(target.name),r=await c.match(url),d=r&&await r.json();if(DataQuality.validElevationManifest(d))return d;}catch{}throw error;}
    })();
    return elevationManifestTask;
  }
  function attachLoadedElevations(){for(const f of state.allCampsites)DataQuality.attachElevation(f,[...elevationSnapshots.values()]);}
  async function loadElevation(code,retry=false){
    if(!detailVisible()||!elevationCache())return;
    if(elevationTasks.has(code))return elevationTasks.get(code);
    if(!retry&&elevationStatus.has(code))return;
    const task=(async()=>{
      const target=elevationCache(),alias=new URL(`__saved_${code}__`,target.root).href;
      elevationStatus.set(code,'loading');notify();
      try{
        const index=await elevationManifest(retry),entry=index.states[code];if(!entry)throw new Error('No elevation snapshot');
        // The validator restricts this exact relative path; URL resolution cannot leave our data directory.
        const url=new URL(entry.url,target.root);if(url.origin!==target.scope.origin||!url.href.startsWith(target.root.href))throw new Error('Invalid elevation path');
        const raw=await elevationFetch(url.href,24000000);if(await elevationDigest(raw)!==entry.sha256)throw new Error('Elevation checksum mismatch');
        const d=JSON.parse(raw);if(!DataQuality.validElevationState(d,code,index.snapshot_id)||Object.keys(d.records).length!==entry.count)throw new Error('Invalid elevation snapshot');
        elevationSnapshots.set(code,d);elevationStatus.set(code,'ready');
        try{const c=await window.caches.open(target.name);await c.put(alias,new Response(JSON.stringify({sha256:entry.sha256,raw})));}catch{}
      }catch{
        let restored=false;
        try{const c=await window.caches.open(target.name),r=await c.match(alias),saved=r&&await r.json();if(typeof saved?.raw==='string'&&saved.raw.length<=24000000&&/^[a-f0-9]{64}$/.test(saved.sha256)&&await elevationDigest(saved.raw)===saved.sha256){const d=JSON.parse(saved.raw);if(DataQuality.validElevationState(d,code)){elevationSnapshots.set(code,d);elevationStatus.set(code,'saved');restored=true;}}}catch{}
        // A validated in-memory snapshot is also usable if Cache Storage is unavailable.
        if(!restored&&elevationSnapshots.has(code)){elevationStatus.set(code,'saved');restored=true;}
        if(!restored){elevationSnapshots.delete(code);elevationStatus.set(code,'unavailable');}
      }finally{elevationTasks.delete(code);attachLoadedElevations();}
    })();elevationTasks.set(code,task);return task;
  }
  function mergeLoaded(features,stateCode) {
    const incoming=DataQuality.publicationCandidates(features,{state:stateCode}).map(raw=>DataQuality.normalizeFeature(raw,{state:stateCode}));
    incoming.forEach(f=>{f.properties.forecastStates=[stateCode];});
    if(state.siteDetails)incoming.forEach(f=>DataQuality.attachSiteDetails(f,state.siteDetails));
    if(state.amenityDetails)incoming.forEach(f=>DataQuality.attachRIDBAmenities(f,state.amenityDetails));
    const cleaned=DataQuality.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:[...state.allCampsites,...incoming]}, {state:stateCode});
    state.allCampsites=cleaned.features;
    if(state.siteDetails)state.allCampsites.forEach(f=>DataQuality.attachSiteDetails(f,state.siteDetails));
    if(state.amenityDetails)state.allCampsites.forEach(f=>DataQuality.attachRIDBAmenities(f,state.amenityDetails));
    attachLoadedElevations();
  }
  async function loadAgencyIndex() {
    try{const data=await fetchJSON('data/campsites/agency/index.json');if(Array.isArray(data?.states)){state.agencyStates=new Set(data.states);state.agencyCounts=data.counts&&typeof data.counts==='object'?data.counts:{};}}
    catch(err){console.warn('Agency campsite index unavailable; Recreation.gov and OSM listings still load.',err.message);}
  }
  async function loadSiteDetails() {
    try{const data=await fetchJSON('data/campsites/ridb-sites.json');if(data&&typeof data.facilities==='object')state.siteDetails=data.facilities;}
    catch(err){console.warn('Campsite RV details unavailable; listings still load.',err.message);}
  }
  async function loadAmenityDetails(){
    try{
      const data=await fetchJSON('data/campsites/ridb-amenities.json');
      if(!DataQuality.validRIDBAmenities(data))throw new Error('Invalid RIDB amenity evidence');
      state.amenityDetails=data;
    }catch(err){console.warn('RIDB amenity evidence unavailable; listings still load.',err.message);}
  }
  async function loadState(code,{retry=false}={}) {
    if(!STATE_BOUNDS[code])return;
    if(state.loadedStates.has(code))return loadElevation(code,retry);
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
        updateMarkers(); // Terrain lookup must not delay otherwise usable campsite markers.
        await loadElevation(code,retry);
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
  function ridbAmenitiesText(p){
    const data=p.ridb_amenity_evidence;
    if(!DataQuality.validRIDBAmenities(data))return DataQuality.ridbFacilityIds(p).length?'<div class="kt-fine">Recreation.gov campsite amenity evidence unavailable.</div>':'';
    const labels={toilet:'Toilets',drinking_water:'Drinking water',shower:'Showers',dump:'Dump station',picnic_table:'Picnic tables'};
    const qualifiers={seasonal:'seasonal',peak_season:'peak season',coin:'coin operated',hand_pump:'hand pump',accessible:'accessible feature',outdoor:'outdoor'};
    const groups=Object.values(data.facilities).map(r=>r.amenities),notes=['Counts describe records, not fixtures or every campsite. Missing fields and current availability are unknown.'];
    if(groups.some(g=>g.drinking_water?.reported))notes.push('Drinking water does not establish RV filling access.');
    if(groups.some(g=>g.dump?.reported))notes.push('Dump access and prices are unknown.');
    if(groups.some(g=>g.shower?.qualifiers.coin))notes.push('Coin qualifiers concern showers only.');
    const facilities=Object.entries(data.facilities).map(([fid,rec])=>{
      const rows=Object.entries(rec.amenities).map(([key,g])=>{
        const parts=[];
        if(g.reported)parts.push(`mentioned in ${g.reported} of ${rec.sites} records`);
        for(const [q,n] of Object.entries(g.qualifiers))parts.push(`${qualifiers[q]}: ${n} records`);
        if(g.negative)parts.push(`explicit no: ${g.negative} records`);
        if(g.unknown)parts.push(`blank or unrecognized: ${g.unknown} records`);
        if(g.conflict)parts.push(`conflicting values: ${g.conflict} records`);
        return `<li>${esc(labels[key])}: ${esc(parts.join('; '))}</li>`;
      });
      return `<p><a href="https://www.recreation.gov/camping/campgrounds/${encodeURIComponent(fid)}" target="_blank" rel="noopener noreferrer">Recreation.gov facility ${esc(fid)}</a></p>${rows.length?`<ul>${rows.join('')}</ul>`:`<p>${rec.sites?'No mapped amenity claims in these overnight campsite records.':'No overnight campsite records in this snapshot.'}</p>`}`;
    }).join('');
    return `<details class="kt-ridb-amenities"><summary>Recreation.gov campsite records report…</summary>${facilities}<p class="kt-fine">${esc(notes.join(' '))}</p><p class="kt-fine">${data.source.original_retrieved_at?`Export retrieved ${esc(data.source.original_retrieved_at.slice(0,10))}.`:'Saved export: retrieval date unknown.'} Amenity update dates unknown. Inspected ${esc(data.source.inspected_at.slice(0,10))}; inspection is not an update date. <a href="${DataQuality.RIDB_AMENITY_URL}" target="_blank" rel="noopener noreferrer">Public source export</a></p></details>`;
  }
  function popupLayout(){
    const size=state.map?.getSize?.()||{},width=Number.isFinite(size.x)?size.x:390,height=Number.isFinite(size.y)?size.y:400;
    return {width:Math.max(100,Math.min(300,width-70)),height:Math.max(80,Math.min(360,height-160))};
  }
  function popupOptions(){return {maxWidth:popupLayout().width,autoPanPaddingTopLeft:[12,80],autoPanPaddingBottomRight:[12,28]};}
  function popup(site) {
    const p=site.properties,[lng,lat]=site.geometry.coordinates;
    const status=typeof p.open_status==='string'?p.open_status.trim().toLowerCase():'';
    const closure=['closed','temporarily closed'].includes(status)?status:null;
    const sourceURL=safeUrl(p.source_url || p.website || p.url);
    const siteId=esc(p.id);
    const layout=popupLayout();
    return `<div class="kt-site-popup" tabindex="0" role="region" aria-label="Campsite details" style="min-width:${Math.min(220,layout.width)}px;max-width:${layout.width}px;max-height:${layout.height}px;color:#263443">
      <h2 style="margin:0 0 8px;font-size:15px">${esc(p.name)}</h2>
      ${closure?`<div class="kt-closure-notice"><strong>Agency reports: ${esc(closure)}.</strong> Confirm reopening with the operator.${p.season?` Season reported: ${esc(p.season)}.`:''}</div>`:''}
      <div><strong>Cost:</strong> ${esc(costText(p))}${p.fee_evidence?` <span class="kt-muted">(${esc(p.fee_evidence)})</span>`:''}</div>
      ${p.fee_text?`<div class="kt-fee-evidence"><span class="kt-muted">${esc(p.fee_source||'Source')}${p.fee_checked?`, imported ${esc(p.fee_checked)}`:''}:</span> “${esc(p.fee_text.length>220?p.fee_text.slice(0,217)+'…':p.fee_text)}”</div>`:''}
      ${p.fee_status==='free'||p.fee_status==='conditional'?'<div class="kt-fine">This is the camping fee only. Entrance fees, passes, permits, or reservation charges may still apply.</div>':''}
      ${p.fee_conflict?'<div class="kt-fine">Sources disagree on the fee, so it shows as unknown.</div>':''}
      ${p.open_status&&status!=='none'&&!closure?`<div><strong>Status (agency):</strong> ${esc(p.open_status)}${p.season?` · season ${esc(p.season)}`:''}</div>`:''}
      ${p.restrictions?`<div><strong>Restrictions:</strong> ${esc(p.restrictions.length>180?p.restrictions.slice(0,177)+'…':p.restrictions)}</div>`:''}
      ${p.stay_limit?`<div><strong>Stay limit:</strong> ${esc(p.stay_limit)}</div>`:''}
      ${p.reservable?'<div class="kt-fine">Reservable on Recreation.gov. Reservation charges may apply. That alone does not show the camping fee.</div>':''}
      <div><strong>Type:</strong> ${esc(p.type)}</div>
      <div><strong>GPS:</strong> <span class="kt-coordinates">${lat.toFixed(5)}, ${lng.toFixed(5)}</span></div>
      ${window.KampTrailForecast?.active(window.kamptrailFilters)?`<p class="kt-forecast-evidence kt-fine">${esc(window.KampTrailForecast.describe(site,window.kamptrailFilters))}</p>`:''}
      <div class="kt-elevation-evidence">${esc(DataQuality.elevationText(site,window.kamptrailFilters?.elevationUnit||'ft'))}</div>
      ${DataQuality.elevationInfo(site)?`<p class="kt-fine">Interpolated terrain from <a href="${DataQuality.ELEVATION_SOURCE}" target="_blank" rel="noopener noreferrer">USGS 3DEP</a>. Retrieval date is not acquisition date. Source grid resolution does not guarantee point accuracy, road grade or RV clearance.</p>`:''}
      <div><strong>Access reported:</strong> ${esc(p.access_label || p.access || 'Not verified')}</div>
      <div><strong>Amenities reported:</strong> ${p.amenities.length?p.amenities.map(esc).join(', '):'Not verified'}</div>
      ${ridbAmenitiesText(p)}
      ${p.road_difficulty?`<div><strong>Road:</strong> ${esc(p.road_difficulty)}</div>`:''}
      ${p.rig_friendly.length?`<div><strong>Rig types reported:</strong> ${p.rig_friendly.map(esc).join(', ')}</div>`:''}
      ${rvText(p)}
      ${window.KampTrailDiscovery?.summary(p)?`<div><strong>Community rating:</strong> ${(window.KampTrailDiscovery.summary(p).rating_sum/window.KampTrailDiscovery.summary(p).rating_count).toFixed(1)}/5 · ${window.KampTrailDiscovery.summary(p).rating_count} published ${window.KampTrailDiscovery.summary(p).rating_count===1?'review':'reviews'} · latest visit ${esc(window.KampTrailDiscovery.summary(p).latest_visit)}</div>`:''}
      ${p.rating!==null?`<div><strong>Source rating:</strong> ${p.rating}/5${p.reviews_count?` (${p.reviews_count} reviews)`:''}</div>`:''}
      <p style="font-size:11px;line-height:1.4">Confirm current fees, access, and camping rules with the operator before traveling.${p.attributes_unverified?' Legacy inferred fees and amenities are hidden.':''}</p>
      ${sourceURL?`<p><a href="${esc(sourceURL)}" target="_blank" rel="noopener noreferrer">Check source / operator</a></p>`:''}
      <div class="kt-popup-actions">
        <button type="button" data-kt-action="trip" data-siteid="${siteId}">Save stop</button>
        <a href="https://www.google.com/maps/dir/?api=1&amp;destination=${lat},${lng}" target="_blank" rel="noopener noreferrer">Directions</a>
        <button type="button" data-kt-action="share" data-siteid="${siteId}">Share</button>
      </div>
      <div class="kt-popup-actions kt-popup-more">
        <button type="button" data-kt-action="permissions" data-siteid="${siteId}">Overnight permission</button>
        <button type="button" data-kt-action="fees" data-siteid="${siteId}">Fee evidence</button>
        <button type="button" data-kt-action="weather" data-siteid="${siteId}">Forecast + elevation</button>
        <button type="button" data-kt-action="alerts" data-siteid="${siteId}">Weather alerts</button>
        <button type="button" data-kt-action="environment" data-siteid="${siteId}">Fire and smoke nearby</button>
        <button type="button" data-kt-action="land" data-siteid="${siteId}">Land manager</button>
        <button type="button" data-kt-action="roads" data-siteid="${siteId}">Approach roads</button>
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
      const marker=L.marker([lat,lng],{icon,title:p.name}).bindPopup(popup(site),popupOptions());
      marker.kamptrailId=id;state.markers.set(id,marker);additions.push(marker);
    }
    // Adding markers re-clusters nearby ones, which would close an open popup and lose what the camper
    // opened in it (services, land manager). Hold new markers until that popup closes.
    if(state.map._popup?.isOpen?.()){
      if(additions.length){(state.heldMarkers||(state.heldMarkers=[])).push(...additions);
        if(!state.flushHeld){state.flushHeld=()=>{const held=(state.heldMarkers||[]).filter(m=>state.markers.get(m.kamptrailId)===m);state.heldMarkers=[];if(held.length)state.clusterGroup.addLayers?state.clusterGroup.addLayers(held):held.forEach(m=>state.clusterGroup.addLayer(m));};state.map.on('popupclose',()=>setTimeout(()=>{if(!state.map._popup?.isOpen?.())state.flushHeld();},0));}}
    } else if(additions.length&&(state.chunking=true))state.clusterGroup.addLayers?state.clusterGroup.addLayers(additions):additions.forEach(m=>state.clusterGroup.addLayer(m));
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
  // Visual centers where a bounding-box center falls in water or far from most of the state.
  const BUBBLE_ANCHOR={AK:[64.2,-152.5],FL:[28.4,-81.7],MI:[43.8,-84.7],HI:[20.6,-156.9],LA:[31.0,-92.3],MA:[42.35,-71.9],MD:[39.3,-76.9],ME:[45.3,-69.2],NY:[42.9,-75.3],VA:[37.6,-78.6],ID:[44.2,-114.6],MN:[46.2,-94.4],TX:[31.3,-99.3]};
  function bubbleIcon(size,n,dx=0,dy=0){
    return L.divIcon({className:'kt-state-bubble',html:`<span style="width:${size}px;height:${size}px${size<32?';font-size:10px':''}">${short(n)}</span>`,iconSize:[size,size],iconAnchor:[size/2-dx,size/2-dy]});
  }
  function buildOverview() {
    const group=L.layerGroup();group.items=[];
    for(const [code,n] of Object.entries(stateTotals())){
      if(!n)continue;const b=STATE_BOUNDS[code];
      const size=n>=5000?46:n>=1000?40:34;
      const ll=BUBBLE_ANCHOR[code]||[(b.s+b.n)/2,(b.w+b.e)/2];
      const m=L.marker(ll,{icon:bubbleIcon(size,n),title:`${code}: about ${n.toLocaleString('en-US')} source listings. Select to zoom in.`,keyboard:true,zIndexOffset:n});
      m.on('click',()=>{state.map.fitBounds([[b.s,b.w],[b.n,b.e]],{maxZoom:9});if(state.map.getZoom()<DETAIL_ZOOM)state.map.setView([(b.s+b.n)/2,(b.w+b.e)/2],DETAIL_ZOOM);});
      group.addLayer(m);group.items.push({code,n,base:size,size,ll,marker:m,line:null,dx:0,dy:0});
    }
    return group;
  }
  // Small eastern states overlap at national zoom. Larger totals keep their place, and each smaller
  // bubble moves to the nearest free spot, preferring east and south (open water), with a leader line.
  const BUBBLE_DIRECTIONS=[0,30,-30,60,90,-60,120,150,180,-90,-120,-150].map(d=>d*Math.PI/180);
  function layoutOverview() {
    const g=state.overview;if(!g||!g.items||!state.map||!state.map.hasLayer(g))return;
    const placed=[],scale=state.map.getZoom()<=4?0.72:1;
    for(const it of [...g.items].sort((a,b)=>b.n-a.n)){
      const size=Math.round(it.base*scale),resized=size!==it.size;it.size=size;
      const p=state.map.latLngToLayerPoint(it.ll);
      const free=(x,y)=>placed.every(q=>Math.hypot(q.x-x,q.y-y)>=(q.r+it.size/2+3));
      let dx=0,dy=0;
      if(!free(p.x,p.y)){
        let found=false;
        for(let ring=1;ring<=6&&!found;ring++){
          const dist=ring*it.size*0.75;
          for(const a of BUBBLE_DIRECTIONS){const x=p.x+Math.cos(a)*dist,y=p.y+Math.sin(a)*dist;if(free(x,y)){dx=Math.round(x-p.x);dy=Math.round(y-p.y);found=true;break;}}
        }
      }
      placed.push({x:p.x+dx,y:p.y+dy,r:it.size/2});
      if(resized||dx!==it.dx||dy!==it.dy){it.dx=dx;it.dy=dy;it.marker.setIcon(bubbleIcon(it.size,it.n,dx,dy));}
      if(dx||dy){const end=state.map.layerPointToLatLng([p.x+dx,p.y+dy]);if(it.line)it.line.setLatLngs([it.ll,end]);else it.line=L.polyline([it.ll,end],{className:'kt-state-leader',interactive:false,weight:1.5,color:'#24613f',opacity:.8});if(!g.hasLayer(it.line))g.addLayer(it.line);}
      else if(it.line&&g.hasLayer(it.line))g.removeLayer(it.line);
    }
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
      if(!state.map.hasLayer(state.overview)){state.map.addLayer(state.overview);layoutOverview();}
    }
  }
  function requestForecast(force=false){
    if(detailVisible()&&window.KampTrailForecast?.active(api.getCurrentFilters()))return window.KampTrailForecast.ensureStates(getVisibleStates(),{force});
    return Promise.resolve();
  }
  function onView() {
    syncMode();
    if(detailVisible()){requestForecast();return loadBatch(getVisibleStates(),false);}
    notify();return Promise.resolve(api.getLoadStatus());
  }
  const api=window.KampTrailData={
    version:'2.16.0',
    DETAIL_ZOOM,
    _overviewMoved:()=>(state.overview?.items||[]).filter(i=>i.dx||i.dy).map(i=>({code:i.code,dx:i.dx,dy:i.dy,leader:!!i.line&&state.overview.hasLayer(i.line)})),
    async init(map,config={}){
      window.addEventListener?.('kamptrail:discoveryupdated',()=>updateMarkers());
      window.addEventListener?.('kamptrail:forecastupdated',()=>{updateMarkers();requestForecast();});
      state.map=map;state.config=config;
      state.clusterGroup=L.markerClusterGroup({maxClusterRadius:50,spiderfyOnMaxZoom:true,showCoverageOnHover:false,chunkedLoading:true,chunkProgress:(done,total)=>{state.chunking=done<total;}});
      let timer;
      map.on('zoomend',layoutOverview);
      map.on('moveend',()=>{syncMode();clearTimeout(timer);timer=setTimeout(onView,250);});
      // Optional evidence must not delay the map when its request is slow or unavailable.
      loadAmenityDetails().then(()=>{
        if(state.amenityDetails)state.allCampsites.forEach(f=>DataQuality.attachRIDBAmenities(f,state.amenityDetails));
        updateMarkers();
      });
      await Promise.all([loadIndex(),loadSiteDetails(),loadAgencyIndex()]);
      if(state.overview&&map.hasLayer(state.overview))map.removeLayer(state.overview);state.overview=null;
      await onView();
    },
    loadSearchIndex(force=false){
      if(force)state.searchIndexPromise=null;
      if(!state.searchIndexPromise)state.searchIndexPromise=fetchJSON('data/campsites/search-index.json').then(d=>{if(d.version!==1||!Array.isArray(d.sites))throw new Error('Search index unavailable');return d;}).catch(e=>{state.searchIndexPromise=null;throw e;});
      return state.searchIndexPromise;
    },
    getDefaultFilters:defaults,
    getCurrentFilters:()=>window.kamptrailFilters || defaults(),
    updateFilters(filters){window.kamptrailFilters={...defaults(),...filters};updateMarkers();requestForecast();},
    getAllCampsites:()=>state.allCampsites,
    getCampsiteById(id){const key=String(id);return state.allCampsites.find(s=>s.properties.id===key||s.properties.legacy_ids?.includes(key));},
    getLoadedStates:()=>[...state.loadedStates],
    getVisibleStates,
    getStateBounds:()=>STATE_BOUNDS,
    getVisibleCampsites(filters=api.getCurrentFilters()){
      if(state.map&&!detailVisible())return [];
      const list=DataQuality.applyFilters(state.allCampsites,filters);
      if(!state.map)return list;
      const b=state.map.getBounds();return list.filter(f=>{const [lon,lat]=f.geometry.coordinates;return b.contains([lat,lon])||b.contains([lat,lon+360])||b.contains([lat,lon-360]);});
    },
    refreshForecast:()=>requestForecast(true),
    getForecastStatus(){const f=api.getCurrentFilters(),forecast=window.KampTrailForecast;return{...forecast?.status(),unknown:forecast?.active(f)?api.getVisibleCampsites({...f,forecastMinC:null,forecastMaxC:null}).filter(s=>!forecast.get(s,f.forecastHours)).length:0};},
    getElevationStatus(){const f=api.getCurrentFilters();return{loading:[...elevationStatus.values()].includes('loading'),saved:[...elevationStatus.values()].includes('saved'),unavailable:[...elevationStatus].filter(([,v])=>v==='unavailable').map(([k])=>k),unknown:DataQuality.elevationRange(f).active?api.getVisibleCampsites({...f,elevationMin:null,elevationMax:null}).filter(s=>!DataQuality.elevationInfo(s)).length:0};},
    getLoadStatus:()=>({loadedStates:[...state.loadedStates],loadingStates:[...state.loading.keys()],failedStates:[...state.failed].map(([code,f])=>({state:code,error:f.error})),totalSites:state.allCampsites.length,loading:state.loading.size>0,overview:!detailVisible(),catalogueTotal:Object.values(stateTotals()).reduce((a,b)=>a+b,0)}),
    loadStates:async codes=>{const result=await loadBatch(codes,true);if(detailVisible()&&window.KampTrailForecast?.active(api.getCurrentFilters()))await window.KampTrailForecast.ensureStates(codes);return result;},
    refresh:()=>detailVisible()?loadBatch(getVisibleStates(),true):Promise.resolve(api.getLoadStatus()),
    getStateTotals:stateTotals,
    focusCampsite(id,{preserveFilters=false}={}){
      const site=api.getCampsiteById(id);if(!site)return false;
      let marker=state.markers.get(site.properties.id);
      if(!marker && !preserveFilters && typeof window.KampTrailFilters?.reset==='function') {window.KampTrailFilters.reset();marker=state.markers.get(site.properties.id);}
      if(!marker) {window.showToast?.('This campsite is hidden by your filters. Reset Filters to view it on the map.','info',7000);return false;}
      const focusSeq=state.focusSeq=(state.focusSeq||0)+1;
      state.map.closePopup();
      // Open the popup against final map coordinates; a concurrent zoom reset can undo its autopan.
      const [lon,lat]=site.geometry.coordinates;state.map.setView([lat,lon],14,{animate:false});syncMode();
      // Chunked cluster loading can lag behind a focus request, so wait until the marker is placed.
      let tries=0;
      const attempt=()=>{
        if(focusSeq!==state.focusSeq)return;
        if(!state.clusterGroup.zoomToShowLayer){marker.openPopup();return;}
        // Wait for chunked cluster loading to finish. Later chunks re-cluster and would close the popup.
        if(!state.chunking&&(marker.__parent||state.map.hasLayer(marker))){
          const fallback=()=>{if(!marker.isPopupOpen?.()&&!state.map._popup?.isOpen?.())L.popup(popupOptions()).setLatLng([lat,lon]).setContent(popup(site)).openOn(state.map);};
          // A popup bound to the marker closes whenever markercluster re-clusters it (zoom animation,
          // later chunks, neighboring states loading), losing anything the camper opened in it.
          // A map-level popup at the campsite's point survives re-clustering.
          let opened=false;const show=()=>{if(opened||focusSeq!==state.focusSeq)return;opened=true;fallback();};
          state.clusterGroup.zoomToShowLayer(marker,()=>setTimeout(show,0));
          setTimeout(show,1500);
          return;
        }
        if(++tries<50){setTimeout(attempt,100);return;}
        L.popup(popupOptions()).setLatLng([lat,lon]).setContent(popup(site)).openOn(state.map);
      };
      attempt();
      return true;
    },
    addToTrip(id){const site=api.getCampsiteById(id);if(site)state.config.onTripAdd?.(site.properties.id);},
    toggleFavorite(id){state.config.onFavoriteToggle?.(id);},
    loadServices(lat,lng,options={}){
      const point=[lng,lat];
      return KampTrailServices.loadBounds(KampTrailServices.radiusBounds(point,30),options).then(result=>({...result,items:result.items.filter(item=>KampTrailServices.distance(point,item.coordinates)<=30)}));
    },
    nearestServices(items,lat,lng,selected=KampTrailServices.getCategories()){
      const best={};
      for(const item of items){if(!KampTrailServices.matches(item,selected))continue;const miles=KampTrailServices.distance([lng,lat],item.coordinates);if(miles>30)continue;for(const key of item.categories)if(selected.includes(key)&&(!best[key]||miles<best[key].miles))best[key]={item,miles};}
      return best;
    },
    renderNearbyServices(box,lat,lng,force=false){
      box._serviceAbort?.abort();const controller=new AbortController();box._serviceAbort=controller;
      box.dataset.ktNearbyServices='1';box._serviceLat=lat;box._serviceLng=lng;const selected=KampTrailServices.getCategories();
      box.textContent='Finding services within 30 miles (straight-line)…';box.setAttribute('aria-live','polite');
      return api.loadServices(lat,lng,{categories:selected,signal:controller.signal,force}).then(result=>{
        if(controller.signal.aborted)return;
        const best=api.nearestServices(result.items,lat,lng,selected);box.replaceChildren();
        const heading=document.createElement('h3');heading.textContent='Services within 30 miles (straight-line)';
        const list=document.createElement('ul');
        for(const key of selected){
          const label=KampTrailServices.categories[key].label,li=document.createElement('li'),match=best[key];
          if(!match){li.textContent=`${label}: ${result.partial?'unknown in missing areas; none in loaded coverage':'none in loaded source coverage'}`;list.append(li);continue;}
          const {item,miles}=match,[lng,lat]=item.coordinates;li.dataset.serviceId=item.id;
          const title=document.createElement('strong');title.textContent=`${label}: ${item.name||label}, about ${miles<10?miles.toFixed(1):Math.round(miles)} mi `;
          const evidence=document.createElement('p');evidence.className='kt-fine';evidence.textContent=KampTrailServices.describe(item,result.manifest);
          const directions=document.createElement('a');directions.href=`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;directions.target='_blank';directions.rel='noopener noreferrer';directions.textContent='Directions';
          const osm=document.createElement('a');osm.href=`https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}`;osm.target='_blank';osm.rel='noopener noreferrer';osm.textContent='View on OSM';
          const save=document.createElement('button');save.type='button';save.textContent='Save service stop';save.onclick=()=>window.KampTrailTrip?.addStop(item.id,KampTrailServices.feature(item,result.manifest));
          const permission=document.createElement('button');permission.type='button';permission.textContent='Overnight permission';permission.onclick=()=>window.KampTrailPermissions?.open({kind:'service',id:item.id,name:item.name,coordinates:item.coordinates});
          li.append(title,evidence,directions,' · ',osm,' ',save,' ',permission);list.append(li);
        }
        const note=document.createElement('p');note.className='kt-fine';note.textContent=result.message;
        const attribution=document.createElement('a');attribution.href='https://www.openstreetmap.org/copyright';attribution.textContent='Derived from OpenStreetMap contributors (ODbL)';attribution.target='_blank';attribution.rel='noopener noreferrer';
        const retry=document.createElement('button');retry.type='button';retry.textContent='Retry nearby service areas';retry.onclick=()=>api.renderNearbyServices(box,lat,lng,true);
        box.append(heading,list,note,attribution,retry);window.KampTrailSpot?.relayout(box);return result;
      }).catch(error=>{if(error.name==='AbortError'||controller.signal.aborted)return;box.textContent='Service coverage unavailable. Missing areas are unknown. ';const retry=document.createElement('button');retry.type='button';retry.textContent='Retry nearby service areas';retry.onclick=()=>api.renderNearbyServices(box,lat,lng,true);box.append(retry);});
    },

  };
  // One document-level subscription refreshes only attached nearby panels; removed popups retain no listeners.
  window.addEventListener?.('kamptrail:servicescategories',()=>{
    for(const box of document.querySelectorAll('[data-kt-nearby-services]'))api.renderNearbyServices(box,box._serviceLat,box._serviceLng);
  });
  document.addEventListener('click',event=>{
    const action=event.target.closest('[data-kt-action]');
    if(action){
      const id=action.dataset.siteid,kind=action.dataset.ktAction;
      if(kind==='trip'){api.addToTrip(id);return;}
      const site=api.getCampsiteById(id);if(!site)return;
      const [lng,lat]=site.geometry.coordinates;
      if(kind==='alerts'){window.KampTrailEnvironment?.openAlerts(lat,lng);return;}
      if(kind==='environment'){window.KampTrailEnvironment?.showNear(lat,lng);return;}
      if(kind==='roads'){window.KampTrailMVUM?.showNear(lat,lng);return;}
      if(kind==='permissions'){window.KampTrailPermissions?.open({kind:'campsite',id:String(site.properties.id),name:site.properties.name,coordinates:[lng,lat]});return;}
      if(kind==='reviews'){window.KampTrailCommunity?.open(site);return;}
      if(kind==='share'){window.KampTrailShare?.share({site:site.properties.id},site.properties.name);return;}
      if(kind==='fix'){if(window.KampTrailContrib)KampTrailContrib.open({kind:'correction',site});else if(window.KampTrailShare)window.open(KampTrailShare.issueUrl('fix',site),'_blank','noopener');return;}
      const extra=action.closest('.kt-site-popup')?.querySelector('.kt-popup-extra');if(!extra)return;
      const box=document.createElement('div');extra.append(box);action.disabled=true;
      if(kind==='fees')window.KampTrailSpot?.renderFeeEvidence(box,site.properties);
      else if(kind==='weather')window.KampTrailSpot?.renderForecast(box,lat,lng);
      else if(kind==='land')window.KampTrailSpot?.renderLand(box,lat,lng);
      else if(kind==='nearby')api.renderNearbyServices(box,lat,lng);
      return;
    }

  });
})();
