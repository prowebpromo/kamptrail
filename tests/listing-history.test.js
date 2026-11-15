'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const H=require('../listing-history');
const {buildHistory,buildFromCheckout,successfulScopes}=require('../scripts/build-listing-history');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {check}=require('../scripts/check-id-continuity');
const {buildSearchIndex,buildFromDirectory}=require('../scripts/build-search-index');
const at='2026-11-15T00:00:00Z';
const pt=(id,name='Pine Campground',extra={})=>({type:'Feature',geometry:{type:'Point',coordinates:[-110,40]},properties:{id,name,tourism:'camp_site',source_retrieved_at:'2026-10-29T01:02:03Z',...extra}});
const site=(id,aliases=[])=>({id,legacy_ids:aliases,name:'Pine Campground',lat:40,lng:-110,states:['UT']});
const row=(id,aliases=[])=>({...site(id,aliases),source_dates:[{source_record_id:id,retrieved_at:null,updated_at:null}],source_urls:[],reason:'source_absent_latest_feed',archived_at:at});
const index=sites=>({version:1,sites});

test('all six moved agency aliases remain reserved to their original hosts without current search pollution',()=>{
  const pairs=[['osm:node:2344691835','usfs:73062','osm:way:1547355984'],['osm:node:2332493731','usfs:34174','osm:way:1289006722'],
    ['osm:node:2304430543','usfs:6426','usfs:6426'],['osm:node:1922410822','usfs:9902','usfs:9902'],
    ['osm:node:2110160216','usfs:34198','osm:way:76352794'],['ridb:234526','usfs:12331','usfs:12331']];
  const previous=index(pairs.map(([id,alias])=>site(id,[alias])));
  const candidate=index(pairs.map(([,alias,id])=>site(id,id===alias?[]:[alias])));
  const old=pairs.flatMap(([id,alias])=>[{state:'UT',feature:pt(id)},
    {state:'UT',feature:pt(alias,'Old agency',{source_retrieved_at:undefined,retrieved_at:'2026-10-30',source_url:'https://www.fs.usda.gov/recarea/example'})}]);
  const current=pairs.flatMap(([,alias,id],n)=>[
    {state:'UT',feature:pt(alias,`Agency ${n} Campground`)},
    ...(id===alias?[]:[{state:'UT',feature:{...pt(id,`Own ${n} Campground`),geometry:{type:'Point',coordinates:[-110+n,40]},properties:{...pt(id,`Own ${n} Campground`).properties,source_ids:[id,alias]}}}])]);
  const history=buildHistory({previousIndex:previous,currentIndex:candidate,previousRecords:old,currentRecords:current,scopes:new Set(['osm:UT','ridb:UT']),archivedAt:at});
  assert.equal(history.listings.length,6);assert.equal(H.reservedIds(history).size,12);
  for(const [id,alias] of pairs){assert.equal(H.historyMap(history).get(alias).id,id);assert.equal(H.historyMap(history).get(id).id,id);
    assert.equal(H.historyMap(history).get(alias).source_dates.find(row=>row.source_record_id===alias).retrieved_at,'2026-10-30');}
  const active=buildSearchIndex([{state:'UT',geojson:{type:'FeatureCollection',features:current.map(x=>x.feature)}}],undefined,null,[],null,null,{},history);
  assert.equal(active.sites.length,3);
  for(const listing of active.sites)assert.ok([listing.id,...listing.legacy_ids].every(id=>!H.reservedIds(history).has(id)));
  const result=check(previous,active,history);assert.deepEqual([result.lost,result.moved,result.conflicts],[[],[],[]]);
  assert.equal(active.history_sha256,crypto.createHash('sha256').update(H.serializeHistory(history)).digest('hex'));
});

test('original dates and points are preserved; historical feature carries no current advice',()=>{
  const old=pt('osm:way:1','Old Campground',{source_updated_at:null,fee:'no',caravans:'yes'});
  const args={previousIndex:index([site('osm:way:1')]),currentIndex:index([]),previousRecords:[{state:'UT',feature:old}],scopes:new Set(['osm:UT']),archivedAt:at};
  const history=buildHistory(args),record=history.listings[0],feature=H.historicalFeature(record);
  assert.deepEqual(record.source_dates,[{source_record_id:'osm:way:1',retrieved_at:'2026-10-29T01:02:03Z',updated_at:null}]);
  assert.deepEqual(feature.geometry.coordinates,[-110,40]);assert.equal(feature.properties.historical_listing,true);
  for(const key of ['fee','cost','fee_status','rig_friendly','caravans','access','type'])assert.equal(feature.properties[key],undefined);
  const precise=buildHistory({...args,previousIndex:index([site('usfs:1')]),previousRecords:[{state:'UT',feature:pt('usfs:1','Old',{source_retrieved_at:undefined,retrieved_at:'2026-10-30'})}],scopes:new Set(['usfs:US'])});
  assert.equal(precise.listings[0].source_dates[0].retrieved_at,'2026-10-30');
  assert.equal(H.serializeHistory(history),H.serializeHistory(buildHistory(args)));
});

