/* KampTrail Trip Planner – lightweight panel with add/remove + export JSON */
(function(){
  'use strict';

  const S = { map:null, open:false, trip: { name:'My Trip', stops:[] }, panel:null };

  function load(){ try{ const x=localStorage.getItem('kt_trip'); if(x) S.trip = JSON.parse(x); }catch{} }
  function save(){ try{ localStorage.setItem('kt_trip', JSON.stringify(S.trip)); }catch{} }
  function id(){ return 'stop_'+Date.now()+'_'+Math.random().toString(36).slice(2,7); }

  function getCamp(id){
    const all = window.KampTrailData?.getAll() || [];
    return all.find(f => f.properties.id === id);
  }

  function headerBtnBadge(){
    const btn = document.getElementById('trip');
    if (btn) btn.textContent = `📍 My Trip (${S.trip.stops.length})`;
  }

  function render(){
    const list = S.panel.querySelector('#kt-trip-stops');
    list.innerHTML = S.trip.stops.map((s,i)=>{
      const c = getCamp(s.id);
      if (!c) return '';
      const p=c.properties; const [lng,lat]=c.geometry.coordinates;
      return `<div style="display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;background:#0b141b;border:1px solid #284356;border-radius:8px;padding:8px">
        <div style="background:#86b7ff;color:#fff;border-radius:50%;width:28px;height:28px;display:grid;place-items:center;font-weight:700">${i+1}</div>
        <div><div style="font-weight:700">${p.name}</div><div style="opacity:.8;font-size:12px">${p.type} • ${p.cost===0?'Free':(p.cost?('$'+p.cost):'Unknown')}</div></div>
        <div style="display:flex;gap:6px">
          <button data-goto="${lat},${lng}" style="padding:6px 8px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:6px;cursor:pointer">📍</button>
          <button data-del="${s.id}" style="padding:6px 8px;border:1px solid #284356;background:#173243;color:#ff6b6b;border-radius:6px;cursor:pointer">🗑</button>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('button[data-goto]').forEach(b=>b.onclick=()=>{
      const [lat,lng]=b.dataset.goto.split(',').map(parseFloat);
      S.map.setView([lat,lng], 12);
    });
    list.querySelectorAll('button[data-del]').forEach(b=>b.onclick=()=>{
      S.trip.stops = S.trip.stops.filter(x=>x.id!==b.dataset.del); save(); render(); headerBtnBadge();
    });
  }

  function buildPanel(){
    const p = document.createElement('div');
    p.id='kt-trip-panel';
    p.style.cssText='position:fixed;top:60px;right:-380px;width:360px;max-width:calc(100vw - 24px);height:calc(100vh - 80px);background:#0f1b24;border:1px solid #284356;border-radius:12px 0 0 12px;z-index:1002;color:#cfe3f2;box-shadow:-8px 0 24px rgba(0,0,0,.35);transition:right .25s ease';
    p.innerHTML = `
      <div style="padding:10px 12px;border-bottom:1px solid #284356;display:flex;align-items:center;gap:8px">
        <input id="kt-trip-name" value="${S.trip.name}" style="flex:1;padding:6px;border:1px solid #284356;border-radius:8px;background:#0b141b;color:#cfe3f2">
        <button id="kt-trip-close" style="background:transparent;border:none;color:#9fd0ff;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div id="kt-trip-stops" style="padding:10px 12px;display:grid;gap:8px;overflow:auto;height:calc(100% - 112px)"></div>
      <div style="padding:10px 12px;border-top:1px solid #284356;display:flex;gap:8px">
        <button id="kt-trip-export" style="flex:1;padding:8px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:8px;cursor:pointer">💾 Export JSON</button>
        <button id="kt-trip-clear" style="padding:8px;border:1px solid #284356;background:#173243;color:#ff6b6b;border-radius:8px;cursor:pointer">Clear</button>
      </div>`;
    document.body.append(p);

    p.querySelector('#kt-trip-close').onclick = ()=> this.close();
    p.querySelector('#kt-trip-export').onclick = ()=>{
      const blob = new Blob([JSON.stringify(S.trip,null,2)], {type:'application/json'});
      const url = URL.createObjectURL(blob); const a=document.createElement('a');
      a.href=url; a.download = `${(S.trip.name||'trip').replace(/\s+/g,'_')}.json`; a.click(); URL.revokeObjectURL(url);
    };
    p.querySelector('#kt-trip-clear').onclick = ()=>{
      if (confirm('Clear all stops?')){ S.trip.stops=[]; save(); render(); headerBtnBadge(); }
    };
    p.querySelector('#kt-trip-name').onblur = e=>{ S.trip.name = e.target.value || 'My Trip'; save(); };
    return p;
  }

  window.KampTrailTrip = {
    init(map){
      S.map = map; load();
      S.panel = buildPanel(); render(); headerBtnBadge();
    },
    addStop(campId){
      if (S.trip.stops.some(s=>s.id===campId)){ alert('Already in trip'); return; }
      S.trip.stops.push({ id: campId }); save(); render(); headerBtnBadge(); this.open();
    },
    toggle(){ S.open ? this.close() : this.open(); },
    open(){ S.panel.style.right = '0'; S.open=true; },
    close(){ S.panel.style.right = '-380px'; S.open=false; }
  };
})();
