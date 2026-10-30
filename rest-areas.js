/* Official rest-area locations. Location and duration evidence never establishes overnight permission. */
(function(global){
  'use strict';
  const LIST='https://www.txdot.gov/discover/rest-areas-travel-information-centers/safety-rest-area-list.html';
  const POLICY='https://www.txdot.gov/discover/rest-areas-travel-information-centers/safety-rest-area-map.html';
  const detail=u=>typeof u==='string'&&/^https:\/\/www\.txdot\.gov\/discover\/rest-areas-travel-information-centers\/safety-rest-area-list\/[a-z0-9-]+\.html$/.test(u);
  const check=(ok,msg)=>{if(!ok)throw new Error('Official rest areas: '+msg);};
  const utc=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s.replace('Z','.000Z');
  function source(s,url,now){check(s&&s.url===url&&/^[a-f0-9]{64}$/.test(s.sha256)&&utc(s.retrieved_at)&&Date.parse(s.retrieved_at)<=now+300000&&s.source_updated_at===null,'invalid source evidence');}
  function validate(d,now=Date.now()){
    check(d&&d.version===1&&d.region==='TX'&&Array.isArray(d.records)&&d.records.length>0&&d.records.length<=1000,'invalid catalogue');
    source(d.source,LIST,now);check(d.duration_context?.maximum_hours===24,'invalid duration context');source(d.duration_context.source,POLICY,now);
    const ids=new Set();
    for(const r of d.records){
      check(r&&/^txdot:[a-f0-9]{24}$/.test(r.id)&&!ids.has(r.id),'duplicate or invalid identity');ids.add(r.id);
      check(r.state==='TX'&&r.permission==='unknown'&&Array.isArray(r.coordinates)&&r.coordinates.length===2&&r.coordinates.every(Number.isFinite)&&r.coordinates[0]>=-107&&r.coordinates[0]<=-93&&r.coordinates[1]>=25&&r.coordinates[1]<=37,'invalid place or unsupported permission claim');
      check(detail(r.source_url)&&typeof r.name==='string'&&r.name.length>0&&new TextEncoder().encode(r.name).length<=200&&typeof r.location==='string'&&new TextEncoder().encode(r.location).length<=800&&(r.milepost===null||typeof r.milepost==='string'&&r.milepost.length<=60),'invalid source row');
    }
    return d;
  }
  function coordinate5(x){const n=Math.sign(x)*Math.floor(Math.abs(x)*1e5+.5)/1e5;return(n===0?0:n).toFixed(5);}
  function place(r){const c=r.coordinates.map(x=>Number(coordinate5(x)));return{kind:'spot',id:`spot:${coordinate5(c[1])},${coordinate5(c[0])}`,name:r.name,coordinates:c};}
  function describe(r,d){return`${r.location}${r.milepost?' · Milepost '+r.milepost:''}. TxDOT location list retrieved ${d.source.retrieved_at}; source update date not supplied. TxDOT describes a visitor stay limit of up to 24 hours (duration source retrieved ${d.duration_context.source.retrieved_at}). A time limit does not establish permission to sleep overnight. Overnight permission, current opening and space availability are unknown.`;}
  function feature(r,d){const p=place(r);return{type:'Feature',geometry:{type:'Point',coordinates:p.coordinates},properties:{id:p.id,name:r.name,type:'spot',source:'Texas Department of Transportation',rest_area_source_id:r.id,rest_area_source_url:r.source_url,rest_area_evidence:describe(r,d)}};}
  function within(c,b){const lng=((c[0]+540)%360)-180,w=((b.west+540)%360)-180,e=((b.east+540)%360)-180;return c[1]>=b.south&&c[1]<=b.north&&(b.east-b.west>=360||(w<=e?lng>=w&&lng<=e:lng>=w||lng<=e));}
  function init(map){
    const L=global.L,layer=L.layerGroup();let data=null,pending=null,controller=null,control,status,view=0;
    const active=()=>map.hasLayer(layer);
    const el=(tag,text)=>{const n=global.document.createElement(tag);if(text)n.textContent=text;return n;};
    const link=(label,url)=>{const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
    const button=(label,action)=>{const b=el('button',label);b.type='button';b.onclick=action;return b;};
    function popup(r,d){
      const box=el('div');box.className='kt-rest-popup';box.dataset.restAreaId=r.id;box.tabIndex=0;box.setAttribute('role','region');box.setAttribute('aria-label','Rest-area source details');box.style.maxHeight=Math.max(80,Math.min(360,map.getSize().y-160))+'px';
      box.append(el('h2',r.name),el('p',describe(r,d)),link('TxDOT place source',r.source_url),' · ',link('TxDOT duration source',POLICY));
      const actions=el('div');actions.className='kt-popup-actions';
      actions.append(button('Save rest-area stop',()=>{const f=feature(r,d);global.KampTrailTrip?.addStop(f.properties.id,f);}),button('Overnight permission',()=>global.KampTrailPermissions?.open(place(r))));box.append(actions);return box;
    }
    async function load(force=false){
      if(data&&!force)return data;if(pending)return pending;
      controller=new AbortController();const timer=global.setTimeout(()=>controller.abort(),20000);
      pending=(async()=>{const response=await global.fetch('data/rest-areas/TX.json',{cache:'no-store',signal:controller.signal});check(response.ok,'source unavailable');check(Number(response.headers.get('content-length'))<=512*1024,'response exceeds bound');
        const reader=response.body.getReader(),chunks=[];let size=0;
        while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512*1024){await reader.cancel();throw new Error('Official rest-area response exceeds bound');}chunks.push(value);}
        const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}data=validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));return data;
      })().finally(()=>{global.clearTimeout(timer);pending=null;controller=null;});return pending;
    }
    async function redraw(force=false){
      const current=++view;if(control)control.hidden=!active();if(!active())return;
      if(global.navigator.onLine===false){layer.clearLayers();status.textContent='Offline: reconnect to load official rest-area locations. Current opening and overnight permission are unknown.';return;}
      if(map.getZoom()<6){layer.clearLayers();status.textContent='Zoom to level 6 or closer. Official rest-area pilot covers Texas only. Overnight permission is unknown.';return;}
      status.textContent='Loading official rest-area locations…';
      try{
        const d=await load(force);if(current!==view||!active()||global.navigator.onLine===false)return;
        const b=map.getBounds(),bounds={south:b.getSouth(),west:b.getWest(),north:b.getNorth(),east:b.getEast()},rows=d.records.filter(r=>within(r.coordinates,bounds));
        status.textContent=`${rows.length} official rest-area location${rows.length===1?'':'s'} in this view. Texas pilot only; other regions are not covered. TxDOT list retrieved ${d.source.retrieved_at.slice(0,10)}. Overnight permission and current opening are unknown.`;
        // Hold marker replacement while any popup is open, as with campsite discovery.
        if(map._popup?.isOpen?.())return;
        layer.clearLayers();for(const r of rows){const marker=L.marker([r.coordinates[1],r.coordinates[0]],{title:r.name,keyboard:true,icon:L.divIcon({className:'kt-rest-icon',html:'<span>R</span>',iconSize:[26,26],iconAnchor:[13,13]})});marker.ktRestAreaId=r.id;marker.bindPopup(()=>popup(r,d),{maxWidth:Math.max(120,Math.min(300,map.getSize().x-70)),autoPanPaddingTopLeft:[12,80],autoPanPaddingBottomRight:[12,28]});layer.addLayer(marker);}
      }catch(error){if(current===view&&active()){layer.clearLayers();status.textContent='Official rest-area catalogue unavailable. Missing locations and overnight permission remain unknown. Reconnect and retry.';}}
    }
    const widget=L.control({position:'bottomright'});widget.onAdd=()=>{control=el('div');control.className='kt-rest-control';control.hidden=true;status=el('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');control.append(el('strong','Official rest areas'),status,button('Retry official rest areas',()=>redraw(true)));L.DomEvent.disableClickPropagation(control);L.DomEvent.disableScrollPropagation(control);return control;};widget.addTo(map);
    map.on('overlayadd overlayremove',e=>{if(e.layer===layer){if(!active()){++view;controller?.abort();}redraw();}});
    let timer;map.on('moveend',()=>{global.clearTimeout(timer);timer=global.setTimeout(()=>redraw(),180);});map.on('popupclose',()=>global.setTimeout(()=>{if(!map._popup?.isOpen?.())redraw();},0));
    global.addEventListener('offline',()=>{++view;controller?.abort();redraw();});global.addEventListener('online',()=>redraw());
    return layer;
  }
  const api={version:'2.15.1',validate,place,feature,describe,within,detail,init};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else global.KampTrailRestAreas=api;
})(typeof window!=='undefined'?window:globalThis);
