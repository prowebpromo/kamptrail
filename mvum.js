/* USFS motor-vehicle road designations. This is source context, not RV routing or a road-condition survey. */
(function(global){
  'use strict';
  const SERVICE='https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer';
  const FORESTS='https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestCommonNames_01/MapServer/0/query';
  const MIN_ZOOM=10,MAX_ROADS=1000,CACHE_LIMIT=12;
  const LABELS={1:'All vehicles · yearlong designation',2:'All vehicles · seasonal designation',3:'Highway-legal vehicles · yearlong designation',4:'Highway-legal vehicles · seasonal designation',11:'Special vehicle designation · yearlong',12:'Special vehicle designation · seasonal'};
  const FIELDS=['objectid','id','name','symbol','mvum_symbol_name','seasonal','passengervehicle','passengervehicle_datesopen','highclearancevehicle','highclearancevehicle_datesopen','motorhome','motorhome_datesopen','truck','truck_datesopen','surfacetype','operationalmaintlevel','districtname','forestname','routestatus'];
  const st={map:null,group:null,control:null,box:null,status:null,summary:null,coverage:null,opacity:.8,enabled:false,sequence:0,timer:null,abort:null,links:null,linksPromise:null,reading:false};
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  const props=p=>Object.fromEntries(Object.entries(p||{}).map(([k,v])=>[k.toLowerCase().split('.').pop(),v]));
  const clean=v=>v==null?'':String(v).trim();
  const norm=v=>clean(v).toLowerCase().normalize('NFKD').replace(/&/g,'and').replace(/national forests?|national grasslands?|national|forest[s]?|grasslands?/g,'').replace(/[^a-z0-9]/g,'');
  function safeLink(value){try{const u=new URL(value);if(u.username||u.password||!['http:','https:'].includes(u.protocol)||!(/(^|\.)fs\.usda\.gov$|(^|\.)fs\.fed\.us$/i.test(u.hostname)))return null;u.protocol='https:';return u.href;}catch{return null;}}
  function designation(raw){const p=props(raw);return LABELS[Number(p.symbol)]||'Vehicle designation not reported';}
  function reported(value){const s=clean(value);if(/^(y|yes|1)$/i.test(s))return 'Yes, according to source';if(/^(n|no|0)$/i.test(s))return 'No, according to source';return s||'Not reported';}
  function validRoad(f){if(!f||!['LineString','MultiLineString'].includes(f.geometry?.type))return false;const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;return Array.isArray(lines)&&lines.length>0&&lines.every(line=>Array.isArray(line)&&line.length>=2&&line.length<=15000&&line.every(c=>Array.isArray(c)&&c.length>=2&&Number.isFinite(c[0])&&Number.isFinite(c[1])&&Math.abs(c[0])<=180&&Math.abs(c[1])<=90))&&Object.hasOwn(LABELS,Number(props(f.properties).symbol));}
  function normalizeUnits(features){const byId=new Map();for(const f of features||[]){const p=props(f.attributes||f.properties),forest=clean(p.forestname),district=clean(p.districtname||p.unit_name);if(!forest&&!district)continue;const stamp=Number(p.roadmvum);const date=stamp>0&&Number.isFinite(stamp)?new Date(stamp):null;byId.set(clean(p.unit_id)||forest+'|'+district,{forest,district,available:!!date&&!Number.isNaN(date.valueOf()),as_of:date&&!Number.isNaN(date.valueOf())?date.toISOString().slice(0,10):null});}return [...byId.values()];}
  function query(layer,bounds,extra={}){const p=new URLSearchParams({f:'json',where:'1=1',geometry:JSON.stringify({xmin:bounds[0],ymin:bounds[1],xmax:bounds[2],ymax:bounds[3],spatialReference:{wkid:4326}}),geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outSR:'4326',...extra});return `${SERVICE}/${layer}/query?${p}`;}
  async function json(url,signal){const r=await fetch(url,{signal});if(!r.ok)throw new Error('Forest Service request failed');const d=await r.json();if(d?.error)throw new Error('Forest Service query unavailable');return d;}
  async function forestLinks(signal){
    if(st.links)return st.links;
    if(!st.linksPromise)st.linksPromise=json(FORESTS+'?'+new URLSearchParams({f:'json',where:'1=1',outFields:'adminforestname,commonname,url',returnGeometry:'false',resultRecordCount:'500'}),signal).then(d=>{
      if(!Array.isArray(d.features)||d.exceededTransferLimit)throw new Error('Forest links incomplete');
      st.links=d.features.flatMap(f=>{const p=props(f.attributes),url=safeLink(p.url);return [...new Set([p.adminforestname,p.commonname].map(clean).filter(Boolean))].map(name=>({name,url}));}).filter(x=>x.name&&x.url);return st.links;
    }).finally(()=>{st.linksPromise=null;});
    return st.linksPromise;
  }
  function forestLink(name,links){const key=norm(name),rows=Array.isArray(links)?links:[],exact=rows.filter(f=>norm(f.name)===key),candidates=exact.length?exact:rows.filter(f=>key.length>6&&norm(f.name).includes(key)),urls=[...new Set(candidates.map(f=>f.url))];return urls.length===1?urls[0]:null;}
  function detail(feature,links){const p=props(feature.properties),box=node('div',null,'kt-road-popup');box.append(node('h3',clean(p.name)||`Forest road ${clean(p.id)||'number not reported'}`),node('p',designation(p)));
    const dl=node('dl');const add=(label,value)=>{dl.append(node('dt',label),node('dd',clean(value)||'Not reported'));};
    add('Road number',p.id);add('Forest',p.forestname);add('Ranger district',p.districtname);add('Surface reported',p.surfacetype);add('Road status reported',p.routestatus);
    for(const [label,key]of [['Passenger vehicles','passengervehicle'],['Motorhomes','motorhome'],['High-clearance vehicles','highclearancevehicle'],['Trucks','truck']]){add(label,reported(p[key]));if(clean(p[key+'_datesopen']))add(label+' dates',p[key+'_datesopen']);}
    box.append(dl,node('p','Designation and dates do not establish current road conditions, clearance, camping permission, or suitability for your RV. Check the current district map, closures and posted signs.','kt-fine'));
    const home=forestLink(p.forestname,links);if(home){const a=node('a',`${clean(p.forestname)}: official maps and alerts`);a.href=home;a.target='_blank';a.rel='noopener noreferrer';box.append(a);}
    const source=node('a','USFS road source and metadata');source.href=SERVICE+'/1';source.target='_blank';source.rel='noopener noreferrer';const sourceLine=node('p');sourceLine.append(source);box.append(sourceLine);return box;
  }
  function css(name){return getComputedStyle(document.documentElement).getPropertyValue(name).trim();}
  function roadStyle(f){const p=props(f.properties),n=Number(p.symbol);return{color:css([3,4].includes(n)?'--road-highway':[11,12].includes(n)?'--road-special':'--road-all'),weight:parseFloat(css('--road-stroke')),opacity:st.opacity,dashArray:[2,4,12].includes(n)?css('--road-seasonal-dash'):null};}
  function renderRoads(data){st.group.clearLayers();L.geoJSON(data.roads,{renderer:st.renderer,bubblingMouseEvents:false,style:roadStyle,onEachFeature(f,l){l.bindPopup(()=>detail(f,data.links),{maxWidth:parseFloat(css('--road-popup-width'))});l.on('popupopen',()=>{st.reading=true;});l.on('popupclose',()=>{st.reading=false;if(st.enabled){clearTimeout(st.timer);st.timer=setTimeout(refresh,500);}});l.on('add',()=>{const e=l.getElement?.();if(e){e.setAttribute('tabindex','0');e.setAttribute('role','button');e.setAttribute('aria-label',`Forest road ${clean(props(f.properties).name||props(f.properties).id)||'designation'}`);e.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();l.openPopup();}});}});}}).addTo(st.group);}
  function status(text){if(st.status)st.status.textContent=text;if(st.summary)st.summary.textContent='USFS road context'+(st.map?.getZoom()<MIN_ZOOM?' · zoom in':'');}
  function context(data,saved){
    st.coverage.replaceChildren();const ul=node('ul');for(const u of data.units){const li=node('li',`${u.district||u.forest}: ${u.available?'MVUM data listed'+(u.as_of?' · unit entry '+u.as_of:''):'No MVUM data listed in this feed'}`);const link=forestLink(u.forest,data.links);if(link){const a=node('a','Official forest maps / alerts');a.href=link;a.target='_blank';a.rel='noopener noreferrer';li.append(' ',a);}ul.append(li);}st.coverage.append(ul);
    if(!data.units.length)st.coverage.append(node('p','District coverage is unknown here. An empty layer does not establish that no roads exist.'));
    if(data.coverage_incomplete)st.coverage.append(node('p','Some district coverage information could not be loaded.'));
    st.coverage.append(node('small',`${saved?'Saved view':'Retrieved'} ${new Date(data.retrieved).toISOString().slice(0,10)}. Unit dates vary; this is not a current-conditions check.`));
  }
  function viewBounds(){const b=st.map.getBounds(),west=((b.getWest()+540)%360)-180,east=west+(b.getEast()-b.getWest());return [west,b.getSouth(),east,b.getNorth()].map(x=>+x.toFixed(4));}
  function cacheId(bounds){return new URL('__mvum_saved_view__?bounds='+bounds.join(','),new URL('./',location.href)).href;}
  const cacheName=()=>`kamptrail:${new URL('./',location.href).href}:mvum-v1`;
  async function savedView(bounds){try{const c=await caches.open(cacheName()),r=await c.match(cacheId(bounds));if(!r)return null;const d=await r.json();if(d.version!==1||!Number.isFinite(Date.parse(d.retrieved))||!Array.isArray(d.links)||!d.links.every(x=>x&&typeof x.name==='string'&&!!safeLink(x.url))||!Array.isArray(d.units)||d.roads?.type!=='FeatureCollection'||!Array.isArray(d.roads.features)||d.roads.features.length>MAX_ROADS||!d.roads.features.every(validRoad))return null;return d;}catch{return null;}}
  async function saveView(bounds,data){try{const c=await caches.open(cacheName());await c.put(cacheId(bounds),new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}));const keys=await c.keys();for(const key of keys.slice(0,Math.max(0,keys.length-CACHE_LIMIT)))await c.delete(key);}catch{/* Browser storage is optional. */}}
  async function refresh(){
    if(!st.enabled||st.reading)return;const seq=++st.sequence;st.abort?.abort();st.abort=new AbortController();st.group.clearLayers();st.coverage?.replaceChildren();
    if(st.map.getZoom()<MIN_ZOOM){status(`Zoom to level ${MIN_ZOOM} or closer to load USFS roads.`);return;}
    const bounds=viewBounds();if(bounds[2]>180||bounds[2]-bounds[0]>3||bounds[3]-bounds[1]>3){status('Zoom into a smaller area to load road designations.');return;}
    status('Loading Forest Service roads and district coverage…');
    const saved=await savedView(bounds);if(seq!==st.sequence)return;
    if(!navigator.onLine){if(saved){renderRoads(saved);context(saved,true);status(`${saved.roads.features.length} saved road segments. Offline: check current maps and closures when connected.`);}else status('Road data for this view is not saved offline. Reconnect to load it.');return;}
    try{
      const signal=st.abort.signal,timeout=setTimeout(()=>st.abort?.abort(),15000);
      let results;try{results=await Promise.allSettled([
        json(query(1,bounds,{f:'geojson',where:"symbol IN ('1','2','3','4','11','12')",outFields:FIELDS.join(','),returnGeometry:'true',resultRecordCount:String(MAX_ROADS),geometryPrecision:'5',maxAllowableOffset:'0.00002'}),signal),
        json(query(12,bounds,{outFields:'*',returnGeometry:'false',resultRecordCount:'30'}),signal),
        json(query(13,bounds,{outFields:'*',returnGeometry:'false',resultRecordCount:'30'}),signal),forestLinks(signal)
      ]);}finally{clearTimeout(timeout);}
      if(seq!==st.sequence||!st.enabled)return;if(results[0].status!=='fulfilled')throw new Error('Road request failed');const roads=results[0].value;
      if(!Array.isArray(roads.features)||roads.type!=='FeatureCollection')throw new Error('Invalid roads');
      if(roads.exceededTransferLimit||roads.properties?.exceededTransferLimit||roads.features.length>=MAX_ROADS){status('This view has too many road segments. Zoom closer to load the complete view.');return;}
      roads.features=roads.features.filter(validRoad);
      const units=normalizeUnits(results.slice(1,3).flatMap(r=>r.status==='fulfilled'&&Array.isArray(r.value.features)?r.value.features:[]));
      const data={version:1,retrieved:new Date().toISOString(),roads,units,links:results[3].status==='fulfilled'?results[3].value:[],coverage_incomplete:results.slice(1,3).some(r=>r.status!=='fulfilled'||r.value.exceededTransferLimit)};
      renderRoads(data);context(data,false);status(roads.features.length?`${roads.features.length} road segments. Select a road for source vehicle and seasonal details.`:'No road records returned. Coverage may be missing; consult the district map.');await saveView(bounds,data);
    }catch{if(seq!==st.sequence||!st.enabled)return;if(saved){renderRoads(saved);context(saved,true);status('Forest Service is unavailable. Showing the saved view; it may be outdated.');}else status('Forest Service road data could not load. Retry when connected.');}
  }
  function control(){const c=L.control({position:'bottomleft'});c.onAdd=()=>{const box=node('div',null,'kt-mvum-control'),details=node('details');details.open=!matchMedia('(max-width:760px)').matches;st.summary=node('summary','USFS road context');details.append(st.summary);const body=node('div',null,'kt-mvum-body');
    st.status=node('p','Loading…');st.status.setAttribute('role','status');st.status.setAttribute('aria-live','polite');body.append(st.status,node('p','Road designation is not camping permission or an RV passability check. Current district maps, closures and signs take priority.','kt-fine'));
    const legend=node('ul',null,'kt-road-key');for(const [cls,text]of [['all','All vehicles'],['highway','Highway-legal vehicles'],['special','Special designation'],['seasonal','Dashed: seasonal designation']]){const li=node('li'),swatch=node('i',null,'road-key-'+cls);swatch.setAttribute('aria-hidden','true');li.append(swatch,text);legend.append(li);}body.append(legend);
    const label=node('label','Road layer opacity '),input=node('input');input.type='range';input.min='20';input.max='100';input.step='10';input.value=String(Math.round(st.opacity*100));input.setAttribute('aria-label','Road layer opacity');input.oninput=()=>{st.opacity=+input.value/100;st.group.eachLayer(l=>l.setStyle?.({opacity:st.opacity}));try{localStorage.setItem('kt_mvum_opacity',String(st.opacity));}catch{}};label.append(input);body.append(label);
    const retry=node('button','Retry road data','btn');retry.type='button';retry.onclick=refresh;body.append(retry);st.coverage=node('div',null,'kt-mvum-coverage');body.append(st.coverage);details.append(body);box.append(details);L.DomEvent.disableClickPropagation(box);L.DomEvent.disableScrollPropagation(box);st.box=box;return box;};return c;}
  function init(map){st.map=map;st.renderer=L.svg();try{const n=Number(localStorage.getItem('kt_mvum_opacity'));if(n>=.2&&n<=1)st.opacity=n;}catch{}st.group=L.layerGroup();st.group.on('add',()=>{st.enabled=true;st.control=control().addTo(map);refresh();});st.group.on('remove',()=>{st.enabled=false;st.sequence++;st.abort?.abort();clearTimeout(st.timer);st.control?.remove();});map.on('moveend',()=>{if(st.enabled&&!st.reading){clearTimeout(st.timer);st.timer=setTimeout(refresh,500);}});return st.group;}
  function showNear(lat,lng){if(!st.map||!st.group)return;st.map.closePopup();st.map.setView([lat,lng],Math.max(12,st.map.getZoom()));clearTimeout(st.timer);if(!st.map.hasLayer(st.group))st.group.addTo(st.map);else refresh();st.box?.querySelector('details')?.setAttribute('open','');}
  global.KampTrailMVUM={version:'2.18.0',init,showNear,refresh,designation,reported,normalizeUnits,validRoad,safeLink,forestLink,query,SERVICE};
})(typeof window!=='undefined'?window:globalThis);
