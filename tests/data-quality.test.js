const {test}=require('node:test');
const assert=require('node:assert/strict');
const quality=require('../data-quality.js');
const point=(properties={},coordinates=[-73,43])=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{name:'Pine Campground',...properties}});
const normalize=p=>quality.normalizeFeature(point(p));

test('legacy RIDB estimates remain unknown rather than free or paved',()=>{
  const site=normalize({id:'NY-001',source:'recreation.gov',facility_id:42,cost:0,amenities:['water'],rig_friendly:['RV'],road_difficulty:'paved'});
  assert.equal(site.properties.id,'ridb:42');
  assert.equal(site.properties.cost,null);assert.equal(site.properties.fee_status,'unknown');
  assert.deepEqual(site.properties.amenities,[]);assert.deepEqual(site.properties.rig_friendly,[]);assert.equal(site.properties.road_difficulty,null);
  assert.ok(site.properties.legacy_ids.includes('NY-001'));
});
test('legacy invented $15 is also unknown; schema 3 fee facts survive',()=>{
  assert.equal(normalize({facility_id:42,cost:15}).properties.cost,null);
  const current=normalize({facility_id:42,schema_version:3,cost:24.5,fee_status:'paid'});
  assert.equal(current.properties.cost,24.5);assert.equal(current.properties.fee_status,'paid');
});
test('OSM free, paid amount unknown, and missing fee are distinct',()=>{
  const free=normalize({osm_id:1,tourism:'camp_site',fee:'no'});
  const paid=normalize({osm_id:2,tourism:'camp_site',fee:'yes'});
  const unknown=normalize({osm_id:3,tourism:'camp_site'});
  assert.equal(free.properties.cost,0);assert.equal(paid.properties.cost,null);assert.equal(paid.properties.fee_status,'paid');assert.equal(unknown.properties.fee_status,'unknown');
  assert.deepEqual(quality.applyFilters([free,paid,unknown],{cost:'free'}),[free]);
  assert.deepEqual(quality.applyFilters([free,paid,unknown],{cost:'paid'}),[paid]);
});
test('OSM structural types and positive amenity tags normalize',()=>{
  const site=normalize({osm_id:7,osm_type:'relation',tourism:'caravan_site',type:'multipolygon',toilets:'yes',drinking_water:'no',caravans:'yes'});
  assert.equal(site.properties.id,'osm:relation:7');assert.equal(site.properties.type,'established');
  assert.deepEqual(site.properties.amenities,['toilet']);assert.deepEqual(site.properties.rig_friendly,['trailer']);
  assert.equal(quality.applyFilters([site],{amenities:['water']}).length,0);
});
test('shared identity across states deduplicates and keeps legacy lookup aliases',()=>{
  const a=point({id:'CA-001',facility_id:123,cost:0,state:'CA'});
  const b=point({id:'NV-099',facility_id:123,cost:0,state:'NV'});
  const result=quality.cleanAndDedupeGeoJSON({features:[a,b]});
  assert.equal(result.features.length,1);assert.ok(result.features[0].properties.legacy_ids.includes('NV-099'));
});
test('normalization is idempotent and keeps explicit facts merged into legacy RIDB',()=>{
  const result=quality.cleanAndDedupeGeoJSON({features:[point({facility_id:1,cost:0}),point({osm_id:7,tourism:'camp_site',fee:'no',toilets:'yes'})]});
  const twice=quality.cleanAndDedupeGeoJSON(result);
  assert.equal(twice.features[0].properties.fee_status,'free');assert.deepEqual(twice.features[0].properties.amenities,['toilet']);
});
test('placeholder matching keeps real Demotte and Greatest campground names',()=>{
  assert.ok(normalize({name:'Demotte Campground'}));assert.ok(normalize({name:'Greatest Lake'}));
  assert.equal(normalize({name:'Sample Campsite'}),null);
});
test('invalid coordinates do not reach Leaflet; anonymous valid records get stable IDs',()=>{
  assert.equal(quality.normalizeFeature(point({},[null,43])),null);assert.equal(quality.normalizeFeature(point({},[0,0])),null);
  assert.equal(normalize({}).properties.id,normalize({}).properties.id);
});
test('aliases agree with filter vocabulary without promoting unknown rigs',()=>{
  const site=normalize({schema_version:3,amenities:['toilets','fire_rings','picnic_tables'],rig_friendly:['RV'],road_difficulty:'paved'});
  assert.equal(quality.applyFilters([site],{amenities:['toilet','fire_ring','picnic_table'],rigSize:'rv',roadDifficulty:'paved'}).length,1);
  assert.equal(quality.applyFilters([site],{rigSize:'big_rig'}).length,0);
});