test('failed, skipped and old successful source scopes cannot authorize history',()=>{
  const args={previousIndex:index([site('osm:way:1')]),currentIndex:index([]),previousRecords:[{state:'UT',feature:pt('osm:way:1')}],archivedAt:at};
  for(const outcome of ['failed','skipped','fresh']){
    const health={run:{started:at},sources:{osm:{scopes:{UT:{outcome,last_attempt:'2026-11-14T00:00:00Z',last_success:'2026-11-14T00:00:00Z'}}}}};
    assert.throws(()=>buildHistory({...args,scopes:successfulScopes(health)}),/not successful/);
  }
  const health={run:{started:at},sources:{osm:{scopes:{UT:{outcome:'fresh',last_attempt:at,last_success:at}}}}};
  assert.equal(buildHistory({...args,scopes:successfulScopes(health)}).listings.length,1);
});

test('BLM management-area identities require the successful national BLM source scope',()=>{
  const args={previousIndex:index([site('blm-area:42')]),currentIndex:index([]),previousRecords:[{state:'UT',feature:pt('blm-area:42')}],archivedAt:at};
  assert.throws(()=>buildHistory({...args,scopes:new Set(['blm:UT'])}),/not successful/);
  assert.equal(buildHistory({...args,scopes:new Set(['blm:US'])}).listings[0].id,'blm-area:42');
});

test('reappearing source remains historical until a verified decision and prior entries never change',()=>{
  const prior={version:1,listings:[row('osm:way:1',['usfs:2'])]},copy=structuredClone(prior);
  const history=buildHistory({previousIndex:index([]),currentIndex:index([site('osm:way:1')]),priorHistory:prior,currentRecords:[{state:'UT',feature:pt('osm:way:1')}],archivedAt:at});
  assert.deepEqual(history,copy);assert.deepEqual(prior,copy);
  assert.equal(H.filterActiveFeature(pt('osm:way:1'),history),null);
  assert.equal(H.filterActiveFeature(pt('usfs:2'),history),null);
  const result=check(index([]),index([site('osm:way:1')]),history,prior);assert.equal(result.conflicts.length,1);
  assert.ok(check(index([]),index([]),{version:1,listings:[]},prior).lost.length);
  const changed=structuredClone(prior);changed.listings[0].archived_at='2026-11-16T00:00:00Z';
  assert.ok(check(index([]),index([]),changed,prior).conflicts.length);
});

test('present but unpublishable own records use catalogue reason; publishable merge losses fail closed',()=>{
  const args={previousIndex:index([site('osm:way:1')]),currentIndex:index([]),previousRecords:[{state:'UT',feature:pt('osm:way:1')}],scopes:new Set(['osm:UT']),archivedAt:at};
  const currentRecords=[{state:'UT',feature:pt('osm:way:1','Unnamed site (OSM)')}];
  assert.equal(buildHistory({...args,currentRecords}).listings[0].reason,'no_longer_in_current_catalogue');
  assert.throws(()=>buildHistory({...args,currentRecords:[{state:'UT',feature:pt('osm:way:1')}]}),/fix identity merge/);
});

test('malformed records, unsafe URLs and duplicate historical claims are rejected',()=>{
  const good={version:1,listings:[row('osm:way:1',['usfs:2'])]};
  for(const mutate of [x=>x.listings.push(row('usfs:2')),x=>x.listings[0].lat=91,x=>x.listings[0].source_dates[0].retrieved_at='yesterday',x=>x.listings[0].source_dates[0].retrieved_at='2026-02-30',x=>x.listings[0].source_urls.push({source_record_id:'osm:way:1',url:'javascript:alert(1)'})]){
    const bad=structuredClone(good);mutate(bad);assert.throws(()=>H.validateHistory(bad));assert.throws(()=>check(index([]),index([]),bad));
  }
  const active=pt('osm:way:3','Current',{source_ids:['osm:way:3','usfs:2'],legacy_ids:['usfs:2']});
  const filtered=H.filterActiveFeature(active,good);assert.deepEqual(filtered.properties.source_ids,['osm:way:3']);assert.deepEqual(filtered.properties.legacy_ids,[]);assert.deepEqual(active.properties.legacy_ids,['usfs:2']);
  assert.equal(H.filterActiveFeature(pt('old-import-id','Old',{facility_id:4}),{version:1,listings:[row('ridb:4')]}),null);
});

