'use strict';
// Rig-tag ownership (2.34.0): merge guards, own-source reading, negatives, conflicts, members never used,
// the published per-listing fixture, and the provenance-debt guard on operator and website.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Q=require('../data-quality.js');
const {CampsiteMerger}=require('../scripts/merge_campsite_data');
const {buildSearchIndex}=require('../scripts/build-search-index');

const osm=(id,tags={},coords=[-105,40],name='Pine Campground')=>({type:'Feature',geometry:{type:'Point',coordinates:coords},properties:{id:`osm:way:${id}`,osm_id:id,osm_type:'way',tourism:'camp_site',name,schema_version:3,source:'openstreetmap',source_retrieved_at:'2026-10-29T02:53:12Z',...tags}});
const ridb=(fid,extra={},coords=[-105,40],name='Pine Campground')=>({type:'Feature',geometry:{type:'Point',coordinates:coords},properties:{id:`ridb:${fid}`,facility_id:String(fid),name,schema_version:3,source:'recreation.gov',description:'A campground with camping.',fee_status:'unknown',amenities:[],rig_friendly:[],...extra}});
const usfs=(id,extra={},coords=[-105,40],name='Pine Campground')=>({type:'Feature',geometry:{type:'Point',coordinates:coords},properties:{id:`usfs:${id}`,name,source:'US Forest Service',sources:['US Forest Service'],camping_activity:'RV Camping',type:'established',schema_version:3,fee_status:'unknown',amenities:[],rig_friendly:['rv'],...extra}});
const merge=(a,b)=>new CampsiteMerger().mergeProperties(a.properties,b.properties);

test('snapshot merge keeps every rig-suitability key on the element that carries it',()=>{
  const tags={tents:'yes',caravans:'yes',motorhome:'yes',capacity:'40','capacity:caravans':'13',backcountry:'no',group_only:'no',static_caravans:'no',horse:'yes',maxlength:'12',maxtents:'2'};
  const host=merge(ridb(7),osm(3,tags));
  for(const k of Object.keys(tags))assert.equal(host[k],undefined,k);
  assert.deepEqual(host.member_evidence[0].fields,tags);assert.equal(host.member_evidence[0].source_record_id,'osm:way:3');
  // An OSM host keeps its own values, including explicit negatives. The absorbed element's values go to member evidence.
  const own=merge(osm(1,{tents:'yes',caravans:'no'}),osm(2,{tents:'no',caravans:'yes'}));
  assert.equal(own.tents,'yes');assert.equal(own.caravans,'no');
  assert.deepEqual(own.member_evidence.find(e=>e.source_record_id==='osm:way:2').fields,{tents:'no',caravans:'yes'});
  // Separate records never union rig lists. The same record seen twice still does.
  assert.deepEqual(merge(ridb(8,{rig_friendly:['tent']}),ridb(9,{rig_friendly:['rv']})).rig_friendly,['tent']);
  assert.deepEqual(merge(usfs(5),usfs(5)).rig_friendly,['rv']);
  assert.deepEqual(host.source_ids,['ridb:7','osm:way:3']);assert.equal(host.id,'ridb:7');
});

test('tents, caravans and motorhome count only on the listing own element',()=>{
  // A Recreation.gov host that inherited tourism and rig tags through an old snapshot is not an OSM element.
  const inherited=Q.normalizeFeature(ridb(10,{tourism:'camp_site',tents:'yes',caravans:'yes'}));
  assert.deepEqual(inherited.properties.rig_friendly,[]);assert.equal(inherited.properties.osm_rig_tags,null);
  assert.equal(Q.applyFilters([inherited],{rigSize:'tent'}).length,0);
  const own=Q.normalizeFeature(osm(11,{tents:'yes',caravans:'no',motorhome:'only'})).properties;
  assert.deepEqual(own.rig_friendly,['tent']);assert.deepEqual(own.rig_negatives,['trailer']);assert.deepEqual(own.osm_rig_tags,{caravans:'no',motorhome:'only',tents:'yes'});
  const e=Q.rigEvidence(own);
  assert.equal(e.categories.tent.status,'present');assert.equal(e.categories.trailer.status,'absent');assert.equal(e.categories.rv.status,'unrecognized');
  assert.equal(Q.rigLine(own),'Tents: reported; Trailers and caravans: source says no; RV: value not recognized');
});

test('index reconciliation keeps other records rig values as attributed members and never uses them',()=>{
  const out=Q.cleanAndDedupeGeoJSON({features:[ridb(20),osm(21,{tents:'yes',caravans:'yes'})]});
  assert.equal(out.features.length,1);const p=out.features[0].properties;
  assert.equal(p.id,'ridb:20');assert.deepEqual(Q.rigFilterSet(p),[]);
  assert.deepEqual(p.rig_members.map(m=>[m.source_record_id,m.fields]),[['osm:way:21',{caravans:'yes',tents:'yes'}]]);
  assert.equal(Q.applyFilters(out.features,{rigSize:'trailer'}).length,0);
  // A Forest Service record's own list stays with it. An OSM host does not gain it.
  const ag=Q.cleanAndDedupeGeoJSON({features:[osm(22,{tents:'yes'}),usfs(23)]}).features[0].properties;
  assert.equal(ag.id,'osm:way:22');assert.deepEqual(Q.rigFilterSet(ag),['tent']);
  assert.deepEqual(ag.rig_members.map(m=>[m.source_record_id,m.fields.rig_friendly]),[['usfs:23','rv']]);
  // Repeated normalization (state reloads) neither duplicates members nor revives borrowed values.
  const again=Q.cleanAndDedupeGeoJSON(Q.cleanAndDedupeGeoJSON(out)).features[0].properties;
  assert.equal(again.rig_members.length,1);assert.deepEqual(Q.rigFilterSet(again),[]);
  // The agency record's own list is its own evidence.
  const fsOwn=Q.normalizeFeature(usfs(24)).properties;assert.deepEqual(Q.rigFilterSet(fsOwn),['rv']);assert.equal(fsOwn.rig_record.source,'US Forest Service');
});

