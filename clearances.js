/* National OSM clearance candidates (kamptrail-clearances-3) and moderated visitor reports.
   A candidate is one tagged OSM object. Nothing here claims passage, legal access or a clear road. */
(function(global){
  'use strict';
  const t=(key,params={})=>global.KampTrailI18n?.t(key,params)??String(key).replace(/\{([a-zA-Z0-9_]+)\}/g,(token,name)=>Object.hasOwn(params,name)?String(params[name]):token);
  const VERSION='2.35.0',SCHEMA='kamptrail-clearances-3',MANIFEST='data/clearances/index.json',REPORTS='api/clearance-reports.php';
  const MIN_ZOOM=10,MAX_MANIFEST_BYTES=1024*1024,MAX_TILE_BYTES=512*1024,MAX_TILE_RECORDS=2000,MAX_TILES=4096;
  const MAX_VIEW_TILES=64,MAX_VIEW_BYTES=4*1024*1024,MEMORY_BYTES=12*1024*1024,LIST_LIMIT=200;
  const ATTRIBUTION='Contains information from OpenStreetMap, © OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0.';
  const COPYRIGHT_URL='https://www.openstreetmap.org/copyright',LICENSE_URL='https://opendatacommons.org/licenses/odbl/1-0/';
  const STATUSES=['numeric_only','mixed','directional_only','conditional','unknown','suspect'];
  const APPLIES=['way_itself','road_below','unknown'];
  const TAG_KEYS=['maxheight','maxheight:physical','maxheight:conditional','maxheight:forward','maxheight:backward','maxheight:lanes','height'];
  const COUNTED=['maxheight','maxheight:physical','height'];
  const DIRECTIONS=['both','one_direction','unsure'];
  const check=(ok,msg)=>{if(!ok)throw new Error('Clearance candidates: '+msg);};
  const plain=o=>!!o&&typeof o==='object'&&!Array.isArray(o);
  const str=(s,max=240)=>typeof s==='string'&&s.length<=max;
  const utc=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s)&&Number.isFinite(Date.parse(s));
  const finite=n=>typeof n==='number'&&Number.isFinite(n);

  // Same syntax as scripts/clearance_parse.py: bare metres, "N m", and ASCII feet/inches. Anything else is unknown.
  function parseHeight(raw){const h=parseHundredths(raw);return h===null?null:h.metres;}
  function parseHundredths(raw){
    if(typeof raw!=='string')return null;
    const metric=raw.match(/^(\d+)(?:\.(\d{1,6}))?(?: m)?$/),imperial=raw.match(/^(\d+)'(?:(\d{1,2})")?$/);
    if(metric){
      const micro=Number(metric[1])*1e6+Number((metric[2]||'').padEnd(6,'0')||0);
      if(!Number.isSafeInteger(micro)||micro<=0||micro>100e6)return null;
      // Metric converts down to hundredths of an inch, so rounding never raises a structure's height.
      return {metres:micro/1e6,hundredths:Math.floor(micro/254)};
    }
    if(imperial&&(imperial[2]===undefined||Number(imperial[2])<12)){
      const inches=Number(imperial[1])*12+Number(imperial[2]||0),metres=inches*.0254;
      return metres>0&&metres<=100?{metres,hundredths:inches*100}:null;
    }
    return null;
  }
  // Rig heights are canonical whole millimetres. Clearances are compared at that resolution: a clearance within half a
  // millimetre of the rig height is equal, and equal is a conflict. hundredths are kept for display only.
  function rigHundredths(mm){return Number.isSafeInteger(mm)&&mm>0&&mm<=10000?Math.ceil(mm*1000/254):null;}
  const toMm=hundredths=>Math.round(hundredths*254/1000);
  // comparable: numeric_only and comparable=true. needs_checking: suspect, conditional, directional, mixed. unknown: no usable number.
  function state(c){
    if(c?.status==='numeric_only'&&c.comparable===true&&finite(c.min_inches))return 'comparable';
    if(c?.status==='unknown')return 'unknown';
    return 'needs_checking';
  }
  function compare(c,rigMm){
    const s=state(c),valid=Number.isSafeInteger(rigMm)&&rigMm>0&&rigMm<=10000;
    if(s!=='comparable')return {compared:false,relation:'not_compared',conflict:false,state:s};
    if(!valid)return {compared:false,relation:'no_rig_height',conflict:false,state:s};
    const clearance=Math.round(c.min_inches*100),mm=toMm(clearance);
    const relation=mm<rigMm?'below':mm===rigMm?'equal':'above';
    // Equal is a conflict, never clearance.
    return {compared:true,relation,conflict:relation!=='above',state:s,clearance_hundredths:clearance,clearance_mm:mm,rig_mm:rigMm,rig_hundredths:Math.round(rigMm*1000/254),difference_mm:mm-rigMm};
  }

  function validateManifest(m){
    check(plain(m)&&m.version===3&&m.schema===SCHEMA&&m.kind==='clearance_candidates_manifest','invalid manifest');
    check(m.license==='ODbL-1.0'&&m.copyright_url===COPYRIGHT_URL&&m.attribution===ATTRIBUTION,'missing ODbL attribution');
    check(Array.isArray(m.tiles)&&m.tiles.length>0&&m.tiles.length<=MAX_TILES,'invalid tile index');
    check(plain(m.sources)&&plain(m.states_protected),'invalid source dates');
    for(const [region,s] of Object.entries(m.sources))check(/^[A-Z]{2}$/.test(region)&&plain(s)&&utc(s.extract_timestamp)&&utc(s.retrieved_at),'invalid source dates');
    const paths=new Set();
    for(const e of m.tiles){
      check(plain(e)&&typeof e.path==='string'&&/^tiles\/\d{1,2}-\d{1,5}-\d{1,5}(?:-p\d{1,3})?\.json$/.test(e.path)&&!paths.has(e.path),'invalid tile path');paths.add(e.path);
      for(const k of ['z','x','y','part','parts'])check(Number.isSafeInteger(e[k])&&e[k]>=0,'invalid tile key');
      check(e.z>=7&&e.z<=13&&e.x<2**e.z&&e.y<2**e.z&&e.part>=1&&e.part<=e.parts,'invalid tile key');
      check(e.path===(e.part===1?`tiles/${e.z}-${e.x}-${e.y}.json`:`tiles/${e.z}-${e.x}-${e.y}-p${e.part}.json`),'tile path does not match its key');
      check(Array.isArray(e.bbox)&&e.bbox.length===4&&e.bbox.every(finite)&&e.bbox[0]<=e.bbox[2]&&e.bbox[1]<=e.bbox[3]&&e.bbox[0]>=-180&&e.bbox[2]<=180&&e.bbox[1]>=-90&&e.bbox[3]<=90,'invalid tile bbox');
      check(Number.isSafeInteger(e.bytes)&&e.bytes>0&&e.bytes<=MAX_TILE_BYTES&&Number.isSafeInteger(e.records)&&e.records>0&&e.records<=MAX_TILE_RECORDS&&/^[a-f0-9]{64}$/.test(e.sha256),'invalid tile integrity fields');
    }
    return m;
  }
  function intersects(a,b){return a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];}
  // Zoom gating and a per-view budget. Below the minimum zoom nothing is requested.
  function tilesForView(m,bbox,zoom){
    if(!(zoom>=MIN_ZOOM))return {ok:false,reason:'zoom',tiles:[]};
    const boxes=bbox[2]-bbox[0]>=360?[[-180,bbox[1],180,bbox[3]]]:bbox[0]<-180?[[bbox[0]+360,bbox[1],180,bbox[3]],[-180,bbox[1],bbox[2],bbox[3]]]:bbox[2]>180?[[bbox[0],bbox[1],180,bbox[3]],[-180,bbox[1],bbox[2]-360,bbox[3]]]:[bbox];
    const tiles=m.tiles.filter(e=>boxes.some(b=>intersects(e.bbox,b))),bytes=tiles.reduce((n,e)=>n+e.bytes,0);
    if(tiles.length>MAX_VIEW_TILES||bytes>MAX_VIEW_BYTES)return {ok:false,reason:'budget',tiles:[],requested:tiles.length,bytes};
    return {ok:true,tiles,bytes};
  }
  function points(c){return c.geometry.type==='Point'?[c.geometry.coordinates]:c.geometry.coordinates;}
  function bboxOf(c){const ps=points(c);let w=180,s=90,e=-180,n=-90;for(const [x,y] of ps){w=Math.min(w,x);e=Math.max(e,x);s=Math.min(s,y);n=Math.max(n,y);}return [w,s,e,n];}
  function validateCandidate(c,box){
    check(plain(c)&&['node','way'].includes(c.osm_type)&&/^[1-9][0-9]{0,15}$/.test(c.osm_id)&&c.id===`osm:${c.osm_type}:${c.osm_id}`,'invalid identity');
    check(/^[A-Z]{2}$/.test(c.state)&&Number.isSafeInteger(c.osm_version)&&c.osm_version>0&&utc(c.edited_at),'invalid identity date');
    const g=c.geometry;check(plain(g)&&g.type===(c.osm_type==='node'?'Point':'LineString'),'invalid geometry');
    const ps=g.type==='Point'?[g.coordinates]:g.coordinates;
    check(Array.isArray(ps)&&(g.type==='Point'||ps.length>=2)&&ps.length<=50000&&ps.every(p=>Array.isArray(p)&&p.length===2&&p.every(finite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90),'invalid geometry');
    const b=bboxOf(c),eps=2e-6;check(b[0]>=box[0]-eps&&b[1]>=box[1]-eps&&b[2]<=box[2]+eps&&b[3]<=box[3]+eps,'candidate outside its tile bbox');
    check(plain(c.tags)&&Object.keys(c.tags).length>0&&Object.entries(c.tags).every(([k,v])=>TAG_KEYS.includes(k)&&str(v)),'invalid raw tags');
    check(plain(c.context)&&Object.values(c.context).every(v=>str(v)),'invalid context');
    check(STATUSES.includes(c.status)&&typeof c.comparable==='boolean'&&c.comparable===(c.status==='numeric_only'),'invalid status');
    check(APPLIES.includes(c.applies_to)&&Array.isArray(c.applies_to_evidence)&&c.applies_to_evidence.every(v=>str(v,120)),'invalid applies_to');
    check(Array.isArray(c.reasons)&&c.reasons.every(v=>str(v,120))&&Array.isArray(c.structure),'invalid reasons');
    check(plain(c.metres)&&plain(c.inches)&&Object.entries(c.inches).every(([k,v])=>Object.hasOwn(c.tags,k)&&(v===null||finite(v)&&v>0)),'invalid normalized values');
    if(c.comparable){
      const counted=COUNTED.filter(k=>finite(c.inches[k])).map(k=>c.inches[k]);
      check(finite(c.min_inches)&&c.min_inches>0&&counted.length>0&&Math.abs(Math.min(...counted)-c.min_inches)<1e-9&&finite(c.min_metres),'comparable candidate without a valid minimum');
      // The raw text must still parse to the stored minimum, so a corrupted value cannot pass as comparable.
      check(COUNTED.some(k=>Object.hasOwn(c.tags,k)&&parseHundredths(c.tags[k])?.hundredths===Math.round(c.min_inches*100)),'minimum differs from raw source');
    }else check(!Object.hasOwn(c,'min_inches')&&!Object.hasOwn(c,'min_metres'),'uncomparable candidate carries a minimum');
    return c;
  }
  function validateTile(doc,entry){
    check(plain(doc)&&doc.version===3&&doc.schema===SCHEMA&&doc.kind==='clearance_candidates'&&doc.license==='ODbL-1.0'&&doc.attribution===ATTRIBUTION,'invalid tile');
    check(plain(doc.tile)&&['z','x','y','part','parts'].every(k=>doc.tile[k]===entry[k]),'tile key mismatch');
    check(Array.isArray(doc.candidates)&&doc.candidates.length===entry.records,'tile record count mismatch');
    const ids=new Set();for(const c of doc.candidates){validateCandidate(c,entry.bbox);check(!ids.has(c.id),'duplicate identity');ids.add(c.id);}
    return doc;
  }
  async function sha256Hex(bytes,env=global){
    const subtle=env.crypto?.subtle;check(!!subtle,'integrity check unavailable');
    return Array.from(new Uint8Array(await subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function readBounded(url,max,env=global,signal,cache='no-cache'){
    const r=await env.fetch(url,{cache,credentials:'same-origin',signal});
    check(r.ok,'source unavailable');check(!(Number(r.headers.get('content-length'))>max),'response exceeds bound');
    if(!r.body?.getReader){const b=new Uint8Array(await r.arrayBuffer());check(b.byteLength<=max,'response exceeds bound');return b;}
    const reader=r.body.getReader(),chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new Error('Clearance candidates: response exceeds bound');}chunks.push(value);}
    const out=new Uint8Array(size);let pos=0;for(const c of chunks){out.set(c,pos);pos+=c.byteLength;}return out;
  }
  const decode=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));

  // Rhode Island pilot (RI.json, version 1). The national dataset protects RI until it is rebuilt under schema 3, so the
  // client keeps reading the shipped pilot there. Validation rules are those of the 2.34.0 pilot client, unchanged.
  const PILOT_DEADLINE_MS=15000,PILOT='data/clearances/RI.json',PILOT_BOX=[-72,40.9,-70.9,42.1],PILOT_SOURCE='https://download.geofabrik.de/north-america/us/rhode-island-latest.osm.pbf';
  const PILOT_KEYS=['maxheight','maxheight:physical','maxheight:conditional','maxheight:forward','maxheight:backward','maxheight:lanes'];
  const PILOT_CONTEXT=['name','ref','highway','bridge','tunnel','barrier','access','source:maxheight','maxheight:signed','source:maxheight:physical'];
  const exactUtc=s=>utc(s)&&new Date(s).toISOString()===s.replace('Z','.000Z');
  function validatePilot(d,now=Date.now()){
    const ck=(ok,msg)=>{if(!ok)throw new Error('Reported height tags: '+msg);};
    ck(plain(d)&&d.version===1&&d.region==='RI'&&Array.isArray(d.records)&&d.records.length>0&&d.records.length<=MAX_TILE_RECORDS,'invalid pilot');
    const s=d.source;
    ck(plain(s)&&s.kind==='geofabrik'&&s.url===PILOT_SOURCE&&(s.resolved_url===PILOT_SOURCE||/^https:\/\/download\.geofabrik\.de\/north-america\/us\/rhode-island-\d{6}\.osm\.pbf$/.test(s.resolved_url))&&/^[a-f0-9]{64}$/.test(s.sha256)&&Number.isSafeInteger(s.bytes)&&s.bytes>0&&s.bytes<=2*1024**3&&s.license==='ODbL-1.0'&&s.copyright_url===COPYRIGHT_URL&&exactUtc(s.retrieved_at)&&exactUtc(s.extract_timestamp)&&Date.parse(s.extract_timestamp)<=Date.parse(s.retrieved_at)&&Date.parse(s.retrieved_at)<=now+300000,'invalid source evidence');
    ck(s.resolved_url===PILOT_SOURCE||s.resolved_url.endsWith(s.extract_timestamp.slice(2,10).replaceAll('-','')+'.osm.pbf'),'resolved extract date mismatch');
    const ids=new Set();let vertices=0;
    for(const r of d.records){
      ck(plain(r)&&['node','way'].includes(r.osm_type)&&/^[1-9][0-9]*$/.test(r.osm_id)&&r.id===`osm:${r.osm_type}:${r.osm_id}`&&!ids.has(r.id)&&r.state==='RI'&&Number.isSafeInteger(r.osm_version)&&r.osm_version>0&&exactUtc(r.edited_at)&&Date.parse(r.edited_at)<=Date.parse(s.extract_timestamp),'invalid identity/date');ids.add(r.id);
      ck(plain(r.geometry)&&r.geometry.type===(r.osm_type==='node'?'Point':'LineString')&&Array.isArray(r.geometry.coordinates),'invalid geometry');
      const ps=r.geometry.type==='Point'?[r.geometry.coordinates]:r.geometry.coordinates;vertices+=ps.length;
      ck((r.osm_type==='node'||ps.length>=2)&&vertices<=50000&&ps.every(p=>Array.isArray(p)&&p.length===2&&p.every(finite)&&p[0]>=-72&&p[0]<=-70.9&&p[1]>=40.9&&p[1]<=42.1),'invalid pilot coordinates');
      ck(plain(r.tags)&&Object.keys(r.tags).length>0&&Object.entries(r.tags).every(([k,v])=>PILOT_KEYS.includes(k)&&str(v)),'invalid source tags');
      ck(plain(r.context)&&Object.entries(r.context).every(([k,v])=>PILOT_CONTEXT.includes(k)&&str(v)),'invalid context');
      ck(!!r.context.highway||r.context.barrier==='height_restrictor','no highway or height-restrictor context');
      ck(plain(r.metres)&&Object.keys(r.metres).every(k=>['maxheight','maxheight:physical'].includes(k)&&Object.hasOwn(r.tags,k)),'invalid normalized fields');
      for(const k of ['maxheight','maxheight:physical']){
        if(!Object.hasOwn(r.tags,k)){ck(!Object.hasOwn(r.metres,k),'invented height');continue;}
        const expected=parseHeight(r.tags[k]),value=r.metres[k];
        ck(expected===null?value===null:finite(value)&&Math.abs(value-expected)<1e-9,'height differs from raw source');
      }
    }
    return d;
  }
  // Pilot records were never reviewed for status, comparability or applies_to, so they are shown with their raw tags
  // and are never compared with a rig height or tied to a road.
  function pilotCandidates(d){
    return d.records.map(r=>({id:r.id,osm_type:r.osm_type,osm_id:r.osm_id,osm_version:r.osm_version,edited_at:r.edited_at,state:'RI',geometry:r.geometry,tags:{...r.tags},context:{...r.context},
      status:'pilot_unreviewed',comparable:false,applies_to:'unknown',applies_to_evidence:['ri_pilot_schema_1_not_assessed'],reasons:['ri_pilot_not_reviewed_under_schema_3'],structure:[],pilot:true}));
  }
  const pilotNeeded=(m,bbox)=>Object.hasOwn(m.states_protected||{},'RI')&&intersects(PILOT_BOX,bbox);
  // Manifest and tile access with size, sha256, schema and identity checks. Tiles that fail are never shown.
  function createStore(env=global,base=''){
    let manifest=null,pending=null;const tiles=new Map(),inflight=new Map();let held=0;
    const url=p=>base+p;
    async function loadManifest(){
      if(manifest)return manifest;if(pending)return pending;
      pending=readBounded(url(MANIFEST),MAX_MANIFEST_BYTES,env).then(b=>manifest=validateManifest(decode(b))).finally(()=>{pending=null;});return pending;
    }
    async function loadTile(entry,signal){
      if(tiles.has(entry.path)){const hit=tiles.get(entry.path);tiles.delete(entry.path);tiles.set(entry.path,hit);return hit.doc;}
      if(inflight.has(entry.path))return inflight.get(entry.path);
      const job=(async()=>{
        const bytes=await readBounded(url('data/clearances/'+entry.path),MAX_TILE_BYTES,env,signal);
        check(bytes.byteLength===entry.bytes,'tile size mismatch');check(await sha256Hex(bytes,env)===entry.sha256,'tile checksum mismatch');
        const doc=validateTile(decode(bytes),entry);tiles.set(entry.path,{doc,bytes:entry.bytes});held+=entry.bytes;
        for(const [k,v] of tiles){if(held<=MEMORY_BYTES)break;tiles.delete(k);held-=v.bytes;}
        return doc;
      })().finally(()=>inflight.delete(entry.path));
      inflight.set(entry.path,job);return job;
    }
    // Same dated offline copy as the 2.34.0 pilot client: Cache Storage kamptrail:<scope>:clearance-v1, keyed by the absolute
    // RI.json URL, written only after validation and validated again on read. A failed or late refresh uses the copy in
    // memory or the saved copy, labelled as a saved snapshot. Removing the layer cancels the request without using either.
    let pilot=null,pilotPending=null,pilotController=null;
    const scope=()=>env.location?.href?new env.URL('./',env.location.href).href:'';
    const pilotKey=()=>env.location?.href?new env.URL(PILOT,env.location.href).href:url(PILOT);
    const pilotCache=()=>`kamptrail:${scope()}:clearance-v1`;
    const pack=(d,saved)=>({source:d.source,candidates:pilotCandidates(d),saved});
    async function loadPilot({force=false}={}){
      // Offline, the copy in memory is a saved snapshot even if it was read online earlier in this tab.
      if(pilot&&!force)return env.navigator?.onLine===false&&!pilot.saved?(pilot={...pilot,saved:true}):pilot;
      if(pilotPending){if(pilotController?.signal.aborted){try{await pilotPending;}catch{}return loadPilot({force});}return pilotPending;}
      const ctl=new AbortController();pilotController=ctl;let timedOut=false;
      const timer=(env.setTimeout||setTimeout)(()=>{timedOut=true;ctl.abort();},PILOT_DEADLINE_MS);
      pilotPending=(async()=>{
        try{
          const d=validatePilot(decode(await readBounded(url(PILOT),MAX_TILE_BYTES,env,ctl.signal,'no-store')));pilot=pack(d,false);
          try{const cache=await env.caches.open(pilotCache());await cache.put(pilotKey(),new Response(JSON.stringify(d),{headers:{'content-type':'application/json'}}));}catch{}
          return pilot;
        }catch(error){
          if(ctl.signal.aborted&&!timedOut)throw error;
          if(pilot){pilot={...pilot,saved:true};return pilot;}
          try{const hit=await(await env.caches.open(pilotCache())).match(pilotKey());if(hit){const b=await readBounded(null,MAX_TILE_BYTES,{fetch:async()=>hit});pilot=pack(validatePilot(decode(b)),true);return pilot;}}catch{}
          throw error;
        }
      })().finally(()=>{(env.clearTimeout||clearTimeout)(timer);pilotPending=null;if(pilotController===ctl)pilotController=null;});
      return pilotPending;
    }
    const cancelPilot=()=>pilotController?.abort();
    const markPilotSaved=()=>{if(pilot&&!pilot.saved)pilot={...pilot,saved:true};};
    return {loadManifest,loadTile,loadPilot,cancelPilot,markPilotSaved,pilotCacheName:pilotCache,get manifest(){return manifest;}};
  }
  function validReport(r){
    return plain(r)&&Number.isSafeInteger(r.id)&&r.id>0&&finite(r.lat)&&finite(r.lng)&&Math.abs(r.lat)<=90&&Math.abs(r.lng)<=180&&str(r.posted,40)&&parseHundredths(r.posted)?.hundredths===r.hundredths
      &&/^\d{4}-\d\d-\d\d$/.test(r.observed_on)&&utc(r.published_at)&&DIRECTIONS.includes(r.direction)&&(r.osm_ref===null||/^osm:(?:node|way):[1-9][0-9]{0,15}$/.test(r.osm_ref));
  }
  // The endpoint returns at most 200 rows and says so; the count shown must never read as complete when it is not.
  function reportsSummary(d){const n=d?.reports?.length??0;return d?.truncated?t('First {count} visitor reports; more are not shown.',{count:n}):t('{count} visitor reports.',{count:n});}
  async function loadReports(bbox,env=global,signal){
    const q=bbox.map(n=>n.toFixed(4)).join(',');
    const raw=await readBounded(REPORTS+'?bbox='+encodeURIComponent(q),256*1024,env,signal),d=decode(raw);
    check(plain(d)&&d.ok===true&&d.version===1&&Array.isArray(d.reports)&&d.reports.length<=200&&d.reports.every(validReport)&&typeof d.truncated==='boolean','invalid visitor reports');
    return d;
  }

  // Display only, to the nearest tenth of an inch. Comparison uses whole millimetres.
  const inches=h=>{const tenths=Math.round(Math.abs(h)/10),ft=Math.floor(tenths/120),inch=(tenths-ft*120)/10;return ft?`${ft}'${inch}"`:`${inch}"`;};
  function stateText(c){
    if(c.pilot)return t('Rhode Island pilot record: raw source tags only. Not reviewed for comparison, so it is not compared with your rig height.');
    if(state(c)==='comparable')return t('Numeric tag; can be compared with your rig height.');
    if(c.status==='suspect')return t('Value needs checking: it failed a plausibility check and is not compared.');
    if(c.status==='unknown')return t('Unknown: no usable number. Not compared.');
    if(c.status==='conditional')return t('Needs checking: conditional limit, not interpreted or compared.');
    if(c.status==='directional_only')return t('Needs checking: direction or lane limit, not interpreted or compared.');
    return t('Needs checking: mixed plain and direction or lane values, not compared.');
  }
  function comparisonText(cmp){
    if(cmp.relation==='no_rig_height')return t('Save a travel height in your rig profile to compare.');
    if(cmp.relation==='not_compared')return t('Not compared with your rig height.');
    const clearance=inches(cmp.clearance_hundredths),rig=inches(cmp.rig_mm*1000/254),gap=inches(cmp.difference_mm*1000/254);
    if(cmp.relation==='below')return t('Conflict: tagged clearance {clearance} is lower than your rig height {rig} by {gap}.',{clearance,rig,gap});
    if(cmp.relation==='equal')return t('Conflict: tagged clearance {clearance} equals your rig height {rig}. Equal is not clear.',{clearance,rig});
    return t('Tagged clearance {clearance} is higher than your rig height {rig} by {gap}. One tagged object only; this does not establish passage.',{clearance,rig,gap});
  }
  function appliesText(c){
    if(c.applies_to==='unknown')return t('Road relationship unknown: this data cannot tie the limit to a road.');
    return t('Limit tagged on this road way ({evidence}). Which road a route drives is a separate question.',{evidence:c.applies_to_evidence.join(', ')});
  }
  function heightText(c,key){
    if(!Object.hasOwn(c.tags,key))return t('Unknown; no source tag');
    const value=parseHeight(c.tags[key]);
    return c.tags[key]+(value===null?t(' (numeric limit unknown)'):t(' (about {value} m)',{value:value.toFixed(2)}));
  }
  function sourceLink(c){return`https://www.openstreetmap.org/${c.osm_type}/${c.osm_id}`;}
  function sourceDates(m,c,pilot){const s=c.pilot?pilot?.source:m?.sources?.[c.state];return (c.pilot&&pilot?.saved?t('Saved snapshot. '):'')+(s?t('OpenStreetMap extract {extract}; downloaded {retrieved}. Object last edited {edited}. These dates are not an inspection.',{extract:s.extract_timestamp,retrieved:s.retrieved_at,edited:c.edited_at}):t('Object last edited {edited}. Extract date unknown.',{edited:c.edited_at}));}
  function attributionNode(doc){
    const p=doc.createElement('p');p.className='kt-odbl';p.append(ATTRIBUTION+' ');
    const a=doc.createElement('a');a.href=COPYRIGHT_URL;a.target='_blank';a.rel='noopener noreferrer';a.textContent=t('OpenStreetMap copyright and licence');p.append(a);return p;
  }
  const rigHeight=()=>{try{return global.KampTrailRigProfile?.getProfile?.()?.rig?.heightMm??null;}catch{return null;}};

  // Visitor report form. Reuses the moderated corrections queue (api/submit.php); nothing appears until a moderator applies it.
  function openReportForm(target){
    const doc=global.document,d=doc.createElement('dialog');d.id='kt-clearance-report';d.setAttribute('aria-labelledby','kt-clearance-report-title');
    const el=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
    const field=(label,input,hint)=>{const w=el('label');w.className='kt-field';w.append(el('span',label),input);if(hint)w.append(el('small',hint));return w;};
    const h=el('h2',t('Report a posted clearance'));h.id='kt-clearance-report-title';
    const close=el('button',t('Close'));close.type='button';close.onclick=()=>d.close();
    const f=el('form');f.noValidate=true;const opened=Date.now();
    const posted=el('input');posted.name='posted';posted.required=true;posted.maxLength=40;posted.autocomplete='off';posted.placeholder=`13'6" / 4.1 m`;
    const observed=el('input');observed.type='date';observed.name='observed_on';observed.required=true;observed.max=new Date().toISOString().slice(0,10);
    const direction=el('select');direction.name='direction';for(const [v,l] of [['unsure',t('Not sure')],['both',t('Both directions')],['one_direction',t('One direction only')]]){const o=el('option',l);o.value=v;direction.append(o);}
    const details=el('textarea');details.name='details';details.rows=3;details.maxLength=4000;details.required=true;
    const source=el('input');source.name='source';source.maxLength=500;
    const hp=el('div');hp.className='kt-hp';hp.setAttribute('aria-hidden','true');const trap=el('input');trap.name='website';trap.tabIndex=-1;trap.autocomplete='off';hp.append(field(t('Website'),trap));
    const confirm=el('label');confirm.className='kt-confirm';const first=el('input');first.type='checkbox';first.name='firsthand';confirm.append(first,' '+t('I saw this sign myself or it comes from an official source.'));
    const msg=el('p');msg.className='kt-report-msg';msg.setAttribute('role','status');msg.setAttribute('aria-live','polite');
    const send=el('button',t('Send for moderation'));send.type='submit';send.className='btn primary';
    const where=el('p',t('Location: {lat}, {lng}.',{lat:target.lat.toFixed(5),lng:target.lng.toFixed(5)})+(target.osm_ref?' '+t('Linked to OpenStreetMap object {id}.',{id:target.osm_ref}):' '+t('Move the map so its centre is on the structure before opening this form.')));
    f.append(el('p',t('A moderator reviews every report. Published reports show the posted value and dates. They are never compared with your rig height and never change OpenStreetMap data.')),where,
      field(t('Posted clearance on the sign'),posted,t(`Write it as on the sign, for example 13'6" or 4.1 m.`)),field(t('Date you saw it'),observed),field(t('Applies to'),direction),
      field(t('Where is the sign and what is it on?'),details,t('Road name, structure and travel direction. At least 10 characters.')),field(t('Source (optional)'),source),hp,confirm,msg,send);
    f.onsubmit=async e=>{
      e.preventDefault();const text=posted.value.trim();
      if(!parseHundredths(text)){msg.textContent=t(`Enter the posted height as 13'6" or 4.1 m.`);return;}
      const body={kind:'clearance',details:details.value,source:source.value,website:trap.value,firsthand:first.checked,elapsed_ms:Date.now()-opened,lat:+target.lat.toFixed(6),lng:+target.lng.toFixed(6),
        clearance:{posted:text,observed_on:observed.value,direction:direction.value,osm_ref:target.osm_ref||null}};
      send.disabled=true;msg.textContent=t('Sending…');let res=null,out={};
      try{res=await global.fetch('api/submit.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});out=await res.json().catch(()=>({}));}catch{}
      send.disabled=false;
      if(res?.status===201&&/^[a-f0-9]{32}$/.test(out.token||'')){
        try{const list=JSON.parse(global.localStorage.getItem('kt_reports_v1')||'[]');list.unshift({token:out.token,name:t('Posted clearance {value}',{value:text}),kind:'clearance',at:new Date().toISOString()});global.localStorage.setItem('kt_reports_v1',JSON.stringify(list.slice(0,50)));}catch{}
        f.replaceChildren(el('p',t('Received. A moderator will review it. Check its status under About the data, My reports.')));return;
      }
      msg.textContent=res?.status===422&&out.fields?Object.values(out.fields).map(v=>t(v)).join(' '):res?.status===429?t('Too many reports from this connection. Try again later.'):t('Reports are unavailable right now. Try again later.');
    };
    d.append(close,h,f);doc.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();posted.focus();return d;
  }

  function init(map){
    const L=global.L,doc=global.document,layer=L.layerGroup(),store=createStore();
    let control,status,select,openButton,view=0,controller=null,rows=[],reports=[],pilotData=null;
    const active=()=>map.hasLayer(layer);
    const el=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
    const link=(label,url)=>{const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
    const credit=`<a href="${COPYRIGHT_URL}" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors, ODbL</a>`;
    function popup(c,m,pilot){
      const box=el('div');box.className='kt-clearance-popup';box.tabIndex=0;box.setAttribute('role','region');box.setAttribute('aria-label',t('Clearance candidate details'));box.style.maxHeight=Math.max(80,Math.min(380,map.getSize().y-160))+'px';
      const cmp=compare(c,rigHeight());const verdict=el('p',comparisonText(cmp));verdict.className='kt-clearance-verdict kt-clearance-'+(cmp.conflict?'conflict':cmp.relation);
      box.append(el('h2',c.context.name||c.context.ref||t('Clearance candidate')),verdict,el('p',stateText(c)));
      for(const key of TAG_KEYS)if(Object.hasOwn(c.tags,key))box.append(el('p',`${key}: ${heightText(c,key)}`));
      box.append(el('p',appliesText(c)),el('p',t('Map view only: not matched to any route.')));
      if(c.reasons.length)box.append(el('p',t('Source flags: {reasons}',{reasons:c.reasons.join(', ')})));
      if(Object.keys(c.context).length){const dl=el('dl');for(const [k,v] of Object.entries(c.context))dl.append(el('dt',k),el('dd',v));box.append(dl);}
      box.append(el('p',sourceDates(m,c,pilot)),link(t('OpenStreetMap source object'),sourceLink(c)),' · ',link(t('OSM height-tag guidance'),'https://wiki.openstreetmap.org/wiki/Key:maxheight'),attributionNode(doc));
      const report=el('button',t('Report a different posted clearance'));report.type='button';const p0=points(c)[0];report.onclick=()=>{map.closePopup();openReportForm({lat:p0[1],lng:p0[0],osm_ref:c.id});};box.append(report);
      return box;
    }
    function reportPopup(r){
      const box=el('div');box.className='kt-clearance-popup';box.tabIndex=0;box.setAttribute('role','region');box.setAttribute('aria-label',t('Visitor-reported clearance details'));
      box.append(el('h2',t('Visitor-reported posted clearance')),el('p',t('Posted value: {value}. Seen {observed}; published {published}.',{value:r.posted,observed:r.observed_on,published:r.published_at.slice(0,10)})),
        el('p',t('Moderated visitor report, not OpenStreetMap data. Not compared with your rig height and not tied to a road.')),el('p',t('Applies to: {direction}',{direction:{both:t('Both directions'),one_direction:t('One direction only'),unsure:t('Not sure')}[r.direction]})));
      if(r.osm_ref)box.append(el('p',t('Linked to OpenStreetMap object {id}.',{id:r.osm_ref})));
      return box;
    }
    const colour=c=>{const cmp=compare(c,rigHeight());return cmp.conflict?'#b3261e':cmp.relation==='above'?'#1f5f99':cmp.state==='unknown'?'#5c5c5c':'#9a6200';};
    async function redraw(forcePilot=false){
      const current=++view;controller?.abort();controller=null;if(control)control.hidden=!active();if(!active()){store.cancelPilot();map.attributionControl?.removeAttribution(credit);return;}
      map.attributionControl?.addAttribution(credit);
      const b=map.getBounds(),bbox=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],zoom=map.getZoom();
      if(zoom<MIN_ZOOM){clearAll();status.textContent=t('Zoom to level {zoom} or closer to load clearance candidates. Nothing is loaded at this zoom; hazards here are unknown.',{zoom:MIN_ZOOM});return;}
      status.textContent=t('Loading clearance candidates…');controller=new AbortController();const signal=controller.signal;
      try{
        let m=null,manifestFailed=false;try{m=await store.loadManifest();}catch{manifestFailed=true;}if(current!==view)return;
        const riView=intersects(PILOT_BOX,bbox);
        if(manifestFailed&&!riView)throw new Error('manifest unavailable');
        const plan=m?tilesForView(m,bbox,zoom):{ok:true,tiles:[]};
        if(!plan.ok){clearAll();status.textContent=t('This view needs too much clearance data. Zoom in further; hazards here are unknown.');return;}
        let failed=0;const seen=new Map();
        await Promise.all(plan.tiles.map(e=>store.loadTile(e,signal).then(d=>{for(const c of d.candidates)if(intersects(bboxOf(c),bbox))seen.set(c.id,c);}).catch(()=>{failed++;})));
        let regionNote=manifestFailed?' '+t('National clearance data unavailable; outside Rhode Island this view is unknown.'):'';const protectedStates=Object.keys(m?.states_protected||{});
        // The pilot is read while the manifest protects RI, or when the manifest cannot be read at all (for example offline).
        let pilotNow=null;
        if(riView&&(manifestFailed||pilotNeeded(m,bbox))){
          try{pilotNow=await store.loadPilot({force:forcePilot});if(current!==view||!active())return;let added=0;for(const c of pilotNow.candidates)if(!seen.has(c.id)&&intersects(bboxOf(c),bbox)){seen.set(c.id,c);added++;}regionNote+=' '+(pilotNow.saved?t('Saved snapshot. '):'')+t('Rhode Island: {count} pilot records with raw tags only (extract {date}); not compared.',{count:added,date:pilotNow.source.extract_timestamp.slice(0,10)});}
          catch{if(current!==view||!active())return;regionNote+=' '+t('Rhode Island pilot data is missing or failed validation; Rhode Island is unknown.');}
        }
        const others=protectedStates.filter(x=>x!=='RI');if(others.length)regionNote+=' '+t('Not in this dataset: {states}.',{states:others.join(', ')});
        let reportsNote='',reportData=null;
        try{reportData=await loadReports(bbox,global,signal);}catch{reportsNote=' '+t('Visitor reports unavailable.');}
        if(current!==view||!active())return;
        pilotData=pilotNow;reports=reportData?.reports||[];
        rows=[...seen.values()].sort((a,b)=>{const r=x=>{const c=compare(x,rigHeight());return c.conflict?0:c.state==='needs_checking'?1:c.state==='unknown'?2:3;};return r(a)-r(b)||a.id.localeCompare(b.id);});
        const conflicts=rows.filter(c=>compare(c,rigHeight()).conflict).length,unresolved=rows.filter(c=>state(c)!=='comparable').length;
        status.textContent=t('{count} clearance candidates in view: {conflicts} conflict with your rig height, {unresolved} need checking or unknown.',{count:rows.length,conflicts,unresolved})+(reportData?' '+reportsSummary(reportData):'')+(failed?' '+t('{failed} data tiles failed their integrity check and are not shown; that area is unknown.',{failed}):'')+reportsNote+' '+t('Unmapped hazards are unknown.')+regionNote;
        render(m);
      }catch(error){
        if(current===view&&active()){clearAll();status.textContent=t('Clearance candidates unavailable. Hazards in this view are unknown. Reconnect and retry.');}
      }
    }
    // Layer, selector and counts change together. An open clearance popup stays only while its record is in the new
    // validated result, with its content rebuilt from that result; otherwise it is closed.
    const openItem=()=>{const p=map._popup;return p?.isOpen?.()&&p._source&&typeof p._source.ktClearanceId==='string'&&layer.hasLayer?.(p._source)!==false?p._source:null;};
    function clearAll(){const open=openItem();if(open)map.closePopup();layer.clearLayers();select.replaceChildren();select.disabled=openButton.disabled=true;}
    function render(m){
      const popupOptions={maxWidth:Math.max(120,Math.min(300,map.getSize().x-70)),autoPanPaddingTopLeft:[12,80],autoPanPaddingBottomRight:[12,28]};
      const open=openItem(),openId=open?.ktClearanceId;
      const keepCandidate=openId&&rows.find(c=>c.id===openId),keepReport=openId&&reports.find(r=>'report:'+r.id===openId);
      if(open&&!keepCandidate&&!keepReport)map.closePopup();
      for(const l of layer.getLayers())if(!(l===open&&(keepCandidate||keepReport)))layer.removeLayer(l);
      select.replaceChildren();
      for(const c of rows){
        const o={color:colour(c),weight:5,opacity:.9,dashArray:state(c)==='comparable'?null:'6 5'},shownPilot=c.pilot?pilotData:null,content=()=>popup(c,m,shownPilot);
        if(open&&keepCandidate&&c.id===openId){open.setStyle?.(o);open.getPopup().setContent(content);open.getPopup().update?.();continue;}
        const item=c.geometry.type==='LineString'?L.polyline(c.geometry.coordinates.map(p=>[p[1],p[0]]),o):L.circleMarker([c.geometry.coordinates[1],c.geometry.coordinates[0]],{...o,radius:7});
        item.ktClearanceId=c.id;item.bindPopup(content,popupOptions);layer.addLayer(item);
      }
      for(const r of reports){
        if(open&&keepReport&&'report:'+r.id===openId){open.getPopup().setContent(()=>reportPopup(r));open.getPopup().update?.();continue;}
        const item=L.circleMarker([r.lat,r.lng],{color:'#6b2f8f',weight:3,radius:8,fillOpacity:.15});item.ktClearanceId='report:'+r.id;item.bindPopup(()=>reportPopup(r),{maxWidth:popupOptions.maxWidth});layer.addLayer(item);
      }
      const listed=[...rows.slice(0,LIST_LIMIT).map(c=>[c.id,`${c.context.name||c.context.ref||t('Source object')} · ${c.id}`]),...reports.map(r=>['report:'+r.id,t('Visitor report {value}',{value:r.posted})])];
      for(const [id,label] of listed){const o=el('option',label);o.value=id;select.append(o);}
      if(openId&&listed.some(([id])=>id===openId))select.value=openId;
      select.disabled=openButton.disabled=!listed.length;
    }
    const widget=L.control({position:'bottomleft'});
    widget.onAdd=()=>{
      control=el('div');control.className='kt-clearance-control';control.hidden=true;status=el('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      const label=el('label',t('Clearance candidate in view'));select=el('select');select.setAttribute('aria-label',t('Clearance candidate in view'));select.disabled=true;label.append(select);
      openButton=el('button',t('Open selected candidate'));openButton.type='button';openButton.disabled=true;
      openButton.onclick=()=>{const item=layer.getLayers().find(l=>l.ktClearanceId===select.value);if(item){item.openPopup();global.setTimeout(()=>map.getContainer().querySelector('.kt-clearance-popup')?.focus(),0);}};
      const retry=el('button',t('Retry clearance data'));retry.type='button';retry.onclick=()=>redraw(true);
      const report=el('button',t('Report a posted clearance'));report.type='button';report.onclick=()=>{const c=map.getCenter();openReportForm({lat:c.lat,lng:c.lng,osm_ref:null});};
      control.append(el('strong',t('Clearance candidates')),status,label,openButton,retry,report,attributionNode(doc));
      L.DomEvent.disableClickPropagation(control);L.DomEvent.disableScrollPropagation(control);return control;
    };
    widget.addTo(map);
    map.on('overlayadd overlayremove',e=>{if(e.layer===layer)redraw();});
    let timer;map.on('moveend',()=>{global.clearTimeout(timer);timer=global.setTimeout(()=>redraw(),180);});
    global.addEventListener?.('kamptrail:rigprofilechanged',()=>{if(active())redraw();});
    global.addEventListener?.('online',()=>{if(active())redraw(true);});
    global.addEventListener?.('offline',()=>{store.markPilotSaved();if(active())redraw();});
    return layer;
  }
  const api={version:VERSION,SCHEMA,MANIFEST,MIN_ZOOM,MAX_VIEW_TILES,MAX_VIEW_BYTES,MAX_TILE_BYTES,ATTRIBUTION,COPYRIGHT_URL,LICENSE_URL,parseHeight,parseHundredths,rigHundredths,state,compare,
    validateManifest,validateTile,validateCandidate,tilesForView,intersects,bboxOf,points,sha256Hex,readBounded,createStore,loadReports,validReport,
    reportsSummary,validatePilot,pilotCandidates,pilotNeeded,PILOT,PILOT_BOX,stateText,comparisonText,appliesText,heightText,sourceLink,sourceDates,attributionNode,openReportForm,init};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else global.KampTrailClearances=api;
})(typeof window!=='undefined'?window:globalThis);
