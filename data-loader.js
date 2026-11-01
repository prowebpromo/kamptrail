/* Campsite loading, source normalization, map markers, and recovery. */
(function () {
  'use strict';
  const t = (key, params) => (typeof window !== 'undefined' ? window.KampTrailI18n : globalThis.KampTrailI18n)?.t(key, params) ?? String(key).replace(/\{([a-zA-Z0-9_]+)\}/g, (token, name) => Object.hasOwn(params || {}, name) ? String(params[name]) : token);
  const uiLabel = (kind,value) => (typeof window !== 'undefined' ? window.KampTrailI18n : globalThis.KampTrailI18n)?.label(kind,value) ?? value;
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
      const kinds={'data/campsites/index.json':'index','data/campsites/agency/index.json':'agencyIndex','data/campsites/ridb-sites.json':'sites','data/campsites/ridb-amenities.json':'amenityEvidence','data/campsites/usfs-site-amenities.json':'usfsSiteEvidence','data/campsites/search-index.json':'search'};
      if (!relative.endsWith('.geojson') && !kinds[relative]) return null;
      return {name:`kamptrail:${scope.href}:data-v1`, url:target.href, index:kinds[relative]==='index', kind:kinds[relative]||'geojson'};
    } catch { return null; }
  }
  function validDataset(data, target) {
    if (target?.index) return Array.isArray(data?.states) && Number.isFinite(data.total_sites) && data.total_sites >= 0;
    if (target?.kind === 'agencyIndex') return data?.version === 1 && Array.isArray(data.states);
    if (target?.kind === 'sites') return [1, 2].includes(data?.version) && !!data.facilities && typeof data.facilities === 'object';
    if (target?.kind === 'amenityEvidence') return DataQuality.validRIDBAmenities(data);
    if (target?.kind === 'usfsSiteEvidence') return DataQuality.validUSFSSiteAmenities(data);
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
    const options={state:stateCode,...(state.siteDetails?{siteDetails:state.siteDetails}:{}),...(state.amenityDetails?{amenityDetails:state.amenityDetails}:{})};
    // Members of unclassified hosts stay withheld across loaded states (an element can be a member in one state and a row in another).
    state.withheldMembers=new Set([...(state.withheldMembers||[]),...DataQuality.withheldMembers(features,options)]);options.withheldMembers=state.withheldMembers;
    const incoming=DataQuality.publicationCandidates(features,options).map(raw=>DataQuality.normalizeFeature(raw,options));
    incoming.forEach(f=>{f.properties.forecastStates=[stateCode];});
    if(state.siteDetails)incoming.forEach(f=>DataQuality.attachSiteDetails(f,state.siteDetails));
    if(state.amenityDetails)incoming.forEach(f=>DataQuality.attachRIDBAmenities(f,state.amenityDetails));
    if(state.usfsDetails)incoming.forEach(f=>DataQuality.attachUSFSSiteAmenities(f,state.usfsDetails));
    const cleaned=DataQuality.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:[...state.allCampsites,...incoming]}, options);
    state.allCampsites=cleaned.features;
    if(state.siteDetails)state.allCampsites.forEach(f=>DataQuality.attachSiteDetails(f,state.siteDetails));
    if(state.amenityDetails)state.allCampsites.forEach(f=>DataQuality.attachRIDBAmenities(f,state.amenityDetails));
    if(state.usfsDetails)state.allCampsites.forEach(f=>DataQuality.attachUSFSSiteAmenities(f,state.usfsDetails));
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
  async function loadUSFSSiteDetails(){
    try{
      const data=await fetchJSON('data/campsites/usfs-site-amenities.json');
      if(!DataQuality.validUSFSSiteAmenities(data))throw new Error('Invalid Forest Service site evidence');
      state.usfsDetails=data;
    }catch(err){console.warn('Forest Service site evidence unavailable; listings still load.',err.message);}
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
        await state.amenityReady;
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
    if(p.fee_status==='free')return t('Free (source reported)');
    if(p.fee_status==='conditional')return t("Free with conditions (see wording)");
    if(p.fee_status==='paid')return p.cost===null?t('Paid · amount not verified'):t('${amount}/night (source reported)',{amount:p.cost});
    return t("Fee not verified");
  }
  // Cell coverage: dated camper signal reports beside a link to the FCC public map. No carrier prediction.
  const FCC_MAP='https://broadbandmap.fcc.gov/home';
  function signalReports(p){
    const d=window.KampTrailDiscovery,s=d?.summary(p);if(!s||!d.CARRIERS||!d.SIGNAL)return [];
    const rows=[];
    for(const g of s.observations||[])for(const x of g.values?.signals||[]){
      if(!d.CARRIERS[x.carrier]||!d.SIGNAL[x.signal])continue;
      rows.push({carrier:d.CARRIERS[x.carrier],signal:d.SIGNAL[x.signal],setting:(d.ENVIRONMENTS||{})[x.environment]||'',radio:(x.radio==='lte'||x.radio==='5g')&&d.RADIOS?d.RADIOS[x.radio]:'',visit:g.latest_visit,count:g.count});
    }
    return rows.sort((a,b)=>b.visit.localeCompare(a.visit)||a.carrier.localeCompare(b.carrier));
  }
  function coverageHTML(p,lat,lng,siteId){
    const rows=signalReports(p).slice(0,6);
    const list=rows.length?`<ul class="kt-signal-list">${rows.map(r=>`<li>${esc(r.carrier)}: ${esc(r.signal)}${r.radio?` · ${esc(r.radio)}`:''}${r.setting?` (${esc(r.setting)})`:''} · ${esc(t("visit {date}",{date:r.visit}))} · ${esc(t(r.count===1?"{count} report":"{count} reports",{count:r.count}))}</li>`).join('')}</ul>`:`<p class="kt-fine">${t("No camper signal reports yet.")}</p>`;
    return `<div class="kt-coverage"><strong>${t("Cell coverage:")}</strong>
      <p class="kt-fine">${t("Camper signal reports are what visitors experienced on the visit date, not a prediction.")}</p>${list}
      <p><a href="${FCC_MAP}" target="_blank" rel="noopener noreferrer">${t("Check carrier coverage (FCC map)")}</a>
      <button type="button" class="kt-linkbtn" data-kt-action="copycoords" data-siteid="${siteId}">${t("Copy coordinates")}</button>
      <span class="kt-copy-status" role="status" aria-live="polite"></span></p>
      <p class="kt-fine">${t("On the FCC map, choose Mobile Broadband and search near {coords}. It shows coverage modeled by each carrier, not a guarantee of service.",{coords:`${lat.toFixed(5)}, ${lng.toFixed(5)}`})}</p></div>`;
  }
  function rvText(p) {
    if(!p.site_count)return '';
    const parts=[];
    const rig=+(window.kamptrailFilters?.rigLength||0);
    if(p.rv_sites)parts.push(t("{0} of {1} sites allow RVs or trailers", {"0":(p.rv_sites),"1":(p.site_count)}));
    else parts.push(t("{0} sites listed, none list RV or trailer use", {"0":(p.site_count)}));
    if(p.rv_max_length)parts.push(t("longest reported {0} ft", {"0":(p.rv_max_length)}));
    const hooks=(window.kamptrailFilters?.hookups)||[];
    if(rig>0||hooks.length){const n=DataQuality.matchingSites(p,rig,hooks,false);parts.push(t("{0} {1} {2} on the same site", {"0":(n),"1":(n===1?t("site lists"):t("sites list")),"2":([rig>0?t('{0} ft or more',{'0':rig}):'',hooks.length?t('{types} hookups',{types:hooks.map(value=>uiLabel('hookup',value)).join(' + ')}):''].filter(Boolean).join(t(" with ")))}));}
    const h=p.hookups||{},hk=[['electric','electric'],['water','water'],['sewer','sewer']].filter(([k])=>h[k]>0).map(([k,l])=>t("{0} at {1}", {"0":(uiLabel('hookup',l)),"1":(h[k])}));
    return `<div><strong>${t("RV sites (Recreation.gov):")}</strong> ${esc(parts.join(' · '))}</div>${hk.length?`<div><strong>${t("Hookups reported:")}</strong> ${esc(hk.join(', '))}${t(' sites')}</div>`:''}`;
  }
  function ridbAmenitiesText(p){
    const data=p.ridb_amenity_evidence;
    if(!DataQuality.validRIDBAmenities(data))return DataQuality.ridbFacilityIds(p).length?'<div class="kt-fine">'+esc(t('Recreation.gov campsite amenity evidence unavailable.'))+'</div>':'';
    const labels={toilet:t("Toilets"),drinking_water:t("Drinking water"),shower:t("Showers"),dump:t("Dump station"),picnic_table:t("Picnic tables"),fire_fixture:t("Fire pits or rings"),grill:t("Grills"),trash_collection:t("Trash collection"),food_locker:t("Food lockers"),tent_pad:t("Tent pads"),grill_or_fire_ring:t("Grill or fire ring (source field: “Grills/Fire Ring”)")};
    const qualifiers={seasonal:t("seasonal"),peak_season:t("peak season"),coin:t("coin operated"),hand_pump:t("hand pump"),accessible:t("accessible feature"),outdoor:t("outdoor")};
    const groups=Object.values(data.facilities).map(r=>r.amenities),notes=[t("Counts describe records, not fixtures or every campsite. Missing fields and current availability are unknown.")];
    if(groups.some(g=>g.fire_fixture?.reported||g.grill_or_fire_ring?.reported))notes.push(t("A fire fixture does not establish permission to have a fire."));
    if(groups.some(g=>g.grill_or_fire_ring?.reported))notes.push(t("Quoted field name is in the original source language; it does not establish both features."));
    if(groups.some(g=>g.drinking_water?.reported))notes.push(t("Drinking water does not establish RV filling access."));
    if(groups.some(g=>g.dump?.reported))notes.push(t("Dump access and prices are unknown."));
    if(groups.some(g=>g.shower?.qualifiers.coin))notes.push(t("Coin qualifiers concern showers only."));
    const facilities=Object.entries(data.facilities).map(([fid,rec])=>{
      const rows=Object.entries(rec.amenities).map(([key,g])=>{
        const parts=[];
        if(g.reported)parts.push(t('mentioned in {count} of {total} records',{count:g.reported,total:rec.sites}));
        for(const [q,n] of Object.entries(g.qualifiers))parts.push(t('{qualifier}: {count} records',{qualifier:qualifiers[q],count:n}));
        if(g.negative)parts.push(t('explicit no: {count} records',{count:g.negative}));
        if(g.unknown)parts.push(t('blank or unrecognized: {count} records',{count:g.unknown}));
        if(g.conflict)parts.push(t('conflicting values: {count} records',{count:g.conflict}));
        return `<li>${esc(labels[key])}: ${esc(parts.join('; '))}</li>`;
      });
      return `<p><a href="https://www.recreation.gov/camping/campgrounds/${encodeURIComponent(fid)}" target="_blank" rel="noopener noreferrer">${esc(t('Recreation.gov facility {id}',{id:fid}))}</a></p>${rows.length?`<ul>${rows.join('')}</ul>`:`<p>${rec.sites?t("No mapped amenity claims in these overnight campsite records."):t("No overnight campsite records in this snapshot.")}</p>`}`;
    }).join('');
    return `<details class="kt-ridb-amenities"><summary>${esc(t('Recreation.gov campsite records report…'))}</summary>${facilities}<p class="kt-fine">${esc(notes.join(' '))}</p><p class="kt-fine">${data.source.original_retrieved_at?esc(t('Export retrieved {date}.',{date:data.source.original_retrieved_at.slice(0,10)})):esc(t('Saved export: retrieval date unknown.'))} ${esc(t('Amenity update dates unknown. Inspected {date}; inspection is not an update date.',{date:data.source.inspected_at.slice(0,10)}))} <a href="${DataQuality.RIDB_AMENITY_URL}" target="_blank" rel="noopener noreferrer">${esc(t('Public source export'))}</a></p></details>`;
  }
  // Forest Service Recreation Site statements for an exactly matched Recreation.gov ID. Separate from ridbAmenitiesText.
  function usfsSiteText(p){
    const data=p.usfs_site_evidence;
    if(!DataQuality.validUSFSSiteAmenities(data))return '';
    const labels={
      water:{drinking_water:t("Drinking water stated"),no_drinking_water:t("Not for drinking, per the text"),no_water:t("Text says no water")},
      toilet:{flush:t("Flush toilets stated"),vault_or_pit:t("Vault, pit or similar toilets stated"),no_toilet:t("Text says no toilets"),nearby_only:t("Restrooms stated as nearby only")}
    };
    const qualifiers={hand_pump:t("hand pump"),seasonal:t("seasonal"),accessible:t("accessible feature")};
    const heads={water:t("Water (Forest Service text):"),toilet:t("Restrooms (Forest Service text):")};
    const entries=Object.entries(data.facilities),separate=DataQuality.validRIDBAmenities(p.ridb_amenity_evidence);
    const facilities=entries.map(([fid,facility])=>{
      const records=facility.records.map(r=>{
        const lines=['water','toilet'].filter(field=>r[field]).map(field=>{
          const item=r[field],known=item.class!=='unknown'&&labels[field][item.class];
          const note=facility.conflicts.includes(field)?t("No normalized label: Forest Service records for this ID disagree."):known?t("Normalized: {label}",{label:[labels[field][item.class],...(item.qualifiers||[]).map(q=>qualifiers[q])].join(', ')}):t("No normalized label: the wording is ambiguous.");
          return `<li><strong>${esc(heads[field])}</strong> <span class="kt-usfs-text">“${esc(item.text)}”</span><br><span class="kt-muted">${esc(note)}</span></li>`;
        });
        const season=r.season?[r.season.open_season?t("Open season: {value}",{value:r.season.open_season}):'',r.season.description?t("Season description: {value}",{value:r.season.description}):''].filter(Boolean):[];
        const credit=r.updated?t("Source: USDA Forest Service Recreation Site record, updated {date}.",{date:r.updated}):t("Source: USDA Forest Service Recreation Site record, update date unknown.");
        return `<p><strong>${esc(r.name||t("Forest Service site record"))}</strong>${r.type?` <span class="kt-muted">(${esc(r.type)})</span>`:''}</p><ul>${lines.join('')}</ul>${season.length?`<p class="kt-fine">${esc(t("Season text on this record (context only, not about water or restrooms):"))} ${esc(season.join('; '))}</p>`:''}<p class="kt-fine">${esc(credit)}</p>`;
      }).join('');
      return `${entries.length>1?`<p><a href="https://www.recreation.gov/camping/campgrounds/${encodeURIComponent(fid)}" target="_blank" rel="noopener noreferrer">${esc(t('Recreation.gov facility {id}',{id:fid}))}</a></p>`:''}${records}`;
    }).join('');
    return `<details class="kt-usfs-site"><summary>${esc(t("Forest Service site record says…"))}</summary>${facilities}<p class="kt-fine">${esc(t("Free text written by the Forest Service and matched by Recreation.gov facility ID.")+(separate?" "+t("Kept separate from the Recreation.gov records above."):"")+" "+t("Blank or ambiguous wording is unknown, never a statement of absence. Not current availability."))}</p><p class="kt-fine">${esc(t("Data retrieved {date}. CC BY 4.0.",{date:data.source.retrieved}))} <a href="${DataQuality.USFS_SITE_URL}" target="_blank" rel="noopener noreferrer">${esc(t("Forest Service source layer"))}</a></p></details>`;
  }
  // R8 (2.31.0): the amenity evidence the filters use, with source, scope and date for every statement.
  // Amenity filters match only what this block shows, at the scope it states.
  function osmRef(id){const m=String(id||'').match(/^osm:(node|way|relation|unknown):([^:]+)/);return m?`${m[1]}/${m[2]}`:String(id||'');}
  function osmLink(id,text){const m=String(id||'').match(/^osm:(node|way|relation):([0-9]+)$/);return m?`<a href="https://www.openstreetmap.org/${m[1]}/${m[2]}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`:esc(text);}
  const day=d=>typeof d==='string'&&/^\d{4}-\d\d-\d\d/.test(d)?d.slice(0,10):null;
  function amenityEvidenceText(p){
    const e=DataQuality.amenityEvidence(p),rig=DataQuality.campsiteRigActive(window.kamptrailFilters);
    const labels={toilet:t("Toilets"),water:t("Drinking water"),dump:t("Dump station"),shower:t("Showers")};
    const status={present:t("reported"),absent:t("source says no"),conflict:t("sources disagree"),unrecognized:t("value not recognized"),unknown:t("unknown")};
    const when=r=>{const d=day(r.date);if(!d)return t("date unknown");return r.source==='osm'?t("survey date {date}",{date:d}):r.source==='usfs'?t("updated {date}",{date:d}):d;};
    const who=r=>r.source==='osm'?osmLink(r.record,t("OpenStreetMap element {ref}",{ref:osmRef(r.record)})):r.source==='ridb'?esc(t('Recreation.gov facility {id}',{id:r.record.slice(5)})):r.source==='usfs'?esc(r.name?t("Forest Service site record: {name}",{name:r.name}):t("Forest Service site record")):esc(t("{source} listing record",{source:r.label||r.record}));
    const scope=r=>r.scope==='element'?t("whole mapped element"):r.scope==='listing_record'?t("this listing's own record"):r.scope==='site_record'?t("site record"):r.scope==='other_site_record'?t("different site ({type}), not this campground",{type:r.type||t("type unknown")}):t("{count} of {total} campsite records, not every site",{count:r.count,total:r.total});
    const part=r=>`${who(r)} <span class="kt-muted">(${esc(scope(r))}${r.value!=null&&r.source!=='ridb'?` · ${esc(t("value “{value}”",{value:String(r.value).slice(0,120)}))}`:''} · ${esc(when(r))})</span>`;
    const rows=DataQuality.FILTER_AMENITIES.map(a=>{
      const x=e.amenities[a],refs=[...x.positive,...x.negative,...x.conflict,...(x.status==='unrecognized'?x.other:[]),...x.elsewhere];
      return `<li data-amenity="${a}" data-status="${x.status}"><strong>${esc(labels[a])}:</strong> ${esc(status[x.status])}${refs.length?`: ${refs.map(part).join('; ')}`:''}</li>`;
    }).join('');
    const osm=e.sources.find(s=>s.source==='osm');
    const osmBlock=osm?`<p class="kt-fine kt-osm-amenities">${osmLink(osm.record,t("OpenStreetMap element {ref}",{ref:osmRef(osm.record)}))}: <span class="kt-usfs-text">${esc(Object.entries(osm.tags).map(([k,v])=>`${k}=${v}`).join(', '))}</span>. ${esc(t("Survey: {date}.",{date:day(osm.date)||t("date unknown")}))} ${esc(t("Retrieved: {date}.",{date:day(osm.retrieved)||t("date unknown")}))} ${esc(t("Tags describe this mapped element only. A retrieval date is not a survey date."))}</p>`:'';
    const members=e.members.length?`<details class="kt-amenity-members"><summary>${esc(t("Merged elements, not used for this listing ({count})",{count:e.members.length}))}</summary><ul>${e.members.map(m=>`<li data-member="${esc(m.source_record_id)}">${/^osm:/.test(m.source_record_id)?osmLink(m.source_record_id,t("OpenStreetMap element {ref}",{ref:osmRef(m.source_record_id)})):esc(t("{source} listing record",{source:m.source||m.source_record_id}))}: <span class="kt-usfs-text">${esc(Object.entries(m.fields).map(([k,v])=>`${k}=${v}`).join(', '))}</span> <span class="kt-muted">(${esc(t("Survey: {date}.",{date:day(m.observed_at)||t("date unknown")}))} ${esc(t("Retrieved: {date}.",{date:day(m.retrieved_at)||t("date unknown")}))})</span></li>`).join('')}</ul><p class="kt-fine">${esc(t("These observations belong to other records merged into this listing, such as a single site or a duplicate outline. They are not used for this listing's amenities or filters."))}</p></details>`:'';
    const rigNote=rig&&DataQuality.FILTER_AMENITIES.some(a=>e.amenities[a].positive.some(r=>r.scope==='campsite_records'))?`<p class="kt-fine">${esc(t("A campsite length or hookup filter is on. Recreation.gov campsite-record amenities do not count toward amenity filters then, because they are not linked to the campsite that fits."))}</p>`:'';
    if(e.state==='no_source')return `<div class="kt-amenity-evidence" data-state="no_source"><strong>${t("Amenity evidence:")}</strong> ${esc(t("No amenity source for this listing."))}${members}</div>`;
    return `<div class="kt-amenity-evidence" data-state="evidence"><strong>${t("Amenity evidence:")}</strong><ul>${rows}</ul>${osmBlock}<p class="kt-fine">${esc(t("Amenity filters match only the evidence listed here, at its stated scope. Unknown is not absence."))}</p>${rigNote}${members}</div>`;
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
    return `<div class="kt-site-popup" tabindex="0" role="region" aria-label="${esc(t('Campsite details'))}" style="min-width:${Math.min(220,layout.width)}px;max-width:${layout.width}px;max-height:${layout.height}px;color:#263443">
      <h2 style="margin:0 0 8px;font-size:15px">${esc(p.name)}</h2>
      ${closure?`<div class="kt-closure-notice"><strong>${t("Agency reports:")} ${esc(closure)}.</strong> ${t("Confirm reopening with the operator.")}${p.season?t(" Season reported: {0}.", {"0":(esc(p.season))}):''}</div>`:''}
      <div><strong>${t("Cost:")}</strong> ${esc(costText(p))}${p.fee_evidence?` <span class="kt-muted">(${esc(p.fee_evidence)})</span>`:''}</div>
      ${p.fee_text?`<div class="kt-fee-evidence"><span class="kt-muted">${esc(p.fee_source||t("Source"))}${p.fee_checked?t(", imported {0}", {"0":(esc(p.fee_checked))}):''}:</span> “${esc(p.fee_text.length>220?p.fee_text.slice(0,217)+'…':p.fee_text)}”</div>`:''}
      ${p.fee_status==='free'||p.fee_status==='conditional'?`<div class="kt-fine">${t("This is the camping fee only. Entrance fees, passes, permits, or reservation charges may still apply.")}</div>`:''}
      ${p.fee_conflict?`<div class="kt-fine">${t("Sources disagree on the fee, so it shows as unknown.")}</div>`:''}
      ${p.open_status&&status!=='none'&&!closure?`<div><strong>${t("Status (agency):")}</strong> ${esc(p.open_status)}${p.season?t(" · season {0}", {"0":(esc(p.season))}):''}</div>`:''}
      ${p.restrictions?`<div><strong>${t("Restrictions:")}</strong> ${esc(p.restrictions.length>180?p.restrictions.slice(0,177)+'…':p.restrictions)}</div>`:''}
      ${p.stay_limit?`<div><strong>${t("Stay limit:")}</strong> ${esc(p.stay_limit)}</div>`:''}
      ${p.reservable?`<div class="kt-fine">${t("Reservable on Recreation.gov. Reservation charges may apply. That alone does not show the camping fee.")}</div>`:''}
      <div><strong>${t("Type:")}</strong> ${esc(uiLabel('type',p.type))}</div>
      <div><strong>GPS:</strong> <span class="kt-coordinates">${lat.toFixed(5)}, ${lng.toFixed(5)}</span></div>
      ${window.KampTrailForecast?.active(window.kamptrailFilters)?`<p class="kt-forecast-evidence kt-fine">${esc(window.KampTrailForecast.describe(site,window.kamptrailFilters))}</p>`:''}
      <div class="kt-elevation-evidence">${esc(DataQuality.elevationText(site,window.kamptrailFilters?.elevationUnit||'ft'))}</div>
      ${DataQuality.elevationInfo(site)?`<p class="kt-fine">${t("Interpolated terrain from ")}<a href="${DataQuality.ELEVATION_SOURCE}" target="_blank" rel="noopener noreferrer">USGS 3DEP</a>${t(". Retrieval date is not acquisition date. Source grid resolution does not guarantee point accuracy, road grade or RV clearance.")}</p>`:''}
      <div><strong>${t("Access reported:")}</strong> ${esc(p.access_label || p.access || t("Not verified"))}</div>
      ${amenityEvidenceText(p)}
      ${ridbAmenitiesText(p)}
      ${usfsSiteText(p)}
      <!-- Bundled road_difficulty holds surface labels with no attributable source, so it is not shown. Approach difficulty comes only from dated visitor reports. -->
      ${p.rig_friendly.length?`<div><strong>${t("Rig types reported:")}</strong> ${p.rig_friendly.map(value=>esc(uiLabel('rig',value))).join(', ')}</div>`:''}
      ${rvText(p)}
      ${window.KampTrailDiscovery?.summary(p)?`<div><strong>${t("Community rating:")}</strong> ${esc(t("{0}/5 · {1} published {2} · latest visit {3}",{'0':(window.KampTrailDiscovery.summary(p).rating_sum/window.KampTrailDiscovery.summary(p).rating_count).toFixed(1),'1':window.KampTrailDiscovery.summary(p).rating_count,'2':t(window.KampTrailDiscovery.summary(p).rating_count===1?'review':'reviews'),'3':window.KampTrailDiscovery.summary(p).latest_visit}))}</div>`:''}
      <details class="kt-seasonal-scores"><summary>${t("Seasonal visit sub-ratings")}</summary><p class="kt-seasonal-values">${esc(window.KampTrailDiscovery?.summary(p)?window.KampTrailDiscovery.seasonalText(window.KampTrailDiscovery.seasonalScores(window.KampTrailDiscovery.summary(p).observations)):t("Open Reviews and photos to load published numeric sub-ratings."))}</p><p class="kt-fine">${t("Subjective 1–5 scores; at least 3 explicit ratings per aspect and season for an average. US calendar seasons combine years. Not current conditions or safety guarantees.")}</p></details>
      ${p.rating!==null?`<div><strong>${t("Source rating:")}</strong> ${p.rating}/5${p.reviews_count?` (${p.reviews_count}${t(' reviews')})`:''}</div>`:''}
      <p style="font-size:11px;line-height:1.4">${t("Confirm current fees, access, and camping rules with the operator before traveling.")}${p.attributes_unverified?t(" Legacy inferred fees and amenities are hidden."):''}</p>
      ${sourceURL?`<p><a href="${esc(sourceURL)}" target="_blank" rel="noopener noreferrer">${t("Check source / operator")}</a></p>`:''}
      ${coverageHTML(p,lat,lng,siteId)}
      <div class="kt-popup-actions">
        <button type="button" data-kt-action="trip" data-siteid="${siteId}">${t("Save stop")}</button>
        <a href="https://www.google.com/maps/dir/?api=1&amp;destination=${lat},${lng}" target="_blank" rel="noopener noreferrer">${t("Directions")}</a>
        <button type="button" data-kt-action="share" data-siteid="${siteId}">${t("Share")}</button>
      </div>
      <div class="kt-popup-actions kt-popup-more">
        <button type="button" data-kt-action="permissions" data-siteid="${siteId}">${t("Overnight permission")}</button>
        <button type="button" data-kt-action="fees" data-siteid="${siteId}">${t("Fee evidence")}</button>
        <button type="button" data-kt-action="weather" data-siteid="${siteId}">${t("Forecast + elevation")}</button>
        <button type="button" data-kt-action="alerts" data-siteid="${siteId}">${t("Weather alerts")}</button>
        <button type="button" data-kt-action="environment" data-siteid="${siteId}">${t("Fire and smoke nearby")}</button>
        <button type="button" data-kt-action="land" data-siteid="${siteId}">${t("Land manager")}</button>
        <button type="button" data-kt-action="roads" data-siteid="${siteId}">${t("Approach roads")}</button>
        <button type="button" data-kt-action="nearby" data-siteid="${siteId}">${t("Nearest RV services")}</button>
      </div>
      <div class="kt-popup-extra"></div>
      <p><button type="button" class="btn" data-kt-action="reviews" data-siteid="${siteId}">${t("Reviews and photos")}</button></p>
      <p class="kt-fine"><button type="button" class="kt-linkbtn" data-kt-action="fix" data-siteid="${siteId}">${t("Suggest a fix")}</button> ${t("No account needed. A moderator reviews every report.")}</p>
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
      // Keep live controls intact while open, then render any deferred evidence
      // from the latest record before this marker is opened again.
      marker.on('popupclose',()=>{const current=api.getCampsiteById(id);if(current)marker.setPopupContent(popup(current));});
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
      const m=L.marker(ll,{icon:bubbleIcon(size,n),title:t("{0}: about {1} source listings. Select to zoom in.", {"0":(code),"1":(n.toLocaleString(window.KampTrailI18n?.locale() || 'en-US'))}),keyboard:true,zIndexOffset:n});
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
    version:'2.31.0',
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
      // Recreation.gov overnight records corroborate a facility's own type at admission, so state merges wait for this (it never rejects).
      state.amenityReady=loadAmenityDetails();
      state.amenityReady.then(()=>{
        if(state.amenityDetails)state.allCampsites.forEach(f=>DataQuality.attachRIDBAmenities(f,state.amenityDetails));
        updateMarkers();
      });
      loadUSFSSiteDetails().then(()=>{
        if(state.usfsDetails)state.allCampsites.forEach(f=>DataQuality.attachUSFSSiteAmenities(f,state.usfsDetails));
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
    // Read-only render of one listing's popup markup, for tests and the evidence fixture.
    popupHTML:site=>popup(site),
    getDefaultFilters:defaults,
    getCurrentFilters:()=>window.kamptrailFilters || defaults(),
    updateFilters(filters){window.kamptrailFilters={...defaults(),...filters};updateMarkers();requestForecast();},
    getAllCampsites:()=>state.allCampsites,
    getCampsiteById(id){const key=String(id);return state.allCampsites.find(s=>s.properties.id===key||s.properties.legacy_ids?.includes(key));},
    // Listings withdrawn from campsite discovery keep a resolvable legacy entry explaining why (data/campsites/withdrawn.json).
    loadWithdrawn(){if(!state.withdrawnPromise)state.withdrawnPromise=fetchJSON('data/campsites/withdrawn.json').then(d=>d?.version===1&&Array.isArray(d.listings)?new Map(d.listings.filter(w=>typeof w?.id==='string').flatMap(w=>[w.id,...(Array.isArray(w.legacy_ids)?w.legacy_ids:[])].map(k=>[String(k),w]))):new Map()).catch(()=>new Map());return state.withdrawnPromise;},
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
      if(!marker) {window.showToast?.(t("This campsite is hidden by your filters. Reset Filters to view it on the map."),'info',7000);return false;}
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
      box.textContent=t("Finding services within 30 miles (straight-line)…");box.setAttribute('aria-live','polite');
      return api.loadServices(lat,lng,{categories:selected,signal:controller.signal,force}).then(result=>{
        if(controller.signal.aborted)return;
        const best=api.nearestServices(result.items,lat,lng,selected);box.replaceChildren();
        const heading=document.createElement('h3');heading.textContent=t("Services within 30 miles (straight-line)");
        const list=document.createElement('ul');
        for(const key of selected){
          const label=KampTrailServices.categories[key].label,li=document.createElement('li'),match=best[key];
          if(!match){li.textContent=`${label}: ${result.partial?t("unknown in missing areas; none in loaded coverage"):t("none in loaded source coverage")}`;list.append(li);continue;}
          const {item,miles}=match,[lng,lat]=item.coordinates;li.dataset.serviceId=item.id;
          const title=document.createElement('strong');title.textContent=t("{0}: {1}, about {2} mi ", {"0":(label),"1":(item.name||label),"2":(miles<10?miles.toFixed(1):Math.round(miles))});
          const evidence=document.createElement('p');evidence.className='kt-fine';evidence.textContent=KampTrailServices.describe(item,result.manifest);
          const directions=document.createElement('a');directions.href=`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;directions.target='_blank';directions.rel='noopener noreferrer';directions.textContent=t("Directions");
          const osm=document.createElement('a');osm.href=`https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}`;osm.target='_blank';osm.rel='noopener noreferrer';osm.textContent=t("View on OSM");
          const save=document.createElement('button');save.type='button';save.textContent=t("Save service stop");save.onclick=()=>window.KampTrailTrip?.addStop(item.id,KampTrailServices.feature(item,result.manifest));
          const permission=document.createElement('button');permission.type='button';permission.textContent=t("Overnight permission");permission.onclick=()=>window.KampTrailPermissions?.open({kind:'service',id:item.id,name:item.name,coordinates:item.coordinates});
          li.append(title,evidence,directions,' · ',osm,' ',save,' ',permission);list.append(li);
        }
        const note=document.createElement('p');note.className='kt-fine';note.textContent=result.message;
        const attribution=document.createElement('a');attribution.href='https://www.openstreetmap.org/copyright';attribution.textContent=t("Derived from OpenStreetMap contributors (ODbL)");attribution.target='_blank';attribution.rel='noopener noreferrer';
        const retry=document.createElement('button');retry.type='button';retry.textContent=t("Retry nearby service areas");retry.onclick=()=>api.renderNearbyServices(box,lat,lng,true);
        box.append(heading,list,note,attribution,retry);window.KampTrailSpot?.relayout(box);return result;
      }).catch(error=>{if(error.name==='AbortError'||controller.signal.aborted)return;box.textContent=t("Service coverage unavailable. Missing areas are unknown. ");const retry=document.createElement('button');retry.type='button';retry.textContent=t("Retry nearby service areas");retry.onclick=()=>api.renderNearbyServices(box,lat,lng,true);box.append(retry);});
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
      if(kind==='copycoords'){const text=`${lat.toFixed(5)}, ${lng.toFixed(5)}`,status=action.parentElement?.querySelector('.kt-copy-status');
        const done=ok=>{if(status)status.textContent=ok?t("Coordinates copied."):t("Copy unavailable. Coordinates: {coords}",{coords:text});};
        try{navigator.clipboard.writeText(text).then(()=>done(true),()=>done(false));}catch{done(false);}return;}
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
