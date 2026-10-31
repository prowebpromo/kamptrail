'use strict';
// R8 amenity ownership (2.31.0): merge guards, scope rules, the same-campsite rule,
// date-unknown handling and the published 188/221-case fixture.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Q=require('../data-quality.js');
const {CampsiteMerger}=require('../scripts/merge_campsite_data');
const {buildSearchIndex}=require('../scripts/build-search-index');
const routesContext={DataQuality:Q,URL,Set,Map,Math,Number,Date,Array,AbortController,setTimeout,clearTimeout};vm.createContext(routesContext);vm.runInContext(fs.readFileSync(path.join(__dirname,'../routes.js'),'utf8'),routesContext);const R=routesContext.KampTrailRoutes;

const osm=(id,tags={},coords=[-105,40],name='Pine Campground')=>({type:'Feature',geometry:{type:'Point',coordinates:coords},properties:{id:`osm:node:${id}`,osm_id:id,osm_type:'node',tourism:'camp_site',name,schema_version:3,source:'openstreetmap',source_retrieved_at:'2026-10-29T02:53:12Z',...tags}});
const ridb=(fid,extra={},coords=[-105,40],name='Pine Campground')=>({type:'Feature',geometry:{type:'Point',coordinates:coords},properties:{id:`ridb:${fid}`,facility_id:String(fid),name,schema_version:3,source:'recreation.gov',description:'A campground with camping.',fee_status:'unknown',amenities:[],rig_friendly:[],...extra}});
const ridbSource={name:'Recreation.gov RIDB full export',url:Q.RIDB_AMENITY_URL,sha256:'a'.repeat(64),inspected_at:'2026-10-30T12:00:00Z',original_retrieved_at:null,attribute_updated_at:null,archive_entry_time:'2026-10-21T18:46:28',archive_entry_timezone:null,basis:'frozen_public_export_cache',http_last_modified:null};
const g=(reported,extra={})=>({reported,negative:0,unknown:0,conflict:0,qualifiers:{},...extra});
const ridbPayload=(fid,sites,amenities)=>({version:1,source:{...ridbSource},facilities:{[fid]:{sites,amenities}}});
const usfsPayload=(fid,records,conflicts=[])=>({version:1,source:{name:'USDA Forest Service Recreation Site record',layer_url:Q.USFS_SITE_URL,license:'CC BY 4.0',basis:'saved_download',retrieved:'2026-10-31',rows_sha256:'b'.repeat(64)},facilities:{[fid]:{records,conflicts}}});
const fsRecord=(extra={})=>({cn:'1',name:'Pine Campground',type:'CAMPGROUND',toilet:{text:'Vault toilet(s)',class:'vault_or_pit'},updated:null,edw_modified:null,...extra});
const merge=(a,b)=>{const m=new CampsiteMerger();return m.mergeProperties(a.properties,b.properties);};

test('snapshot merge keeps amenity tags and survey dates on the element that carries them',()=>{
  // OSM host absorbing a site node: the site's tags move to attributed member evidence.
  const merged=merge(osm(1,{toilets:'no'}),osm(2,{toilets:'yes',drinking_water:'yes',shower:'yes',check_date:'2024-06-01','toilets:disposal':'pitlatrine',fee:'yes'}));
  assert.equal(merged.toilets,'no');for(const k of ['drinking_water','shower','check_date','toilets:disposal','fee'])assert.equal(merged[k],undefined,k);
  const e=merged.member_evidence.find(r=>r.source_record_id==='osm:node:2');
  assert.deepEqual(e.fields,{fee:'yes',toilets:'yes',drinking_water:'yes',shower:'yes',check_date:'2024-06-01','toilets:disposal':'pitlatrine'});
  assert.equal(e.source,'OpenStreetMap contributors');assert.equal(e.retrieved_at,'2026-10-29T02:53:12Z');assert.equal(e.source_url,'https://www.openstreetmap.org/node/2');
  // A Recreation.gov host owns no OSM tag at all.
  const host=merge(ridb(7),osm(3,{toilets:'yes',power_supply:'yes'}));
  assert.equal(host.toilets,undefined);assert.equal(host.power_supply,undefined);assert.deepEqual(host.member_evidence[0].fields,{toilets:'yes',power_supply:'yes'});
  // Membership and identity are unchanged by the guard.
  assert.deepEqual(host.source_ids,['ridb:7','osm:node:3']);assert.equal(host.id,'ridb:7');
  // The same element seen twice keeps its own tags, and separate records never union amenity lists.
  assert.equal(merge(osm(4,{toilets:'yes'}),osm(4,{toilets:'yes'})).toilets,'yes');
  const a=ridb(8,{amenities:['toilet']}),b=ridb(9,{amenities:['shower']});assert.deepEqual(merge(a,b).amenities,['toilet']);
});

