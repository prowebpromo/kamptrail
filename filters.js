/* Filters use only reported campsite data. Missing data never counts as a match. */
(function(){
  'use strict';
  const t = (key, params) => (typeof window !== 'undefined' ? window.KampTrailI18n : globalThis.KampTrailI18n)?.t(key, params) ?? String(key).replace(/\{([a-zA-Z0-9_]+)\}/g, (token, name) => Object.hasOwn(params || {}, name) ? String(params[name]) : token);
  const AMENITIES=[['toilet',t("Toilets")],['water',t("Drinking water")],['dump',t("Dump station")],['shower',t("Showers")]];
  const RIGS=[['all',t("Any")],['tent',t("Tents")],['trailer',t("Trailers and caravans")]];
  const HOOKUPS=[['electric',t("Electric")],['water',t("Water")],['sewer',t("Sewer")]];
  const defaults=()=>({cost:'all',type:'all',rigSize:'all',roadDifficulty:'all',amenities:[],minRating:0,rigLength:0,rigIncludeUnknown:false,hookups:[],minReviews:1,scoreSeason:'',minScore_quietness:0,minScore_shade:0,minScore_comfort:0,observedDays:365,elevationMin:null,elevationMax:null,elevationUnit:'ft',forecastMinC:null,forecastMaxC:null,forecastHours:24,forecastUnit:'F'});
  const state={filters:defaults(),panel:null,button:null};
  function close(){state.panel.style.display='none';state.button.setAttribute('aria-expanded','false');}
  function count(f){return Number(f.cost!=='all')+Number(f.type!=='all')+Number(f.rigSize!=='all')+f.amenities.length+Number(f.rigLength>0)+f.hookups.length+Number(f.minRating>0)+Number(f.minReviews>1)+(window.KampTrailDiscovery?.scoreFilterCount(f)||0)+Object.keys(window.KampTrailDiscovery?.AXES||{}).filter(k=>f['observed_'+k]).length+Number(!!f.observed_carrier)+Number(!!f.observed_signal)+Number(DataQuality.elevationRange(f).active)+Number(window.KampTrailForecast?.active(f));}
  function apply(origin='manual'){
    const f=state.filters;
    try{localStorage.setItem('kt_filters_mvp',JSON.stringify({cost:f.cost,type:f.type,rigSize:f.rigSize,amenities:f.amenities,rigLength:f.rigLength,rigIncludeUnknown:f.rigIncludeUnknown,hookups:f.hookups,minRating:f.minRating,minReviews:f.minReviews,scoreSeason:f.scoreSeason,...Object.fromEntries(Object.keys(window.KampTrailDiscovery?.SCORES||{}).map(k=>['minScore_'+k,f['minScore_'+k]||0])),observedDays:f.observedDays,elevationMin:f.elevationMin,elevationMax:f.elevationMax,elevationUnit:f.elevationUnit,forecastMinC:f.forecastMinC,forecastMaxC:f.forecastMaxC,forecastHours:f.forecastHours,forecastUnit:f.forecastUnit,...Object.fromEntries(Object.keys(window.KampTrailDiscovery?.AXES||{}).map(k=>['observed_'+k,f['observed_'+k]||''])),observed_carrier:f.observed_carrier||'',observed_signal:f.observed_signal||''}));}catch{}
    window.kamptrailFilters=f;
    window.KampTrailData?.updateFilters(f);
    if(window.KampTrailDiscovery?.active(f))window.KampTrailDiscovery.load();
    const badge=document.getElementById('filter-badge'),n=count(f);
    if(badge){badge.style.display=n?'inline-block':'none';badge.textContent=n;}
    window.dispatchEvent(new CustomEvent('kamptrail:filterschanged',{detail:{origin}}));
  }
  function sync(){
    const p=state.panel;if(!p)return;
    p.querySelector(`[name="f-cost"][value="${state.filters.cost}"]`).checked=true;
    p.querySelector('#f-type').value=state.filters.type;
    syncElevation();syncForecast();
    p.querySelector('#f-rig').value=state.filters.rigSize;
    p.querySelectorAll('[name="f-amenity"]').forEach(el=>{el.checked=state.filters.amenities.includes(el.value);});
    p.querySelectorAll('[data-camper-filter]').forEach(n=>{n.value=String(state.filters[n.dataset.camperFilter]??'');});
    p.querySelector('#f-length').value=state.filters.rigLength>0?String(state.filters.rigLength):'';
    p.querySelector('#f-length-unknown').checked=!!state.filters.rigIncludeUnknown;
    p.querySelectorAll('[name="f-hookup"]').forEach(el=>{el.checked=state.filters.hookups.includes(el.value);});
  }
  function syncElevation(){
    const p=state.panel;if(!p)return;const unit=state.filters.elevationUnit;
    p.querySelector('#f-elevation-unit').value=unit;
    for(const which of ['Min','Max']){const n=p.querySelector('#f-elevation-'+which.toLowerCase()),value=state.filters['elevation'+which];n.value=value===null?'':String(DataQuality.elevationFromMetres(value,unit));n.setAttribute('aria-label',t("{bound} elevation ({unit})", {bound:which==='Min'?t('Minimum'):t('Maximum'),unit:unit==='m'?t('metres'):t('feet')}));n.removeAttribute('aria-invalid');}
    p.querySelector('#f-elevation-error').textContent='';
  }
  function setElevationFilters(f){
    const candidate={elevationMin:f.elevationMin??null,elevationMax:f.elevationMax??null,elevationUnit:f.elevationUnit==='m'?'m':'ft'};
    if(!DataQuality.elevationRange(candidate).valid)return false;
    Object.assign(state.filters,candidate);syncElevation();apply();return true;
  }
  function syncForecast(){
    const p=state.panel,weather=window.KampTrailForecast;if(!p||!weather)return;const unit=state.filters.forecastUnit;
    p.querySelector('#f-forecast-unit').value=unit;p.querySelector('#f-forecast-hours').value=state.filters.forecastHours;
    for(const which of ['Min','Max']){const n=p.querySelector('#f-forecast-'+which.toLowerCase()),value=state.filters['forecast'+which+'C'];n.value=value===null?'':String(weather.fromC(value,unit));n.setAttribute('aria-label',t("{bound} forecast sample temperature (°{unit})", {bound:which==='Min'?t('Minimum'):t('Maximum'),unit}));n.removeAttribute('aria-invalid');}
    p.querySelector('#f-forecast-error').textContent='';
  }
  function setForecastFilters(f){
    const candidate={forecastMinC:f.forecastMinC??null,forecastMaxC:f.forecastMaxC??null,forecastHours:f.forecastHours??24,forecastUnit:f.forecastUnit==='C'?'C':'F'};
    if(!window.KampTrailForecast?.range(candidate).valid)return false;Object.assign(state.filters,candidate);syncForecast();apply();return true;
  }
  function reset(){state.filters=defaults();sync();apply('reset');}
  function applyProfile(profile){
    const f=window.KampTrailRigProfile?.toFilters(profile);if(!f)return false;
    Object.assign(state.filters,f);sync();apply('profile');return true;
  }
  window.KampTrailFilters={
    version:'2.20.0',
    init(map){
      const p=document.createElement('div');p.id='kt-filter-panel';p.style.cssText='display:none;position:absolute;left:12px;width:300px;border-radius:10px;box-shadow:0 4px 20px #0003';
      p.setAttribute('role','region');p.setAttribute('aria-label',t("Campsite filters"));
      p.innerHTML=`<div class="filter-header"><h2 style="flex:1">${t("Filters")}</h2><button id="kt-f-reset" class="btn">${t("Reset")}</button><button id="kt-f-close" class="btn" aria-label="${t("Close filters")}">${t("Close")}</button></div>
        <div class="filter-body"><p id="kt-rig-filter-status" class="filter-note" role="status">${t("Profile matching is off.")}</p><button type="button" id="kt-filter-rig-profile" class="btn">${t("Rig profile")}</button><strong>${t("Reported fee")}</strong><div class="cost-options">
        <label><input type="radio" name="f-cost" value="all" checked> ${t("All fees")}</label>
        <label><input type="radio" name="f-cost" value="free"> ${t("Free")}</label>
        <label><input type="radio" name="f-cost" value="conditional"> ${t("Free with conditions")}</label>
        <label><input type="radio" name="f-cost" value="paid"> ${t("Paid")}</label>
        <label><input type="radio" name="f-cost" value="unknown"> ${t("Unknown")}</label></div>
        <label for="f-type"><strong>${t("Campsite type")}</strong></label><select id="f-type"><option value="all">${t("All types")}</option><option value="established">${t("Campground")}</option><option value="dispersed">${t("Dispersed")}</option><option value="backcountry">${t("Backcountry")}</option><option value="parking">${t("Overnight parking")}</option><option value="other">${t("Other / unspecified")}</option></select>
        <fieldset class="kt-elevation-filters"><legend>${t("Approximate terrain elevation")}</legend>
        <label for="f-elevation-unit">${t("Elevation units")}</label><select id="f-elevation-unit"><option value="ft">${t("Feet (ft)")}</option><option value="m">${t("Metres (m)")}</option></select>
        <div class="kt-elevation-bounds"><label>${t("Minimum")}<input id="f-elevation-min" type="number" step="any" inputmode="decimal" aria-describedby="f-elevation-help f-elevation-error" placeholder="${t("No minimum")}"></label><label>${t("Maximum")}<input id="f-elevation-max" type="number" step="any" inputmode="decimal" aria-describedby="f-elevation-help f-elevation-error" placeholder="${t("No maximum")}"></label></div>
        <p id="f-elevation-help" class="filter-note">${t("Bounds include their endpoints. Missing elevations are excluded. USGS 3DEP interpolated terrain is approximate; grid resolution does not guarantee point accuracy, road grade or RV clearance.")}</p>
        <p id="f-elevation-error" class="filter-note" role="alert"></p><p id="f-elevation-status" class="filter-note" role="status"></p><button type="button" id="f-elevation-retry" class="btn">${t("Retry elevation data")}</button></fieldset>
        <fieldset class="kt-forecast-filters"><legend>${t("Published forecast temperature samples")}</legend>
        <label for="f-forecast-hours">${t("Forecast window")}</label><select id="f-forecast-hours"><option value="24">${t("Next 24 hours")}</option><option value="48">${t("Next 48 hours")}</option></select>
        <label for="f-forecast-unit">${t("Temperature units")}</label><select id="f-forecast-unit"><option value="F">${t("Fahrenheit (°F)")}</option><option value="C">${t("Celsius (°C)")}</option></select>
        <div class="kt-forecast-bounds"><label>${t("Minimum")}<input id="f-forecast-min" type="number" step="any" inputmode="decimal" aria-describedby="f-forecast-help f-forecast-error" placeholder="${t("No minimum")}"></label><label>${t("Maximum")}<input id="f-forecast-max" type="number" step="any" inputmode="decimal" aria-describedby="f-forecast-help f-forecast-error" placeholder="${t("No maximum")}"></label></div>
        <p id="f-forecast-help" class="filter-note">${t("Every published sample in the next 24 or 48 hours must meet these inclusive bounds. NOAA/NWS NDFD samples can be 1–3 hours apart; these are not continuous or daily temperature extremes. Missing, incomplete, expired and offline forecasts are excluded. Terrain elevation remains available separately.")}</p>
        <p id="f-forecast-error" class="filter-note" role="alert"></p><p id="f-forecast-status" class="filter-note" role="status"></p><button type="button" id="f-forecast-retry" class="btn">${t("Retry forecast samples")}</button></fieldset>
        <label for="f-length"><strong>${t("Fits my rig (feet)")}</strong></label><input id="f-length" type="number" inputmode="decimal" min="0.001" max="80" step="any" placeholder="${t("e.g. 32")}">
        <label class="kt-inline"><input type="checkbox" id="f-length-unknown"> ${t("Include listings with no documented RV length")}</label>
        <fieldset class="amenity-options"><legend><strong>${t("Hookups reported")}</strong></legend>${HOOKUPS.map(([v,l])=>`<label><input type="checkbox" name="f-hookup" value="${v}"> ${l}</label>`).join('')}</fieldset>
        <p class="filter-note">${t("Rig length and hookups use Recreation.gov site details, so only those campgrounds can match. A match means at least one site reports it. Book or confirm the exact site.")}</p>
        <label for="f-rig"><strong>${t("Source says it allows")}</strong></label><select id="f-rig">${RIGS.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select>
        <fieldset class="amenity-options"><legend><strong>${t("Amenities reported")}</strong></legend>${AMENITIES.map(([v,l])=>`<label><input type="checkbox" name="f-amenity" value="${v}"> ${l}</label>`).join('')}</fieldset>
        <p class="filter-note">${t("Rig and amenity filters show only listings whose source reports them. Many listings have no data, so these filters hide a lot. Unknown fees remain unknown. Confirm with the operator.")}</p></div>`;
      map.getContainer().append(p);L.DomEvent.disableClickPropagation(p);L.DomEvent.disableScrollPropagation(p);
      state.panel=p;
      try{
        const saved=JSON.parse(localStorage.getItem('kt_filters_mvp')||'{}');
        if(['all','free','conditional','paid','unknown'].includes(saved.cost))state.filters.cost=saved.cost;
        if(['all','established','dispersed','backcountry','parking','other'].includes(saved.type))state.filters.type=saved.type;
        if(RIGS.some(([v])=>v===saved.rigSize))state.filters.rigSize=saved.rigSize;
        const forecast={forecastMinC:saved.forecastMinC??null,forecastMaxC:saved.forecastMaxC??null,forecastHours:saved.forecastHours??24,forecastUnit:saved.forecastUnit==='C'?'C':'F'};if(window.KampTrailForecast?.range(forecast).valid)Object.assign(state.filters,forecast);
        const e={elevationMin:saved.elevationMin??null,elevationMax:saved.elevationMax??null};if(DataQuality.elevationRange(e).valid)Object.assign(state.filters,e);state.filters.elevationUnit=saved.elevationUnit==='m'?'m':'ft';
        if(Number.isFinite(saved.rigLength)&&saved.rigLength>0&&saved.rigLength<=80)state.filters.rigLength=saved.rigLength;
        state.filters.rigIncludeUnknown=saved.rigIncludeUnknown===true;
        if(Array.isArray(saved.hookups))state.filters.hookups=saved.hookups.filter(h=>HOOKUPS.some(([v])=>v===h));
        if(Array.isArray(saved.amenities))state.filters.amenities=saved.amenities.filter(a=>AMENITIES.some(([v])=>v===a));
      }catch{}
      const forecast=window.KampTrailForecast;
      if(forecast){
        const forecastChange=()=>{const candidate={forecastHours:state.filters.forecastHours};let invalid=false;
          for(const which of ['Min','Max']){const n=p.querySelector('#f-forecast-'+which.toLowerCase());candidate['forecast'+which+'C']=n.value.trim()===''?null:forecast.toC(Number(n.value),state.filters.forecastUnit);if(n.validity.badInput)invalid=true;}
          if(invalid||!forecast.range(candidate).valid){p.querySelector('#f-forecast-error').textContent=t("Enter bounds between −100 and 70 °C (−148 to 158 °F), with minimum no greater than maximum. Your last valid filter remains applied.");for(const n of p.querySelectorAll('.kt-forecast-bounds input'))n.setAttribute('aria-invalid','true');return;}
          Object.assign(state.filters,candidate);p.querySelector('#f-forecast-error').textContent='';for(const n of p.querySelectorAll('.kt-forecast-bounds input'))n.removeAttribute('aria-invalid');apply();
        };
        for(const n of p.querySelectorAll('.kt-forecast-bounds input'))n.onchange=forecastChange;
        p.querySelector('#f-forecast-unit').onchange=e=>{state.filters.forecastUnit=e.target.value;syncForecast();apply();};
        p.querySelector('#f-forecast-hours').onchange=e=>{state.filters.forecastHours=Number(e.target.value);apply();};
        const forecastStatus=()=>{const info=window.KampTrailData?.getForecastStatus?.(),active=forecast.active(state.filters),overview=window.KampTrailData?.getLoadStatus?.().overview;
          p.querySelector('#f-forecast-status').textContent=!active?t("Forecast filters are off."):overview?t("Zoom in to load published forecast samples."):t("{0} listings matching other filters in this view have unknown or incomplete current forecasts and are excluded. {1}", {"0":(info?.unknown||0),"1":(forecast.statusText())});
          p.querySelector('#f-forecast-retry').hidden=!active||overview;p.querySelector('#f-forecast-retry').disabled=!!info?.loading;
        };
        window.addEventListener('kamptrail:dataupdated',forecastStatus);window.addEventListener('kamptrail:forecastupdated',forecastStatus);p.querySelector('#f-forecast-retry').onclick=()=>window.KampTrailData?.refreshForecast();forecastStatus();
      }
      const elevationChange=()=>{
        const candidate={};let invalid=false;
        for(const which of ['Min','Max']){const n=p.querySelector('#f-elevation-'+which.toLowerCase());candidate['elevation'+which]=n.value.trim()===''?null:DataQuality.elevationToMetres(Number(n.value),state.filters.elevationUnit);if(n.validity.badInput)invalid=true;}
        if(invalid||!DataQuality.elevationRange(candidate).valid){p.querySelector('#f-elevation-error').textContent=t("Enter valid bounds between −500 and 9,000 metres (about −1,640 to 29,528 ft), with minimum no greater than maximum. Your last valid filter remains applied.");for(const n of p.querySelectorAll('.kt-elevation-bounds input'))n.setAttribute('aria-invalid','true');return;}
        Object.assign(state.filters,candidate);p.querySelector('#f-elevation-error').textContent='';for(const n of p.querySelectorAll('.kt-elevation-bounds input'))n.removeAttribute('aria-invalid');apply();
      };
      for(const n of p.querySelectorAll('.kt-elevation-bounds input'))n.onchange=elevationChange;
      p.querySelector('#f-elevation-unit').onchange=e=>{state.filters.elevationUnit=e.target.value;syncElevation();apply();};
      const elevationStatus=()=>{const s=window.KampTrailData?.getElevationStatus?.(),active=DataQuality.elevationRange(state.filters).active;const status=p.querySelector('#f-elevation-status');status.textContent=window.KampTrailData?.getLoadStatus?.().overview?t("Zoom in to load campsite elevations."):s?.loading?t("Loading terrain elevations…"):active?t("{0} listings matching other filters in this view have unknown elevation and are excluded.{1}{2}", {"0":(s?.unknown||0),"1":(s?.saved?t(" Saved static elevation evidence is in use."):''),"2":(s?.unavailable?.length?t(" Elevation data unavailable for ")+s.unavailable.join(', ')+'.':'')}):t("Elevation filters are off.");p.querySelector('#f-elevation-retry').hidden=!s?.unavailable?.length;p.querySelector('#f-elevation-retry').disabled=!!s?.loading;};
      window.addEventListener('kamptrail:dataupdated',elevationStatus);p.querySelector('#f-elevation-retry').onclick=()=>window.KampTrailData?.refresh();elevationStatus();
      const evidence=window.KampTrailDiscovery;
      if(evidence){
        const set=document.createElement('fieldset');set.className='kt-camper-filters';const legend=document.createElement('legend');legend.textContent=t("Published camper evidence");set.append(legend);
        const add=(name,label,options,defaultValue='')=>{const l=document.createElement('label');l.textContent=label;const n=document.createElement('select');n.dataset.camperFilter=name;n.setAttribute('aria-label',label);for(const[value,text]of options){const o=document.createElement('option');o.value=value;o.textContent=text;n.append(o);}l.append(n);set.append(l);const savedValue=String(savedCamper[name]??defaultValue);if(options.some(([v])=>v===savedValue))state.filters[name]=(['minRating','minReviews','observedDays'].includes(name)||name.startsWith('minScore_'))?+savedValue:savedValue;n.onchange=()=>{state.filters[name]=(['minRating','minReviews','observedDays'].includes(name)||name.startsWith('minScore_'))?+n.value:n.value;apply();};};
        let savedCamper={};try{savedCamper=JSON.parse(localStorage.getItem('kt_filters_mvp')||'{}');}catch{}
        add('minRating',t("Minimum community rating"),[['0',t("Any rating")],['3',t("3+ stars")],['4',t("4+ stars")],['5',t("5 stars")]],'0');
        add('minReviews',t("Minimum published reviews"),[['1',t("1+ reviews")],['3',t("3+ reviews")],['5',t("5+ reviews")]],'1');
        for(const[k,a]of Object.entries(evidence.AXES))add('observed_'+k,t('Reported {label}',{label:a.label.toLowerCase()}),[['',t("Any / not filtering")],...Object.entries(a.values)]);
        add('observed_carrier',t("Reported carrier"),[['',t("Any carrier")],...Object.entries(evidence.CARRIERS)]);
        add('observed_signal',t("Reported signal"),[['',t("Any signal")],...Object.entries(evidence.SIGNAL_FILTER)]);
        add('observedDays',t("Observation age"),[['0',t("Any visit date")],['365',t("Past 12 months")],['90',t("Past 90 days")]],'365');
        add('scoreSeason',t("Numeric rating visit season"),[['',t("All calendar seasons")],...Object.entries(evidence.SEASONS)]);
        for(const[k,a]of Object.entries(evidence.SCORES))add('minScore_'+k,t('Minimum average {aspect} score',{aspect:a.label.toLowerCase()}),[['0',t("Any / not filtering")],['3',t("3+ of 5")],['4',t("4+ of 5")],['5',t("5 of 5")]],'0');
        const scoreNote=document.createElement('p');scoreNote.className='filter-note';scoreNote.textContent=t("Numeric scores are subjective. Each average needs 3+ explicit published ratings within the selected season and age. Combined selections use visits reporting all chosen aspects and meeting all condition and carrier selections. Season alone needs 3+ ratings for an aspect. Calendar seasons combine years; missing or insufficient evidence never matches.");set.append(scoreNote);
        const note=document.createElement('p');note.className='filter-note';note.textContent=t("Ratings use all published reviews. Condition selections must occur on the same reported visit, within the selected age. Missing reports do not match. Camper reports are not FCC predictions, permission or safety guarantees.");set.append(note);
        const status=document.createElement('p');status.className='filter-note';status.setAttribute('role','status');const refresh=document.createElement('button');refresh.type='button';refresh.className='btn';refresh.textContent=t("Refresh camper evidence");refresh.onclick=()=>evidence.load(true);set.append(status,refresh);const showStatus=()=>{status.textContent=evidence.status();refresh.disabled=status.textContent.startsWith(t("Loading"));};window.addEventListener('kamptrail:discoveryupdated',showStatus);showStatus();p.querySelector('.filter-body').append(set);
      }
      sync();
      state.button=document.getElementById('filters');
      state.button.onclick=()=>{const open=p.style.display==='none';p.style.display=open?'block':'none';state.button.setAttribute('aria-expanded',String(open));};
      p.querySelector('#kt-filter-rig-profile').onclick=()=>window.KampTrailRigProfile?.open();
      p.querySelector('#kt-f-reset').onclick=reset;p.querySelector('#kt-f-close').onclick=()=>{close();state.button.focus();};
      p.querySelectorAll('[name="f-cost"]').forEach(el=>el.onchange=()=>{state.filters.cost=el.value;apply();});
      p.querySelector('#f-type').onchange=e=>{state.filters.type=e.target.value;apply();};
      p.querySelector('#f-rig').onchange=e=>{state.filters.rigSize=e.target.value;apply();};
      p.querySelectorAll('[name="f-amenity"]').forEach(el=>el.onchange=()=>{state.filters.amenities=[...p.querySelectorAll('[name="f-amenity"]:checked')].map(i=>i.value);apply();});
      const len=p.querySelector('#f-length');
      // Apply while typing, and make the later change event a no-op, so a click right after typing is not lost to a re-render.
      let lenTimer;
      const setLen=final=>{const raw=len.value.trim(),n=Number(raw);const next=raw&&Number.isFinite(n)&&n>0&&n<=80?n:0;if(final&&!next&&raw)len.value='';if(next===state.filters.rigLength)return;state.filters.rigLength=next;apply();};
      len.oninput=()=>{clearTimeout(lenTimer);lenTimer=setTimeout(()=>setLen(false),400);};
      len.onchange=()=>{clearTimeout(lenTimer);setLen(true);};
      p.querySelector('#f-length-unknown').onchange=e=>{state.filters.rigIncludeUnknown=e.target.checked;apply();};
      p.querySelectorAll('[name="f-hookup"]').forEach(el=>el.onchange=()=>{state.filters.hookups=[...p.querySelectorAll('[name="f-hookup"]:checked')].map(i=>i.value);apply();});
      document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
      apply();
    },reset,applyProfile,setElevationFilters,setForecastFilters,setIncludeUnknownLength(on){state.filters.rigIncludeUnknown=!!on;sync();apply();},getFilters:()=>({...state.filters,amenities:[...state.filters.amenities],hookups:[...state.filters.hookups]})
  };
})();
