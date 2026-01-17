/* favorites.js – favorites drawer for saved campsites */
(function(){
  'use strict';
  const st = { map:null, open:false, favorites:[], el:null };

  function save(){ localStorage.setItem('kt_favorites', JSON.stringify(st.favorites)); }
  function load(){ try{ st.favorites = JSON.parse(localStorage.getItem('kt_favorites')||'[]'); }catch{ st.favorites=[]; } }
  function getSite(id){ return (window.KampTrailData && window.KampTrailData.getCampsiteById(id)) || null; }

  function render(){
    // Update header badge
    const badge = document.getElementById('fav-count');
    if(badge) badge.textContent = `(${st.favorites.length})`;

    const list = st.el.querySelector('#kt-fav-list');
    if(!st.favorites.length){
      list.innerHTML='<div style="opacity:.7;text-align:center;padding:20px">No favorites yet<br><small style="font-size:11px">Click ⭐ in campsite popups to add favorites</small></div>';
      return;
    }
    const esc = window.escapeHtml || ((t) => t);
    list.innerHTML = st.favorites.map((id,i)=>{
      const s=getSite(id); if(!s) return '';
      const [lng,lat]=s.geometry.coordinates;
      const safeName = esc(s.properties.name||'Campsite');
      const costText = s.properties.cost === 0 || s.properties.cost === null ? 'FREE' : `$${s.properties.cost}`;
      return `<div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;border:1px solid #284356;border-radius:8px;padding:8px;background:#0b141b;">
        <div style="min-width:0">
          <div style="font-weight:600;color:#cfe3f2">${safeName}</div>
          <div style="opacity:.7;font-size:12px">${s.properties.state || ''} • ${costText}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button data-id="${id}" class="kt-fav-zoom" title="Zoom" style="padding:6px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:6px;cursor:pointer;font-size:11px">📍</button>
          <button data-id="${id}" class="kt-fav-del" title="Remove" style="padding:6px;border:1px solid #284356;background:#173243;color:#ff6b6b;border-radius:6px;cursor:pointer;font-size:11px">⭐</button>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.kt-fav-zoom').forEach(b=>b.onclick=(e)=>{
      const id=e.currentTarget.dataset.id; const s=getSite(id);
      if(s){ const [lng,lat]=s.geometry.coordinates; st.map.setView([lat,lng], 12); }
    });
    list.querySelectorAll('.kt-fav-del').forEach(b=>b.onclick=(e)=>{
      const id=e.currentTarget.dataset.id;
      st.favorites = st.favorites.filter(fid => fid !== id);
      save(); render();
    });
  }

  function drawer(){
    const d=document.createElement('div');
    d.style.position='fixed'; d.style.top='60px'; d.style.right='-360px'; d.style.width='340px';
    d.style.maxWidth='calc(100vw - 24px)'; d.style.height='calc(100vh - 80px)';
    d.style.background='rgba(15,27,36,.98)'; d.style.border='1px solid #284356';
    d.style.borderRadius='12px 0 0 12px';
    d.style.boxShadow='-4px 0 20px rgba(0,0,0,.4)'; d.style.zIndex=1002;
    d.style.transition='right .25s ease';
    d.innerHTML=`
      <div style="padding:10px 12px;border-bottom:1px solid #284356;display:flex;align-items:center;gap:8px">
        <div style="font-weight:700;color:#cfe3f2;flex:1">⭐ Favorites</div>
        <button id="kt-fav-close" style="background:transparent;border:none;color:#9fd0ff;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div id="kt-fav-list" style="padding:12px;display:grid;gap:8px;overflow:auto;height:calc(100% - 120px)"></div>
      <div style="padding:12px;border-top:1px solid #284356;display:flex;gap:8px">
        <button id="kt-fav-clear" style="flex:1;padding:8px;border:1px solid #284356;background:#173243;color:#ff6b6b;border-radius:8px;cursor:pointer">Clear All</button>
      </div>`;
    document.body.appendChild(d);
    return d;
  }

  function open(){ st.open=true; st.el.style.right='0'; }
  function close(){ st.open=false; st.el.style.right='-360px'; }

  window.KampTrailFavorites = {
    init(map){
      st.map = map; load();
      st.el = drawer(); render();
      document.getElementById('favorites').onclick = ()=> (st.open?close():open());
      st.el.querySelector('#kt-fav-close').onclick = close;
      st.el.querySelector('#kt-fav-clear').onclick = ()=>{
        if(confirm('Clear all favorites?')){ st.favorites=[]; save(); render(); }
      };
      console.log('✓ Favorites ready');
    },
    toggle(id){
      const idx = st.favorites.indexOf(id);
      if(idx > -1){
        st.favorites.splice(idx, 1);
      } else {
        st.favorites.push(id);
        open(); // Auto-open when adding
      }
      save(); render();
    },
    isFavorite(id){
      return st.favorites.includes(id);
    },
    openPanel(){ open(); }
  };
})();