test('index reconciliation keeps other records as attributed members and never as the listing amenities',()=>{
  const out=Q.cleanAndDedupeGeoJSON({features:[ridb(10,{tourism:'camp_site'}),osm(11,{toilets:'yes',drinking_water:'no',check_date:'2025-05-02'})]});
  assert.equal(out.features.length,1);const p=out.features[0].properties;
  // tourism=* inherited by a Recreation.gov host does not make it an OSM element.
  assert.equal(p.id,'ridb:10');assert.deepEqual(p.amenities,[]);assert.deepEqual(p.amenity_negatives,[]);assert.equal(p.osm_amenity_tags,null);
  assert.deepEqual(p.amenity_members.map(m=>({id:m.source_record_id,source:m.source,observed:m.observed_at,retrieved:m.retrieved_at,fields:m.fields})),[{id:'osm:node:11',source:'OpenStreetMap contributors',observed:'2025-05-02',retrieved:'2026-10-29T02:53:12Z',fields:{check_date:'2025-05-02',drinking_water:'no',toilets:'yes'}}]);
  // Normalizing again (state reloads) neither duplicates members nor grows negatives.
  const again=Q.cleanAndDedupeGeoJSON(Q.cleanAndDedupeGeoJSON(out)).features[0].properties;
  assert.equal(again.amenity_members.length,1);
  const own=Q.cleanAndDedupeGeoJSON({features:[osm(12,{toilets:'no'})]}),thrice=Q.cleanAndDedupeGeoJSON(Q.cleanAndDedupeGeoJSON(own)).features[0].properties;
  assert.deepEqual(thrice.amenity_negatives,['toilet']);
  assert.equal(Q.applyFilters(out.features,{amenities:['toilet']}).length,0);assert.equal(Q.amenityEvidence(p).state,'no_source');
});

test('scope rules: campsite records stay "some sites", site records and elements stay campground-wide',()=>{
  const f=Q.normalizeFeature(ridb(20));Q.attachRIDBAmenities(f,ridbPayload('20',40,{toilet:g(1),drinking_water:g(0,{unknown:5})}));
  const e=Q.amenityEvidence(f.properties);
  assert.equal(e.amenities.toilet.status,'present');assert.deepEqual([e.amenities.toilet.positive[0].scope,e.amenities.toilet.positive[0].count,e.amenities.toilet.positive[0].total],['campsite_records',1,40]);
  assert.equal(e.amenities.water.status,'unrecognized');assert.deepEqual(Q.amenityFilterSets(f.properties),{g:[],s:['toilet']});
  // Forest Service: explicit class is site-record scope. Disagreeing records give no evidence. Ambiguous wording is unknown.
  const fsf=Q.normalizeFeature(ridb(21));Q.attachUSFSSiteAmenities(fsf,usfsPayload('21',[fsRecord({cn:'1',toilet:{text:'Flush toilets',class:'flush'}}),fsRecord({cn:'2'})],['toilet']));
  assert.equal(Q.amenityEvidence(fsf.properties).amenities.toilet.status,'conflict');assert.equal(Q.applyFilters([fsf],{amenities:['toilet']}).length,0);
  const fsok=Q.normalizeFeature(ridb(22));Q.attachUSFSSiteAmenities(fsok,usfsPayload('22',[fsRecord({water:{text:'Yes',class:'unknown'}})]));
  assert.deepEqual(Q.amenityFilterSets(fsok.properties),{g:['toilet'],s:[]});assert.equal(Q.amenityEvidence(fsok.properties).amenities.water.status,'unrecognized');
  // OSM nonstandard values stay visible and are not promoted.
  const v=Q.normalizeFeature(osm(23,{toilets:'vault'}));assert.equal(Q.amenityEvidence(v.properties).amenities.toilet.status,'unrecognized');assert.equal(Q.applyFilters([v],{amenities:['toilet']}).length,0);
});

