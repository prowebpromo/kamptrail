/* KampTrail Overlays (advanced) */
(function(){
  'use strict';

  const state = { group: null, controls: null, layers: {} };

  function padUS(){ // PAD-US polygons via Esri Feature Service (generalized)
    return L.esri.featureLayer({
      url: 'https://services1.arcgis.com/er9Y6iQYxw79IYqI/ArcGIS/rest/services/PADUS3_0Combined_Proclamation_Marine_Fee/FeatureServer/0',
      simplifyFactor: 0.5,
      precision: 5,
      style: f => ({ color:'#ff6b6b', weight:1, fillOpacity:.08 })
    });
  }

  function blmMgmt(){
    return L.esri.dynamicMapLayer({
      url: 'https://services1.arcgis.com/Yq8rYC2a6bHsH3dS/ArcGIS/rest/services/BLM_National_Surface_Management_Agency/MapServer',
      opacity: 0.35
    });
  }

  function usfsAdmin(){
    return L.esri.dynamicMapLayer({
      url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ProclaimedForests_01/MapServer',
      opacity: 0.35
    });
  }

  function checkbox(label, rightTag){
    const row = document.createElement('label');
    row.style.cssText='display:flex;align-items:center;gap:8px;padding:6px 8px;';
    const cb = document.createElement('input'); cb.type='checkbox';
    const span = document.createElement('span'); span.textContent = label;
    const tag = document.createElement('small'); tag.textContent = rightTag; tag.style.cssText='margin-left:auto;opacity:.7;border:1px solid #284356;border-radius:10px;padding:2px 6px;';
    row.append(cb, span, tag);
    return {row, cb};
  }

  function buildPanel(){
    const panel = document.createElement('div');
    panel.className='kt2-panel';
    panel.style.cssText='position:absolute;top:12px;right:12px;min-width:280px;background:#0f1b24;border:1px solid #284356;border-radius:12px;color:#cfe3f2;z-index:1001;box-shadow:0 8px 24px rgba(0,0,0,.35);';
    panel.innerHTML = `<div style="padding:10px 12px;border-bottom:1px solid #284356;font-weight:700">Layers & Data</div>`;
    const body = document.createElement('div'); body.style.padding='6px 8px';
    panel.append(body);

    const items = [
      { key:'pad', label:'PAD-US (protected/public lands)', maker: padUS, tag:'overlay', checked:false },
      { key:'blm', label:'BLM Surface Mgmt Agency',      maker: blmMgmt, tag:'overlay', checked:false },
      { key:'usfs', label:'USFS Admin boundaries',       maker: usfsAdmin, tag:'overlay', checked:false }
    ];

    items.forEach(it=>{
      const {row,cb} = checkbox(it.label, it.tag);
      cb.checked = !!it.checked;
      cb.addEventListener('change',()=>{
        toggle(it.key, cb.checked);
      });
      body.append(row);
      state.controls[it.key] = cb;
    });

    return panel;
  }

  function toggle(key, on){
    if (on){
      if (!state.layers[key]){
        // lazily create the layer
        if (key==='pad') state.layers[key] = padUS();
        else if (key==='blm') state.layers[key] = blmMgmt();
        else if (key==='usfs') state.layers[key] = usfsAdmin();
      }
      state.group.addLayer(state.layers[key]);
    } else {
      if (state.layers[key]) state.group.removeLayer(state.layers[key]);
    }
  }

  window.KampTrailAdvanced = {
    init(map, cfg={}){
      // Container group so we can add/remove overlays cleanly
      state.group = L.layerGroup().addTo(map);
      state.controls = {};
      state.layers = {};

      const panel = buildPanel();
      map._container.append(panel);
      L.DomEvent.disableClickPropagation(panel);

      // default: none on
    }
  };
})();
