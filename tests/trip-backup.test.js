'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../trip-planner.js'),'utf8');
const feature=(id,type='established')=>({type:'Feature',geometry:{type:'Point',coordinates:[-110.1234567,40.7654321]},properties:{id,type,name:'Private <camp> & creek',fee_status:'unknown',amenities:[],own_evidence:{source:'original',verified:false}}});
const stop=(id='usfs:legacy-1',type)=>({id,feature:feature(id,type),note:'Private note <script>literal text</script>\nSecond line',arrive:'2026-11-05',depart:'2026-11-07'});
const documentFor=stops=>JSON.stringify({format:'kamptrail-trip',version:1,stops});
const fileFor=text=>({size:new Blob([text]).size,text:async()=>text});
function boot(){
 const stored=new Map(),messages=[],calls={confirm:0,persist:0,events:0};let failWrite=false,answer=true;
 const env={Blob,console,sessionStorage:{getItem:()=>null},localStorage:{getItem:key=>stored.get(key)||null,setItem(key,value){if(failWrite)throw new Error('QuotaExceededError');stored.set(key,value);}},navigator:{storage:{persist(){calls.persist++;return Promise.resolve(false);}}},showToast:(message,kind)=>messages.push({message,kind}),confirm(){calls.confirm++;return answer;},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent(){calls.events++;}};
 env.window=env;vm.runInNewContext(source,env);
 return {trip:env.KampTrailTrip,stored,messages,calls,failWrite(value){failWrite=value;},answer(value){answer=value;}};
}
const plain=value=>JSON.parse(JSON.stringify(value));
test('JSON backup restores exact published IDs, snapshots, dates, notes and custom stops after local data loss',async()=>{
 const original=[stop(),stop('spot:custom','spot'),{id:'legacy-unloaded',feature:null,note:'Unresolved original ID',arrive:'',depart:''}];
 // Distinct IDs sharing a coordinate must remain separate.
 const first=boot();assert.equal(await first.trip.importBackup(fileFor(documentFor(original))),true);
 const backup=first.trip.buildBackup();assert.deepEqual(JSON.parse(backup),{format:'kamptrail-trip',version:1,stops:original});
 const recovered=boot();assert.equal(await recovered.trip.importBackup(fileFor(backup)),true);
 assert.deepEqual(plain(recovered.trip.getStops()),original);assert.deepEqual(JSON.parse(recovered.stored.get('kt_trip')),original);
 assert.equal(recovered.calls.confirm,0);assert.equal(recovered.calls.persist,1);
});
test('restore replaces atomically only after confirmation and supports an intentional empty backup',async()=>{
 const w=boot(),old=[stop('old')],next=[stop('new')];await w.trip.importBackup(fileFor(documentFor(old)));
 w.answer(false);assert.equal(await w.trip.importBackup(fileFor(documentFor(next))),false);assert.deepEqual(plain(w.trip.getStops()),old);assert.equal(w.calls.confirm,1);
 w.answer(true);assert.equal(await w.trip.importBackup(fileFor(documentFor(next))),true);assert.deepEqual(plain(w.trip.getStops()),next);
 assert.equal(await w.trip.importBackup(fileFor(documentFor([]))),true);assert.deepEqual(plain(w.trip.getStops()),[]);assert.equal(w.stored.get('kt_trip'),'[]');
});
test('invalid or unexpected data never changes saved stops or persisted data',async()=>{
 const w=boot(),old=[stop('old')];await w.trip.importBackup(fileFor(documentFor(old)));const before=w.stored.get('kt_trip');
 const mutate=fn=>{const data=JSON.parse(documentFor([stop('new')]));fn(data);return JSON.stringify(data);};
 const invalid=['{', 'null', '[]',mutate(d=>d.version=2),mutate(d=>d.format='other'),mutate(d=>d.extra='unsafe'),mutate(d=>d.stops[0].unexpected=1),mutate(d=>delete d.stops[0].note),mutate(d=>d.stops[0].id=123),mutate(d=>d.stops[0].arrive='2026-02-30'),mutate(d=>d.stops[0].note='x'.repeat(1001)),mutate(d=>d.stops[0].feature.extra=1),mutate(d=>d.stops[0].feature.geometry.extra=1),mutate(d=>d.stops[0].feature.geometry.coordinates=[200,40]),mutate(d=>d.stops[0].feature.properties.id={bad:1}),mutate(d=>d.stops.push(d.stops[0])),documentFor([{...stop(),feature:[]}]),documentFor([stop()]).replace('"own_evidence":','"__proto__":'),documentFor([stop()]).replace('"own_evidence":','"constructor":'),documentFor([stop()]).replace('"own_evidence":','"prototype":')];
 for(const text of invalid){assert.equal(await w.trip.importBackup(fileFor(text)),false,text);assert.deepEqual(plain(w.trip.getStops()),old);assert.equal(w.stored.get('kt_trip'),before);}
 assert.equal(w.calls.confirm,0);assert.equal(w.calls.events,1);assert.equal(w.messages.filter(x=>x.message==='Trip backup restored on this device.').length,1);
});
test('limits reject oversized input before reading and enforce actual UTF-8 size and 200-stop boundary',async()=>{
 const w=boot();let read=false;
 assert.equal(await w.trip.importBackup({size:1024*1024+1,text(){read=true;return Promise.resolve('');}}),false);assert.equal(read,false);
 const oversized=JSON.stringify({format:'kamptrail-trip',version:1,stops:[{...stop(),feature:{...feature('large'),properties:{...feature('large').properties,large:'é'.repeat(530000)}}}]});
 assert.ok(oversized.length<1024*1024);assert.throws(()=>w.trip.parseBackup(oversized),/1 MB/);
 // A false File.size cannot bypass the post-read bound.
 assert.equal(await w.trip.importBackup({size:1,text:async()=>oversized}),false);
 const rows=Array.from({length:200},(_,i)=>stop('stop:'+i));assert.equal(w.trip.parseBackup(documentFor(rows)).length,200);
 assert.equal(await w.trip.importBackup(fileFor(documentFor([...rows,stop('201')]))),false);assert.equal(w.stored.has('kt_trip'),false);
});
test('failed persistence leaves old memory and storage unchanged, with no restored-success message or revision event',async()=>{
 const w=boot(),old=[stop('old')];await w.trip.importBackup(fileFor(documentFor(old)));const before=w.stored.get('kt_trip'),events=w.calls.events;
 w.failWrite(true);assert.equal(await w.trip.importBackup(fileFor(documentFor([stop('new')]))),false);
 assert.deepEqual(plain(w.trip.getStops()),old);assert.equal(w.stored.get('kt_trip'),before);assert.equal(w.calls.events,events);
 assert.match(w.messages.at(-1).message,/previous saved stops are unchanged/);assert.equal(w.messages.filter(x=>x.message==='Trip backup restored on this device.').length,1);
});
test('file read failures and deeply nested metadata fail closed before replacement confirmation',async()=>{
 const w=boot();await w.trip.importBackup(fileFor(documentFor([stop('old')])));const before=w.stored.get('kt_trip');
 assert.equal(await w.trip.importBackup({size:100,text:async()=>{throw Error('File could not be read');}}),false);
 const nested=stop('nested');let item=nested.feature.properties;for(let i=0;i<25;i++){item.child={};item=item.child;}
 assert.equal(await w.trip.importBackup(fileFor(documentFor([nested]))),false);assert.equal(w.stored.get('kt_trip'),before);assert.equal(w.calls.confirm,0);
});
