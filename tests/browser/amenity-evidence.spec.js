const {test,expect}=require('@playwright/test');
// R8 (2.31.0): the popup states source, scope and date for every amenity statement, and the
// amenity filters show exactly the listings whose popup reports that amenity at a valid scope.
const ridbSource=require('../../data/campsites/ridb-amenities.json').source;
const usfsSource=require('../../data/campsites/usfs-site-amenities.json').source;
test.use({serviceWorkers:'block',viewport:{width:390,height:844}});
const g=reported=>({reported,negative:0,unknown:0,conflict:0,qualifiers:{}});
const camp=(id,coords,props)=>({type:'Feature',geometry:{type:'Point',coordinates:coords},properties:{id,name:id,schema_version:3,amenities:[],rig_friendly:[],...props}});
const features=[
  // Own OSM element with tags, plus a merged site node whose tags stay attributed to it.
  camp('osm:way:501',[-75.10,43.00],{name:'Own Element Campground',osm_id:501,osm_type:'way',tourism:'camp_site',source:'openstreetmap',source_retrieved_at:'2026-10-29T02:53:12Z',toilets:'yes',drinking_water:'no',shower:'customers',
    source_ids:['osm:way:501','osm:node:502'],member_evidence:[{source_record_id:'osm:node:502',source:'OpenStreetMap contributors',fields:{sanitary_dump_station:'yes',check_date:'2024-06-01'},retrieved_at:'2026-10-29T02:53:12Z',source_updated_at:null,source_url:'https://www.openstreetmap.org/node/502'}]}),
  // Recreation.gov host: toilets on 3 of 40 campsite records, and a fitting 40 ft electric site.
  camp('ridb:601',[-75.12,43.01],{name:'Record Campground',facility_id:'601',source:'recreation.gov',type:'established',description:'A campground with camping.'}),
  // Recreation.gov host with a Forest Service site record saying vault toilets.
  camp('ridb:602',[-75.14,43.02],{name:'Site Record Campground',facility_id:'602',source:'recreation.gov',type:'established',description:'A campground with camping.'}),
  // No amenity source at all.
  camp('blm-area:700',[-75.16,43.03],{name:'Quiet Campground',source:'blm',type:'established',camping_activity:'Camping'})
];
async function open(page,context){
  const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
  await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));
  const json=(r,data)=>r.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  const ridb={version:1,source:ridbSource,facilities:{'601':{sites:40,amenities:{toilet:g(3)}},'602':{sites:0,amenities:{}}}};
  const usfs={version:1,source:{...usfsSource,retrieved:'2026-10-31'},facilities:{'602':{conflicts:[],records:[{cn:'1',name:'Site Record Campground',type:'CAMPGROUND',toilet:{text:'Vault toilet(s)',class:'vault_or_pit'},updated:null,edw_modified:null}]}}};
  await page.route('**/data/campsites/index.json',r=>json(r,{states:[{state:'NY',count:4}],total_sites:4}));
  await page.route('**/data/campsites/agency/index.json',r=>json(r,{version:1,states:[]}));
  await page.route('**/data/campsites/ridb-sites.json',r=>json(r,{version:2,facilities:{'601':{t:40,r:40,L:40,g:[[40,1,1],[20,0,39]],e:1},'602':{t:10,r:10,L:40,g:[[40,0,10]]}}}));
  await page.route('**/data/campsites/ridb-amenities.json',r=>json(r,ridb));
  await page.route('**/data/campsites/usfs-site-amenities.json',r=>json(r,usfs));
  await page.route('**/data/campsites/*_merged.geojson',r=>json(r,{type:'FeatureCollection',features}));
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:43.015,lng:-75.13,zoom:12})));
  const usfsLoaded=page.waitForResponse('**/data/campsites/usfs-site-amenities.json'),ridbLoaded=page.waitForResponse('**/data/campsites/ridb-amenities.json');
  await page.goto('/');await usfsLoaded;await ridbLoaded;
  await page.waitForFunction(()=>KampTrailData.getCampsiteById('ridb:601')?.properties.ridb_amenity_evidence&&KampTrailData.getCampsiteById('ridb:602')?.properties.usfs_site_evidence);
}
async function popupFor(page,id){
  await page.evaluate(id=>KampTrailData.focusCampsite(id),id);
  const name=await page.evaluate(id=>KampTrailData.getCampsiteById(id).properties.name,id);
  const popup=page.locator('.kt-site-popup').filter({has:page.locator('h2',{hasText:name})}).last();await expect(popup).toBeVisible();
  return popup.locator('.kt-amenity-evidence');
}
// The live map filter over every loaded listing (the view may be zoomed in on one popup).
const visible=(page,filters)=>page.evaluate(f=>{KampTrailData.updateFilters(f);return DataQuality.applyFilters(KampTrailData.getAllCampsites(),KampTrailData.getCurrentFilters()).map(s=>s.properties.id).sort();},filters);

