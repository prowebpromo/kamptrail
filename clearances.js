/* Dated source height tags. No route enforcement, bridge inventory or safe-passage claim. */
(function(global){
  'use strict';
  const URL='https://download.geofabrik.de/north-america/us/rhode-island-latest.osm.pbf';
  const KEYS=['maxheight','maxheight:physical','maxheight:conditional','maxheight:forward','maxheight:backward','maxheight:lanes'];
  const CONTEXT=['name','ref','highway','bridge','tunnel','barrier','access','source:maxheight','maxheight:signed','source:maxheight:physical'];
  const MAX_BYTES=512*1024,MAX_ROWS=2000,MAX_VERTICES=50000;
  const check=(ok,msg)=>{if(!ok)throw new Error('Reported height tags: '+msg);};
  const utc=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s.replace('Z','.000Z');
  const text=s=>typeof s==='string'&&new TextEncoder().encode(s).length<=240;
  function parseHeight(raw){
    if(typeof raw!=='string')return null;
    const metric=raw.match(/^(\d+(?:\.\d{1,6})?)(?: m)?$/),imperial=raw.match(/^(\d+)'(?:(\d{1,2})")?$/);
    let value=null;
    if(metric)value=Number(metric[1]);
    else if(imperial&&(imperial[2]===undefined||Number(imperial[2])<12))value=Number(imperial[1])*.3048+Number(imperial[2]||0)*.0254;
    return value>0&&value<=100?value:null;
  }
  function points(r){return r.geometry.type==='Point'?[r.geometry.coordinates]:r.geometry.coordinates;}
  function validate(d,now=Date.now()){
    check(d&&d.version===1&&d.region==='RI'&&Array.isArray(d.records)&&d.records.length>0&&d.records.length<=MAX_ROWS,'invalid pilot');
    const s=d.source;
    check(s&&s.kind==='geofabrik'&&s.url===URL&&(s.resolved_url===URL||/^https:\/\/download\.geofabrik\.de\/north-america\/us\/rhode-island-\d{6}\.osm\.pbf$/.test(s.resolved_url))&&/^[a-f0-9]{64}$/.test(s.sha256)&&Number.isSafeInteger(s.bytes)&&s.bytes>0&&s.bytes<=2*1024**3&&s.license==='ODbL-1.0'&&s.copyright_url==='https://www.openstreetmap.org/copyright'&&utc(s.retrieved_at)&&utc(s.extract_timestamp)&&Date.parse(s.extract_timestamp)<=Date.parse(s.retrieved_at)&&Date.parse(s.retrieved_at)<=now+300000,'invalid source evidence');
    check(s.resolved_url===URL||s.resolved_url.endsWith(s.extract_timestamp.slice(2,10).replaceAll('-','')+'.osm.pbf'),'resolved extract date mismatch');
    const ids=new Set();let vertices=0;
    for(const r of d.records){
      check(r&&['node','way'].includes(r.osm_type)&&/^[1-9][0-9]*$/.test(r.osm_id)&&r.id===`osm:${r.osm_type}:${r.osm_id}`&&!ids.has(r.id)&&r.state==='RI'&&Number.isSafeInteger(r.osm_version)&&r.osm_version>0&&utc(r.edited_at)&&Date.parse(r.edited_at)<=Date.parse(s.extract_timestamp),'invalid identity/date');ids.add(r.id);
      check(r.geometry&&r.geometry.type===(r.osm_type==='node'?'Point':'LineString')&&Array.isArray(r.geometry.coordinates),'invalid geometry');
      const ps=points(r);vertices+=ps.length;
      check((r.osm_type==='node'||ps.length>=2)&&vertices<=MAX_VERTICES&&ps.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=-72&&p[0]<=-70.9&&p[1]>=40.9&&p[1]<=42.1),'invalid pilot coordinates');
      check(r.tags&&typeof r.tags==='object'&&!Array.isArray(r.tags)&&Object.keys(r.tags).length>0&&Object.entries(r.tags).every(([k,v])=>KEYS.includes(k)&&text(v)),'invalid source tags');
      check(r.context&&typeof r.context==='object'&&!Array.isArray(r.context)&&Object.entries(r.context).every(([k,v])=>CONTEXT.includes(k)&&text(v)),'invalid context');
      check(!!r.context.highway||r.context.barrier==='height_restrictor','no highway or height-restrictor context');
      check(r.metres&&typeof r.metres==='object'&&!Array.isArray(r.metres)&&Object.keys(r.metres).every(k=>['maxheight','maxheight:physical'].includes(k)&&Object.hasOwn(r.tags,k)),'invalid normalized fields');
      for(const k of ['maxheight','maxheight:physical']){
        if(!Object.hasOwn(r.tags,k)){check(!Object.hasOwn(r.metres,k),'invented height');continue;}
        const expected=parseHeight(r.tags[k]),value=r.metres[k];
        check(expected===null?value===null:Number.isFinite(value)&&Math.abs(value-expected)<1e-9,'height differs from raw source');
      }
    }
    return d;
  }
  function sourceLink(r){return`https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`;}
  function intersect(r,b){
    const ps=points(r),ys=ps.map(p=>p[1]),xs=ps.map(p=>p[0]);
    if(Math.max(...ys)<b.south||Math.min(...ys)>b.north)return false;
    if(b.east-b.west>=360)return true;
    const w=((b.west+540)%360)-180,e=((b.east+540)%360)-180;
    return w<=e?Math.max(...xs)>=w&&Math.min(...xs)<=e:Math.max(...xs)>=w||Math.min(...xs)<=e;
  }
  function heightText(r,key){
    if(!Object.hasOwn(r.tags,key))return'Unknown; no source tag';
    const value=r.metres[key];
    return `${r.tags[key]}${value===null?' (numeric limit unknown)':` (about ${value.toFixed(2)} m)`}`;
  }
  function describe(r,d,saved=false){
    return `${saved?'Saved snapshot. ':''}OpenStreetMap extract ${d.source.extract_timestamp}; downloaded ${d.source.retrieved_at}. Object last edited ${r.edited_at}. These dates are not an inspection. Rhode Island pilot only; missing records and all other areas are unknown. Current signs, clearance, access and safe passage are unverified. This map does not match these tags to your route or enforce vehicle restrictions.`;
  }
  function init(map){
    const L=global.L,layer=L.layerGroup();let data=null,pending=null,controller=null,control,status,select,openButton,view=0,saved=false;
    const active=()=>map.hasLayer(layer),el=(tag,t)=>{const n=global.document.createElement(tag);if(t)n.textContent=t;return n;};
    const button=(label,action)=>{const b=el('button',label);b.type='button';b.onclick=action;return b;};
    const cacheName=()=>`kamptrail:${new global.URL('./',global.location.href).href}:clearance-v1`;
    const assetURL=()=>new global.URL('data/clearances/RI.json',global.location.href).href;
    const link=(label,url)=>{const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
    function popup(r,d,wasSaved){
      const box=el('div');box.className='kt-clearance-popup';box.tabIndex=0;box.setAttribute('role','region');box.setAttribute('aria-label','Reported height tag details');box.style.maxHeight=Math.max(80,Math.min(360,map.getSize().y-160))+'px';
      box.append(el('h2',r.context.name||r.context.ref||'Reported height tags'),el('p',`General/legal tag (maxheight): ${heightText(r,'maxheight')}.`),el('p',`Physical-height tag (maxheight:physical): ${heightText(r,'maxheight:physical')}.`));
      for(const key of KEYS.filter(k=>!['maxheight','maxheight:physical'].includes(k)))if(Object.hasOwn(r.tags,key))box.append(el('p',`${key}: ${r.tags[key]}. Raw source only; direction, lanes and conditions are not interpreted.`));
      if(Object.keys(r.context).length){const list=el('dl');for(const [k,v] of Object.entries(r.context)){list.append(el('dt',k),el('dd',v));}box.append(list);}
      box.append(el('p',describe(r,d,wasSaved)),link('OpenStreetMap source object',sourceLink(r)),' · ',link('OSM height-tag guidance','https://wiki.openstreetmap.org/wiki/Key:maxheight'),' · ',link('OSM physical-height guidance','https://wiki.openstreetmap.org/wiki/Key:maxheight:physical'));
      return box;
    }
    async function readResponse(response){
      check(response.ok,'source unavailable');check(Number(response.headers.get('content-length'))<=MAX_BYTES,'response exceeds bound');
      const reader=response.body.getReader(),chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new Error('Height-tag source exceeds bound');}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
      return validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
    }
    async function load(force=false){
      if(data&&!force)return data;
      if(pending){if(controller?.signal.aborted){try{await pending;}catch{}return load(force);}return pending;}
      controller=new AbortController();const thisController=controller;let timedOut=false;
      const timer=global.setTimeout(()=>{timedOut=true;thisController.abort();},15000);
      pending=(async()=>{
        try{const d=await readResponse(await global.fetch(assetURL(),{cache:'no-store',signal:thisController.signal}));data=d;saved=false;
          try{const cache=await global.caches.open(cacheName());await cache.put(assetURL(),new Response(JSON.stringify(d),{headers:{'content-type':'application/json'}}));}catch{}return d;
        }catch(error){
          // A deadline may use validated saved evidence; removing the layer cancels the request.
          if(thisController.signal.aborted&&!timedOut)throw error;
          if(data){saved=true;return data;}
          try{const hit=await(await global.caches.open(cacheName())).match(assetURL());if(hit){data=await readResponse(hit);saved=true;return data;}}catch{}
          throw error;
        }
      })().finally(()=>{global.clearTimeout(timer);pending=null;if(controller===thisController)controller=null;});return pending;
    }
    async function redraw(force=false){
      const current=++view;if(control)control.hidden=!active();if(!active())return;
      if(map.getZoom()<8){if(!map._popup?.isOpen?.())layer.clearLayers();status.textContent='Zoom to level 8 or closer. Rhode Island height-tag pilot only. Other areas and missing records are unknown.';return;}
      status.textContent='Loading dated height tags…';
      try{const d=await load(force);if(current!==view||!active())return;
        const b=map.getBounds(),rows=d.records.filter(r=>intersect(r,{south:b.getSouth(),west:b.getWest(),north:b.getNorth(),east:b.getEast()}));
        status.textContent=`${saved?'Saved snapshot. ':''}${rows.length} source height-tag record${rows.length===1?'':'s'} in view. RI pilot only; missing records and other areas are unknown. Extract ${d.source.extract_timestamp.slice(0,10)}. No route enforcement or safe-passage assurance.`;
        if(map._popup?.isOpen?.())return;
        const previous=select.value,snapshotSaved=saved;select.replaceChildren();layer.clearLayers();for(const r of rows){const options={color:'#9b3821',weight:5,opacity:.85};let item;
          if(r.geometry.type==='LineString')item=L.polyline(r.geometry.coordinates.map(p=>[p[1],p[0]]),options);
          else item=L.circleMarker([r.geometry.coordinates[1],r.geometry.coordinates[0]],{...options,radius:7});
          item.ktClearanceId=r.id;item.bindPopup(()=>popup(r,d,snapshotSaved),{maxWidth:Math.max(120,Math.min(300,map.getSize().x-70)),autoPanPaddingTopLeft:[12,80],autoPanPaddingBottomRight:[12,28]});layer.addLayer(item);
          const option=el('option',`${r.context.name||r.context.ref||'Source object'} · ${r.id}`);option.value=r.id;select.append(option);
        }
        if(rows.some(r=>r.id===previous))select.value=previous;select.disabled=openButton.disabled=!rows.length;
      }catch(error){if(current===view&&active()){if(!map._popup?.isOpen?.())layer.clearLayers();select.disabled=openButton.disabled=true;status.textContent='Height-tag evidence unavailable. Coverage and current clearance are unknown. Reconnect and retry.';}}
    }
    const widget=L.control({position:'bottomleft'});widget.onAdd=()=>{control=el('div');control.className='kt-clearance-control';control.hidden=true;status=el('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      const label=el('label','Height-tag record in view');select=el('select');select.setAttribute('aria-label','Height-tag record in view');select.disabled=true;label.append(select);
      openButton=button('Open selected height tags',()=>{const item=layer.getLayers().find(l=>l.ktClearanceId===select.value);if(item){item.openPopup();global.setTimeout(()=>map.getContainer().querySelector('.kt-clearance-popup')?.focus(),0);}});openButton.disabled=true;
      control.append(el('strong','Reported height tags'),status,label,openButton,button('Retry height-tag evidence',()=>redraw(true)));L.DomEvent.disableClickPropagation(control);L.DomEvent.disableScrollPropagation(control);return control;};widget.addTo(map);
    map.on('overlayadd overlayremove',e=>{if(e.layer===layer){if(!active()){++view;controller?.abort();}redraw();}});
    let timer;map.on('moveend',()=>{global.clearTimeout(timer);timer=global.setTimeout(()=>redraw(),180);});
    map.on('popupclose',()=>global.setTimeout(()=>{if(!map._popup?.isOpen?.())redraw();},0));
    global.addEventListener('offline',()=>{saved=!!data;redraw();});global.addEventListener('online',()=>redraw(true));
    return layer;
  }
  const api={version:'2.18.0',validate,parseHeight,heightText,describe,sourceLink,intersect,init,MAX_BYTES};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else global.KampTrailClearances=api;
})(typeof window!=='undefined'?window:globalThis);
