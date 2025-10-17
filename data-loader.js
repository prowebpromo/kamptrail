/* KampTrail Data Loader – loads state GeoJSON by viewport & renders cluster markers */
(function(){
  'use strict';

  const US_BBOX = {
    'AL':{s:30.2,w:-88.5,n:35.0,e:-84.9}, 'AK':{s:51.2,w:-179.1,n:71.4,e:-129.9},
    'AZ':{s:31.3,w:-114.8,n:37.0,e:-109.0},'AR':{s:33.0,w:-94.6,n:36.5,e:-89.6},
    'CA':{s:32.5,w:-124.4,n:42.0,e:-114.1},'CO':{s:37.0,w:-109.1,n:41.0,e:-102.0},
    'CT':{s:40.9,w:-73.7,n:42.1,e:-71.8}, 'DE':{s:38.4,w:-75.8,n:39.8,e:-75.0},
    'FL':{s:24.5,w:-87.6,n:31.0,e:-80.0}, 'GA':{s:30.4,w:-85.6,n:35.0,e:-80.8},
    'HI':{s:18.9,w:-160.3,n:22.3,e:-154.8},'ID':{s:42.0,w:-117.2,n:49.0,e:-111.0},
    'IL':{s:37.0,w:-91.5,n:42.5,e:-87.5}, 'IN':{s:37.8,w:-88.1,n:41.8,e:-84.8},
    'IA':{s:40.4,w:-96.6,n:43.5,e:-90.1}, 'KS':{s:37.0,w:-102.1,n:40.0,e:-94.6},
    'KY':{s:36.5,w:-89.6,n:39.1,e:-81.9}, 'LA':{s:29.0,w:-94.0,n:33.0,e:-88.8},
    'ME':{s:43.0,w:-71.1,n:47.5,e:-66.9}, 'MD':{s:37.9,w:-79.5,n:39.7,e:-75.0},
    'MA':{s:41.2,w:-73.5,n:42.9,e:-69.9}, 'MI':{s:41.7,w:-90.4,n:48.3,e:-82.4},
    'MN':{s:43.5,w:-97.2,n:49.4,e:-89.5}, 'MS':{s:30.2,w:-91.7,n:35.0,e:-88.1},
    'MO':{s:36.0,w:-95.8,n:40.6,e:-89.1}, 'MT':{s:45.0,w:-116.1,n:49.0,e:-104.0},
    'NE':{s:40.0,w:-104.1,n:43.0,e:-95.3}, 'NV':{s:35.0,w:-120.0,n:42.0,e:-114.0},
    'NH':{s:42.7,w:-72.6,n:45.3,e:-70.7}, 'NJ':{s:38.9,w:-75.6,n:41.4,e:-73.9},
    'NM':{s:31.3,w:-109.1,n:37.0,e:-103.0}, 'NY':{s:40.5,w:-79.8,n:45.0,e:-71.9},
    'NC':{s:33.8,w:-84.3,n:36.6,e:-75.5}, 'ND':{s:45.9,w:-104.1,n:49.0,e:-96.6},
    'OH':{s:38.4,w:-84.8,n:42.3,e:-80.5}, 'OK':{s:33.6,w:-103.0,n:37.0,e:-94.4},
    'OR':{s:42.0,w:-124.6,n:46.3,e:-116.5}, 'PA':{s:39.7,w:-80.5,n:42.3,e:-74.7},
    'RI':{s:41.1,w:-71.9,n:42.0,e:-71.1}, 'SC':{s:32.0,w:-83.4,n:35.2,e:-78.5},
    'SD':{s:42.5,w:-104.1,n:46.0,e:-96.4}, 'TN':{s:35.0,w:-90.3,n:36.7,e:-81.6},
    'TX':{s:25.8,w:-106.6,n:36.5,e:-93.5}, 'UT':{s:37.0,w:-114.1,n:42.0,e:-109.0},
    'VT':{s:42.7,w:-73.4,n:45.0,e:-71.5}, 'VA':{s:36.5,w:-83.7,n:39.5,e:-75.2},
    'WA':{s:45.5,w:-124.8,n:49.0,e:-116.9}, 'WV':{s:37.2,w:-82.6,n:40.6,e:-77.7},
    'WI':{s:42.5,w:-92.9,n:47.3,e:-86.8}, 'WY':{s:41.0,w:-111.1,n:45.0,e:-104.0}
  };

  const S = {
    map: null,
    cluster: null,
    loadedStates: new Set(),
    loading: new Set(),
    all: []
  };

  function inViewStates(){
    const b = S.map.getBounds();
    const v = {s:b.getSouth(), w:b.getWest(), n:b.getNorth(), e:b.getEast()};
    const out=[];
    for (const [k,bb] of Object.entries(US_BBOX)){
      if (!(v.e < bb.w || v.w > bb.e || v.n < bb.s || v.s > bb.n)) out.push(k);
    }
    return out;
  }

  async function loadState(code){
    if (S.loadedStates.has(code) || S.loading.has(code)) return [];
    S.loading.add(code);
    try{
      const r = await fetch(`data/campsites/${code}.geojson`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const gj = await r.json();
      const f = gj.features || [];
      S.all.push(...f);
      S.loadedStates.add(code);
      return f;
    }catch(e){ console.warn('loadState',code,e.message); return []; }
    finally{ S.loading.delete(code); }
  }

  function iconFor(p){
    let bg = p.cost===0 ? '#00b894' : '#e17055';
    if (p.type==='established') bg = '#0984e3';
    const html = `<div style="background:${bg};color:#fff;border-radius:50%;width:26px;height:26px;display:grid;place-items:center;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">⛺</div>`;
    return L.divIcon({html, className:'kt-camp', iconSize:[26,26], iconAnchor:[13,13]});
  }

  function popupFor(p){
    const cost = p.cost===0 ? 'Free' : (p.cost ? `$${p.cost}/night`:'Unknown');
    return `
      <div style="min-width:200px">
        <strong>${p.name}</strong><br>
        <div style="opacity:.8;font-size:12px">${p.type} · ${cost}</div>
        ${p.description ? `<div style="margin-top:6px;font-size:12px;max-height:70px;overflow:auto">${p.description}</div>`:''}
        <div style="display:flex;gap:6px;margin-top:8px">
          <button onclick="KampTrailData._fav('${p.id}')" style="padding:6px 8px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:6px;cursor:pointer">❤ Save</button>
          <button onclick="KampTrailData._trip('${p.id}')" style="padding:6px 8px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:6px;cursor:pointer">➕ Add to trip</button>
        </div>
      </div>`;
  }

  function applyFilters(list){
    const f = window.kamptrailFilters || {cost:'all', type:'all'};
    return list.filter(feat=>{
      const p = feat.properties;
      if (f.cost==='free' && !(p.cost===0)) return false;
      if (f.cost==='paid' && (p.cost===0)) return false;
      if (f.type!=='all' && p.type!==f.type) return false;
      return true;
    });
  }

  function refreshMarkers(){
    const bounds = S.map.getBounds();
    const filtered = applyFilters(S.all).filter(feat=>{
      const [lng,lat] = feat.geometry.coordinates; 
      return bounds.contains([lat,lng]);
    }).slice(0, 5000);

    S.cluster.clearLayers();
    filtered.forEach(feat=>{
      const p=feat.properties; const [lng,lat]=feat.geometry.coordinates;
      const m = L.marker([lat,lng], {icon:iconFor(p), title:p.name}).bindPopup(popupFor(p),{maxWidth:280});
      S.cluster.addLayer(m);
    });
  }

  let debTimer=null;
  function debouncedRefresh(){ clearTimeout(debTimer); debTimer=setTimeout(refreshMarkers, 300); }

  window.KampTrailData = {
    async init(map, cfg={}){
      S.map = map;
      S.cluster = L.markerClusterGroup({chunkedLoading:true, spiderfyOnMaxZoom:false, maxClusterRadius:50});
      map.addLayer(S.cluster);

      // initial states
      const first = inViewStates();
      await Promise.all(first.map(loadState));
      refreshMarkers();

      // auto-load on move
      map.on('moveend', async ()=>{
        const vis = inViewStates();
        const needs = vis.filter(s=>!S.loadedStates.has(s) && !S.loading.has(s));
        if (needs.length) await Promise.all(needs.map(loadState));
        debouncedRefresh();
      });
    },

    updateFilters(){ refreshMarkers(); },

    // exposed for popup buttons
    _fav(id){ if (this.onFavoriteToggle) this.onFavoriteToggle(id); },
    _trip(id){ if (this.onTripAdd) this.onTripAdd(id); },

    onFavoriteToggle: null,
    onTripAdd: null,

    // Helpers used by index.html
    getAll(){ return S.all; }
  };
})();