test('Forest Service records for a different site type are shown as a different site and never match',()=>{
  for(const type of ['SWIMMING SITE','PICNIC SITE','INFO SITE/FEE STATION','LOOKOUT/CABIN','DAY USE AREA']){
    const f=Q.normalizeFeature(ridb(70));f.properties.rv_sigs=[[40,0,1]];
    Q.attachUSFSSiteAmenities(f,usfsPayload('70',[fsRecord({name:'Lake North Recreation Area',type,water:{text:'Potable Water',class:'drinking_water'}})]));
    const e=Q.amenityEvidence(f.properties);
    assert.equal(e.amenities.toilet.status,'unknown',type);assert.equal(e.amenities.toilet.elsewhere[0].scope,'other_site_record');
    for(const filters of [{},{rigLength:30}])for(const a of ['toilet','water'])assert.equal(Q.applyFilters([f],{amenities:[a],...filters}).length,0,type+' '+a);
  }
  for(const type of ['CAMPGROUND','GROUP CAMPGROUND','HORSE CAMP']){const f=Q.normalizeFeature(ridb(71));Q.attachUSFSSiteAmenities(f,usfsPayload('71',[fsRecord({type})]));assert.deepEqual(Q.amenityFilterSets(f.properties),{g:['toilet'],s:[]},type);}
});
test('explicit negatives and contradictions stay visible and never match',()=>{
  const f=Q.normalizeFeature(osm(30,{toilets:'yes',drinking_water:'no'},[-105,40],'Pine Campground'));f.properties.legacy_ids.push('ridb:30');
  Q.attachUSFSSiteAmenities(f,usfsPayload('30',[fsRecord({toilet:{text:'No toilets',class:'no_toilet'}})]));
  const e=Q.amenityEvidence(f.properties);
  assert.equal(e.amenities.toilet.status,'conflict');assert.equal(e.amenities.water.status,'absent');
  assert.deepEqual(Q.amenityFilterReason(f.properties,'toilet'),{included:false,reason:'sources_disagree'});
  assert.deepEqual(Q.amenityFilterReason(f.properties,'water'),{included:false,reason:'explicit_negative'});
});

test('rig fit and amenity filters match within one campsite record, never across sites',()=>{
  const sigs=[[40,1,1],[20,0,9]];
  const rec=Q.normalizeFeature(ridb(40));Q.attachRIDBAmenities(rec,ridbPayload('40',10,{toilet:g(9),shower:g(1)}));rec.properties.rv_sigs=sigs;
  // Without a campsite-level filter, a campsite-record mention matches at its stated scope.
  assert.equal(Q.applyFilters([rec],{amenities:['toilet']}).length,1);
  // The 40 ft electric site and the toilet records cannot be shown to be the same campsite record.
  for(const filters of [{rigLength:35},{hookups:['electric']},{rigLength:30,hookups:['electric']}]){
    assert.equal(Q.applyFilters([rec],{amenities:['toilet'],...filters}).length,0,JSON.stringify(filters));
    assert.equal(Q.applyFilters([rec],filters).length,1,'the rig filter alone still matches');
    assert.deepEqual(Q.amenityFilterReason(rec.properties,'toilet',filters),{included:false,reason:'campsite_records_with_rig_filter'});
  }
  // Campground-wide evidence (own OSM element, Forest Service site record) can combine with a fitting campsite.
  const wide=Q.normalizeFeature(ridb(41));wide.properties.rv_sigs=sigs;Q.attachUSFSSiteAmenities(wide,usfsPayload('41',[fsRecord()]));
  assert.equal(Q.applyFilters([wide],{amenities:['toilet'],rigLength:35}).length,1);
  // The tent/trailer rig type is element-level, not a campsite record, so it does not trigger the rule.
  assert.equal(Q.campsiteRigActive({rigSize:'trailer'}),false);
  // The national index keeps the same split so route filters agree with the map.
  const idx=buildSearchIndex([{state:'CO',geojson:{type:'FeatureCollection',features:[ridb(40),{...ridb(41),geometry:{type:'Point',coordinates:[-106,41]}}]}}],Q,{'40':{g:sigs,r:10,t:10},'41':{g:sigs,r:10,t:10}},[],null,null,{ridb:ridbPayload('40',10,{toilet:g(9)}),usfs:usfsPayload('41',[fsRecord()])});
  assert.equal(idx.amenity_version,1);
  const rows=Object.fromEntries(idx.sites.map(s=>[s.id,s]));assert.deepEqual(rows['ridb:40'].m.s,['toilet']);assert.equal(rows['ridb:40'].m.a,undefined);assert.deepEqual(rows['ridb:41'].m.a,['toilet']);
  const rebuilt=idx.sites.map(R.indexFeature);
  assert.deepEqual(Q.applyFilters(rebuilt,{amenities:['toilet']}).map(f=>f.properties.id).sort(),['ridb:40','ridb:41']);
  assert.deepEqual(Q.applyFilters(rebuilt,{amenities:['toilet'],rigLength:35}).map(f=>f.properties.id),['ridb:41']);
});

