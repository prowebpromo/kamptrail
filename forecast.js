/* Volatile NOAA/NWS NDFD samples. Never persist weather in the campsite catalogue. */
(function(global){
  'use strict';
  const HOUR=3600000,STATES=new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
  const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x),number=x=>typeof x==='number'&&Number.isFinite(x),hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),integer=(x,a,b)=>Number.isInteger(x)&&x>=a&&x<=b;
  function utc(x){if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(x))return NaN;const n=Date.parse(x);return Number.isFinite(n)&&new Date(n).toISOString().slice(0,19)===x.slice(0,19)?n:NaN;}
  function range(f={}){const min=f.forecastMinC??null,max=f.forecastMaxC??null,hours=f.forecastHours??24;return{min,max,hours,active:min!==null||max!==null,valid:[min,max].every(n=>n===null||number(n)&&n>=-100&&n<=70)&&(min===null||max===null||min<=max)&&[24,48].includes(hours)};}
  const active=f=>range(f).active;
  const toC=(v,u)=>number(v)?Math.round((u==='C'?v:(v-32)*5/9)*1e6)/1e6:null;
  const fromC=(v,u)=>number(v)?Math.round((u==='C'?v:v*9/5+32)*1e6)/1e6:null;
  function validManifest(m,catalogue,now){
    if(!object(m)||m.version!==1||!/^[a-f0-9]{24}$/.test(m.snapshot_id)||!hash(m.catalogue_sha256)||m.catalogue_sha256!==catalogue||!number(now))return false;
    const gen=utc(m.generated_at),exp=utc(m.expires_at);
    if(!number(gen)||!number(exp)||gen>now+300000||exp<=now||exp<=gen||exp>gen+3*HOUR)return false;
    if(m.source?.name!=='NOAA/NWS NDFD'||!Array.isArray(m.source.files)||!m.source.files.length||m.source.files.length>3||!object(m.regions)||!Object.keys(m.regions).length||Object.keys(m.regions).length>3)return false;
    const regions=new Set();
    for(const f of m.source.files){const modified=utc(f.last_modified);if(!hash(f.sha256)||!['conus','alaska','hawaii'].includes(f.region)||regions.has(f.region)||!number(modified)||modified>gen+300000||exp>modified+3*HOUR||!integer(f.bytes,1,150*1024*1024)||typeof f.etag!=='string'||f.etag.length>256||/[\u0000-\u001f\u007f]/.test(f.etag)||!['https://noaa-ndfd-pds.s3.amazonaws.com/opnl/','https://tgftp.nws.noaa.gov/SL.us008001/ST.opnl/DF.gr2/DC.ndfd/'].some(root=>f.url===`${root}AR.${f.region}/VP.001-003/ds.temp.bin`))return false;regions.add(f.region);}
    if(m.source.files.reduce((n,f)=>n+f.bytes,0)>150*1024*1024)return false;
    for(const [name,r]of Object.entries(m.regions)){
      if(!regions.has(name)||!object(r)||!hash(r.grid_sha256)||!integer(r.max_step_seconds,1,10800)||!Array.isArray(r.times)||!r.times.length||r.times.length>100)return false;
      if(!Array.isArray(r.reference_times)||!r.reference_times.length||r.reference_times.length>100)return false;
      const references=r.reference_times.map(utc);if(references.some((t,i)=>!number(t)||t>gen+300000||i&&t<=references[i-1]))return false;
      const times=r.times.map(utc);if(times.some((t,i)=>!number(t)||t<gen-6*HOUR||t>gen+96*HOUR||i&&(t<=times[i-1]||t-times[i-1]>r.max_step_seconds*1000)))return false;
    }
    if(regions.size!==Object.keys(m.regions).length||!object(m.states)||!Object.keys(m.states).length||Object.keys(m.states).length>50)return false;
    let count=0;for(const [s,v]of Object.entries(m.states)){if(!STATES.has(s)||!object(v)||v.asset!==`forecast-v1-${m.snapshot_id}-${s}.json.gz`||!hash(v.sha256)||!hash(v.json_sha256)||!integer(v.bytes,1,2*1024*1024)||!integer(v.json_bytes,1,8*1024*1024)||!integer(v.count,0,20000))return false;count+=v.count;}
    return count<=100000&&object(m.coverage)&&count>=m.coverage.total&&integer(m.coverage.total,0,100000)&&integer(m.coverage.grid_known,0,m.coverage.total)&&integer(m.coverage.unknown,0,m.coverage.total)&&m.coverage.grid_known+m.coverage.unknown===m.coverage.total;
  }
  function validState(d,code,m,quality){
    if(!STATES.has(code)||!object(d)||d.version!==1||d.state!==code||d.snapshot_id!==m.snapshot_id||d.generated_at!==m.generated_at||d.expires_at!==m.expires_at||!object(d.records)||Object.keys(d.records).length!==m.states[code]?.count||Object.keys(d.records).length>20000)return false;
    return Object.entries(d.records).every(([id,r])=>{
      if(!id||id.length>200||/[\u0000-\u001f\u007f]/.test(id)||!object(r)||typeof r.coordinate_key!=='string')return false;
      const p=r.coordinate_key.split(',').map(Number);if(p.length!==2||quality.coordinateKey([p[1],p[0]])!==r.coordinate_key)return false;
      if(r.status==='unknown')return typeof r.reason==='string'&&r.reason.length>0&&r.reason.length<=100&&!/[\u0000-\u001f\u007f]/.test(r.reason)&&Object.keys(r).every(k=>['coordinate_key','status','reason'].includes(k));
      const reg=m.regions[r.region];return r.status==='known'&&!!reg&&number(r.grid_lat)&&Math.abs(r.grid_lat)<=90&&number(r.grid_lng)&&Math.abs(r.grid_lng)<=180&&number(r.grid_distance_m)&&r.grid_distance_m>=0&&r.grid_distance_m<=5000&&Array.isArray(r.temperatures_c)&&r.temperatures_c.length===reg.times.length&&r.temperatures_c.every(t=>t===null||number(t)&&t>=-100&&t<=70);
    });
  }
  function sampleWindow(r,region,hours,now){
    if(!r||r.status!=='known'||![24,48].includes(hours)||!number(now))return null;
    const times=region.times.map(utc),end=now+hours*HOUR,step=region.max_step_seconds*1000;
    if(times.at(-1)<end)return null;
    const indices=[];for(let i=0;i<times.length;i++)if(times[i]>now&&times[i]<=end)indices.push(i);
    if(!indices.length||times[indices[0]]-now>step||end-times[indices.at(-1)]>step)return null;
    if(indices.some((i,n)=>!number(r.temperatures_c[i])||n&&times[i]-times[indices[n-1]]>step))return null;
    const values=indices.map(i=>r.temperatures_c[i]);return{min:Math.min(...values),max:Math.max(...values),samples:values.length,first:times[indices[0]],last:times[indices.at(-1)],start:now,end,cadence:step/HOUR};
  }
  function create(env){
    const q=env.DataQuality,shards=new Map(),pending=new Map(),failures=new Set(),wanted=new Set(),queue=[];
    let manifest=null,indexTask=null,catalogue=null,anchor=null,expiryTimer=null,workers=0,epoch=0,lastAttempt=-Infinity,error='',loadingIndex=false;
    const mono=()=>env.performance.now(),online=()=>env.navigator?.onLine!==false;
    const effectiveNow=()=>anchor&&online()?anchor.server+Math.max(0,mono()-anchor.mono):NaN;
    function emit(){if(env.dispatchEvent&&env.CustomEvent)env.dispatchEvent(new env.CustomEvent('kamptrail:forecastupdated'));}
    function fresh(){return !!manifest&&number(effectiveNow())&&effectiveNow()<utc(manifest.expires_at);}
    async function request(url,limit){
      const controller=new env.AbortController(),timer=env.setTimeout(()=>controller.abort(),20000);
      try{const r=await env.fetch(url,{cache:'no-store',credentials:'same-origin',signal:controller.signal});if(!r.ok)throw new Error('Forecast unavailable');if(Number(r.headers.get('content-length'))>limit)throw new Error('Forecast response too large');
        let text;if(r.body?.getReader){const reader=r.body.getReader(),chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('Forecast response too large');}chunks.push(value);}const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.byteLength;}text=new env.TextDecoder('utf-8',{fatal:true}).decode(all);}else{text=await r.text();if(new env.TextEncoder().encode(text).length>limit)throw new Error('Forecast response too large');}return text;
      }finally{env.clearTimeout(timer);}
    }
    async function digest(raw){const bytes=await env.crypto.subtle.digest('SHA-256',new env.TextEncoder().encode(raw));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}
    async function loadIndex(force){
      if(indexTask)return indexTask;if(!force&&fresh())return true;if(!online())return false;
      if(!force&&mono()-lastAttempt<60000)return false;lastAttempt=mono();loadingIndex=true;error='';emit();const current=epoch;
      indexTask=(async()=>{try{
        if(!catalogue||force){const c=JSON.parse(await request('data/campsites/coordinate-index.json',1024));if(c.version!==1||!hash(c.sha256)||!integer(c.count,0,100000))throw new Error('Catalogue identity unavailable');catalogue=c.sha256;}
        const d=JSON.parse(await request('api/forecast.php?kind=index',256*1024)),server=utc(d.server_now);
        if(!d.ok||!validManifest(d.manifest,catalogue,server))throw new Error('Forecast is unavailable, expired or incompatible with this catalogue');
        if(current!==epoch||!online())return false;
        if(manifest?.snapshot_id!==d.manifest.snapshot_id){shards.clear();failures.clear();}
        manifest=d.manifest;anchor={server,mono:mono()};env.clearTimeout(expiryTimer);expiryTimer=env.setTimeout(()=>invalidate('Forecast expired. Reconnect or retry for current samples.'),Math.max(1,utc(manifest.expires_at)-server));return true;
      }catch(e){if(current===epoch)error=e.message;return false;}finally{loadingIndex=false;indexTask=null;emit();}})();return indexTask;
    }
    function drain(){while(workers<2&&queue.length){const task=queue.shift();workers++;task().finally(()=>{workers--;drain();});}}
    function loadState(code,force){
      if(pending.get(code)?.manifest===manifest)return pending.get(code).promise;if(!force&&(shards.has(code)||failures.has(code)))return Promise.resolve();
      const current=epoch,m=manifest;let resolve;const promise=new Promise(r=>{resolve=r;});pending.set(code,{manifest:m,promise});
      queue.push(async()=>{try{
        if(current!==epoch||manifest!==m||!online()||!fresh())return;
        if(!m.states[code])throw new Error('State forecast unavailable');const entry=m.states[code],raw=await request(`api/forecast.php?kind=state&state=${code}&snapshot=${m.snapshot_id}`,8*1024*1024);
        if(new env.TextEncoder().encode(raw).length!==entry.json_bytes||await digest(raw)!==entry.json_sha256)throw new Error('Forecast checksum mismatch');
        const d=JSON.parse(raw);if(!validState(d,code,m,q))throw new Error('Invalid state forecast');if(current!==epoch||manifest!==m||!fresh())return;
        shards.set(code,d);failures.delete(code);
      }catch(e){if(current===epoch&&manifest===m){shards.delete(code);failures.add(code);error=e.message;}}finally{if(pending.get(code)?.promise===promise)pending.delete(code);resolve();emit();}});drain();return promise;
    }
    async function ensureStates(codes,{force=false}={}){const list=[...new Set(codes)].filter(c=>STATES.has(c)).slice(0,50);if(!list.length)return;list.forEach(c=>wanted.add(c));if(!online()||!await loadIndex(force))return;await Promise.all(list.map(c=>loadState(c,force)));}
    function get(feature,hours=24,now=effectiveNow()){
      if(!fresh()||!number(now)||now>=utc(manifest.expires_at))return null;
      const p=feature?.properties,key=q.coordinateKey(feature?.geometry?.coordinates);if(!p||typeof p.id!=='string'||!key)return null;
      const states=Array.isArray(p.forecastStates)?p.forecastStates:[p.state];
      for(const code of states){if(!STATES.has(code))continue;const r=shards.get(code)?.records[p.id];if(!r||r.coordinate_key!==key||r.status!=='known')continue;const window=sampleWindow(r,manifest.regions[r.region],hours,now);if(window)return{...window,region:r.region,modified:manifest.source.files.find(f=>f.region===r.region).last_modified,expires:manifest.expires_at,gridDistance:r.grid_distance_m};}return null;
    }
    function matches(feature,f={},now=effectiveNow()){const bounds=range(f);if(!bounds.active)return true;if(!bounds.valid)return false;const d=get(feature,bounds.hours,now);return !!d&&(bounds.min===null||d.min>=bounds.min)&&(bounds.max===null||d.max<=bounds.max);}
    function status(){return{online:online(),loading:loadingIndex||pending.size>0,ready:fresh(),error,states:[...shards.keys()],unavailable:[...failures],expires:manifest?.expires_at||null};}
    function statusText(){const s=status();return!s.online?'Offline: forecast samples cannot match.':s.loading?'Loading published forecast samples…':!s.ready?(s.error||'Forecast samples have not loaded.'):s.unavailable.length?`Forecast samples unavailable for ${s.unavailable.join(', ')}. Unknown samples are excluded.`:`NOAA/NWS NDFD samples. Expires ${s.expires}.`;}
    const date=t=>new Date(t).toISOString().replace('.000Z','Z');
    function describe(feature,f={}){const d=get(feature,range(f).hours);if(!d)return'Forecast samples unknown, incomplete, expired or unavailable.';const u=f.forecastUnit==='C'?'C':'F';return`${d.samples} published samples: ${fromC(d.min,u)} to ${fromC(d.max,u)} °${u}; next ${range(f).hours} h (${date(d.start)} to ${date(d.end)}). First/last sample ${date(d.first)} / ${date(d.last)}; cadence up to ${d.cadence} h. NOAA/NWS NDFD file updated ${d.modified}; expires ${d.expires}. File update is not each location’s forecast issuance. Samples are not continuous or daily extrema.`;}
    function invalidate(reason='Forecast needs a fresh server clock check.') {epoch++;anchor=null;manifest=null;shards.clear();failures.clear();lastAttempt=-Infinity;error=reason;env.clearTimeout(expiryTimer);emit();}
    env.addEventListener?.('offline',()=>invalidate('Offline: forecast samples cannot match.'));
    env.addEventListener?.('online',()=>invalidate());
    env.addEventListener?.('pageshow',e=>{if(e.persisted)invalidate();});
    env.document?.addEventListener('visibilitychange',()=>{if(env.document.visibilityState==='visible')invalidate();});
    // One minute checks also drop samples that leave a rolling window; no network is done per marker.
    env.setInterval?.(()=>{if(manifest&&wanted.size)emit();},60000);
    return{version:'2.13.0',ensureStates,get,matches,effectiveNow,status,statusText,describe,invalidate,range,active,toC,fromC,validManifest,validState,sampleWindow,utc};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={create,range,active,toC,fromC,utc,validManifest,validState,sampleWindow};
  else global.KampTrailForecast=create(global);
})(typeof window!=='undefined'?window:globalThis);
