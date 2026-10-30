'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function api(document){const c={document,window:{},Map,URLSearchParams,AbortController,setTimeout,clearTimeout};vm.createContext(c);vm.runInContext(fs.readFileSync('spot-info.js','utf8'),c);return c.window.KampTrailSpot;}
test('spot help opens the existing About dialog and focuses its native details summary',()=>{
  let opened=0,focused=0,scrolled=0;
  const summary={focus(){focused++;},scrollIntoView(options){assert.equal(options.block,'nearest');scrolled++;}};
  const dialog={open:false,showModal(){opened++;this.open=true;}};
  const details={open:false,querySelector:selector=>selector==='summary'?summary:null};
  const m=api({getElementById:id=>id==='data-dialog'?dialog:id==='kt-camping-care'?details:null});
  assert.equal(m.openCampingCare(),true);assert.equal(dialog.open,true);assert.equal(details.open,true);assert.equal(opened,1);assert.equal(focused,1);assert.equal(scrolled,1);
  assert.equal(m.openCampingCare(),true);assert.equal(opened,1,'An already-open dialog must not be opened again');assert.equal(focused,2);
});
test('a missing help target or unsupported dialog fails without changing the map',()=>{
  assert.equal(api({getElementById:()=>null}).openCampingCare(),false);
  assert.equal(api({getElementById:id=>id==='data-dialog'?{open:false}:id==='kt-camping-care'?{querySelector:()=>({focus(){throw Error('must not focus');}})}:null}).openCampingCare(),false);
});
test('help attributes the checked primary sources without universal stay rules or inspection claims',()=>{
  const html=fs.readFileSync('index.html','utf8'),care=html.match(/<details id="kt-camping-care"[\s\S]*?<\/details>/)?.[0];assert.ok(care);
  const proof=JSON.parse(fs.readFileSync('docs/camping-care-sources.json','utf8'));
  assert.equal(proof.checked_on,'2026-10-30');
  const urls=[...care.matchAll(/href="([^"]+)"/g)].map(m=>m[1]);assert.equal(urls.length,3);
  assert.deepEqual(urls.sort(),proof.sources.map(s=>s.url).sort());
  for(const source of proof.sources){assert.equal(source.status,200);assert.equal(source.final_url,source.url);assert.match(source.sha256,/^[a-f0-9]{64}$/);assert.ok(source.bytes>1000);assert.equal(source.retrieved_at.slice(0,10),proof.checked_on);}
  assert.ok(care.includes('<time datetime="'+proof.checked_on+'"'));
  assert.match(care,/Map ownership does not grant permission/);assert.match(care,/General guidance, not a current site inspection/);
  assert.doesNotMatch(care,/14.day|28.day|25.mile|30.mile|200.feet|6.8.inch/i);
});
