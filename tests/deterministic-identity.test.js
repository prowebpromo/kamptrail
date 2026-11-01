'use strict';
// Deterministic browser identity (2.33.0): the map elects the canonical host the published index elected,
// whatever order and timing states load with, and stored ids are never rewritten. docs/DETERMINISTIC_IDENTITY.md
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const {identityHosts}=require('../scripts/build-identity-hosts.js');
const {listingRow}=require('../scripts/build-search-index.js');
const DQ=require('../data-quality.js');
const dir=path.join(root,'data/campsites');
const indexText=fs.readFileSync(path.join(dir,'search-index.json'),'utf8'),index=JSON.parse(indexText),byId=new Map(index.sites.map(s=>[s.id,s]));

function harness({hosts='served',delay={},fail=new Set(),sidecarDelay=0}={}){
  const host={mode:hosts};
  const cluster={addLayers(){},addLayer(){},removeLayer(){}};
  const ocean={getSouth:()=>-10,getNorth:()=>-9,getWest:()=>-140,getEast:()=>-139,contains:()=>false};
  const map={on(){return this;},getBounds:()=>ocean,addLayer(){},removeLayer(){},hasLayer:()=>false,getZoom:()=>10,setView(){},closePopup(){}};
  const requests=[];
  const fetcher=async(url,opts)=>{
    const rel=String(url);requests.push(rel);
    const code=(rel.match(/([A-Z]{2})(?:_merged)?\.geojson$/)||[])[1];
    if(code&&delay[code])await new Promise(r=>setTimeout(r,delay[code]));
    if(sidecarDelay&&/(ridb-amenities|usfs-site-amenities)\.json$/.test(rel))await new Promise(r=>setTimeout(r,sidecarDelay));
    if(rel.endsWith('identity-hosts.json')&&host.mode!=='served'){
      if(host.mode==='corrupt')return {ok:true,json:async()=>({version:1,hosts:[]})};
      if(host.mode==='timeout')return new Promise((_,reject)=>opts?.signal?.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}))));
      return {ok:false,status:404,json:async()=>({})};
    }
    if(code&&fail.has(code))return {ok:false,status:503,json:async()=>({})};
    const file=path.join(root,rel);if(!fs.existsSync(file))return {ok:false,status:404,json:async()=>({})};
    return {ok:true,json:async()=>JSON.parse(fs.readFileSync(file,'utf8'))};
  };
  const context={console:{warn(){},log(){},error(){}},fetch:fetcher,setTimeout,clearTimeout,AbortController,URL,document:{addEventListener(){}},dispatchEvent(){},
    L:{markerClusterGroup:()=>cluster,divIcon:o=>o,marker:()=>({bindPopup(){return this;},on(){return this;},setPopupContent(){return this;}})}};
  context.window=context;vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'data-quality.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'data-loader.js'),'utf8'),context);
  return {api:context.KampTrailData,DQ:context.DataQuality,map,requests,serveHosts:()=>{host.mode='served';}};
}
// Values built inside the VM realm are compared as plain JSON.
const plain=v=>JSON.parse(JSON.stringify(v));
const rowOf=(h,f)=>plain(listingRow(f,h.DQ,[]));
const ids=row=>[row.id,...[...row.legacy_ids].sort()];
const claims=row=>{const m={...row.m};delete m.e;return m;};
function snapshot(h,want){
  const out={};
  for(const id of want){const f=h.api.getCampsiteById(id);assert.ok(f,`listing for ${id} is loaded`);const r=rowOf(h,f);out[id]={ids:ids(r),claims:claims(r)};}
  return out;
}
function expectIndex(h,want){
  for(const id of want){
    const f=h.api.getCampsiteById(id),r=rowOf(h,f),x=byId.get(id);
    assert.equal(r.id,x.id,`${id}: browser canonical id equals the index`);
    assert.deepEqual(ids(r),ids(x),`${id}: browser source-id set equals the index`);
    assert.deepEqual(claims(r),claims(x),`${id}: popup claims and filter inputs equal the index`);
  }
}

// Measured live on 2.31.0 (docs/DETERMINISTIC_IDENTITY.md) plus cases the catalogue check found.
const CASES=[['MN',['usfs:26736']],['ID',['usfs:5901']],['UT',['usfs:9461']],['NC','TN',['osm:way:1107154601']],['CA','NV',['usfs:20680','usfs:6427']]].map(c=>({states:c.slice(0,-1),ids:c[c.length-1]}));

test('the published host map is derived from the committed index and validates',()=>{
  const data=JSON.parse(fs.readFileSync(path.join(dir,'identity-hosts.json'),'utf8'));
  assert.deepEqual(data,identityHosts(indexText),'identity-hosts.json is current with search-index.json');
  assert.equal(data.index_sha256,crypto.createHash('sha256').update(indexText).digest('hex'));
  assert.ok(DQ.validIdentityHosts(data));
  for(const bad of [{...data,version:2},{...data,hosts:[]},{...data,hosts:{'a':['a']}},{...data,hosts:{'a':['b'],'c':['b']}},{...data,hosts:{'a':['b'],'b':['c']}}])assert.equal(DQ.validIdentityHosts(bad),false);
  // Every id the index ever published is in the map exactly once, as canonical or as alias.
  const opts=DQ.identityOptions(data);
  for(const s of index.sites)for(const l of s.legacy_ids)assert.equal(opts.previousHosts.get(l),s.id);
});

