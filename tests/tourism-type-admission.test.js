'use strict';
// Tourism-type-admission candidate: listing type must come from the listing's own record.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const DQ=require('../data-quality.js');
const {CampsiteMerger}=require('../scripts/merge_campsite_data.js');
const pt=(props,c=[-110,40])=>({type:'Feature',geometry:{type:'Point',coordinates:c},properties:props});
const ridb={id:'ridb:1',facility_id:'1',name:'Pine Flat Campground',source:'recreation.gov',schema_version:3};

test('A: a Recreation.gov row that inherited tourism keeps its own type (other), not Campground',()=>{
  const f=DQ.normalizeFeature(pt({...ridb,tourism:'camp_site',type:null}));
  assert.equal(f.properties.type,'other');
  assert.equal(f.properties.camping_classification,'campsite','publication is unchanged in this candidate');
});
test('A: an own OSM element without a type still defaults to Campground',()=>{
  const f=DQ.normalizeFeature(pt({id:'osm:way:9',osm_id:9,osm_type:'way',tourism:'camp_site',name:'Lake Camp',source:'openstreetmap',schema_version:3}));
  assert.equal(f.properties.type,'established');
});
test('A: a Recreation.gov row with its own listed type keeps it',()=>{
  assert.equal(DQ.normalizeFeature(pt({...ridb,tourism:'camp_site',type:'established'})).properties.type,'established');
});
test('B: snapshot merge never lends a different record\'s type',()=>{
  const m=new CampsiteMerger();
  const out=m.mergeProperties({...ridb,type:'other'},{...ridb,id:'ridb:2',facility_id:'2',type:'established'});
  assert.equal(out.type,null);
});
test('B: the same record seen twice still fills a missing type',()=>{
  const m=new CampsiteMerger();
  assert.equal(m.mergeProperties({...ridb,type:null},{...ridb,type:'established'}).type,'established');
  assert.equal(m.mergeProperties({...ridb,type:'dispersed'},{...ridb,id:'ridb:2',facility_id:'2',type:'established'}).type,'dispersed');
});
test('B: an OSM member\'s rig keys are untouched by the type rule',()=>{
  const m=new CampsiteMerger();
  const out=m.mergeProperties({...ridb,type:null},{id:'osm:node:5',osm_id:5,osm_type:'node',tourism:'camp_site',tents:'yes',name:'Pine Flat Campground'});
  assert.equal(out.type,null);assert.equal(out.tents,'yes');
});
test('C: the L230 promotion is unchanged in this candidate (open question)',()=>{
  const host=DQ.normalizeFeature(pt({...ridb,name:'Coleman Lake Recreation Area',type:'other'}));
  const agency=DQ.normalizeFeature(pt({id:'usfs:3',name:'Coleman Lake Recreation Area',type:'established',camping_activity:'Campground camping',source:'USDA Forest Service',schema_version:3}));
  assert.equal(host.properties.camping_classification,'unverified_camping_record');
  const out=DQ.cleanAndDedupeGeoJSON({features:[host,agency]}).features;
  assert.equal(out.length,1);assert.equal(out[0].properties.id,'ridb:1');assert.equal(out[0].properties.type,'established');
});
test('package: every proposed change is a type relabel of a published listing with no status change',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/candidates/tourism-type-admission.json'),'utf8'));
  const idx=new Map(JSON.parse(fs.readFileSync(path.join(__dirname,'../data/campsites/search-index.json'),'utf8')).sites.map(s=>[s.id,s]));
  assert.equal(pkg.proposal.length,45);
  for(const r of pkg.proposal){assert.equal(idx.get(r.id)?.m.t,r.to,r.id);assert.equal(r.field,'type');}
  for(const r of pkg.records){assert.equal(r.proposed.status,'published',r.canonical_id);assert.ok(r.identity.saved_link_resolves_index,r.canonical_id);}
  assert.equal(pkg.venn['A∩B'],0);assert.equal(pkg.venn['B∩C'],0);
});
