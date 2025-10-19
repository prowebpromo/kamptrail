/* data-loader.js
 * Viewport/state-based campsite & POI loading + clustering.
 */
(function () {
  'use strict';

  // State bounding boxes
  const BBOX = { 
    AL:{s:30.2,w:-88.5,n:35,e:-84.9}, AK:{s:51.2,w:-179.1,n:71.4,e:-129.9}, AZ:{s:31.3,w:-114.8,n:37,e:-109},
    AR:{s:33,w:-94.6,n:36.5,e:-89.6}, CA:{s:32.5,w:-124.4,n:42,e:-114.1}, CO:{s:37,w:-109.1,n:41,e:-102},
    CT:{s:40.9,w:-73.7,n:42.1,e:-71.8}, DE:{s:38.4,w:-75.8,n:39.8,e:-75}, FL:{s:24.5,w:-87.6,n:31,e:-80},
    GA:{s:30.4,w:-85.6,n:35,e:-80.8}, HI:{s:18.9,w:-160.3,n:22.3,e:-154.8}, ID:{s:42,w:-117.2,n:49,e:-111},
    IL:{s:37,w:-91.5,n:42.5,e:-87.5}, IN:{s:37.8,w:-88.1,n:41.8,e:-84.8}, IA:{s:40.4,w:-96.6,n:43.5,e:-90.1},
    KS:{s:37,w:-102.1,n:40,e:-94.6}, KY:{s:36.5,w:-89.6,n:39.1,e:-81.9}, LA:{s:29,w:-94,n:33,e:-88.8},
    ME:{s:43,w:-71.1,n:47.5,e:-66.9}, MD:{s:37.9,w:-79.5,n:39.7,e:-75}, MA:{s:41.2,w:-73.5,n:42.9,e:-69.9},
    MI:{s:41.7,w:-90.4,n:48.3,e:-82.4}, MN:{s:43.5,w:-97.2,n:49.4,e:-89.5}, MS:{s:30.2,w:-91.7,n:35,e:-88.1},
    MO:{s:36,w:-95.8,n:40.6,e:-89.1}, MT:{s:45,w:-116.1,n:49,e:-104}, NE:{s:40,w:-104.1,n:43,e:-95.3},
    NV:{s:35,w:-120,n:42,e:-114}, NH:{s:42.7,w:-72.6,n:45.3,e:-70.7}, NJ:{s:38.9,w:-75.6,n:41.4,e:-73.9},
    NM:{s:31.3,w:-109.1,n:37,e:-103}, NY:{s:40.5,w:-79.8,n:45,e:-71.9}, NC:{s:33.8,w:-84.3,n:36.6,e:-75.5},
    ND:{s:45.9,w:-104.1,n:49,e:-96.6}, OH:{s:38.4,w:-84.8,n:42.3,e:-80.5}, OK:{s:33.6,w:-103,n:37,e:-94.4},
    OR:{s:42,w:-124.6,n:46.3,e:-116.5}, PA:{s:39.7,w:-80.5,n:42.3,e:-74.7}, RI:{s:41.1,w:-71.9,n:42,e:-71.1},
    SC:{s:32,w:-83.4,n:35.2,e:-78.5}, SD:{s:42.5,w:-104.1,n:46,e:-96.4}, TN:{s:35,w:-90.3,n:36.7,e:-81.6},
    TX:{s:25.8,w:-106.6,n:36.5,e:-93.5}, UT:{s:37,w:-114.1,n:42,e:-109}, VT:{s:42.7,w:-73.4,n:45,e:-71.5},
    VA:{s:36.5,w:-83.7,n:39.5,e:-75.2}, WA:{s:45.5,w:-124.8,n:49,e:-116.9}, WV:{s:37.2,w:-82.6,n:40.6,e:-77.7},
    WI:{s:42.5,w:-92.9,n:47.3,e:-86.8}, WY:{s:41,w:-111.1,n:45,e:-104} 
  };

  const state = {
    map: null,
    cluster: null,
    loaded: new Set(),
    loading: new Set(),
    all: [],
    config: { maxMarkers: 5000, isFavorite: null, onTripAdd: null, onFavoriteToggle: null }
  };

  const debounce = (fn, ms) => { 
    let t; 
    return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; 
  };

  function intersect(a,b){ 
    return !(a.e<b.w||a.w>b.e||a.n<b.s||a.s>b.n); 
  }
  
  function bboxOfMap(map){
    const b = map.getBounds();
    return {s:b.getSouth(), w:b.getWest(), n:b.getNorth(), e:b.getEast()};
  }
  
  function visibleStates(map){
    const v = bboxOfMap(map), out=[];
    for(const [code,bb] of Object.entries(BBOX)){ 
      if(intersect(v,bb)) out.push(code); 
    }
    return out;
  }

  function featureToMarker(f) {
    const p = f.properties;
    const [lng, lat] = f.geometry.coordinates;
    const paid = p.cost && p.cost>0;
    const color = paid ? '#e17055' : (p.type==='established' ? '#0984e3' : '#00b894');
    const label = paid ? '💲' : (p.type==='established' ? '🏕️' : '⛺');

    const icon = L.divIcon({
      className: 'kt-camp-marker',
      html: `<div style="background:${color};color:#fff;border-radius:50%;width:28px;height:28px;display:grid;place-items:center;font-size:16px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);">${label}</div>`,
      iconSize: [28,28], 
      iconAnchor:[14,14]
    });

    const m = L.marker([lat,lng], { icon, title: p.name || 'Campsite' });
    const cost = p.cost===0 ? '<span style="color:#00b894;">Free</span>' :
                (p.cost?`$${p.cost}/night`:'Unknown');
    const rating = p.rating ? `⭐ ${(+p.rating).toFixed(1)}/5 (${p.reviews_count||0})` : '';
    const rig = (p.rig_friendly||[]).join(', ');
    
    m.bindPopup(`
      <div style="min-width:220px">
        <h3 style="margin:0 0 6px 0;font-size:15px;color:#fff;">${p.name||'Campsite'}</h3>
        ${rating?`<div style="color:#feca57">${rating}</div>`:''}
        <div style="font-size:12px;margin-top:6px">
          <div><b>Cost:</b> ${cost}</div>
          <div><b>Type:</b> ${p.type||'–'}</div>
          ${rig?`<div><b>Rig:</b> ${rig}</div>`:''}
        </div>
        <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <button onclick="KampTrailData._trip('${p.id}')" style="padding:6px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:6px;cursor:pointer;font-size:11px;">➕ Add to trip</button>
          <button onclick="KampTrailData._fav('${p.id}')" style="padding:6px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:6px;cursor:pointer;font-size:11px;">♡ Save</button>
        </div>
      </div>`);
    return m;
  }

  async function loadState(code){
    if(state.loaded.has(code) || state.loading.has(code)) return [];
    state.loading.add(code);
    try{
      const res = await fetch(`data/campsites/${code}.geojson`);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const gj = await res.json();
      state.loaded.add(code);
      const feats = gj.features||[];
      state.all.push(...feats);
      return feats;
    }catch(e){
      console.warn(`Could not load ${code}:`, e.message);
      return [];
    }finally{
      state.loading.delete(code);
    }
  }

  function applyFilters(feats, filters){
    if(!filters) return feats; // No filters = show all
    
    return feats.filter(f=>{
      const p=f.properties||{};
      
      // Cost filter
      if(filters.cost==='free' && p.cost !== 0) return false;
      if(filters.cost==='paid' && p.cost === 0) return false;
      
      // Type filter
      if(filters.type && filters.type!=='all' && p.type!==filters.type) return false;
      
      // Rig size filter (simplified - just check if rig_friendly array exists)
      if(filters.rigSize && filters.rigSize!=='all') {
        const rigs = p.rig_friendly || [];
        if(rigs.length === 0) return false;
      }
      
      // Road difficulty filter
      if(filters.roadDifficulty && filters.roadDifficulty!=='all' && p.road_difficulty!==filters.roadDifficulty) return false;
      
      // Amenities filter
      if(filters.amenities && filters.amenities.length > 0){
        const hasAll = filters.amenities.every(a => (p.amenities||[]).includes(a));
        if(!hasAll) return false;
      }
      
      // Rating filter
      if(filters.minRating && (+filters.minRating||0) > 0) {
        if(!p.rating || +p.rating < +filters.minRating) return false;
      }
      
      return true;
    });
  }

  function refreshMarkers(filters){
    const bounds = state.map.getBounds();
    const filtered = applyFilters(state.all, filters);
    const vis = filtered.filter(f=>{
      const [lng,lat]=f.geometry.coordinates; 
      return bounds.contains([lat,lng]);
    }).slice(0, state.config.maxMarkers);

    state.cluster.clearLayers();
    vis.forEach(f=> state.cluster.addLayer(featureToMarker(f)));
    console.log(`Markers: showing ${vis.length}, loaded ${state.all.length}, states ${[...state.loaded].join(',')}`);
  }

  async function ensureVisibleStates(){
    const states = visibleStates(state.map);
    const toLoad = states.filter(s=>!state.loaded.has(s) && !state.loading.has(s));
    if(toLoad.length){
      await Promise.all(toLoad.map(loadState));
    }
  }

  // Public API
  window.KampTrailData = {
    async init(map, config={}){
      state.map = map;
      state.config = Object.assign(state.config, config);

      // Cluster group
      state.cluster = L.markerClusterGroup({
        chunkedLoading:true, 
        spiderfyOnMaxZoom:false, 
        maxClusterRadius:50,
        iconCreateFunction:(c)=>{
          const n=c.getChildCount();
          return L.divIcon({
            html:`<div style="background:#0984e3;color:#fff;border-radius:50%;width:40px;height:40px;display:grid;place-items:center;font-weight:700;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);">${n}</div>`,
            className:'kt-clu', 
            iconSize:[40,40]
          });
        }
      });
      map.addLayer(state.cluster);

      // Initial load
      await ensureVisibleStates();
      refreshMarkers(this.getDefaultFilters());

      // Subsequent loads on pan/zoom
      map.on('moveend', debounce(async ()=>{
        await ensureVisibleStates();
        refreshMarkers(this.getCurrentFilters());
      }, 400));
      
      console.log('✓ Data loader ready');
    },

    getDefaultFilters(){
      return { cost:'all', type:'all', rigSize:'all', roadDifficulty:'all', amenities:[], minRating:0 };
    },
    
    getCurrentFilters(){ 
      return window.kamptrailFilters || this.getDefaultFilters(); 
    },
    
    updateFilters(filters){ 
      window.kamptrailFilters = filters; 
      refreshMarkers(filters); 
    },

    getAllCampsites(){ return state.all; },
    getCampsiteById(id){ return state.all.find(s=>s.properties?.id===id); },

    _trip(id){ if(state.config.onTripAdd) state.config.onTripAdd(id); },
    _fav(id){ if(state.config.onFavoriteToggle) state.config.onFavoriteToggle(id); }
  };
})();