test('a missing observation date is "date unknown"; a retrieval or rebuild date is never substituted',()=>{
  const f=Q.normalizeFeature(osm(50,{toilets:'yes'}));const e=Q.amenityEvidence(f.properties);
  assert.equal(e.amenities.toilet.positive[0].date,null);assert.equal(e.amenities.toilet.positive[0].retrieved,'2026-10-29T02:53:12Z');
  const dated=Q.amenityEvidence(Q.normalizeFeature(osm(51,{toilets:'yes',check_date:'2025-07-04'})).properties);assert.equal(dated.amenities.toilet.positive[0].date,'2025-07-04');
  const bad=Q.amenityEvidence(Q.normalizeFeature(osm(52,{toilets:'yes',check_date:'summer 2024'})).properties);assert.equal(bad.amenities.toilet.positive[0].date,null);
  const r=Q.normalizeFeature(ridb(53));Q.attachRIDBAmenities(r,ridbPayload('53',3,{toilet:g(1)}));assert.equal(Q.amenityEvidence(r.properties).amenities.toilet.positive[0].date,null);
  const u=Q.normalizeFeature(ridb(54));Q.attachUSFSSiteAmenities(u,usfsPayload('54',[fsRecord({updated:null})]));assert.equal(Q.amenityEvidence(u.properties).amenities.toilet.positive[0].date,null);
  // Popup wording, in all three languages.
  const html=popupFor(osm(50,{toilets:'yes'}));
  assert.match(html,/OpenStreetMap element node\/50<\/a> <span class="kt-muted">\(whole mapped element · value “yes” · date unknown\)/);
  assert.match(html,/Survey: date unknown\. Retrieved: 2026-10-29\./);
  // The only date in the evidence is the source retrieval date, labelled as such. No build or current date appears.
  const block=html.match(/kt-amenity-evidence[\s\S]*?<\/div>/)[0];assert.deepEqual([...new Set(block.match(/\d{4}-\d\d-\d\d/g))],['2026-10-29']);
  assert.match(popupFor(osm(50,{toilets:'yes'}),'es'),/todo el elemento cartografiado · valor «yes» · fecha desconocida/);
  assert.match(popupFor(osm(50,{toilets:'yes'}),'fr'),/tout l’élément cartographié · valeur « yes » · date inconnue/);
});

test('every listing states its amenity evidence or an explicit no-source state',()=>{
  const none=popupFor({...ridb(60),properties:{...ridb(60).properties,id:'blm-area:60',facility_id:undefined,source:'blm'}});
  assert.match(none,/data-state="no_source"><strong>Amenity evidence:<\/strong> No amenity source for this listing\./);assert.doesNotMatch(none,/Amenities reported:|Not verified<\/div>/);
  const members=popupFor([ridb(61),osm(62,{toilets:'yes',check_date:'2024-01-02'})]);
  assert.match(members,/No amenity source for this listing\./);assert.match(members,/Merged elements, not used for this listing \(1\)/);
  assert.match(members,/data-member="osm:node:62">.*toilets=yes.*Survey: 2024-01-02\. Retrieved: 2026-10-29\./);
  assert.match(popupFor(ridb(63),'es'),/No hay ninguna fuente de servicios para este lugar\./);assert.match(popupFor(ridb(63),'fr'),/Aucune source d’équipements pour ce lieu\./);
});

