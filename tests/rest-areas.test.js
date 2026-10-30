const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const rest=require('../rest-areas.js'),published=JSON.parse(fs.readFileSync('data/rest-areas/TX.json','utf8'));
const clone=()=>structuredClone(published);
test('official catalogue keeps exact source identities, UTC provenance and unknown permission',()=>{
  const d=rest.validate(clone());assert.equal(d.records.length,78);assert.equal(new Set(d.records.map(r=>r.id)).size,78);assert(d.records.every(r=>r.permission==='unknown'));assert.equal(d.duration_context.maximum_hours,24);assert.equal(d.source.source_updated_at,null);
});
test('parking duration cannot become a permission statement or a fee',()=>{
  const d=clone(),r=d.records[0],f=rest.feature(r,d);assert.match(rest.describe(r,d),/does not establish permission to sleep overnight/);assert.match(rest.describe(r,d),/Overnight permission.*unknown/);assert.equal(f.properties.type,'spot');assert.equal(f.properties.cost,undefined);assert.equal(f.properties.permission,undefined);assert.equal(f.properties.id,rest.place(r).id);assert.deepEqual(f.geometry.coordinates,rest.place(r).coordinates);
  r.permission='allowed';assert.throws(()=>rest.validate(d),/permission claim/);
});
test('duplicate identity, nonfinite coordinates, malformed dates and hostile source links are rejected',()=>{
  const mutations=[d=>d.records.push(d.records[0]),d=>{d.records[0].coordinates[0]=NaN;},d=>{d.records[0].coordinates=[0,0];},d=>{d.source.retrieved_at='2026-02-30T00:00:00Z';},d=>{d.source.url='https://example.org/';},d=>{d.records[0].source_url='javascript:alert(1)';},d=>{d.duration_context.maximum_hours=48;}];
  for(const mutate of mutations){const d=clone();mutate(d);assert.throws(()=>rest.validate(d));}
});
test('source identity remains distinct from a canonical rounded map spot',()=>{
  const r=published.records[0],p=rest.place(r);assert(p.id.startsWith('spot:'));assert.notEqual(p.id,r.id);assert.equal(rest.place({...r,coordinates:[-97.5623001,30.9001001]}).id,'spot:30.90010,-97.56230');assert(!rest.detail(r.source_url+'?redirect=evil'));
});
test('viewport selection handles the dateline and excludes points outside the requested view',()=>{
  assert(rest.within([-97,31],{west:-100,east:-95,south:30,north:32}));assert(!rest.within([-97,31],{west:-100,east:-95,south:33,north:34}));assert(rest.within([179,50],{west:170,east:-170,south:40,north:60}));assert(!rest.within([0,50],{west:170,east:-170,south:40,north:60}));
});