test('conflicting source fees stay unknown after another matching record',()=>{
  const free=point({schema_version:3,cost:0});
  const paid=point({schema_version:3,cost:20});
  const result=quality.cleanAndDedupeGeoJSON({features:[free,paid,point({schema_version:3,cost:0})]});
  assert.equal(result.features.length,1);assert.equal(result.features[0].properties.fee_status,'unknown');assert.equal(result.features[0].properties.cost,null);
});
test('source fee conflicts survive subsequent state loads and RIDB fee enrichment',()=>{
  for (const [fee, agencyStatus, agencyCost] of [['no','paid',20],['yes','free',0]]) {
    const osm=point({osm_id:71,osm_type:'node',tourism:'camp_site',fee});
    const agency=point({facility_id:42,schema_version:3,camping_activity:'Campground Camping',fee_status:agencyStatus,cost:agencyCost});
    let result=quality.cleanAndDedupeGeoJSON({features:[osm,agency]});
    for (let load=0;load<3;load++) {
      // The loader cleans accumulated records each time another state arrives.
      const nextState=point({id:'next-state',name:'Other State Campground'},[-110,30]);
      result=quality.cleanAndDedupeGeoJSON({features:[...result.features,nextState]});
      for (const site of result.features) quality.attachSiteDetails(site,{'42':{f:'free'}});
      assert.equal(result.features.length,2);
      const p=result.features.find(f=>f.properties.name==='Pine Campground').properties;
      assert.equal(p.fee_conflict,true);assert.equal(p.fee_status,'unknown');assert.equal(p.cost,null);
      assert.equal(quality.applyFilters(result.features,{cost:'free'}).length,0);
      assert.equal(quality.applyFilters(result.features,{cost:'paid'}).length,0);
    }
  }
});
test('merged agency conditions survive normalization of retained OSM fee tags',()=>{
  for (const fee of ['yes','no']) {
    const osm=point({osm_id:71,osm_type:'node',tourism:'camp_site',fee});
    const agency=point({id:'usfs:42',schema_version:3,camping_activity:'Campground Camping',fee_status:'conditional',cost:null,fee_text:'No fee during winter.'});
    let result=quality.cleanAndDedupeGeoJSON({features:[osm,agency]});
    for (let load=0;load<3;load++) {
      result=quality.cleanAndDedupeGeoJSON(result);
      assert.equal(result.features[0].properties.fee_status,'conditional');
      assert.equal(result.features[0].properties.cost,null);
      assert.equal(result.features[0].properties.fee_text,'No fee during winter.');
      assert.equal(quality.applyFilters(result.features,{cost:'free'}).length,0);
    }
  }
});
test('a previously conflicting record keeps the fee unknown in either merge order',()=>{
  const free=point({schema_version:3,cost:0});
  const paid=point({schema_version:3,cost:20});
  const conflict=quality.cleanAndDedupeGeoJSON({features:[free,paid]}).features[0];
  for (const features of [[free,conflict],[conflict,free]]) {
    const result=quality.cleanAndDedupeGeoJSON({features});
    assert.equal(result.features.length,1);
    const p=result.features[0].properties;
    assert.equal(p.fee_conflict,true);assert.equal(p.fee_status,'unknown');assert.equal(p.cost,null);
    assert.equal(quality.applyFilters(result.features,{cost:'free'}).length,0);
  }
});
test('conflicting water reports do not advertise a verified water amenity',()=>{
  const result=quality.cleanAndDedupeGeoJSON({features:[point({osm_id:1,tourism:'camp_site',drinking_water:'yes'}),point({osm_id:2,tourism:'camp_site',drinking_water:'no'})]});
  assert.ok(!result.features[0].properties.amenities.includes('water'));
});

