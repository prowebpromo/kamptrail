/* MVP filters use only reportable campsite fee and type data. */
(function(){
  'use strict';
  const defaults=()=>({cost:'all',type:'all',rigSize:'all',roadDifficulty:'all',amenities:[],minRating:0});
  const state={filters:defaults(),panel:null,button:null};
  function close(){state.panel.style.display='none';state.button.setAttribute('aria-expanded','false');}
  function apply(){
    try{localStorage.setItem('kt_filters_mvp',JSON.stringify({cost:state.filters.cost,type:state.filters.type}));}catch{}
    window.kamptrailFilters=state.filters;
    window.KampTrailData?.updateFilters(state.filters);
    const badge=document.getElementById('filter-badge'),n=Number(state.filters.cost!=='all')+Number(state.filters.type!=='all');
    badge.style.display=n?'inline-block':'none';badge.textContent=n;
  }
  function reset(){
    state.filters=defaults();
    if(state.panel){state.panel.querySelector('[name="f-cost"][value="all"]').checked=true;state.panel.querySelector('#f-type').value='all';}
    apply();
  }
  window.KampTrailFilters={
    version:'2.2.1',
    init(map){
      const p=document.createElement('div');p.id='kt-filter-panel';p.style.cssText='display:none;position:absolute;left:12px;width:300px;border-radius:10px;box-shadow:0 4px 20px #0003';
      p.setAttribute('role','region');p.setAttribute('aria-label','Campsite filters');
      p.innerHTML=`<div class="filter-header"><h2 style="flex:1">Filters</h2><button id="kt-f-reset" class="btn">Reset</button><button id="kt-f-close" class="btn" aria-label="Close filters">Close</button></div>
        <div class="filter-body"><strong>Reported fee</strong><div class="cost-options">
        <label><input type="radio" name="f-cost" value="all" checked> All fees</label>
        <label><input type="radio" name="f-cost" value="free"> Free</label>
        <label><input type="radio" name="f-cost" value="paid"> Paid</label>
        <label><input type="radio" name="f-cost" value="unknown"> Unknown</label></div>
        <label for="f-type"><strong>Campsite type</strong></label><select id="f-type"><option value="all">All types</option><option value="established">Campground</option><option value="dispersed">Dispersed</option><option value="backcountry">Backcountry</option><option value="parking">Overnight parking</option><option value="other">Other / unspecified</option></select>
        <p class="filter-note">Unknown fees remain unknown. Source reports can change. Confirm current fees and camping access with the operator.</p></div>`;
      map.getContainer().append(p);L.DomEvent.disableClickPropagation(p);L.DomEvent.disableScrollPropagation(p);
      state.panel=p;
      try{const saved=JSON.parse(localStorage.getItem('kt_filters_mvp')||'{}');if(['all','free','paid','unknown'].includes(saved.cost))state.filters.cost=saved.cost;if(['all','established','dispersed','backcountry','parking','other'].includes(saved.type))state.filters.type=saved.type;}catch{}
      p.querySelector(`[name="f-cost"][value="${state.filters.cost}"]`).checked=true;p.querySelector('#f-type').value=state.filters.type;
      state.button=document.getElementById('filters');
      state.button.onclick=()=>{const open=p.style.display==='none';p.style.display=open?'block':'none';state.button.setAttribute('aria-expanded',String(open));};
      p.querySelector('#kt-f-reset').onclick=reset;p.querySelector('#kt-f-close').onclick=()=>{close();state.button.focus();};
      p.querySelectorAll('[name="f-cost"]').forEach(el=>el.onchange=()=>{state.filters.cost=el.value;apply();});
      p.querySelector('#f-type').onchange=e=>{state.filters.type=e.target.value;apply();};
      document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
      apply();
    },reset,getFilters:()=>({...state.filters})
  };
})();
