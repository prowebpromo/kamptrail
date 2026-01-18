/* filters.js – compact filter panel that drives KampTrailData */
(function(){
  'use strict';
  const st = {
    map:null,
    filters:{ cost:'all', type:'all', rigSize:'all', roadDifficulty:'all', amenities:[], minRating:0, searchText:'' }
  };

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  function badgeCount(){
    let c=0;
    const f=st.filters;
    if(f.cost!=='all') c++;
    if(f.type!=='all') c++;
    if(f.rigSize!=='all') c++;
    if(f.roadDifficulty!=='all') c++;
    if(f.amenities.length) c++;
    if((+f.minRating||0)>0) c++;
    return c;
  }

  function apply(){
    window.kamptrailFilters = st.filters;
    if(window.KampTrailData) window.KampTrailData.updateFilters(st.filters, st.map);
    const b=document.getElementById('filter-badge');
    const n=badgeCount();
    b.style.display = n? 'inline-block':'none';
    b.textContent = n;
  }

  function ui(){
    const panel=document.createElement('div');
    panel.id='kt-filter-panel';
    panel.style.position='absolute'; panel.style.left='12px'; panel.style.top='64px';
    panel.style.zIndex=1001; panel.style.width='320px'; panel.style.maxWidth='calc(100vw - 24px)';
    panel.style.background='rgba(15,27,36,.98)'; panel.style.border='1px solid #284356';
    panel.style.borderRadius='12px'; panel.style.boxShadow='0 4px 20px rgba(0,0,0,.4)';
    panel.style.display='none';

    panel.innerHTML=`
      <div style="padding:10px 12px;border-bottom:1px solid #284356;display:flex;align-items:center;gap:8px;">
        <div style="font-weight:700;color:#cfe3f2;flex:1;">Filters</div>
        <button id="kt-f-reset" style="background:#173243;border:1px solid #284356;color:#9fd0ff;padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;">Reset</button>
      </div>
      <div style="padding:12px;max-height:60vh;overflow:auto;font-size:13px;color:#cfe3f2;">
        <label>Cost</label>
        <div style="display:flex;gap:8px;margin:6px 0 12px;">
          <label><input type="radio" name="f-cost" value="all" checked> All</label>
          <label><input type="radio" name="f-cost" value="free"> Free</label>
          <label><input type="radio" name="f-cost" value="paid"> Paid</label>
        </div>

        <label>Type</label>
        <select id="f-type" style="width:100%;background:#0b141b;border:1px solid #284356;color:#cfe3f2;border-radius:6px;padding:6px;">
          <option value="all">All types</option>
          <option value="dispersed">Dispersed</option>
          <option value="established">Established</option>
          <option value="parking">Overnight parking</option>
          <option value="other">Other</option>
        </select>

        <div style="height:10px"></div>
        <label>Rig size</label>
        <select id="f-rig" style="width:100%;background:#0b141b;border:1px solid #284356;color:#cfe3f2;border-radius:6px;padding:6px;">
          <option value="all">Any</option>
          <option value="van">Van / Small RV</option>
          <option value="small_trailer">Small trailer</option>
          <option value="trailer">Trailer</option>
          <option value="big_rig">Big rig</option>
          <option value="tent">Tent</option>
        </select>

        <div style="height:10px"></div>
        <label>Road difficulty</label>
        <select id="f-road" style="width:100%;background:#0b141b;border:1px solid #284356;color:#cfe3f2;border-radius:6px;padding:6px;">
          <option value="all">Any</option>
          <option value="easy">Easy</option>
          <option value="moderate">Moderate</option>
          <option value="4wd">4WD</option>
        </select>

        <div style="height:10px"></div>
        <label>Amenities (must include all)</label>
        <div id="f-amen" style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:6px;">
          ${['toilet','water','dump','fire_ring','picnic_table','shade'].map(a=>`
            <label><input type="checkbox" value="${a}"> ${a.replace('_',' ')}</label>`).join('')}
        </div>

        <div style="height:12px"></div>
        <label>Minimum rating</label>
        <div style="display:flex;align-items:center;gap:10px;">
          <input id="f-rate" type="range" min="0" max="5" step="0.5" value="0" style="flex:1;">
          <output id="f-rate-val" style="min-width:80px;text-align:right;opacity:.85;">Any</output>
        </div>
      </div>`;
    return panel;
  }

  window.KampTrailFilters = {
    init(map){
      st.map = map;
      const p = ui();
      map._container.appendChild(p);
      L.DomEvent.disableClickPropagation(p);

      // Wire header button
      const btn = document.getElementById('filters');
      btn.addEventListener('click', ()=>{ p.style.display = (p.style.display==='none'?'block':'none'); });

      // Wire search input
      const searchInput = document.getElementById('search');
      if (searchInput) {
        searchInput.addEventListener('input', debounce((e) => {
          st.filters.searchText = e.target.value;
          apply();
        }, 300));
      }

      // Reset
      p.querySelector('#kt-f-reset').addEventListener('click', ()=>{
        st.filters = { cost:'all', type:'all', rigSize:'all', roadDifficulty:'all', amenities:[], minRating:0, searchText:'' };
        p.querySelector('input[name="f-cost"][value="all"]').checked = true;
        p.querySelector('#f-type').value='all';
        p.querySelector('#f-rig').value='all';
        p.querySelector('#f-road').value='all';
        p.querySelectorAll('#f-amen input[type="checkbox"]').forEach(c=> c.checked=false);
        const r=p.querySelector('#f-rate'); r.value=0; p.querySelector('#f-rate-val').textContent='Any';
        if (searchInput) searchInput.value = '';
        apply();
      });

      // Inputs
      p.querySelectorAll('input[name="f-cost"]').forEach(r=>r.addEventListener('change', e=>{ st.filters.cost=e.target.value; apply(); }));
      p.querySelector('#f-type').addEventListener('change', e=>{ st.filters.type=e.target.value; apply(); });
      p.querySelector('#f-rig').addEventListener('change', e=>{ st.filters.rigSize=e.target.value; apply(); });
      p.querySelector('#f-road').addEventListener('change', e=>{ st.filters.roadDifficulty=e.target.value; apply(); });
      p.querySelectorAll('#f-amen input').forEach(c=> c.addEventListener('change', e=>{
        const v=e.target.value; const on=e.target.checked;
        const arr=st.filters.amenities;
        if(on && !arr.includes(v)) arr.push(v); else if(!on) st.filters.amenities = arr.filter(x=>x!==v);
        apply();
      }));
      p.querySelector('#f-rate').addEventListener('input', e=>{
        st.filters.minRating = +e.target.value;
        p.querySelector('#f-rate-val').textContent = st.filters.minRating? `${st.filters.minRating}+` : 'Any';
        apply();
      });

      apply();
      console.log('Filters ready');
    },
    getFilters(){ return Object.assign({}, st.filters); }
  };
})();