test('election equals the index for the measured cases, in both orders, with the published host map',async()=>{
  for(const c of CASES)for(const order of [c.states,[...c.states].reverse()]){
    const h=harness();await h.api.init(h.map);
    for(const code of order)await h.api.loadStates([code]);
    expectIndex(h,c.ids);
  }
});

test('Cosby Campground keeps the OSM element and its own toilet evidence whichever state loads first',async()=>{
  const seen=[];
  for(const order of [['NC','TN'],['TN','NC']]){
    const h=harness();await h.api.init(h.map);for(const code of order)await h.api.loadStates([code]);
    const p=h.api.getCampsiteById('ridb:232479').properties;
    assert.equal(p.id,'osm:way:1107154601');
    seen.push(plain({own:p.osm_amenity_tags,filter:h.DQ.amenityFilterSets(p),toilet:h.DQ.amenityFilterReason(p,'toilet')}));
  }
  assert.deepEqual(seen[0],seen[1]);
});

test('delayed responses and parallel batches give the same listings as sequential loading',async()=>{
  const states=['CA','NV','NC','TN'],want=CASES.filter(c=>c.states.every(s=>states.includes(s))).flatMap(c=>c.ids);
  const a=harness();await a.api.init(a.map);for(const code of states)await a.api.loadStates([code]);
  const b=harness({delay:{CA:120,NC:60}});await b.api.init(b.map);await b.api.loadStates(states);
  const c=harness({delay:{TN:120,NV:80}});await c.api.init(c.map);await c.api.loadStates([...states].reverse());
  const sa=snapshot(a,want);assert.deepEqual(snapshot(b,want),sa);assert.deepEqual(snapshot(c,want),sa);
  assert.equal(b.api.getAllCampsites().length,a.api.getAllCampsites().length);
  expectIndex(b,want);
});

// Host file failure on a first visit (404, timeout, corrupt): no merge the index would not make, no flip
// of a shown id, saved stops and contributions keep their ids, and the file arriving converges to the index.
const owner=new Map();for(const s of index.sites)for(const id of [s.id,...s.legacy_ids])owner.set(id,s.id);
for(const mode of ['missing','timeout','corrupt'])test(`host file ${mode} on a first visit: no wrong merge, no flip, converges after retry`,async()=>{
  const states=['UT','NV','TN','NC','CA'],h=harness({hosts:mode});
  await h.api.init(h.map);assert.equal(h.api.getIdentityStatus().hosts,'fallback');
  const shown=new Set();
  for(const code of states){
    await h.api.loadStates([code]);
    const now=new Set();
    for(const f of h.api.getAllCampsites()){
      const p=f.properties,own=new Set([p.id,...(p.legacy_ids||[])].map(id=>owner.get(id)));
      assert.ok(!own.has(undefined),`${p.id}: every record is published`);
      assert.equal(own.size,1,`${p.id}: no merge of two index listings (${[...own]})`);
      now.add(p.id);
    }
    for(const id of shown)assert.ok(now.has(id),`${id}: a shown listing id is never demoted or moved`);
    for(const id of now)shown.add(id);
  }
  // Bird Creek Campground (NV) stays its own listing, as in the index.
  assert.equal(h.api.getCampsiteById('usfs:65184').properties.id,'usfs:65184');
  h.serveHosts();
  for(let i=0;i<3&&h.api.getIdentityStatus().hosts!=='published';i++)await h.api.retryIdentity();
  assert.equal(h.api.getIdentityStatus().hosts,'published');
  const loaded=new Set(states),complete=index.sites.filter(s=>s.states.every(c=>loaded.has(c)));
  for(const s of complete)for(const id of [s.id,...s.legacy_ids])assert.equal(h.api.getCampsiteById(id)?.properties.id,s.id,`${id} resolves to ${s.id} after reconcile`);
  expectIndex(h,complete.map(s=>s.id).slice(0,300));
});

test('any published id resolves to one listing; publishedId and identityIds follow the index',async()=>{
  const h=harness();await h.api.init(h.map);await h.api.loadStates(['TN']);
  // Only TN loaded: the Cosby OSM element is still present, so both ids find it.
  const a=h.api.getCampsiteById('ridb:232479'),b=h.api.getCampsiteById('osm:way:1107154601');
  assert.ok(a&&a===b);
  assert.equal(h.api.publishedId('ridb:232479'),'osm:way:1107154601');
  assert.equal(h.api.publishedId('osm:way:1107154601'),'osm:way:1107154601');
  assert.deepEqual(plain(h.api.identityIds('ridb:232479')),['osm:way:1107154601','ridb:232479']);
  await h.api.loadStates(['NC']);
  for(const s of index.sites.filter(s=>s.states.every(c=>['NC','TN'].includes(c))&&s.legacy_ids.length))
    for(const id of [s.id,...s.legacy_ids])assert.equal(h.api.getCampsiteById(id)?.properties.id,s.id,`${id} resolves to ${s.id}`);
});

