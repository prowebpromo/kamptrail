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
  async function readBounded(url,max,env=global,signal){
    const r=await env.fetch(url,{cache:'no-cache',credentials:'same-origin',signal});
    check(r.ok,'source unavailable');check(!(Number(r.headers.get('content-length'))>max),'response exceeds bound');
    if(!r.body?.getReader){const b=new Uint8Array(await r.arrayBuffer());check(b.byteLength<=max,'response exceeds bound');return b;}
    const reader=r.body.getReader(),chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new Error('Clearance candidates: response exceeds bound');}chunks.push(value);}
    const out=new Uint8Array(size);let pos=0;for(const c of chunks){out.set(c,pos);pos+=c.byteLength;}return out;
  }
  const decode=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
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
    return {loadManifest,loadTile,get manifest(){return manifest;}};
  }
  function validReport(r){
    return plain(r)&&Number.isSafeInteger(r.id)&&r.id>0&&finite(r.lat)&&finite(r.lng)&&Math.abs(r.lat)<=90&&Math.abs(r.lng)<=180&&str(r.posted,40)&&parseHundredths(r.posted)?.hundredths===r.hundredths
      &&/^\d{4}-\d\d-\d\d$/.test(r.observed_on)&&utc(r.published_at)&&DIRECTIONS.includes(r.direction)&&(r.osm_ref===null||/^osm:(?:node|way):[1-9][0-9]{0,15}$/.test(r.osm_ref));
  }
  async function loadReports(bbox,env=global,signal){
    const q=bbox.map(n=>n.toFixed(4)).join(',');
    const raw=await readBounded(REPORTS+'?bbox='+encodeURIComponent(q),256*1024,env,signal),d=decode(raw);
    check(plain(d)&&d.ok===true&&d.version===1&&Array.isArray(d.reports)&&d.reports.length<=200&&d.reports.every(validReport)&&typeof d.truncated==='boolean','invalid visitor reports');
    return d;
  }

  const inches=h=>{const total=Math.abs(h)/100,ft=Math.floor(total/12),inch=total-ft*12;return `${ft}'${Number(inch.toFixed(2))}"`;};
  function stateText(c){
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
    const clearance=inches(cmp.clearance_hundredths),rig=inches(cmp.rig_hundredths),gap=inches(Math.round(cmp.difference_mm*1000/254));
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
  function sourceDates(m,c){const s=m?.sources?.[c.state];return s?t('OpenStreetMap extract {extract}; downloaded {retrieved}. Object last edited {edited}. These dates are not an inspection.',{extract:s.extract_timestamp,retrieved:s.retrieved_at,edited:c.edited_at}):t('Object last edited {edited}. Extract date unknown.',{edited:c.edited_at});}
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
    let control,status,select,openButton,view=0,controller=null,rows=[],reports=[];
    const active=()=>map.hasLayer(layer);
    const el=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
    const link=(label,url)=>{const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
    const credit=`<a href="${COPYRIGHT_URL}" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors, ODbL</a>`;
    function popup(c,m){
      const box=el('div');box.className='kt-clearance-popup';box.tabIndex=0;box.setAttribute('role','region');box.setAttribute('aria-label',t('Clearance candidate details'));box.style.maxHeight=Math.max(80,Math.min(380,map.getSize().y-160))+'px';
      const cmp=compare(c,rigHeight());const verdict=el('p',comparisonText(cmp));verdict.className='kt-clearance-verdict kt-clearance-'+(cmp.conflict?'conflict':cmp.relation);
      box.append(el('h2',c.context.name||c.context.ref||t('Clearance candidate')),verdict,el('p',stateText(c)));
      for(const key of TAG_KEYS)if(Object.hasOwn(c.tags,key))box.append(el('p',`${key}: ${heightText(c,key)}`));
      box.append(el('p',appliesText(c)),el('p',t('Map view only: not matched to any route.')));
      if(c.reasons.length)box.append(el('p',t('Source flags: {reasons}',{reasons:c.reasons.join(', ')})));
      if(Object.keys(c.context).length){const dl=el('dl');for(const [k,v] of Object.entries(c.context))dl.append(el('dt',k),el('dd',v));box.append(dl);}
      box.append(el('p',sourceDates(m,c)),link(t('OpenStreetMap source object'),sourceLink(c)),' · ',link(t('OSM height-tag guidance'),'https://wiki.openstreetmap.org/wiki/Key:maxheight'),attributionNode(doc));
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
    async function redraw(){
      const current=++view;controller?.abort();controller=null;if(control)control.hidden=!active();if(!active()){map.attributionControl?.removeAttribution(credit);return;}
      map.attributionControl?.addAttribution(credit);
      const b=map.getBounds(),bbox=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],zoom=map.getZoom();
      if(zoom<MIN_ZOOM){if(!map._popup?.isOpen?.())layer.clearLayers();select.replaceChildren();select.disabled=openButton.disabled=true;status.textContent=t('Zoom to level {zoom} or closer to load clearance candidates. Nothing is loaded at this zoom; hazards here are unknown.',{zoom:MIN_ZOOM});return;}
      status.textContent=t('Loading clearance candidates…');controller=new AbortController();const signal=controller.signal;
      try{
        const m=await store.loadManifest();if(current!==view)return;
        const plan=tilesForView(m,bbox,zoom);
        if(!plan.ok){if(!map._popup?.isOpen?.())layer.clearLayers();select.replaceChildren();select.disabled=openButton.disabled=true;status.textContent=t('This view needs too much clearance data. Zoom in further; hazards here are unknown.');return;}
        let failed=0;const seen=new Map();
        await Promise.all(plan.tiles.map(e=>store.loadTile(e,signal).then(d=>{for(const c of d.candidates)if(intersects(bboxOf(c),bbox))seen.set(c.id,c);}).catch(()=>{failed++;})));
        let reportsNote='';
        try{reports=(await loadReports(bbox,global,signal)).reports;}catch{reports=[];reportsNote=' '+t('Visitor reports unavailable.');}
        if(current!==view||!active())return;
        rows=[...seen.values()].sort((a,b)=>{const r=x=>{const c=compare(x,rigHeight());return c.conflict?0:c.state==='needs_checking'?1:c.state==='unknown'?2:3;};return r(a)-r(b)||a.id.localeCompare(b.id);});
        const conflicts=rows.filter(c=>compare(c,rigHeight()).conflict).length,unresolved=rows.filter(c=>state(c)!=='comparable').length;
        status.textContent=t('{count} clearance candidates in view: {conflicts} conflict with your rig height, {unresolved} need checking or unknown. {reports} visitor reports.',{count:rows.length,conflicts,unresolved,reports:reports.length})+(failed?' '+t('{failed} data tiles failed their integrity check and are not shown; that area is unknown.',{failed}):'')+reportsNote+' '+t('Unmapped hazards are unknown.')+(Object.keys(m.states_protected).length?' '+t('Not in this dataset: {states}.',{states:Object.keys(m.states_protected).join(', ')}):'');
        if(map._popup?.isOpen?.())return;
        layer.clearLayers();select.replaceChildren();
        for(const c of rows){
          const o={color:colour(c),weight:5,opacity:.9,dashArray:state(c)==='comparable'?null:'6 5'};
          const item=c.geometry.type==='LineString'?L.polyline(c.geometry.coordinates.map(p=>[p[1],p[0]]),o):L.circleMarker([c.geometry.coordinates[1],c.geometry.coordinates[0]],{...o,radius:7});
          item.ktClearanceId=c.id;item.bindPopup(()=>popup(c,m),{maxWidth:Math.max(120,Math.min(300,map.getSize().x-70)),autoPanPaddingTopLeft:[12,80],autoPanPaddingBottomRight:[12,28]});layer.addLayer(item);
        }
        for(const r of reports){const item=L.circleMarker([r.lat,r.lng],{color:'#6b2f8f',weight:3,radius:8,fillOpacity:.15});item.ktClearanceId='report:'+r.id;item.bindPopup(()=>reportPopup(r),{maxWidth:Math.max(120,Math.min(300,map.getSize().x-70))});layer.addLayer(item);}
        const listed=[...rows.slice(0,LIST_LIMIT).map(c=>[c.id,`${c.context.name||c.context.ref||t('Source object')} · ${c.id}`]),...reports.map(r=>['report:'+r.id,t('Visitor report {value}',{value:r.posted})])];
        for(const [id,label] of listed){const o=el('option',label);o.value=id;select.append(o);}
        select.disabled=openButton.disabled=!listed.length;
      }catch(error){
        if(current===view&&active()){if(!map._popup?.isOpen?.())layer.clearLayers();select.disabled=openButton.disabled=true;status.textContent=t('Clearance candidates unavailable. Hazards in this view are unknown. Reconnect and retry.');}
      }
    }
    const widget=L.control({position:'bottomleft'});
    widget.onAdd=()=>{
      control=el('div');control.className='kt-clearance-control';control.hidden=true;status=el('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      const label=el('label',t('Clearance candidate in view'));select=el('select');select.setAttribute('aria-label',t('Clearance candidate in view'));select.disabled=true;label.append(select);
      openButton=el('button',t('Open selected candidate'));openButton.type='button';openButton.disabled=true;
      openButton.onclick=()=>{const item=layer.getLayers().find(l=>l.ktClearanceId===select.value);if(item){item.openPopup();global.setTimeout(()=>map.getContainer().querySelector('.kt-clearance-popup')?.focus(),0);}};
      const retry=el('button',t('Retry clearance data'));retry.type='button';retry.onclick=()=>redraw();
      const report=el('button',t('Report a posted clearance'));report.type='button';report.onclick=()=>{const c=map.getCenter();openReportForm({lat:c.lat,lng:c.lng,osm_ref:null});};
      control.append(el('strong',t('Clearance candidates')),status,label,openButton,retry,report,attributionNode(doc));
      L.DomEvent.disableClickPropagation(control);L.DomEvent.disableScrollPropagation(control);return control;
    };
    widget.addTo(map);
    map.on('overlayadd overlayremove',e=>{if(e.layer===layer)redraw();});
    let timer;map.on('moveend',()=>{global.clearTimeout(timer);timer=global.setTimeout(()=>redraw(),180);});
    map.on('popupclose',()=>global.setTimeout(()=>{if(!map._popup?.isOpen?.()&&active())redraw();},0));
    global.addEventListener?.('kamptrail:rigprofilechanged',()=>{if(active())redraw();});
    global.addEventListener?.('online',()=>{if(active())redraw();});
    return layer;
  }
  const api={version:VERSION,SCHEMA,MANIFEST,MIN_ZOOM,MAX_VIEW_TILES,MAX_VIEW_BYTES,MAX_TILE_BYTES,ATTRIBUTION,COPYRIGHT_URL,LICENSE_URL,parseHeight,parseHundredths,rigHundredths,state,compare,
    validateManifest,validateTile,validateCandidate,tilesForView,intersects,bboxOf,points,sha256Hex,readBounded,createStore,loadReports,validReport,
    stateText,comparisonText,appliesText,heightText,sourceLink,sourceDates,attributionNode,openReportForm,init};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else global.KampTrailClearances=api;
})(typeof window!=='undefined'?window:globalThis);
