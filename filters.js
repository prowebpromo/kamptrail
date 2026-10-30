/* Filters use only reported campsite data. Missing data never counts as a match. */
(function(){
  'use strict';
  const AMENITIES=[['toilet','Toilets'],['water','Drinking water'],['dump','Dump station'],['shower','Showers']];
  const RIGS=[['all','Any'],['tent','Tents'],['trailer','Trailers and caravans']];
  const HOOKUPS=[['electric','Electric'],['water','Water'],['sewer','Sewer']];
  const defaults=()=>({cost:'all',type:'all',rigSize:'all',roadDifficulty:'all',amenities:[],minRating:0,rigLength:0,rigIncludeUnknown:false,hookups:[],minReviews:1,observedDays:365,elevationMin:null,elevationMax:null,elevationUnit:'ft',forecastMinC:null,forecastMaxC:null,forecastHours:24,forecastUnit:'F'});
  const state={filters:defaults(),panel:null,button:null};
  function close(){state.panel.style.display='none';state.button.setAttribute('aria-expanded','false');}
  function count(f){return Number(f.cost!=='all')+Number(f.type!=='all')+Number(f.rigSize!=='all')+f.amenities.length+Number(f.rigLength>0)+f.hookups.length+Number(f.minRating>0)+Number(f.minReviews>1)+Object.keys(window.KampTrailDiscovery?.AXES||{}).filter(k=>f['observed_'+k]).length+Number(!!f.observed_carrier)+Number(!!f.observed_signal)+Number(DataQuality.elevationRange(f).active)+Number(window.KampTrailForecast?.active(f));}
  function apply(){
    const f=state.filters;
    try{localStorage.setItem('kt_filters_mvp',JSON.stringify({cost:f.cost,type:f.type,rigSize:f.rigSize,amenities:f.amenities,rigLength:f.rigLength,rigIncludeUnknown:f.rigIncludeUnknown,hookups:f.hookups,minRating:f.minRating,minReviews:f.minReviews,observedDays:f.observedDays,elevationMin:f.elevationMin,elevationMax:f.elevationMax,elevationUnit:f.elevationUnit,forecastMinC:f.forecastMinC,forecastMaxC:f.forecastMaxC,forecastHours:f.forecastHours,forecastUnit:f.forecastUnit,...Object.fromEntries(Object.keys(window.KampTrailDiscovery?.AXES||{}).map(k=>['observed_'+k,f['observed_'+k]||''])),observed_carrier:f.observed_carrier||'',observed_signal:f.observed_signal||''}));}catch{}
    window.kamptrailFilters=f;
    window.KampTrailData?.updateFilters(f);
    if(window.KampTrailDiscovery?.active(f))window.KampTrailDiscovery.load();
    const badge=document.getElementById('filter-badge'),n=count(f);
    badge.style.display=n?'inline-block':'none';badge.textContent=n;
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
    for(const which of ['Min','Max']){const n=p.querySelector('#f-elevation-'+which.toLowerCase()),value=state.filters['elevation'+which];n.value=value===null?'':String(DataQuality.elevationFromMetres(value,unit));n.setAttribute('aria-label',(which==='Min'?'Minimum':'Maximum')+' elevation ('+(unit==='m'?'metres':'feet')+')');n.removeAttribute('aria-invalid');}
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
    for(const which of ['Min','Max']){const n=p.querySelector('#f-forecast-'+which.toLowerCase()),value=state.filters['forecast'+which+'C'];n.value=value===null?'':String(weather.fromC(value,unit));n.setAttribute('aria-label',(which==='Min'?'Minimum':'Maximum')+' forecast sample temperature (°'+unit+')');n.removeAttribute('aria-invalid');}
    p.querySelector('#f-forecast-error').textContent='';
  }
  function setForecastFilters(f){
    const candidate={forecastMinC:f.forecastMinC??null,forecastMaxC:f.forecastMaxC??null,forecastHours:f.forecastHours??24,forecastUnit:f.forecastUnit==='C'?'C':'F'};
    if(!window.KampTrailForecast?.range(candidate).valid)return false;Object.assign(state.filters,candidate);syncForecast();apply();return true;
  }
  function reset(){state.filters=defaults();sync();apply();}
  window.KampTrailFilters={
    version:'2.13.0',
    init(map){
      const p=document.createElement('div');p.id='kt-filter-panel';p.style.cssText='display:none;position:absolute;left:12px;width:300px;border-radius:10px;box-shadow:0 4px 20px #0003';
      p.setAttribute('role','region');p.setAttribute('aria-label','Campsite filters');
      p.innerHTML=`<div class="filter-header"><h2 style="flex:1">Filters</h2><button id="kt-f-reset" class="btn">Reset</button><button id="kt-f-close" class="btn" aria-label="Close filters">Close</button></div>
        <div class="filter-body"><strong>Reported fee</strong><div class="cost-options">
        <label><input type="radio" name="f-cost" value="all" checked> All fees</label>
        <label><input type="radio" name="f-cost" value="free"> Free</label>
        <label><input type="radio" name="f-cost" value="conditional"> Free with conditions</label>
        <label><input type="radio" name="f-cost" value="paid"> Paid</label>
        <label><input type="radio" name="f-cost" value="unknown"> Unknown</label></div>
        <label for="f-type"><strong>Campsite type</strong></label><select id="f-type"><option value="all">All types</option><option value="established">Campground</option><option value="dispersed">Dispersed</option><option value="backcountry">Backcountry</option><option value="parking">Overnight parking</option><option value="other">Other / unspecified</option></select>
        <fieldset class="kt-elevation-filters"><legend>Approximate terrain elevation</legend>
        <label for="f-elevation-unit">Elevation units</label><select id="f-elevation-unit"><option value="ft">Feet (ft)</option><option value="m">Metres (m)</option></select>
        <div class="kt-elevation-bounds"><label>Minimum<input id="f-elevation-min" type="number" step="any" inputmode="decimal" aria-describedby="f-elevation-help f-elevation-error" placeholder="No minimum"></label><label>Maximum<input id="f-elevation-max" type="number" step="any" inputmode="decimal" aria-describedby="f-elevation-help f-elevation-error" placeholder="No maximum"></label></div>
        <p id="f-elevation-help" class="filter-note">Bounds include their endpoints. Missing elevations are excluded. USGS 3DEP interpolated terrain is approximate; grid resolution does not guarantee point accuracy, road grade or RV clearance.</p>
        <p id="f-elevation-error" class="filter-note" role="alert"></p><p id="f-elevation-status" class="filter-note" role="status"></p><button type="button" id="f-elevation-retry" class="btn">Retry elevation data</button></fieldset>
        <fieldset class="kt-forecast-filters"><legend>Published forecast temperature samples</legend>
        <label for="f-forecast-hours">Forecast window</label><select id="f-forecast-hours"><option value="24">Next 24 hours</option><option value="48">Next 48 hours</option></select>
        <label for="f-forecast-unit">Temperature units</label><select id="f-forecast-unit"><option value="F">Fahrenheit (°F)</option><option value="C">Celsius (°C)</option></select>
        <div class="kt-forecast-bounds"><label>Minimum<input id="f-forecast-min" type="number" step="any" inputmode="decimal" aria-describedby="f-forecast-help f-forecast-error" placeholder="No minimum"></label><label>Maximum<input id="f-forecast-max" type="number" step="any" inputmode="decimal" aria-describedby="f-forecast-help f-forecast-error" placeholder="No maximum"></label></div>
        <p id="f-forecast-help" class="filter-note">Every published sample in the next 24 or 48 hours must meet these inclusive bounds. NOAA/NWS NDFD samples can be 1–3 hours apart; these are not continuous or daily temperature extremes. Missing, incomplete, expired and offline forecasts are excluded. Terrain elevation remains available separately.</p>
        <p id="f-forecast-error" class="filter-note" role="alert"></p><p id="f-forecast-status" class="filter-note" role="status"></p><button type="button" id="f-forecast-retry" class="btn">Retry forecast samples</button></fieldset>
        <label for="f-length"><strong>Fits my rig (feet)</strong></label><input id="f-length" type="number" inputmode="numeric" min="10" max="80" step="1" placeholder="e.g. 32">
        <label class="kt-inline"><input type="checkbox" id="f-length-unknown"> Include listings with no documented RV length</label>
        <fieldset class="amenity-options"><legend><strong>Hookups reported</strong></legend>${HOOKUPS.map(([v,l])=>`<label><input type="checkbox" name="f-hookup" value="${v}"> ${l}</label>`).join('')}</fieldset>
        <p class="filter-note">Rig length and hookups use Recreation.gov site details, so only those campgrounds can match. A match means at least one site reports it. Book or confirm the exact site.</p>
        <label for="f-rig"><strong>Source says it allows</strong></label><select id="f-rig">${RIGS.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select>
        <fieldset class="amenity-options"><legend><strong>Amenities reported</strong></legend>${AMENITIES.map(([v,l])=>`<label><input type="checkbox" name="f-amenity" value="${v}"> ${l}</label>`).join('')}</fieldset>
        <p class="filter-note">Rig and amenity filters show only listings whose source reports them. Many listings have no data, so these filters hide a lot. Unknown fees remain unknown. Confirm with the operator.</p></div>`;
      map.getContainer().append(p);L.DomEvent.disableClickPropagation(p);L.DomEvent.disableScrollPropagation(p);
      state.panel=p;
      try{
        const saved=JSON.parse(localStorage.getItem('kt_filters_mvp')||'{}');
        if(['all','free','conditional','paid','unknown'].includes(saved.cost))state.filters.cost=saved.cost;
        if(['all','established','dispersed','backcountry','parking','other'].includes(saved.type))state.filters.type=saved.type;
        if(RIGS.some(([v])=>v===saved.rigSize))state.filters.rigSize=saved.rigSize;
        const forecast={forecastMinC:saved.forecastMinC??null,forecastMaxC:saved.forecastMaxC??null,forecastHours:saved.forecastHours??24,forecastUnit:saved.forecastUnit==='C'?'C':'F'};if(window.KampTrailForecast?.range(forecast).valid)Object.assign(state.filters,forecast);
        const e={elevationMin:saved.elevationMin??null,elevationMax:saved.elevationMax??null};if(DataQuality.elevationRange(e).valid)Object.assign(state.filters,e);state.filters.elevationUnit=saved.elevationUnit==='m'?'m':'ft';
        if(Number.isInteger(saved.rigLength)&&saved.rigLength>=10&&saved.rigLength<=80)state.filters.rigLength=saved.rigLength;
        state.filters.rigIncludeUnknown=saved.rigIncludeUnknown===true;
        if(Array.isArray(saved.hookups))state.filters.hookups=saved.hookups.filter(h=>HOOKUPS.some(([v])=>v===h));
        if(Array.isArray(saved.amenities))state.filters.amenities=saved.amenities.filter(a=>AMENITIES.some(([v])=>v===a));
      }catch{}
      const forecast=window.KampTrailForecast;
      if(forecast){
        const forecastChange=()=>{const candidate={forecastHours:state.filters.forecastHours};let invalid=false;
          for(const which of ['Min','Max']){const n=p.querySelector('#f-forecast-'+which.toLowerCase());candidate['forecast'+which+'C']=n.value.trim()===''?null:forecast.toC(Number(n.value),state.filters.forecastUnit);if(n.validity.badInput)invalid=true;}
          if(invalid||!forecast.range(candidate).valid){p.querySelector('#f-forecast-error').textContent='Enter bounds between −100 and 70 °C (−148 to 158 °F), with minimum no greater than maximum. Your last valid filter remains applied.';for(const n of p.querySelectorAll('.kt-forecast-bounds input'))n.setAttribute('aria-invalid','true');return;}
          Object.assign(state.filters,candidate);p.querySelector('#f-forecast-error').textContent='';for(const n of p.querySelectorAll('.kt-forecast-bounds input'))n.removeAttribute('aria-invalid');apply();
        };
        for(const n of p.querySelectorAll('.kt-forecast-bounds input'))n.onchange=forecastChange;
        p.querySelector('#f-forecast-unit').onchange=e=>{state.filters.forecastUnit=e.target.value;syncForecast();apply();};
        p.querySelector('#f-forecast-hours').onchange=e=>{state.filters.forecastHours=Number(e.target.value);apply();};
        const forecastStatus=()=>{const info=window.KampTrailData?.getForecastStatus?.(),active=forecast.active(state.filters),overview=window.KampTrailData?.getLoadStatus?.().overview;
          p.querySelector('#f-forecast-status').textContent=!active?'Forecast filters are off.':overview?'Zoom in to load published forecast samples.':`${info?.unknown||0} listings matching other filters in this view have unknown or incomplete current forecasts and are excluded. ${forecast.statusText()}`;
          p.querySelector('#f-forecast-retry').hidden=!active||overview;p.querySelector('#f-forecast-retry').disabled=!!info?.loading;
        };
        window.addEventListener('kamptrail:dataupdated',forecastStatus);window.addEventListener('kamptrail:forecastupdated',forecastStatus);p.querySelector('#f-forecast-retry').onclick=()=>window.KampTrailData?.refreshForecast();forecastStatus();
      }
      const elevationChange=()=>{
        const candidate={};let invalid=false;
        for(const which of ['Min','Max']){const n=p.querySelector('#f-elevation-'+which.toLowerCase());candidate['elevation'+which]=n.value.trim()===''?null:DataQuality.elevationToMetres(Number(n.value),state.filters.elevationUnit);if(n.validity.badInput)invalid=true;}
        if(invalid||!DataQuality.elevationRange(candidate).valid){p.querySelector('#f-elevation-error').textContent='Enter valid bounds between −500 and 9,000 metres (about −1,640 to 29,528 ft), with minimum no greater than maximum. Your last valid filter remains applied.';for(const n of p.querySelectorAll('.kt-elevation-bounds input'))n.setAttribute('aria-invalid','true');return;}
        Object.assign(state.filters,candidate);p.querySelector('#f-elevation-error').textContent='';for(const n of p.querySelectorAll('.kt-elevation-bounds input'))n.removeAttribute('aria-invalid');apply();
      };
      for(const n of p.querySelectorAll('.kt-elevation-bounds input'))n.onchange=elevationChange;
      p.querySelector('#f-elevation-unit').onchange=e=>{state.filters.elevationUnit=e.target.value;syncElevation();apply();};
      const elevationStatus=()=>{const s=window.KampTrailData?.getElevationStatus?.(),active=DataQuality.elevationRange(state.filters).active;const status=p.querySelector('#f-elevation-status');status.textContent=window.KampTrailData?.getLoadStatus?.().overview?'Zoom in to load campsite elevations.':s?.loading?'Loading terrain elevations…':active?`${s?.unknown||0} listings matching other filters in this view have unknown elevation and are excluded.${s?.saved?' Saved static elevation evidence is in use.':''}${s?.unavailable?.length?' Elevation data unavailable for '+s.unavailable.join(', ')+'.':''}`:'Elevation filters are off.';p.querySelector('#f-elevation-retry').hidden=!s?.unavailable?.length;p.querySelector('#f-elevation-retry').disabled=!!s?.loading;};
      window.addEventListener('kamptrail:dataupdated',elevationStatus);p.querySelector('#f-elevation-retry').onclick=()=>window.KampTrailData?.refresh();elevationStatus();
      const evidence=window.KampTrailDiscovery;
      if(evidence){
        const set=document.createElement('fieldset');set.className='kt-camper-filters';const legend=document.createElement('legend');legend.textContent='Published camper evidence';set.append(legend);
        const add=(name,label,options,defaultValue='')=>{const l=document.createElement('label');l.textContent=label;const n=document.createElement('select');n.dataset.camperFilter=name;n.setAttribute('aria-label',label);for(const[value,text]of options){const o=document.createElement('option');o.value=value;o.textContent=text;n.append(o);}l.append(n);set.append(l);const savedValue=String(savedCamper[name]??defaultValue);if(options.some(([v])=>v===savedValue))state.filters[name]=['minRating','minReviews','observedDays'].includes(name)?+savedValue:savedValue;n.onchange=()=>{state.filters[name]=['minRating','minReviews','observedDays'].includes(name)?+n.value:n.value;apply();};};
        let savedCamper={};try{savedCamper=JSON.parse(localStorage.getItem('kt_filters_mvp')||'{}');}catch{}
        add('minRating','Minimum community rating',[['0','Any rating'],['3','3+ stars'],['4','4+ stars'],['5','5 stars']],'0');
        add('minReviews','Minimum published reviews',[['1','1+ reviews'],['3','3+ reviews'],['5','5+ reviews']],'1');
        for(const[k,a]of Object.entries(evidence.AXES))add('observed_'+k,'Reported '+a.label.toLowerCase(),[['','Any / not filtering'],...Object.entries(a.values)]);
        add('observed_carrier','Reported carrier',[['','Any carrier'],...Object.entries(evidence.CARRIERS)]);
        add('observed_signal','Reported signal',[['','Any signal'],...Object.entries(evidence.SIGNAL_FILTER)]);
        add('observedDays','Observation age',[['0','Any visit date'],['365','Past 12 months'],['90','Past 90 days']],'365');
        const note=document.createElement('p');note.className='filter-note';note.textContent='Ratings use all published reviews. Condition selections must occur on the same reported visit, within the selected age. Missing reports do not match. Camper reports are not FCC predictions, permission or safety guarantees.';set.append(note);
        const status=document.createElement('p');status.className='filter-note';status.setAttribute('role','status');const refresh=document.createElement('button');refresh.type='button';refresh.className='btn';refresh.textContent='Refresh camper evidence';refresh.onclick=()=>evidence.load(true);set.append(status,refresh);const showStatus=()=>{status.textContent=evidence.status();refresh.disabled=status.textContent.startsWith('Loading');};window.addEventListener('kamptrail:discoveryupdated',showStatus);showStatus();p.querySelector('.filter-body').append(set);
      }
      sync();
      state.button=document.getElementById('filters');
      state.button.onclick=()=>{const open=p.style.display==='none';p.style.display=open?'block':'none';state.button.setAttribute('aria-expanded',String(open));};
      p.querySelector('#kt-f-reset').onclick=reset;p.querySelector('#kt-f-close').onclick=()=>{close();state.button.focus();};
      p.querySelectorAll('[name="f-cost"]').forEach(el=>el.onchange=()=>{state.filters.cost=el.value;apply();});
      p.querySelector('#f-type').onchange=e=>{state.filters.type=e.target.value;apply();};
      p.querySelector('#f-rig').onchange=e=>{state.filters.rigSize=e.target.value;apply();};
      p.querySelectorAll('[name="f-amenity"]').forEach(el=>el.onchange=()=>{state.filters.amenities=[...p.querySelectorAll('[name="f-amenity"]:checked')].map(i=>i.value);apply();});
      const len=p.querySelector('#f-length');
      // Apply while typing, and make the later change event a no-op, so a click right after typing is not lost to a re-render.
      let lenTimer;
      const setLen=final=>{const raw=len.value.trim(),n=Math.round(+raw);const next=raw&&n>=10&&n<=80?n:0;if(final&&!next&&raw)len.value='';if(next===state.filters.rigLength)return;state.filters.rigLength=next;apply();};
      len.oninput=()=>{clearTimeout(lenTimer);lenTimer=setTimeout(()=>setLen(false),400);};
      len.onchange=()=>{clearTimeout(lenTimer);setLen(true);};
      p.querySelector('#f-length-unknown').onchange=e=>{state.filters.rigIncludeUnknown=e.target.checked;apply();};
      p.querySelectorAll('[name="f-hookup"]').forEach(el=>el.onchange=()=>{state.filters.hookups=[...p.querySelectorAll('[name="f-hookup"]:checked')].map(i=>i.value);apply();});
      document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
      apply();
    },reset,setElevationFilters,setForecastFilters,setIncludeUnknownLength(on){state.filters.rigIncludeUnknown=!!on;sync();apply();},getFilters:()=>({...state.filters,amenities:[...state.filters.amenities],hookups:[...state.filters.hookups]})
  };
})();