test('sidecar evidence that arrives after states load gives the same listings as the index',async()=>{
  // The index attaches RIDB and Forest Service evidence before deduplication; late arrival must match.
  const states=['NC','TN'],want=index.sites.filter(s=>s.states.every(c=>states.includes(c))).map(s=>s.id);
  const late=harness({sidecarDelay:300});await late.api.init(late.map);for(const c of states)await late.api.loadStates([c]);
  await new Promise(r=>setTimeout(r,500));
  const early=harness();await early.api.init(early.map);await new Promise(r=>setTimeout(r,50));for(const c of states)await early.api.loadStates([c]);
  assert.deepEqual(snapshot(late,want),snapshot(early,want));
  expectIndex(late,want);
});

// Partial loads (2.35.0): with the published hosts, a record joins a listing only when both have the same
// index owner. A record whose host has not loaded yet stays its own marker and never borrows another owner.
const pt=(id,name,lon,lat,extra={})=>({type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},properties:{id,name,type:'established',camping_activity:true,...extra}});
test('owner-only joins: same-name records of different index owners stay apart, same owner joins, the index build is unchanged',()=>{
  const hosts={version:1,index_sites:3,index_sha256:'0'.repeat(64),hosts:{'osm:way:1':['ridb:2']}};
  const base=DQ.identityOptions(hosts),browser={...base,ownerOnly:true};
  // usfs:3 is its own index listing; ridb:2 belongs to osm:way:1, whose record has not loaded.
  const partial=[pt('usfs:3','Bird Creek Campground',-114.6545,39.4636),pt('ridb:2','Bird Creek Campground',-114.6530,39.4633)];
  const shown=DQ.cleanAndDedupeGeoJSON({features:partial},browser).features.map(f=>[f.properties.id,f.properties.legacy_ids.filter(x=>x!==f.properties.id)]);
  assert.deepEqual(shown,[['usfs:3',[]],['ridb:2',[]]]);
  // Without ownerOnly (the index build path) the shared function still makes its proximity merge.
  assert.equal(DQ.cleanAndDedupeGeoJSON({features:partial},base).features.length,1);
  // The host arrives: its own alias joins it, the other owner stays separate, in either input order.
  for(const input of [[...partial,pt('osm:way:1','Bird Creek Campground',-114.6543,39.4633)],[pt('osm:way:1','Bird Creek Campground',-114.6543,39.4633),...partial]]){
    const got=DQ.cleanAndDedupeGeoJSON({features:input},browser).features.map(f=>[f.properties.id,[...new Set(f.properties.legacy_ids)].filter(x=>x!==f.properties.id).sort()]).sort();
    assert.deepEqual(got,[['osm:way:1',['ridb:2']],['usfs:3',[]]]);
  }
  // The same record in two state files still joins by its id.
  assert.equal(DQ.cleanAndDedupeGeoJSON({features:[pt('usfs:3','Aspen Campground',-100,40),pt('usfs:3','Aspen Campground',-100,40)]},browser).features.length,1);
});

test('Bird Creek Campground: NV alone keeps usfs:65184 and the OSM/RIDB listing apart; both orders converge',async()=>{
  const owners=s=>new Set([s.properties.id,...(s.properties.legacy_ids||[])].map(id=>owner.get(id)));
  for(const order of [['NV','CA'],['CA','NV']]){
    const h=harness();await h.api.init(h.map);
    for(const [i,code] of order.entries()){
      await h.api.loadStates([code]);
      if(code==='NV'){
        const usfs=h.api.getCampsiteById('usfs:65184');
        assert.equal(usfs.properties.id,'usfs:65184',`${order}: usfs:65184 resolves to itself after ${code}`);
        assert.deepEqual([...owners(usfs)],['usfs:65184'],`${order}: usfs:65184 holds no other owner's record`);
        const other=h.api.getCampsiteById('osm:way:1236741631');
        assert.ok(other&&other!==usfs,`${order}: the OSM/RIDB listing is a separate listing`);
        assert.deepEqual([...owners(other)],['osm:way:1236741631']);
      }
      // Every loaded listing holds records of one index owner only, at every checkpoint.
      for(const f of h.api.getAllCampsites())assert.equal(owners(f).size,1,`${order} after ${code}: ${f.properties.id} holds one index owner`);
    }
    expectIndex(h,['usfs:65184','osm:way:1236741631']);
    assert.equal(h.api.getCampsiteById('ridb:234209').properties.id,'osm:way:1236741631');
  }
});
