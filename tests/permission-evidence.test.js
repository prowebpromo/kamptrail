'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const B=require('../scripts/build-permissions.js'),S=require('../scripts/build-services.js');
const root=path.resolve(__dirname,'..'),helper=path.join(root,'api/_lib/permission-evidence.php');
const official=JSON.parse(fs.readFileSync(path.join(root,'data/permissions/official.json'),'utf8'));
const places=new Map(official.records.map(r=>[B.placeKey(r.place),r.place]));
const capable=spawnSync('php',['-v']).status===0;
if(process.env.KT_REQUIRE_PHP==='1'&&!capable)throw new Error('Permission evidence tests require PHP');
function php(body){const r=spawnSync('php',[],{input:`<?php require ${JSON.stringify(helper)}; function check($c,$m='assertion failed'){if(!$c)throw new Exception($m);} $records=json_decode(${JSON.stringify(JSON.stringify(official.records))},true); $place=$records[0]['place']; $now=strtotime('2026-10-30T12:00:00Z'); ${body}`,encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.stdout);return r.stdout;}
test('reviewed official records are exact, dated and excerpt checksummed',()=>{
 assert.equal(B.validateEvidence(official,places,Date.parse('2026-10-30T12:00:00Z')),official);
 const quotes=new Map();for(const r of official.records)quotes.set(r.source_url,(quotes.get(r.source_url)||0)+r.quote.split(/\s+/).length);for(const words of quotes.values())assert.ok(words<=25);
 assert.equal(places.size,2);assert.equal(official.records[1].effective_from,'2026-10-26');assert.deepEqual(official.records[1].supersedes,[official.records[0].id]);
 for(const mutate of [r=>r.review_after=r.reviewed_at,r=>r.effective_from='2026-02-31',r=>r.place.coordinates[0]+=0.001,r=>r.sha256='0'.repeat(64),r=>r.source_url='http://127.0.0.1/private',r=>r.supersedes=['missing']]){const w=structuredClone(official);mutate(w.records[0]);assert.throws(()=>B.validateEvidence(w,places,Date.parse('2026-10-30T12:00:00Z')));}
});
test('spot keys preserve lat/lng order, signed rounding and normalized zero',()=>{
 assert.equal(B.spotId([-0.000001,-0]),'spot:0.00000,0.00000');assert.equal(B.spotId([-109.6180927,37.2606718]),'spot:37.26067,-109.61809');
 assert.equal(B.spotId([-1.234565,-0.000005]),'spot:-0.00001,-1.23456');
 assert.notEqual(B.placeKey({kind:'service',id:'osm:node:1'}),B.placeKey({kind:'campsite',id:'osm:node:1'}));
});
test('builder consumes actual validated service shard identity and separates matching campsite OSM identity',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kt-permission-'));
 try{
 const source=JSON.parse(fs.readFileSync(path.join(root,'data/sources/services/legacy.json'),'utf8'));source.items=source.items.slice(0,1);const row=source.items[0];
 fs.mkdirSync(path.join(dir,'data/campsites'),{recursive:true});fs.mkdirSync(path.join(dir,'data/permissions'),{recursive:true});
 fs.writeFileSync(path.join(dir,'data/campsites/search-index.json'),JSON.stringify({version:1,sites:[{id:row.id,name:'Camp',lng:row.coordinates[0],lat:row.coordinates[1]}]}));
 fs.writeFileSync(path.join(dir,'data/permissions/official.json'),JSON.stringify({version:1,records:[]}));
 const db=S.buildDatabase([source]);S.writeDatabase(db,path.join(dir,'data/services'));
 assert.equal(B.build(dir).places,2);const out=path.join(dir,'api/_data/permissions');assert.equal(fs.readdirSync(out).filter(x=>/^[a-f0-9]{2}\.json$/.test(x)).length,256);
 for(const kind of ['campsite','service']){const key=`${kind}:${row.id}`,bucket=JSON.parse(fs.readFileSync(path.join(out,B.hash(key).slice(0,2)+'.json'),'utf8'));assert.equal(bucket.places[key].kind,kind);}
 assert.equal(fs.readFileSync(path.join(out,'.htaccess'),'utf8'),'Require all denied\n');
 // Preempt one writer after its temporary bytes exist, then run a second
 // complete writer against the same catalogue before the first can rename.
 const write=fs.writeFileSync;let interleaved=false;
 fs.writeFileSync=function(file,...args){const result=write.call(fs,file,...args);if(!interleaved&&String(file).startsWith(out+path.sep)&&String(file).endsWith('.tmp')){interleaved=true;assert.equal(B.build(dir).places,2);}return result;};
 try{assert.equal(B.build(dir).places,2);}finally{fs.writeFileSync=write;}
 assert.equal(interleaved,true);assert.equal(fs.readdirSync(out).filter(x=>x.endsWith('.tmp')).length,0);
 for(const name of fs.readdirSync(out).filter(x=>x.endsWith('.json')))assert.equal(JSON.parse(fs.readFileSync(path.join(out,name),'utf8')).version,1);
 fs.appendFileSync(path.join(dir,'data/services',db.manifest.shards[0].url),' ');assert.throws(()=>B.build(dir),/integrity/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('PHP exact resolver rejects kind substitution, id/coordinate mismatch and unknown catalogue IDs',{skip:!capable},()=>{
 B.build(root);php(`check(kp_resolve_place($place)['id']===$place['id']); $wrong=$place; $wrong['coordinates'][0]+=0.000001; check(kp_resolve_place($wrong)===null); $wrong=$place; $wrong['kind']='service'; check(kp_resolve_place($wrong)===null); $wrong=$place; $wrong['id']='made-up'; check(kp_resolve_place($wrong)===null); $wrong=$place; $wrong['coordinates'][1]=91; check(kp_resolve_place($wrong)===null); $wrong=$place; $wrong['coordinates'][0]='-109.6180927'; check(kp_resolve_place($wrong)===null);`);
});
test('PHP spot precision exactly agrees with JS including negative zero and half units',{skip:!capable},()=>{
 const coords=[[0,-0],[-0.000001,0],[-1.234565,-0.000005],[-109.6180927,37.2606718],[180,-90],[-180,90]];
 const result=JSON.parse(php(`$pairs=json_decode('${JSON.stringify(coords)}',true); echo json_encode(array_map('kp_spot_id',$pairs));`));assert.deepEqual(result,coords.map(B.spotId));
 php(`$s=['kind'=>'spot','id'=>'spot:0.00000,0.00000','name'=>'Zero','coordinates'=>[-0.000001,0]]; check(kp_resolve_place($s)['coordinates']===[0.0,0.0]); $s['id']='spot:1.00000,0.00000';check(kp_resolve_place($s)===null);`);
});
test('PHP dated reducer keeps closure tombstones permanently and no reports/ownership/nearby permissions',{skip:!capable},()=>{
 php(`
 check(kp_reduce_evidence($records,$place,$now)['status']==='prohibited');
 $stale=kp_reduce_evidence($records,$place,strtotime('2026-11-02T12:00:00Z'));check($stale['status']==='historical');check($stale['evidence'][0]['freshness']==='superseded');check($stale['evidence'][1]['freshness']==='stale');
 check(kp_reduce_evidence($records,$records[2]['place'],$now)['status']==='conditional');
 check(kp_reduce_evidence($records,$records[2]['place'],strtotime('2026-12-01'))['status']==='historical');
 check(kp_reduce_evidence($records,$place,$now,'unoccupied_vehicle_parking')['status']==='unknown');
 $near=$place;$near['coordinates'][0]+=0.00001;check(kp_reduce_evidence($records,$near,$now)['status']==='unknown');
 $service=$place;$service['kind']='service';check(kp_reduce_evidence($records,$service,$now)['status']==='unknown');
 check(kp_reduce_evidence([],$place,$now)['status']==='unknown');
 $bad=$records;$bad[1]['sha256']=str_repeat('0',64);check(kp_reduce_evidence($bad,$place,$now)['status']==='unknown');
 `);
});
test('PHP reducer handles conflict, expiry, future evidence and review boundary',{skip:!capable},()=>{
 php(`
 $allow=$records[0];$allow['statement']='allowed';$deny=$records[1];$deny['supersedes']=[];check(kp_reduce_evidence([$allow,$deny],$place,$now)['status']==='conflict');
 check(kp_reduce_evidence([$allow],$place,$now)['status']==='allowed');
 $allow['effective_until']='2026-10-29';check(kp_reduce_evidence([$allow],$place,$now)['status']==='historical');
 $allow['effective_until']=null;$allow['effective_from']='2026-11-01';check(kp_reduce_evidence([$allow],$place,$now)['status']==='unknown');
 $allow['effective_from']=null;$allow['review_after']='2026-10-30T12:00:00Z';check(kp_reduce_evidence([$allow],$place,$now)['status']==='historical');
 $deny['effective_until']='2026-10-29';$deny['supersedes']=[$allow['id']];check(kp_reduce_evidence([$allow,$deny],$place,$now)['status']==='historical');
 `);
});
