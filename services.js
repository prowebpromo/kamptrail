/* Dated OSM service discovery. Map, nearby and routes share validation and access rules. */
(function (root) {
  'use strict';
  const t = (key, params) => (typeof window !== 'undefined' ? window.KampTrailI18n : globalThis.KampTrailI18n)?.t(key, params) ?? String(key).replace(/\{([a-zA-Z0-9_]+)\}/g, (token, name) => Object.hasOwn(params || {}, name) ? String(params[name]) : token);
  const VERSION = '2.23.0';
  const categories = Object.freeze({
    dump: {label: t("Dump station"), letter: 'D', color: '#6b3fa0'},
    water: {label: t("Water fill"), letter: 'W', color: '#1f6fb2'},
    lpg: {label: t("LPG"), letter: 'P', color: '#a74b0b'},
    showers: {label: t("Showers"), letter: 'S', color: '#206674'},
    laundry: {label: t('Laundry'), letter: 'L', color: '#695120'},
    groceries: {label: t('Groceries'), letter: 'G', color: '#34733e'},
    fuel: {label: t('Fuel'), letter: 'F', color: '#a13b43'}
  });
  const KEYS = Object.keys(categories), TAGS = new Set('amenity tourism sanitary_dump_station waterway drinking_water fuel fuel:lpg shop laundry self_service access access:conditional fee charge opening_hours operator brand website phone wheelchair shower'.split(' '));
  const STATES=new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
  const ITEM_KEYS=new Set('id osm_type osm_id osm_version edited_at coordinates name categories tags states source_region retrieved_at'.split(' '));
  const LIMIT = {manifest: 1024 * 1024, shard: 512 * 1024, rows: 1500, shards: 4096, records: 1000000, cacheBytes: 32 * 1024 * 1024, cacheShards: 64};
  const encoder = new TextEncoder(), bytes = s => encoder.encode(s).length;
  const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const integer = (v, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= 0 && v <= max;
  const catList = v => Array.isArray(v) && v.length > 0 && v.length <= 7 && new Set(v).size === v.length && v.every(k => KEYS.includes(k));
  const date = (v, nullable = false) => (nullable && v === null) || (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,19) === v.slice(0,19) && Date.parse(v) <= Date.now() + 300000);
  const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const coord = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
  const bbox = b => Array.isArray(b) && b.length === 4 && coord([b[0],b[1]]) && coord([b[2],b[3]]) && b[0] <= b[2] && b[1] <= b[3];
  const wrap = x => ((x + 180) % 360 + 360) % 360 - 180;
  function check(ok, message) { if (!ok) throw new Error(`Invalid services ${message}`); }
  function validateManifest(m) {
    check(object(m) && m.version === 2 && /^[a-f0-9]{24}$/.test(m.snapshot_id) && date(m.generated_at), 'manifest');
    check(object(m.source) && m.source.name === 'OpenStreetMap contributors' && m.source.license === 'ODbL-1.0' && m.source.copyright_url === 'https://www.openstreetmap.org/copyright', 'attribution');
    check(Array.isArray(m.coverage) && m.coverage.length > 0 && m.coverage.length <= 60, 'coverage');
    const regions = new Set();
    for (const c of m.coverage) {
      check(object(c) && (c.region==='legacy'||STATES.has(c.region)) && !regions.has(c.region) && ['legacy','geofabrik'].includes(c.kind) && c.license === 'ODbL-1.0' && hash(c.sha256) && integer(c.count,LIMIT.records) && catList(c.categories), 'source');
      check(c.kind === 'legacy' ? c.region === 'legacy' : c.region !== 'legacy', 'source region');
      check(date(c.extract_timestamp,c.kind === 'legacy') && date(c.retrieved_at,c.kind === 'legacy'), 'source dates');
      check(typeof c.url === 'string' && c.url.length <= 2048 && (c.kind==='legacy' ? c.url==='https://www.openstreetmap.org' : /^https:\/\/download\.geofabrik\.de\/north-america\/us\/[a-z-]+-latest\.osm\.pbf$/.test(c.url)), 'source URL');
      if(c.kind==='geofabrik')check(Date.parse(c.extract_timestamp)<=Date.parse(c.retrieved_at)+300000,'source chronology');
      // Source URLs are evidence only; consumers never navigate to an unapproved URL.
      if (c.kind === 'geofabrik') { let u; try {u=new URL(c.url);} catch {} check(u && u.protocol==='https:' && u.hostname==='download.geofabrik.de' && !u.username && !u.password, 'extract URL'); }
      regions.add(c.region);
    }
    check(integer(m.total,LIMIT.records) && Array.isArray(m.shards) && m.shards.length <= LIMIT.shards, 'manifest size');
    const ids = new Set(); let total=0;
    for (const s of m.shards) {
      check(object(s) && typeof s.id==='string' && /^[a-zA-Z0-9_-]{1,80}$/.test(s.id) && !ids.has(s.id) && s.url===`snapshots/${m.snapshot_id}/${s.id}.json` && bbox(s.bbox) && hash(s.sha256) && integer(s.bytes,LIMIT.shard) && s.bytes>0 && integer(s.count,LIMIT.rows) && object(s.counts), 'shard descriptor');
      check(Object.keys(s.counts).every(k=>KEYS.includes(k)) && KEYS.every(k=>s.counts[k]===undefined || integer(s.counts[k],s.count)), 'category counts');
      ids.add(s.id);total+=s.count;
    }
    check(total===m.total && m.coverage.reduce((n,c)=>n+c.count,0)===m.total, 'total');
    return m;
  }
  function validateItem(item, manifest) {
    check(object(item) && Object.keys(item).every(k=>ITEM_KEYS.has(k)) && ['node','way','relation'].includes(item.osm_type) && typeof item.osm_id==='string' && /^[1-9]\d{0,19}$/.test(item.osm_id) && item.id===`osm:${item.osm_type}:${item.osm_id}`, 'identity');
    check((item.osm_version===null || integer(item.osm_version) && item.osm_version>0) && date(item.edited_at,true) && coord(item.coordinates) && typeof item.name==='string' && bytes(item.name)<=120 && catList(item.categories), 'item');
    check(object(item.tags) && Object.entries(item.tags).every(([k,v])=>TAGS.has(k) && typeof v==='string' && bytes(v)<=240), 'tags');
    check(Array.isArray(item.states) && item.states.length>0 && item.states.length<=3 && item.states.every(s=>STATES.has(s)) && typeof item.source_region==='string', 'item region');
    if(item.source_region!=='legacy'){const t=item.tags,positive={dump:t.amenity==='sanitary_dump_station'||['yes','public','customers'].includes(t.sanitary_dump_station),water:t.amenity==='water_point'||t.waterway==='water_point',lpg:t['fuel:lpg']==='yes'||t.fuel==='lpg',showers:t.amenity==='shower',laundry:t.shop==='laundry',groceries:['supermarket','convenience'].includes(t.shop),fuel:t.amenity==='fuel'};check(item.categories.every(k=>positive[k])&&!['closed','off'].includes(t.opening_hours),'category evidence');}
    check(item.retrieved_at===undefined || item.source_region==='legacy' && date(item.retrieved_at,true), 'item source date');
    const source=manifest?.coverage.find(c=>c.region===item.source_region);
    check(!manifest || source && item.categories.every(c=>source.categories.includes(c)), 'source membership');
    return item;
  }
  function validateShard(data, descriptor, manifest) {
    check(object(data) && data.version===2 && data.snapshot_id===manifest.snapshot_id && data.shard_id===descriptor.id && Array.isArray(data.items) && data.items.length===descriptor.count, 'shard');
    const ids=new Set(),counts={};
    for(const item of data.items){validateItem(item,manifest);check(!ids.has(item.id),'duplicate identity');ids.add(item.id);const [x,y]=item.coordinates;check(x>=descriptor.bbox[0]&&(x<descriptor.bbox[2]||x===180&&descriptor.bbox[2]===180)&&y>=descriptor.bbox[1]&&(y<descriptor.bbox[3]||y===90&&descriptor.bbox[3]===90),'shard bounds');for(const k of item.categories)counts[k]=(counts[k]||0)+1;}
    check(KEYS.every(k=>(counts[k]||0)===(descriptor.counts[k]||0)),'shard category totals');
    return data;
  }
  function matches(item, selected=KEYS, includeRestricted=false) {
    return !!item && Array.isArray(item.categories) && item.categories.some(k=>(selected||KEYS).includes(k)) && (includeRestricted || !['no','private'].includes(String(item.tags?.access||'').trim().toLowerCase()));
  }
  function describe(item,manifest) {
    const tags=item.tags||{},source=manifest?.coverage?.find(c=>c.region===item.source_region),stamp=item.retrieved_at || source?.retrieved_at;
    const parts=[item.categories.map(k=>categories[k]?.label||k).join(', ')];
    if(tags.access)parts.push(t("Access reported: {0}{1}", {"0":(tags.access),"1":(['customers','permit'].includes(tags.access)?' (conditional)':'')}));
    if(item.categories.includes('dump')&&tags.sanitary_dump_station==='customers')parts.push(t("Dump access reported: customers (conditional)"));
    if(tags['access:conditional'])parts.push(t("Conditional access: {0}", {"0":(tags['access:conditional'])}));
    if(tags.fee||tags.charge)parts.push(t("Fee reported: {0}", {"0":([tags.fee,tags.charge].filter(Boolean).join('; '))}));
    if(tags.shop)parts.push(t("Shop type: {0}", {"0":(tags.shop)}));
    if(tags.self_service)parts.push(t("Self service: {0}", {"0":(tags.self_service)}));
    if(item.categories.includes('water'))parts.push(t("Drinking water: {0}", {"0":(tags.drinking_water==='yes'?t("tagged yes"):tags.drinking_water==='no'?t("tagged no (non-potable)"):t("not stated"))}));
    if(item.categories.includes('lpg'))parts.push(t("Cylinder refill not verified"));
    if(tags.opening_hours)parts.push(t("Hours reported: {0} (not live status)", {"0":(tags.opening_hours)}));
    if(tags.operator)parts.push(`Operator: ${tags.operator}`);
    parts.push(t("{0}; retrieved {1}{2}", {"0":(item.source_region==='legacy'?t("Legacy source"):t("Source ")+item.source_region),"1":(stamp?stamp.slice(0,10):t("date unknown")),"2":(source?.extract_timestamp?t("; extract ")+source.extract_timestamp.slice(0,10):'')}));
    parts.push(t("Hours, RV access and overnight permission are not verified. Location may not be an entrance."));
    return parts.join(' · ');
  }
  function coverageSummary(coverage) {
    const extracts=coverage.filter(c=>c.kind==='geofabrik');
    const retrieved=c=>c.retrieved_at?c.retrieved_at.slice(0,10):t('date unknown');
    const parts=[];
    if(extracts.length<=3)parts.push(...extracts.map(c=>t('{region} extract retrieved {date}',{region:c.region,date:retrieved(c)})));
    else {
      const dates=extracts.map(retrieved).sort(),first=dates[0],last=dates.at(-1);
      parts.push(t('{count} state extracts, retrieved {first}{last}',{count:extracts.length,first,last:first===last?'':t(' to {date}',{date:last})}));
    }
    const legacy=coverage.find(c=>c.kind==='legacy');
    if(legacy)parts.push(t('Legacy dump/water/LPG {date}',{date:retrieved(legacy)}));
    return parts.join('; ');
  }
  function feature(item,manifest) {
    const source=manifest?.coverage?.find(c=>c.region===item.source_region);
    return {type:'Feature',geometry:{type:'Point',coordinates:[...item.coordinates]},properties:{id:item.id,name:item.name||item.categories.map(k=>categories[k].label).join(', '),type:'service',service_categories:[...item.categories],service_access:item.tags?.access||'unknown',service_source_region:item.source_region,service_evidence:describe(item,manifest),service_retrieved_at:item.retrieved_at||source?.retrieved_at||null,service_extract_timestamp:source?.extract_timestamp||null,fee_status:'unknown',amenities:[],rig_friendly:[]}};
  }
  const rad=x=>x*Math.PI/180, deg=x=>x*180/Math.PI, R=3958.8;
  function distance(a,b) { const x=rad(b[1]-a[1]),y=rad(wrap(b[0]-a[0])),h=Math.sin(x/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(y/2)**2;return 2*R*Math.asin(Math.sqrt(Math.min(1,h))); }
  function bearing(a,b) {const y=rad(wrap(b[0]-a[0]));return Math.atan2(Math.sin(y)*Math.cos(rad(b[1])),Math.cos(rad(a[1]))*Math.sin(rad(b[1]))-Math.sin(rad(a[1]))*Math.cos(rad(b[1]))*Math.cos(y));}
  function segmentDistance(p,a,b) {const length=distance(a,b)/R;if(length<1e-12)return distance(p,a);const d=distance(a,p)/R,delta=bearing(a,p)-bearing(a,b),along=Math.atan2(Math.sin(d)*Math.cos(delta),Math.cos(d));if(along<0||along>length)return Math.min(distance(p,a),distance(p,b));return Math.abs(Math.asin(Math.max(-1,Math.min(1,Math.sin(d)*Math.sin(delta)))))*R;}
  function distanceToRoute(p,points) {let d=Infinity;if(points.length===1)return distance(p,points[0]);for(let i=1;i<points.length;i++)d=Math.min(d,segmentDistance(p,points[i-1],points[i]));return d;}
  function normalizeBounds(b) {check(object(b)&&[b.south,b.west,b.north,b.east].every(Number.isFinite)&&b.south>=-90&&b.north<=90&&b.south<=b.north,'query bounds');if(b.east-b.west>=360)return{south:b.south,west:-180,north:b.north,east:180};return{south:b.south,west:wrap(b.west),north:b.north,east:b.east===180?180:wrap(b.east)};}
  const ranges=b=>b.west<=b.east?[[b.west,b.east]]:[[b.west,180],[-180,b.east]];
  const intersects=(b,s)=>s[3]>=b.south&&s[1]<=b.north&&ranges(b).some(([w,e])=>s[2]>=w&&s[0]<=e);
  const inside=(p,b)=>p[1]>=b.south&&p[1]<=b.north&&ranges(b).some(([w,e])=>p[0]>=w&&p[0]<=e);
  function radiusBounds(p,miles) {const angle=Math.min(Math.PI,miles/R),lat=rad(p[1]),south=Math.max(-90,p[1]-deg(angle)),north=Math.min(90,p[1]+deg(angle));if(south<=-90||north>=90)return{south,west:-180,north,east:180};const dx=deg(Math.asin(Math.min(1,Math.sin(angle)/Math.cos(lat))));return{south,west:wrap(p[0]-dx),north,east:wrap(p[0]+dx)};}
  function routeIndex(points,miles) {
    // Index conservative segment envelopes locally. Long segments stay in a small global list,
    // avoiding an enormous index for polar/dateline routes. POI requests contain shard URLs only.
    const cells=new Map(),global=[];
    const cell=(x,y)=>`${Math.min(179,Math.floor((x+180)/2))}:${Math.min(89,Math.floor((y+90)/2))}`;
    function visit(b,fn){for(const [w,e] of ranges(b))for(let x=Math.floor((w+180)/2);x<=Math.min(179,Math.floor((e+180)/2));x++)for(let y=Math.floor((b.south+90)/2);y<=Math.min(89,Math.floor((b.north+90)/2));y++)fn(`${x}:${y}`);}
    if(points.length===1)points=[points[0],points[0]];
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=distance(a,b);
      if(length>150){global.push(i);continue;}
      visit(radiusBounds(a,length+miles),key=>{if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);});
    }
    return {
      select(box){if(global.some(i=>intersects(radiusBounds(points[i-1],distance(points[i-1],points[i])+miles),box)))return true;let found=false;visit({west:box[0],south:box[1],east:box[2],north:box[3]},key=>{if(cells.has(key))found=true;});return found;},
      accept(p){const indices=cells.get(cell(p[0],p[1]))||[];for(const i of indices)if(segmentDistance(p,points[i-1],points[i])<=miles)return true;for(const i of global)if(segmentDistance(p,points[i-1],points[i])<=miles)return true;return false;}
    };
  }
  function createClient(env=root) {
    const scope=new URL('./',env.location?.href||'https://kamptrail.invalid/'),base=new URL('data/services/',scope),cacheName=`kamptrail:${scope.href}:services-v2`;
    const memory=new Map();let memoryBytes=0,active=0,queue=[],current=null,manifestTask=null,manifestEpoch=0,cacheWrites=Promise.resolve(),lastStatus=null,selectedCategories=null;
    const abort=()=>Object.assign(new Error('Service request cancelled'),{name:'AbortError'});
    const ensure=signal=>{if(signal?.aborted)throw abort();};
    const emit=(name,detail)=>{if(env.dispatchEvent&&typeof env.CustomEvent==='function')env.dispatchEvent(new env.CustomEvent(name,{detail}));};
    function getCategories(){if(selectedCategories)return [...selectedCategories];try{const saved=JSON.parse(env.localStorage?.getItem('kt_service_categories_v2'));if(Array.isArray(saved)&&saved.every(k=>KEYS.includes(k)))selectedCategories=[...new Set(saved)];}catch{}if(!selectedCategories)selectedCategories=[...KEYS];return [...selectedCategories];}
    function setCategories(list){selectedCategories=KEYS.filter(k=>list.includes(k));try{env.localStorage?.setItem('kt_service_categories_v2',JSON.stringify(selectedCategories));}catch{}emit('kamptrail:servicescategories',[...selectedCategories]);return [...selectedCategories];}
    function waitFor(promise,signal){if(!signal)return promise;ensure(signal);return new Promise((resolve,reject)=>{const cancel=()=>reject(abort());signal.addEventListener('abort',cancel,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));});}
    function slot(fn,signal){return new Promise((resolve,reject)=>{const job={fn,signal,resolve,reject};job.cancel=()=>{const i=queue.indexOf(job);if(i>=0)queue.splice(i,1);reject(abort());};signal?.addEventListener('abort',job.cancel,{once:true});queue.push(job);pump();});}
    function pump(){while(active<2&&queue.length){const job=queue.shift();job.signal?.removeEventListener('abort',job.cancel);if(job.signal?.aborted){job.reject(abort());continue;}active++;Promise.resolve().then(()=>{ensure(job.signal);return job.fn();}).then(job.resolve,job.reject).finally(()=>{active--;pump();});}}
    async function digest(text){check(env.crypto?.subtle,'hash support');return Array.from(new Uint8Array(await env.crypto.subtle.digest('SHA-256',encoder.encode(text))),b=>b.toString(16).padStart(2,'0')).join('');}
    async function fetchText(url,limit,signal){return slot(async()=>{ensure(signal);if(env.navigator?.onLine===false)throw new Error('Offline');const controller=new AbortController(),onAbort=()=>controller.abort(),timer=setTimeout(()=>controller.abort(),15000);signal?.addEventListener('abort',onAbort,{once:true});try{const r=await env.fetch(url,{cache:'no-store',redirect:'error',signal:controller.signal});if(!r.ok)throw new Error(`Service HTTP ${r.status}`);if(Number(r.headers?.get('content-length'))>limit)throw new Error('Service response too large');if(r.body?.getReader){const reader=r.body.getReader(),decoder=new TextDecoder();let text='',size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('Service response too large');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return text;}finally{reader.releaseLock();}}const text=await r.text();if(bytes(text)>limit)throw new Error('Service response too large');return text;}finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}},signal);}
    const cache=async()=>env.caches?env.caches.open(cacheName):null;
    async function cached(url){try{const c=await cache(),r=await c?.match(url);return r?{text:await r.text(),hash:r.headers.get('x-kt-sha256')}:null;}catch{return null;}}
    function save(url,text,sha,isShard){cacheWrites=cacheWrites.catch(()=>{}).then(async()=>{const c=await cache();if(!c)return;await c.delete(url);await c.put(url,new Response(text,{headers:{'content-type':'application/json','x-kt-sha256':sha,'x-kt-shard':isShard?'1':'0','x-kt-bytes':String(bytes(text))}}));const keys=await c.keys(),entries=[];let total=0;for(const k of keys){const r=await c.match(k);if(r?.headers.get('x-kt-shard')==='1'){const size=Number(r.headers.get('x-kt-bytes'))||LIMIT.shard;total+=size;entries.push({k,size});}}while(entries.length>LIMIT.cacheShards||total>LIMIT.cacheBytes){const old=entries.shift();total-=old.size;await c.delete(old.k);}}).catch(()=>{});return cacheWrites;}
    function remember(key,data,size,text){if(memory.has(key)){memoryBytes-=memory.get(key).size;memory.delete(key);}memory.set(key,{data,size,text});memoryBytes+=size;while(memory.size>LIMIT.cacheShards||memoryBytes>LIMIT.cacheBytes){const [old,value]=memory.entries().next().value;memory.delete(old);memoryBytes-=value.size;}}
    async function manifest(force=false){if(current&&!force&&Date.now()-current.at<300000)return {...current,offline:env.navigator?.onLine===false||current.offline};if(manifestTask&&!force)return manifestTask;const epoch=++manifestEpoch,url=new URL('index.json',base).href;
      const task=(async()=>{let result;try{const text=await fetchText(url,LIMIT.manifest);const value=validateManifest(JSON.parse(text));const sha=await digest(text);if(epoch===manifestEpoch)await save(url,text,sha,false);result={manifest:value,offline:false,at:Date.now()};}catch(error){const saved=await cached(url);if(!saved||bytes(saved.text)>LIMIT.manifest||!hash(saved.hash)||await digest(saved.text)!==saved.hash)throw new Error(t("Service coverage unavailable. Unsaved areas are unknown; reconnect and retry."));const value=validateManifest(JSON.parse(saved.text));result={manifest:value,offline:true,at:Date.now()};}if(epoch===manifestEpoch)current=result;return result;})();manifestTask=task;try{return await task;}finally{if(manifestTask===task)manifestTask=null;}}
    async function shard(s,m,offline,signal){ensure(signal);const url=new URL(s.url,base).href,key=`${m.snapshot_id}:${s.id}:${s.sha256}`;if(memory.has(key)){const v=memory.get(key);check(v.size===s.bytes,'cached shard size');validateShard(v.data,s,m);remember(key,v.data,v.size,v.text);await save(url,v.text,s.sha256,true);return v.data;}
      const read=async text=>{if(bytes(text)!==s.bytes||await digest(text)!==s.sha256)throw new Error('Service shard integrity mismatch');return validateShard(JSON.parse(text),s,m);};
      const saved=await cached(url);if(saved){try{const data=await read(saved.text);ensure(signal);remember(key,data,s.bytes,saved.text);await save(url,saved.text,s.sha256,true);return data;}catch(error){if(error.name==='AbortError')throw error;}}
      if(offline)throw new Error(t("Area is not saved offline"));const text=await fetchText(url,LIMIT.shard,signal),data=await read(text);ensure(signal);remember(key,data,s.bytes,text);await save(url,text,s.sha256,true);return data;
    }
    function status(result){const prefix=result.offline?t('Saved dated evidence (offline/fallback). '):'';result.message=t('{prefix}{result}Coverage: {coverage}. Source coverage is incomplete; unloaded and uncovered areas are unknown. Hours, RV access and overnight permission are not verified.',{prefix,result:result.partial?t('Partial results: {count} areas missing or outside the loading budget; missing areas are unknown. ',{count:result.missing.length}):result.items.length?t('Results in loaded source coverage. '):t('None in the loaded source coverage. '),coverage:coverageSummary(result.coverage)});lastStatus=result;return result;}
    async function load(select,accept,options={}){const {signal,force=false,onProgress}=options;ensure(signal);const selected=options.categories===undefined?getCategories():KEYS.filter(k=>options.categories.includes(k));if(!selected.length)return {items:[],partial:false,offline:env.navigator?.onLine===false,missing:[],coverage:[],message:t('No service categories selected.'),manifest:current?.manifest||null};const record=await waitFor(manifest(force),signal);ensure(signal);const m=record.manifest,candidates=m.shards.filter(s=>select(s.bbox)&&selected.some(k=>(s.counts[k]||0)>0));const maxShards=Number.isFinite(options.maxShards)?Math.max(0,Math.min(128,Math.floor(options.maxShards))):16,maxBytes=Number.isFinite(options.maxBytes)?Math.max(0,Math.min(LIMIT.cacheBytes,options.maxBytes)):8*1024*1024;let total=0;const chosen=[],missing=[];for(const s of candidates){if(chosen.length>=maxShards||total+s.bytes>maxBytes){missing.push(s.id);continue;}chosen.push(s);total+=s.bytes;}const items=[],ids=new Set();let next=0,done=0;
      async function worker(){while(next<chosen.length){ensure(signal);const s=chosen[next++];try{const data=await shard(s,m,record.offline,signal);ensure(signal);for(const item of data.items)if(!ids.has(item.id)&&matches(item,selected,options.includeRestricted===true)&&accept(item.coordinates)){ids.add(item.id);items.push(item);}}catch(error){if(signal?.aborted)throw abort();missing.push(s.id);}done++;onProgress?.({loaded:done,total:chosen.length,missing:missing.length});}}
      await Promise.all([worker(),worker()]);ensure(signal);return status({items,partial:missing.length>0,offline:record.offline,missing,coverage:m.coverage,manifest:m});
    }
    function loadBounds(bounds,options={}){const b=normalizeBounds(bounds);return load(s=>intersects(b,s),p=>inside(p,b),options);}
    function loadRoute(points,miles,options={}){check(Array.isArray(points)&&points.length>0&&points.length<=150000&&points.every(coord)&&Number.isFinite(miles)&&miles>=0&&miles<=100,'route');const index=routeIndex(points,miles);return load(s=>index.select(s),p=>index.accept(p),{maxShards:128,maxBytes:12*1024*1024,...options});}
    return {version:VERSION,categories,categoryDefinitions:categories,getCategories,setCategories,matches,feature,describe,distance,distanceToRoute,radiusBounds,loadBounds,loadRoute,retry:()=>{current=null;},getStatus:()=>lastStatus,clearMemory:()=>{memory.clear();memoryBytes=0;current=null;},_cacheSettled:()=>cacheWrites};
  }
  const exported={version:VERSION,categories,createClient,validateManifest,validateItem,validateShard,matches,feature,describe,distance,distanceToRoute,radiusBounds,normalizeBounds,intersects};
  if(typeof module==='object'&&module.exports)module.exports=exported;
  if(root?.document)root.KampTrailServices=createClient(root);
})(typeof window==='object'?window:globalThis);