test('MVP excludes explicit private/prohibited camping access while retaining commercial customer and permit records',()=>{
  for(const access of ['private','no','military'])assert.equal(normalize({osm_id:1,tourism:'camp_site',access}),null);
  const customers=normalize({osm_id:2,tourism:'camp_site',access:'customers',ownership:'private',fee:'yes'});
  assert.equal(customers.properties.access_status,'customers');
  assert.match(customers.properties.access_label,/Customers only/);
  const permit=normalize({osm_id:3,tourism:'camp_site',access:'permit'});
  assert.equal(permit.properties.access_status,'permit');
  assert.match(permit.properties.access_label,/Permit required/);
});
test('MVP excludes clear noncamping facilities without removing named campgrounds sharing those words',()=>{
  for(const name of ['Jackson Ranger District','Forest Supervisor Office','Forest Visitor Center','Cottonwood Picnic Site','Big Lake Day Use Area','Pine Boat Ramp','Baranof Lake Cabin','Heybrook Lookout','Teanaway Guard Station','Green River Lodge','US Naval Air Station','Buford Dam Park Shelters (GA)','Alpine Ranger Station']) {
    assert.equal(normalize({name,facility_id:3,type:'established'}),null,name);
  }
  for(const name of ['Sweetwater Guard Station Campground','Meeks Cabin Campground','Medicine Lodge Lake Campground','Cabin Creek RV Park','Picnic Point Campground']) {
    assert.ok(normalize({name,facility_id:3,type:'established'}),name);
  }
});
test('explicit named OSM campsites survive ambiguous names and missing fees, with access remaining unknown',()=>{
  const site=normalize({name:'Log Cabin Resort',osm_id:4,tourism:'caravan_site',ownership:'private'});
  assert.ok(site);assert.equal(site.properties.fee_status,'unknown');
  assert.equal(site.properties.access_status,'unknown');assert.equal(site.properties.access_label,'Access not verified');
  assert.equal(site.properties.camping_evidence,'osm_campsite_tag');
});
test('explicit closed/disused camping records are omitted and ambiguous RIDB activity records are not called campgrounds',()=>{
  for(const tags of [{disused:'yes'},{abandoned:'yes'},{'disused:tourism':'camp_site'},{camping:'no'}])assert.equal(normalize({osm_id:4,tourism:'camp_site',...tags}),null);
  const site=normalize({name:'Lyons Ferry Marina',facility_id:20,type:'established'});
  assert.ok(site);assert.equal(site.properties.type,'other');
  assert.equal(site.properties.camping_classification,'unverified_camping_record');
  const again=quality.normalizeFeature(site);
  assert.equal(again.properties.type,'other');assert.equal(again.properties.access_status,'unknown');
});


test('direct source intro preserves legitimate short RIDB campground names without trusting later nearby mentions',()=>{
  const site=normalize({name:'FRENCHMAN',facility_id:232137,type:'established',description:'<h2>Overview</h2><p>Frenchman Campground sits along its namesake lake. Nearby boating is popular.</p>'});
  assert.equal(site.properties.type,'established');assert.equal(site.properties.camping_evidence,'source_intro_camping');
  const ambiguous=normalize({name:'Lake Recreation Area',facility_id:99,type:'established',description:'A recreation area on Lake X. A campground is located several miles away.'});
  assert.equal(ambiguous.properties.type,'other');
  assert.equal(normalize({name:'Lake Recreation Area',facility_id:99,description:'No overnight camping is permitted here.'}),null);
});
test('duplicate records retain explicit permit/customer access when another source lacks access details',()=>{
  const result=quality.cleanAndDedupeGeoJSON({features:[point({osm_id:1,tourism:'camp_site'}),point({osm_id:2,tourism:'camp_site',access:'permit'})]});
  assert.equal(result.features.length,1);assert.equal(result.features[0].properties.access_status,'permit');assert.match(result.features[0].properties.access_label,/Permit/);
});