test('popup amenity evidence shows source, scope and date, and the filters agree with it',async({page,context})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page,context);
  let box=await popupFor(page,'osm:way:501');
  await expect(box).not.toContainText('Amenities reported');
  await expect(box.locator('[data-amenity="toilet"]')).toHaveAttribute('data-status','present');
  await expect(box.locator('[data-amenity="toilet"]')).toContainText('Toilets: reported: OpenStreetMap element way/501 (whole mapped element · value “yes” · date unknown)');
  await expect(box.locator('[data-amenity="water"]')).toContainText('Drinking water: source says no');
  await expect(box.locator('[data-amenity="shower"]')).toContainText('Showers: value not recognized');
  await expect(box.locator('[data-amenity="dump"]')).toContainText('Dump station: unknown');
  await expect(box.locator('.kt-osm-amenities')).toContainText('Survey: date unknown. Retrieved: 2026-10-29.');
  await expect(box.locator('.kt-osm-amenities a')).toHaveAttribute('href','https://www.openstreetmap.org/way/501');
  // The merged site node's dump station stays its own, visible and unused.
  const members=box.locator('.kt-amenity-members');await members.locator('summary').click();
  await expect(members).toContainText('Merged elements, not used for this listing (1)');
  await expect(members).toContainText('OpenStreetMap element node/502: check_date=2024-06-01, sanitary_dump_station=yes (Survey: 2024-06-01. Retrieved: 2026-10-29.)');
  box=await popupFor(page,'ridb:601');
  await expect(box.locator('[data-amenity="toilet"]')).toContainText('Toilets: reported: Recreation.gov facility 601 (3 of 40 campsite records, not every site · date unknown)');
  box=await popupFor(page,'ridb:602');
  await expect(box.locator('[data-amenity="toilet"]')).toContainText('Toilets: reported: Forest Service site record: Site Record Campground (site record · value “Vault toilet(s)” · date unknown)');
  box=await popupFor(page,'blm-area:700');
  await expect(box).toHaveAttribute('data-state','no_source');await expect(box).toContainText('Amenity evidence: No amenity source for this listing.');
  // Filters: the same evidence, at its scope.
  expect(await visible(page,{amenities:['toilet']})).toEqual(['osm:way:501','ridb:601','ridb:602']);
  expect(await visible(page,{amenities:['water']})).toEqual([]);
  expect(await visible(page,{amenities:['dump']})).toEqual([]);
  expect(await visible(page,{amenities:['shower']})).toEqual([]);
  // Length filter: 601's fitting site and its toilet records are not the same campsite record. 602's site record is campground-wide.
  expect(await visible(page,{rigLength:35})).toEqual(['ridb:601','ridb:602']);
  expect(await visible(page,{amenities:['toilet'],rigLength:35})).toEqual(['ridb:602']);
  expect(await visible(page,{amenities:['toilet'],hookups:['electric']})).toEqual([]);
  await visible(page,{rigLength:35});
  box=await popupFor(page,'ridb:601');
  await expect(box).toContainText('A campsite length or hookup filter is on. Recreation.gov campsite-record amenities do not count toward amenity filters then');
  expect(await page.locator('.kt-site-popup').last().evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  expect(errors).toEqual([]);
});

test('Spanish and French popups translate the evidence frame and keep source words verbatim',async({page,context})=>{
  for(const [lang,present,unknown,none] of [['es','informado','fecha desconocida','No hay ninguna fuente de servicios para este lugar.'],['fr','signalé','date inconnue','Aucune source d’équipements pour ce lieu.']]){
    await page.addInitScript(l=>localStorage.setItem('kt_language',l),lang);
    await open(page,context);
    let box=await popupFor(page,'osm:way:501');
    await expect(box.locator('[data-amenity="toilet"]')).toContainText(present);await expect(box.locator('[data-amenity="toilet"]')).toContainText(unknown);
    await expect(box.locator('.kt-osm-amenities')).toContainText('drinking_water=no, shower=customers, toilets=yes');
    box=await popupFor(page,'blm-area:700');await expect(box).toContainText(none);
  }
});
