/* overlays-advanced.js - Base Map Switcher (No CORS Issues) */

(function(){
  'use strict';

  const state = { 
    currentBase: 'osm',
    baseLayers: {},
    controls: {},
    map: null
  };

  // Base map layers that work without CORS issues
  function osmLayer() {
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    });
  }

  function topoLayer() {
    return L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: '© OpenTopoMap'
    });
  }

  function satelliteLayer() {
    return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: '© Esri'
    });
  }

  function terrainLayer() {
    return L.tileLayer('https://stamen-tiles-{s}.a.ssl.fastly.net/terrain/{z}/{x}/{y}.jpg', {
      subdomains: 'abcd',
      maxZoom: 16,
      attribution: '© Stamen Design'
    });
  }

  function checkbox(label, rightTag, isRadio = false){
    const row = document.createElement('label');
    row.className = 'kt2-row';
    
    const input = document.createElement('input'); 
    input.type = isRadio ? 'radio' : 'checkbox';
    if (isRadio) input.name = 'basemap';
    
    const span = document.createElement('span'); 
    span.textContent = label;
    span.className = 'kt2-name';
    
    const tag = document.createElement('small'); 
    tag.textContent = rightTag; 
    tag.className = `kt2-badge ${rightTag.toLowerCase()}`;
    
    row.append(input, span, tag);
    return {row, input};
  }

  function buildPanel(){
    const panel = document.createElement('div');
    panel.id = 'kt2-overlays';
    panel.innerHTML = `
      <div class="kt2-header">
        <h2 class="kt2-title">🗺️ Map Styles</h2>
        <button class="kt2-close">✕</button>
      </div>`;
    
    const body = document.createElement('div'); 
    body.className = 'kt2-body';
    
    // Add description
    const desc = document.createElement('p');
    desc.style.cssText = 'font-size:12px;color:#666;margin:0 0 12px 0;padding:0 10px;';
    desc.textContent = 'Choose your base map style:';
    body.append(desc);
    
    panel.append(body);
    
    const items = [
      { key: 'osm', label: 'Standard Map', maker: osmLayer, tag: 'default', checked: true },
      { key: 'topo', label: 'Topographic', maker: topoLayer, tag: 'terrain', checked: false },
      { key: 'satellite', label: 'Satellite', maker: satelliteLayer, tag: 'imagery', checked: false },
      { key: 'terrain', label: 'Terrain', maker: terrainLayer, tag: 'terrain', checked: false }
    ];
    
    items.forEach(it => {
      const {row, input} = checkbox(it.label, it.tag, true);
      input.value = it.key;
      input.checked = !!it.checked;
      input.addEventListener('change', () => {
        if (input.checked) {
          switchBaseMap(it.key, it.maker);
        }
      });
      body.append(row);
      state.controls[it.key] = {input, maker: it.maker};
    });
    
    panel.querySelector('.kt2-close').onclick = () => {
      panel.style.display = 'none';
    };
    
    return panel;
  }

  function switchBaseMap(key, makerFn) {
    try {
      console.log(`Switching to base map: ${key}`);
      
      // Remove current base layer
      if (state.baseLayers[state.currentBase]) {
        state.map.removeLayer(state.baseLayers[state.currentBase]);
      }
      
      // Create new layer if needed
      if (!state.baseLayers[key]) {
        state.baseLayers[key] = makerFn();
      }
      
      // Add new base layer (at the back, so markers show on top)
      state.baseLayers[key].addTo(state.map);
      state.baseLayers[key].bringToBack();
      
      state.currentBase = key;
      console.log(`✓ Switched to: ${key}`);
      
    } catch (err) {
      console.error(`Failed to switch base map to ${key}:`, err);
    }
  }

  window.KampTrailAdvanced = {
    init(map, cfg = {}) {
      try {
        state.map = map;
        state.controls = {};
        state.baseLayers = {};
        
        // Remove default OSM layer that Leaflet adds
        map.eachLayer(layer => {
          if (layer instanceof L.TileLayer) {
            map.removeLayer(layer);
          }
        });
        
        // Add initial OSM layer
        state.baseLayers.osm = osmLayer();
        state.baseLayers.osm.addTo(map);
        state.currentBase = 'osm';
        
        // Create panel
        const panel = buildPanel();
        map._container.appendChild(panel);
        L.DomEvent.disableClickPropagation(panel);
        
        // Add toggle button
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'layers-toggle';
        toggleBtn.className = 'btn';
        toggleBtn.innerHTML = '🗺️ Map Style';
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
        
        console.log('✓ Map style switcher ready');
        
        if (cfg.onInit) cfg.onInit();
        
      } catch (err) {
        console.error('Failed to initialize map styles:', err);
      }
    },

    switchTo(key) {
      const control = state.controls[key];
      if (control) {
        control.input.checked = true;
        switchBaseMap(key, control.maker);
      }
    },

    togglePanel(visible) {
      const panel = document.getElementById('kt2-overlays');
      if (panel) {
        panel.style.display = visible ? 'block' : 'none';
      }
    }
  };
})();
