/* On-demand facts about a coordinate: land manager (BLM SMA), NWS forecast and elevation.
   Nothing is fetched until the visitor asks. Results are cached for the visit. */
(function (global) {
  'use strict';
  const SMA = 'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer';
  const cache = new Map();
  const AGENCIES = {
    BLM: {name: 'Bureau of Land Management (BLM)', rule: 'BLM says dispersed camping is generally limited to 14 days within any 28-day period, and limits vary by state and field office.', link: 'https://www.blm.gov/camping', public: true},
    USFS: {name: 'US Forest Service (USFS)', rule: 'Each national forest sets its own stay limits and dispersed camping rules. Check that forest’s current orders and Motor Vehicle Use Map.', link: 'https://www.fs.usda.gov/visit/know-before-you-go', public: true},
    NPS: {name: 'National Park Service (NPS)', rule: 'Camping in national parks is usually limited to designated sites or permits. Check the park’s rules.', link: 'https://www.nps.gov/subjects/camping/index.htm', public: true},
    FWS: {name: 'US Fish and Wildlife Service', rule: 'Most refuges do not allow camping. Check the refuge before you stay.', link: 'https://www.fws.gov/refuges', public: true},
    USFW: {name: 'US Fish and Wildlife Service', rule: 'Most refuges do not allow camping. Check the refuge before you stay.', link: 'https://www.fws.gov/refuges', public: true},
    BOR: {name: 'Bureau of Reclamation', rule: 'Camping rules vary by reservoir and managing partner. Check locally.', link: 'https://www.usbr.gov/recreation/', public: true},
    USBR: {name: 'Bureau of Reclamation', rule: 'Camping rules vary by reservoir and managing partner. Check locally.', link: 'https://www.usbr.gov/recreation/', public: true},
    DOD: {name: 'Department of Defense', rule: 'Military land. Public camping is generally not permitted.', public: false},
    ARMY: {name: 'US Army', rule: 'Military land. Public camping is generally not permitted.', public: false},
    NAVY: {name: 'US Navy', rule: 'Military land. Public camping is generally not permitted.', public: false},
    USAF: {name: 'US Air Force', rule: 'Military land. Public camping is generally not permitted.', public: false},
    USMC: {name: 'US Marine Corps', rule: 'Military land. Public camping is generally not permitted.', public: false},
    DOE: {name: 'Department of Energy', rule: 'Restricted federal land. Public camping is generally not permitted.', public: false},
    USACE: {name: 'US Army Corps of Engineers', rule: 'Camping is usually limited to designated campgrounds. Check the project office.', link: 'https://www.recreation.gov/', public: true},
    NTVALL: {name: 'Alaska Native allotment', rule: 'Private Native land. Camping requires the owner’s permission.', public: false},
    NTVPIC: {name: 'Alaska Native land', rule: 'Native corporation land. Camping requires permission or a permit.', public: false},
    OTHFE: {name: 'Other federal land', rule: 'Rules vary by agency. Check before camping.', public: true},
    BIA: {name: 'Bureau of Indian Affairs / tribal land', rule: 'Tribal land. Camping requires the tribe’s permission.', public: false},
    ST: {name: 'State land', rule: 'State land rules vary widely. Some state trust land is closed to camping. Check the state agency.', public: true},
    LG: {name: 'Local government land', rule: 'Local rules apply. Check with the city or county.', public: true},
    PVT: {name: 'Private land', rule: 'Private land. Do not camp without the owner’s permission.', public: false},
    UND: {name: 'Not determined', rule: 'The land manager is not recorded here. Treat it as private until you confirm otherwise.', public: false}
  };
  const key = (kind, lat, lng, digits = 4) => `${kind}:${lat.toFixed(digits)},${lng.toFixed(digits)}`;
  async function getJSON(url, timeout = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const r = await fetch(url, {signal: controller.signal, headers: {Accept: 'application/geo+json, application/json'}});
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(timer); }
  }
  function memo(k, fn) {
    if (cache.has(k)) return cache.get(k);
    const p = fn().catch(e => { cache.delete(k); throw e; });
    cache.set(k, p);
    return p;
  }
  function describeLand(attrs) {
    if (!attrs) return null;
    const code = String(attrs.ADMIN_AGENCY_CODE || 'UND').toUpperCase();
    const info = AGENCIES[code] || {name: `Federal agency (${code})`, rule: 'Facility or administrative land. Camping is usually not permitted. Check before you stay.', public: false};
    const unit = [attrs.ADMIN_UNIT_NAME, attrs.ADMIN_UNIT_TYPE].filter(v => v && !/^(null|none)$/i.test(String(v)) && v !== info.name && v !== 'Bureau of Land Management').join(' · ');
    return {code, name: info.name, unit: unit || null, rule: info.rule, link: info.link || null, public: info.public, state: attrs.ADMIN_ST || null};
  }
  function landManager(lat, lng) {
    return memo(key('land', lat, lng), async () => {
      const params = new URLSearchParams({geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'ADMIN_AGENCY_CODE,ADMIN_UNIT_NAME,ADMIN_UNIT_TYPE,ADMIN_ST', returnGeometry: 'false', f: 'json'});
      const data = await getJSON(`${SMA}/1/query?${params}`);
      if (data.error) throw new Error(data.error.message || 'Land lookup failed');
      const features = Array.isArray(data.features) ? data.features : [];
      // Prefer a determined agency when overlapping records exist.
      const best = features.find(f => f.attributes && f.attributes.ADMIN_AGENCY_CODE && f.attributes.ADMIN_AGENCY_CODE !== 'UND') || features[0];
      return describeLand(best && best.attributes) || describeLand({ADMIN_AGENCY_CODE: 'UND'});
    });
  }
  function forecast(lat, lng) {
    return memo(key('wx', lat, lng, 3), async () => {
      const point = await getJSON(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`);
      const url = point && point.properties && point.properties.forecast;
      if (!url) throw new Error('No forecast for this location');
      const fc = await getJSON(url);
      const periods = (fc.properties && fc.properties.periods || []).slice(0, 6).map(p => ({
        name: p.name, temp: p.temperature, unit: p.temperatureUnit, wind: [p.windSpeed, p.windDirection].filter(Boolean).join(' '),
        short: p.shortForecast, pop: p.probabilityOfPrecipitation && Number.isFinite(p.probabilityOfPrecipitation.value) ? p.probabilityOfPrecipitation.value : null
      }));
      const elevM = fc.properties && fc.properties.elevation && Number.isFinite(fc.properties.elevation.value) ? fc.properties.elevation.value : null;
      const rel = point.properties.relativeLocation && point.properties.relativeLocation.properties;
      return {periods, elevationFt: elevM === null ? null : Math.round(elevM * 3.28084), near: rel ? `${rel.city}, ${rel.state}` : null, updated: fc.properties && fc.properties.updateTime || null};
    });
  }
  function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
  function link(href, text) { const a = el('a', text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
  // Re-layout an open Leaflet popup after async content changes its size, so it pans fully into view.
  function relayout(target) {
    const map = global.map;
    const popup = map && map._popup;
    if (!popup || !target || !target.closest || !target.closest('.leaflet-popup')) return;
    // Do not call popup.update(): it would re-render string content and erase the loaded section.
    try { popup._updateLayout && popup._updateLayout(); popup._updatePosition && popup._updatePosition(); popup._adjustPan && popup._adjustPan(); } catch {}
  }
  function renderLand(target, lat, lng) {
    target.replaceChildren(el('p', 'Checking land manager…', 'kt-muted'));
    return landManager(lat, lng).then(info => {
      const box = el('div', null, `kt-land ${info.public ? 'is-public' : 'is-restricted'}`);
      box.append(el('strong', info.name));
      if (info.unit) box.append(el('div', info.unit, 'kt-muted'));
      box.append(el('p', info.rule));
      if (info.link) box.append(link(info.link, 'Official camping rules'));
      box.append(el('p', 'Source: BLM Surface Management Agency map. Boundaries can be approximate. Signs and local orders on site take priority.', 'kt-fine'));
      target.replaceChildren(box);relayout(target);
      return info;
    }).catch(() => { target.replaceChildren(el('p', 'Land manager lookup is unavailable right now. Try again when connected.', 'kt-muted')); });
  }
  function renderForecast(target, lat, lng) {
    target.replaceChildren(el('p', 'Loading the National Weather Service forecast…', 'kt-muted'));
    return forecast(lat, lng).then(wx => {
      const box = el('div', null, 'kt-wx');
      const head = [];
      if (wx.elevationFt !== null) head.push(`Elevation about ${wx.elevationFt.toLocaleString('en-US')} ft`);
      if (wx.near) head.push(`Forecast area near ${wx.near}`);
      if (head.length) box.append(el('div', head.join(' · '), 'kt-muted'));
      const list = el('ul');
      wx.periods.forEach(p => list.append(el('li', `${p.name}: ${p.temp}°${p.unit}, ${p.short}${p.pop !== null ? `, ${p.pop}% precip` : ''}${p.wind ? `, wind ${p.wind}` : ''}`)));
      box.append(list, el('p', 'Source: National Weather Service (weather.gov). US locations only.', 'kt-fine'));
      target.replaceChildren(box);relayout(target);
      return wx;
    }).catch(() => { target.replaceChildren(el('p', 'Forecast is unavailable for this spot right now. The NWS covers US locations only.', 'kt-muted')); });
  }
  function renderFeeEvidence(target, properties) {
    const records=global.DataQuality.mergeFeeEvidence(properties.fee_evidence_records);
    if(!records.length&&typeof properties.fee_text==='string'&&properties.fee_text.trim())records.push({source:properties.fee_source||'Source reported',source_field:properties.fee_source_field||null,source_record_id:null,source_url:global.DataQuality.mergeFeeEvidence([{source:'Source',text:'Source',source_url:properties.source_url||properties.website}])[0]?.source_url,retrieved_at:properties.fee_checked,text:properties.fee_text});
    const box=el('section',null,'kt-fee-records');box.append(el('h3','Camping fee evidence'),el('p','Source wording is shown in full. A retrieval date is when KampTrail downloaded the record, not a field inspection. Confirm current fees and restrictions with the operator.','kt-fine'));
    if(properties.fee_conflict)box.append(el('p','Sources disagree. The fee remains unknown; neither statement is treated as proof of free camping.'));
    if(!records.length){box.append(el('p',properties.fee_status==='unknown'?'No camping-fee wording is recorded. The fee remains unknown.':'This snapshot has a structured fee classification but no retained source wording.'));if(Number.isFinite(properties.cost)&&properties.cost>=0)box.append(el('p','Reported nightly amount: $'+properties.cost));if(properties.fee_evidence)box.append(el('p',String(properties.fee_evidence)));}
    const labels={feedescription:'Camping fee information',recareadescription:'Recreation-area description',restrictions:'Restrictions',FacilityDescription:'Campground description',FacilityUseFeeDescription:'Camping fee information',UseFeeDescription:'Camping fee information',fee:'Community fee tag','fee / fee:conditional':'Community fee and conditions tags','official_page.Fee Site and Info':'Official campground fee information','official_page.Camping and access':'Camping and vehicle access'};
    for(const r of records){const details=el('details');details.open=records.length===1;details.append(el('summary',r.source+' · '+(labels[r.source_field]||'Source wording')));
      const meta=[];if(r.source_record_id)meta.push('Record '+r.source_record_id);if(r.retrieved_at)meta.push('Retrieved '+r.retrieved_at);if(r.source_updated_at)meta.push('Source record updated '+r.source_updated_at);if(meta.length)details.append(el('p',meta.join(' · '),'kt-fine'));
      details.append(el('p',r.text,'kt-fee-full-text'));
      if(r.classification_text&&r.classification_text!==r.text){const used=el('details');used.append(el('summary','Wording used to classify the camping fee'),el('p',r.classification_text,'kt-fee-full-text'));details.append(used);}
      if(r.qualification_text){const used=el('details');used.append(el('summary','Conditions used to qualify the fee'),el('p',r.qualification_text,'kt-fee-full-text'));details.append(used);}
      if(r.source_url)details.append(link(r.source_url,'Open source record'));
      if(r.query_url==='https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0/query'&&/^\d+$/.test(r.source_record_id||'')){
        const row=new URL(r.query_url);row.searchParams.set('where','recareaid='+r.source_record_id);row.searchParams.set('outFields','recareaid,recareaname,feedescription,restrictions,recareadescription');row.searchParams.set('returnGeometry','false');row.searchParams.set('f','pjson');
        details.append(el('span',' · '),link(row.href,'View official data row'));
      }
      box.append(details);
    }
    target.replaceChildren(box);relayout(target);
  }
  global.KampTrailSpot = {version: '2.17.0', relayout, landManager, forecast, describeLand, renderLand, renderForecast, renderFeeEvidence, AGENCIES, SMA_URL: SMA};
})(typeof window !== 'undefined' ? window : globalThis);
