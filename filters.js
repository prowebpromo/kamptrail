/* Filters use only reported campsite data. Missing data never counts as a match. */
(function(){
  'use strict';
  const AMENITIES=[['toilet','Toilets'],['water','Drinking water'],['dump','Dump station'],['shower','Showers']];
  const RIGS=[['all','Any'],['tent','Tents'],['trailer','Trailers and caravans']];
  const HOOKUPS=[['electric','Electric'],['water','Water'],['sewer','Sewer']];
  const defaults=()=>({cost:'all',type:'all',rigSize:'all',roadDifficulty:'all',amenities:[],minRating:0,rigLength:0,rigIncludeUnknown:false,hookups:[]});
  const state={filters:defaults(),panel:null,button:null};
  function close(){state.panel.style.display='none';state.button.setAttribute('aria-expanded','false');}
  function count(f){return Number(f.cost!=='all')+Number(f.type!=='all')+Number(f.rigSize!=='all')+f.amenities.length+Number(f.rigLength>0)+f.hookups.length;}
  function apply(){
    const f=state.filters;
    try{localStorage.setItem('kt_filters_mvp',JSON.stringify({cost:f.cost,type:f.type,rigSize:f.rigSize,amenities:f.amenities,rigLength:f.rigLength,rigIncludeUnknown:f.rigIncludeUnknown,hookups:f.hookups}));}catch{}
    window.kamptrailFilters=f;
    window.KampTrailData?.updateFilters(f);
    const badge=document.getElementById('filter-badge'),n=count(f);
    badge.style.display=n?'inline-block':'none';badge.textContent=n;
  }
  function sync(){
    const p=state.panel;if(!p)return;
    p.querySelector(`[name="f-cost"][value="${state.filters.cost}"]`).checked=true;
    p.querySelector('#f-type').value=state.filters.type;
    p.querySelector('#f-rig').value=state.filters.rigSize;
    p.querySelectorAll('[name="f-amenity"]').forEach(el=>{el.checked=state.filters.amenities.includes(el.value);});
    p.querySelector('#f-length').value=state.filters.rigLength>0?String(state.filters.rigLength):'';
    p.querySelector('#f-length-unknown').checked=!!state.filters.rigIncludeUnknown;
    p.querySelectorAll('[name="f-hookup"]').forEach(el=>{el.checked=state.filters.hookups.includes(el.value);});
  }
  function reset(){state.filters=defaults();sync();apply();}
  window.KampTrailFilters={
    version:'2.5.0',
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
        if(Number.isInteger(saved.rigLength)&&saved.rigLength>=10&&saved.rigLength<=80)state.filters.rigLength=saved.rigLength;
        state.filters.rigIncludeUnknown=saved.rigIncludeUnknown===true;
        if(Array.isArray(saved.hookups))state.filters.hookups=saved.hookups.filter(h=>HOOKUPS.some(([v])=>v===h));
        if(Array.isArray(saved.amenities))state.filters.amenities=saved.amenities.filter(a=>AMENITIES.some(([v])=>v===a));
      }catch{}
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
    },reset,setIncludeUnknownLength(on){state.filters.rigIncludeUnknown=!!on;sync();apply();},getFilters:()=>({...state.filters,amenities:[...state.filters.amenities],hookups:[...state.filters.hookups]})
  };
})();