test('public MVP cleaner excludes unverified activity listings by default while diagnostic callers can retain them',()=>{
  const campground=point({name:'Pine Campground',facility_id:1});
  const unverified=point({name:'Lake Recreation Area',facility_id:2,description:'A general recreation area near the lake.'},[-74,44]);
  assert.ok(quality.normalizeFeature(unverified));
  const publicSites=quality.cleanAndDedupeGeoJSON({features:[campground,unverified]});
  assert.equal(publicSites.features.length,1);assert.equal(publicSites.features[0].properties.name,'Pine Campground');
  const diagnostic=quality.cleanAndDedupeGeoJSON({features:[campground,unverified]},{includeUnverified:true});
  assert.equal(diagnostic.features.length,2);
  assert.equal(diagnostic.features[1].properties.camping_classification,'unverified_camping_record');
});

test('RV length and hookup filters use Recreation.gov site summaries and never match unknowns', () => {
  const DQ = require('../data-quality.js');
  const mk = (fid) => ({type: 'Feature', geometry: {type: 'Point', coordinates: [-110, 40]}, properties: {id: `ridb:${fid}`, facility_id: fid, amenities: [], rig_friendly: [], rating: null}});
  const table = {'1': {t: 10, r: 6, L: 40, g: [[25, 3, 2], [40, 3, 4]], e: 6, w: 6}, '2': {t: 5, r: 0, L: 0}};
  const a = DQ.attachSiteDetails(mk(1), table), b = DQ.attachSiteDetails(mk(2), table), c = DQ.attachSiteDetails(mk(3), table);
  assert.strictEqual(a.properties.rv_max_length, 40);
  assert.strictEqual(b.properties.rv_max_length, null);
  assert.strictEqual(c.properties.rv_max_length, undefined);
  assert.strictEqual(DQ.sitesFitting(a.properties, 30), 4);
  assert.deepStrictEqual(DQ.applyFilters([a, b, c], {rigLength: 35}).map(s => s.properties.id), ['ridb:1']);
  assert.deepStrictEqual(DQ.applyFilters([a, b, c], {rigLength: 45}), []);
  assert.deepStrictEqual(DQ.applyFilters([a, b, c], {hookups: ['electric', 'water']}).map(s => s.properties.id), ['ridb:1']);
  assert.deepStrictEqual(DQ.applyFilters([a, b, c], {hookups: ['sewer']}), []);
});

test('Recreation.gov fee evidence fills only unknown fees', () => {
  const DQ = require('../data-quality.js');
  const mk = (fid, extra = {}) => ({type: 'Feature', geometry: {type: 'Point', coordinates: [-110, 40]}, properties: {id: `ridb:${fid}`, facility_id: fid, fee_status: 'unknown', cost: null, amenities: [], rig_friendly: [], ...extra}});
  const t = {'1': {t: 0, r: 0, L: 0, f: 'free', fe: 'fee_text', sl: '14 days'}, '2': {t: 0, r: 0, L: 0, rs: 1}, '3': {t: 0, r: 0, L: 0, f: 'free', fe: 'fee_text'}, '4': {t: 0, r: 0, L: 0, f: 'paid', fe: 'fee_text', c: 22}};
  const a = DQ.attachSiteDetails(mk(1), t).properties;
  assert.deepStrictEqual([a.fee_status, a.cost, a.stay_limit], ['free', 0, '14 days']);
  const b = DQ.attachSiteDetails(mk(2), t).properties;
  // Reservable alone stays unknown.
  assert.deepStrictEqual([b.fee_status, b.cost, b.fee_evidence, b.reservable], ['unknown', null, undefined, true]);
  const c = DQ.attachSiteDetails(mk(3, {fee_status: 'paid', cost: 15}), t).properties;
  assert.deepStrictEqual([c.fee_status, c.cost], ['paid', 15]);
  const d = DQ.attachSiteDetails(mk(4), t).properties;
  assert.deepStrictEqual([d.fee_status, d.cost], ['paid', 22]);
});