test('checkout builder reads frozen own evidence and retains committed history across later runs',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'listing-history-'));
  const write=(file,data)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),JSON.stringify(data)+'\n');};
  const git=(...args)=>execFileSync('git',['-c','core.autocrlf=false',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const output=path.join(root,'data/campsites/withdrawn.json');
  try{
    write('data/campsites/search-index.json',index([site('osm:way:1',['usfs:2'])]));
    write('data/opencampingmap/UT.geojson',{type:'FeatureCollection',features:[pt('osm:way:1')]});
    write('data/campsites/agency/UT.geojson',{type:'FeatureCollection',features:[pt('usfs:2','Old',{source_retrieved_at:undefined,retrieved_at:'2026-10-30'})]});
    git('init','-q');git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','Original source fixture');
    const baseline=git('rev-parse','HEAD');
    write('data/campsites/search-index.json',index([site('usfs:2')]));
    write('data/opencampingmap/UT.geojson',{type:'FeatureCollection',features:[]});
    const health={run:{started:at},sources:{osm:{scopes:{UT:{outcome:'failed',last_attempt:at,last_success:'2026-10-29T00:00:00Z'}}}}};
    write('data/health.json',health);
    assert.throws(()=>buildFromCheckout({root,baseRef:baseline,output,archivedAt:at}),/not successful/);
    assert.equal(fs.existsSync(output),false,'failed scopes must not create a registry');
    health.sources.osm.scopes.UT={outcome:'fresh',last_attempt:at,last_success:at};write('data/health.json',health);
    const history=buildFromCheckout({root,baseRef:baseline,output,archivedAt:at});
    assert.equal(history.listings.length,1);
    assert.equal(history.listings[0].source_dates.find(row=>row.source_record_id==='usfs:2').retrieved_at,'2026-10-30');
    git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','Historical identity fixture');
    const saved=fs.readFileSync(output,'utf8');fs.unlinkSync(output);
    assert.throws(()=>buildFromCheckout({root,baseRef:'HEAD',output,archivedAt:at}),/Committed historical listing missing/);
    fs.writeFileSync(output,saved);
    assert.deepEqual(buildFromCheckout({root,baseRef:'HEAD',output,archivedAt:'2026-11-16T00:00:00Z'}),history);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('directory index binds exact state and agency bytes to the historical registry',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'listing-source-hashes-'));
  const states='AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
  const history={version:1,listings:[row('osm:way:1',['usfs:2'])]};
  try{
    for(const code of states)fs.writeFileSync(path.join(directory,code+'_merged.geojson'),JSON.stringify({type:'FeatureCollection',features:code==='UT'?[pt('osm:way:3','Current Campground'),pt('osm:way:1')]:[]})+'\n');
    fs.mkdirSync(path.join(directory,'agency'));
    fs.writeFileSync(path.join(directory,'agency/UT.geojson'),JSON.stringify({type:'FeatureCollection',features:[pt('usfs:2')]})+'\n');
    fs.writeFileSync(path.join(directory,'withdrawn.json'),H.serializeHistory(history));
    const built=buildFromDirectory(directory);
    assert.deepEqual(built.sites.map(s=>s.id),['osm:way:3']);
    assert.equal(Object.keys(built.source_sha256).length,51);
    for(const name of ['UT_merged.geojson','agency/UT.geojson'])assert.equal(built.source_sha256['data/campsites/'+name],crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,name))).digest('hex'));
    const before=built.source_sha256['data/campsites/UT_merged.geojson'];
    fs.appendFileSync(path.join(directory,'UT_merged.geojson'),'\n');
    assert.notEqual(buildFromDirectory(directory).source_sha256['data/campsites/UT_merged.geojson'],before);
    assert.equal(built.history_sha256,crypto.createHash('sha256').update(H.serializeHistory(history)).digest('hex'));
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