function popupFor(features,language='en'){
  const list=Array.isArray(features)?features:[features];
  const context={console:{warn(){},log(){}},setTimeout,clearTimeout,URL,document:{addEventListener(){},documentElement:{lang:'en'},querySelectorAll:()=>[]},localStorage:{getItem:()=>language,setItem(){}},Intl,Date};
  context.window=context;vm.createContext(context);
  if(language==='fr')vm.runInContext(fs.readFileSync(path.join(__dirname,'../locale-fr.js'),'utf8'),context);
  if(language!=='en')vm.runInContext(fs.readFileSync(path.join(__dirname,'../locale.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../data-quality.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../data-loader.js'),'utf8'),context);
  const site=context.DataQuality.cleanAndDedupeGeoJSON({features:list}).features[0];
  return context.KampTrailData.popupHTML(site);
}

test('published fixture: each of the 191 borrowed-amenity and 221 Recreation.gov toilet-record listings has its stated outcome',()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/amenity-ownership-cases.json'),'utf8'));
  const dir=path.join(__dirname,'../data/campsites'),read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
  const details=read('ridb-sites.json').facilities,ridbData=read('ridb-amenities.json'),usfsData=read('usfs-site-amenities.json'),idx=read('search-index.json').sites;
  const preferredIds=new Set(idx.map(s=>s.id)),previousHosts=new Map();for(const s of idx)for(const a of s.legacy_ids||[])previousHosts.set(a,s.id);
  const attach=f=>{Q.attachSiteDetails(f,details);Q.attachRIDBAmenities(f,ridbData);Q.attachUSFSSiteAmenities(f,usfsData);};
  const wanted=new Set(fixture.cases.map(c=>c.id)),input=[];
  for(const name of fs.readdirSync(dir).filter(n=>/^[A-Z]{2}_merged\.geojson$/.test(n)).sort()){
    const state=name.slice(0,2),features=read(name).features,agency=path.join(dir,'agency',state+'.geojson');
    if(fs.existsSync(agency))features.push(...JSON.parse(fs.readFileSync(agency,'utf8')).features);
    for(const raw of Q.publicationCandidates(features,{state})){const f=Q.normalizeFeature(raw,{state});if(f){attach(f);input.push(f);}}
  }
  const catalogue=Q.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:input},{preferredIds,previousHosts}).features;catalogue.forEach(attach);
  const by=new Map(catalogue.filter(f=>wanted.has(f.properties.id)).map(f=>[f.properties.id,f.properties]));
  assert.equal(fixture.cases.filter(c=>c.borrowed).length,191);assert.equal(fixture.cases.filter(c=>c.ridb_toilet_records).length,221);
  for(const c of fixture.cases){
    const p=by.get(c.id);assert.ok(p,c.id);
    assert.deepEqual(Q.amenityFilterReason(p,'toilet'),c.toilet,c.id+' toilet');
    assert.deepEqual(Q.amenityFilterReason(p,'water'),c.water,c.id+' water');
    assert.deepEqual(Q.amenityFilterReason(p,'toilet',fixture.length_filter_used),c.toilet_with_length_filter,c.id+' toilet with length');
    // A borrowed value is never the listing's own any more.
    for(const a of c.borrowed_values)assert.ok(!p.amenities.includes(a),c.id+' still owns borrowed '+a);
    // Every exclusion carries a reason. Coverage is not forced: exclusions remain.
    for(const k of ['toilet','water','toilet_with_length_filter'])if(!c[k].included)assert.ok(c[k].reason,c.id);
  }
  assert.ok(fixture.cases.some(c=>!c.toilet.included),'exclusions remain; not every record was made to match');
});