test('agency records count as camping, keep fee wording, and fill an unknown Recreation.gov fee on merge', () => {
  const DQ = require('../data-quality.js');
  const ridb = {type:'Feature',geometry:{type:'Point',coordinates:[-120.0,48.7]},properties:{name:'TIFFANY SPRINGS CAMPGROUND',facility_id:'500',source:'recreation.gov',type:'established'}};
  const usfs = {type:'Feature',geometry:{type:'Point',coordinates:[-120.002,48.7012]},properties:{id:'usfs:77',name:'Tiffany Springs Campground',camping_activity:'Campground Camping',schema_version:3,field_provenance:{cost:'x'},fee_status:'free',cost:0,fee_text:'No fee.',fee_source:'US Forest Service',fee_checked:'2026-10-28',amenities:[],rig_friendly:[]}};
  const out = DQ.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:[ridb,usfs]}).features;
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual([out[0].properties.fee_status, out[0].properties.fee_text, out[0].properties.fee_source], ['free', 'No fee.', 'US Forest Service']);
  const lone = DQ.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:[{...usfs,properties:{...usfs.properties,name:'Geisinger',fee_status:'conditional',cost:null}}]}).features[0];
  assert.strictEqual(lone.properties.fee_status, 'conditional');
  assert.strictEqual(DQ.applyFilters([lone], {rigLength: 30}).length, 0);
  assert.strictEqual(DQ.applyFilters([lone], {rigLength: 30, rigIncludeUnknown: true}).length, 1);
});

test('rig length and hookups must be met by one campsite, not different sites in a campground', () => {
  const DQ = require('../data-quality.js');
  const mk = (fid) => ({type: 'Feature', geometry: {type: 'Point', coordinates: [-110, 40]}, properties: {id: `ridb:${fid}`, facility_id: fid, amenities: [], rig_friendly: [], rating: null}});
  // Campground 1: a 50 ft unpowered site and a 20 ft powered site. Campground 2: one 45 ft powered site. Campground 3: lengths not documented, one powered site.
  const table = {'1': {t: 2, r: 2, L: 50, g: [[20, 1, 1], [50, 0, 1]], e: 1}, '2': {t: 1, r: 1, L: 45, g: [[45, 1, 1]], e: 1}, '3': {t: 1, r: 1, L: 0, g: [[0, 1, 1]], e: 1}};
  const sites = ['1', '2', '3'].map(id => DQ.attachSiteDetails(mk(id), table));
  const ids = f => DQ.applyFilters(sites, f).map(s => s.properties.id);
  assert.deepStrictEqual(ids({rigLength: 40, hookups: ['electric']}), ['ridb:2']);
  assert.deepStrictEqual(ids({rigLength: 40}), ['ridb:1', 'ridb:2']);
  assert.deepStrictEqual(ids({hookups: ['electric']}), ['ridb:1', 'ridb:2', 'ridb:3']);
  assert.deepStrictEqual(ids({rigLength: 40, hookups: ['electric'], rigIncludeUnknown: true}), ['ridb:2', 'ridb:3']);
  assert.strictEqual(DQ.matchingSites(sites[0].properties, 40, ['electric']), 0);
  assert.strictEqual(DQ.matchingSites(sites[1].properties, 40, ['electric']), 1);
});