test('an own trailer yes against a Recreation.gov count of 0 RV-type sites is a conflict, never a pick',()=>{
  const f=Q.normalizeFeature(osm(30,{caravans:'yes',tents:'yes'}));f.properties.legacy_ids.push('ridb:31');
  Q.attachSiteDetails(f,{'31':{t:12,r:0,L:0}});
  const e=Q.rigEvidence(f.properties);
  assert.equal(e.categories.trailer.status,'conflict');assert.equal(e.categories.tent.status,'present');
  assert.deepEqual(e.categories.trailer.conflict[0],{source:'ridb',record:'ridb:31',count:0,total:12});
  assert.equal(Q.applyFilters([f],{rigSize:'trailer'}).length,0);assert.equal(Q.applyFilters([f],{rigSize:'tent'}).length,1);
  // Recreation.gov never adds a category on its own.
  const g=Q.normalizeFeature(osm(32,{tents:'yes'}));g.properties.legacy_ids.push('ridb:33');Q.attachSiteDetails(g,{'33':{t:12,r:12,L:40}});
  assert.deepEqual(Q.rigFilterSet(g.properties),['tent']);
  // Unknown stays unknown: no rig source shows no line and matches no rig filter.
  const none=Q.normalizeFeature(ridb(34)).properties;assert.equal(Q.rigEvidence(none).state,'no_source');assert.equal(Q.rigLine(none),'');
});

test('the national index publishes only own-source rig categories',()=>{
  const out=buildSearchIndex([{state:'CO',geojson:{type:'FeatureCollection',features:[ridb(40),osm(41,{tents:'yes',caravans:'yes'}),osm(42,{tents:'no',caravans:'yes'},[-106,41],'Elk Camp')]}}]);
  const by=Object.fromEntries(out.sites.map(s=>[s.id,s.m.r||[]]));
  assert.deepEqual(by['ridb:40'],[]);assert.deepEqual(by['osm:way:42'],['trailer']);
});

test('published rig fixture matches the committed data, listing by listing',()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/rig-tag-ownership-cases.json'),'utf8'));
  const index=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/campsites/search-index.json'),'utf8')).sites,by=new Map(index.map(s=>[s.id,s]));
  assert.ok(fixture.cases.length>=fixture.summary.listings_with_rig_change);
  for(const id of ['ridb:232324','ridb:274260','osm:node:11810571792','usfs:26883','ridb:242362','osm:way:259289402'])assert.ok(fixture.cases.some(c=>c.id===id),id);
  for(const c of fixture.cases){
    const s=by.get(c.id);assert.ok(s,c.id);const r=s.m.r||[];
    assert.equal(r.includes('tent'),c.tents_after,c.id+' tents');assert.equal(r.includes('trailer'),c.trailers_after,c.id+' trailers');
    // Never gained, and every borrowed value is attributed to a member.
    assert.ok(!(c.tents_after&&!c.tents_before)&&!(c.trailers_after&&!c.trailers_before),c.id);
    for(const [cat,from] of Object.entries(c.borrowed))assert.ok(from.length,c.id+' '+cat);
  }
  const csv=fs.readFileSync(path.join(__dirname,'fixtures/rig-tag-ownership-cases.csv'),'utf8').trim().split('\n');
  assert.equal(csv.length-1,fixture.cases.length);
});

test('provenance debt guard: campsite client code never reads operator, and website only as the agency record own link',()=>{
  // Inherited operator and website values stay in snapshots (owner decision pending). No campsite UI may present them.
  const files=['data-loader.js','filters.js','app.js','routes.js','trip-planner.js','share.js','spot-info.js','layers.js','community.js','community-discovery.js','permissions.js','contributions.js'];
  for(const file of files){
    const src=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    assert.doesNotMatch(src,/\b(?:p|props|properties|site\.properties|feature\.properties)\??\.operator\b|\[['"]operator['"]\]/,file+' reads operator');
    const web=[...src.matchAll(/\b(?:p|props|properties|site\.properties|feature\.properties)\??\.website\b|\[['"]website['"]\]/g)];
    // Known fallbacks after source_url: the popup link and the fee-evidence panel. Each carries a provenance-debt comment.
    if(file==='data-loader.js'||file==='spot-info.js'){assert.equal(web.length,1,file+' reads website once');assert.match(src,/[Pp]rovenance debt \(2\.32\.0\)/);assert.match(src,/source_url\s*\|\|\s*(?:p|properties)\.website/);}
    else assert.equal(web.length,0,file+' reads website');
  }
  // Both read sites use normalized source_url first. Every published listing has one, so website is never reached.
  const dq=fs.readFileSync(path.join(__dirname,'../data-quality.js'),'utf8');
  assert.match(dq,/[Pp]rovenance debt \(2\.32\.0\)/);
});
