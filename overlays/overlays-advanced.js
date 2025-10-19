/* overlays-advanced.js - COMPLETE FILE - Working Overlays */

(function(){
  'use strict';

  const state = { 
    group: null, 
    controls: null, 
    layers: {},
    map: null
  };

  function publicLandsOverlay(){
    return L.tileLayer('https://tiles.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Public_Lands/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      opacity: 0.4,
      attribution: 'BLM, USFS, NPS'
    });
  }

  function blmLandsOverlay(){
    return L.tileLayer('https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LR_Bounds/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      opacity: 0.4,
      attribution: 'Bureau of Land Management'
    });
  }

  function usfsLandsOverlay(){
    return L.tileLayer('https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      opacity: 0.4,
      attribution: 'US Forest Service'
    });
  }

  function npsLandsOverlay(){
    return L.tileLayer('https://mapservices.nps.gov/arcgis/rest/services/LandResourcesDivisionTractAndBoundaryService/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      opacity: 0.4,
      attribution: 'National Park Service'
    });
  }

  function cellTowersOverlay(){
    return L.tileLayer('https://tiles.opencellid.org/tiles/{z}/{x}/{y}.png', {
      maxZoom: 16,
      opacity: 0.5,
      attribution: 'OpenCelliD'
    });
  }

  function fireHazardOverlay(){
    return L.tileLayer('https://firms.modaps.eosdis.nasa.gov/mapserver/wms/fires?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=fires_modis_24&SRS=EPSG:3857&BBOX={bbox}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE', {
      maxZoom: 12,
      opacity: 0.6,
      attribution: 'NASA FIRMS'
    });
  }

  function checkbox(label, rightTag){
    const row = document.createElement('label');
    row.className = 'kt2-row';
    
    const cb = document.createElement('input'); 
    cb.type = 'checkbox';
    
    const span = document.createElement('span'); 
    span.textContent = label;
    span.className = 'kt2-name';
    
    const tag = document.createElement('small'); 
    tag.textContent = rightTag; 
    tag.className = 'kt2-badge overlay';
    
    row.append(cb, span, tag);
    return {row, cb};
  }

  function buildPanel(){
    const panel = document.createElement('div');
    panel.id = 'kt2-overlays';
    panel.innerHTML = `
      <div class="kt2-header">
        <h2 class="kt2-title">🗺️ Layers & Data</h2>
        <button class="kt2-close">✕</button>
      </div>`;
    
    const body = document.createElement('div'); 
    body.className = 'kt2-body';
    panel.append(body);
    
    const items = [
      { key: 'public', label: 'Public Lands (All)', maker: publicLandsOverlay, tag: 'overlay', checked: false },
      { key: 'blm', label: 'BLM Lands', maker: blmLandsOverlay, tag: 'overlay', checked: false },
      { key: 'usfs', label: 'National Forests (USFS)', maker: usfsLandsOverlay, tag: 'overlay', checked: false },
      { key: 'nps', label: 'National Parks (NPS)', maker: npsLandsOverlay, tag: 'overlay', checked: false },
      { key: 'cell', label: 'Cell Towers', maker: cellTowersOverlay, tag: 'data', checked: false },
      { key: 'fire', label: 'Fire Risk', maker: fireHazardOverlay, tag: 'alert', checked: false }
    ];
    
    items.forEach(it => {
      const {row, cb} = checkbox(it.label, it.tag);
      cb.checked = !!it.checked;
      cb.addEventListener('change', () => {
        toggle(it.key, cb.checked, it.maker);
      });
      body.append(row);
      state.controls[it.key] = {checkbox: cb, maker: it.maker};
    });
    
    panel.querySelector('.kt2-close').onclick = () => {
      panel.style.display = 'none';
    };
    
    return panel;
  }

  function toggle(key, on, makerFn){
    try {
      if (on) {
        if (!state.layers[key]) {
          console.log(`Creating overlay: ${key}`);
          state.layers[key] = makerFn();
        }
        state.group.addLayer(state.layers[key]);
        console.log(`✓ Enabled: ${key}`);
      } else {
        if (state.layers[key]) {
          state.group.removeLayer(state.layers[key]);
          console.log(`✓ Disabled: ${key}`);
        }
      }
    } catch (err) {
      console.error(`Failed to toggle ${key}:`, err);
    }
  }

  function clearAllLayers() {
    Object.keys(state.layers).forEach(key => {
      if (state.layers[key]) {
        state.group.removeLayer(state.layers[key]);
      }
    });
    state.layers = {};
  }

  window.KampTrailAdvanced = {
    init(map, cfg = {}) {
      try {
        state.map = map;
        state.group = L.layerGroup().addTo(map);
        state.controls = {};
        state.layers = {};
        
        const panel = buildPanel();
        map._container.appendChild(panel);
        L.DomEvent.disableClickPropagation(panel);
        
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'layers-toggle';
        toggleBtn.className = 'btn';
        toggleBtn.innerHTML = '🗺️ Layers';
        toggleBtn.onclick = () => {
          const isVisible = panel.style.display !== 'none';
          panel.style.display = isVisible ? 'none' : 'block';
        };
        
        const filtersBtn = document.getElementById('filters');
        if (filtersBtn && filtersBtn.parentNode) {
          filtersBtn.parentNode.insertBefore(toggleBtn, filtersBtn.nextSibling);
        } else {
          document.querySelector('header .actions')?.appendChild(toggleBtn);
        }
        
        console.log('✓ Overlays initialized successfully');
        
        if (cfg.onInit) cfg.onInit();
        
      } catch (err) {
        console.error('Failed to initialize overlays:', err);
      }
    },

    toggleLayer(key, enabled) {
      const control = state.controls[key];
      if (control) {
        control.checkbox.checked = enabled;
        toggle(key, enabled, control.maker);
      }
    },

    getActiveLayers() {
      return Object.keys(state.layers).filter(key => 
        state.group.hasLayer(state.layers[key])
      );
    },

    clearAll() {
      clearAllLayers();
      Object.values(state.controls).forEach(ctrl => {
        ctrl.checkbox.checked = false;
      });
    },

    togglePanel(visible) {
      const panel = document.getElementById('kt2-overlays');
      if (panel) {
        panel.style.display = visible ? 'block' : 'none';
      }
    }
  };
})();
