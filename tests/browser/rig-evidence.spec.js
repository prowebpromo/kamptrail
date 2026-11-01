const {test,expect}=require('@playwright/test');
// Rig-tag ownership (2.32.0): the popup rig line reads only the listing's own sources, lists merged
// elements' rig tags as not used, keeps negatives and conflicts, and the Tents and Trailers filters agree.
test.use({serviceWorkers:'block',viewport:{width:390,height:844}});
const camp=(id,coords,props)=>({type:'Feature',geometry:{type:'Point',coordinates:coords},properties:{id,name:id,schema_version:3,amenities:[],rig_friendly:[],...props}});
const features=[
  // Own element: tents yes, caravans no. A merged RV loop says the opposite and stays its own.
  camp('osm:way:801',[-75.10,43.00],{name:'Own Rig Campground',osm_id:801,osm_type:'way',tourism:'camp_site',source:'openstreetmap',tents:'yes',caravans:'no',
    source_ids:['osm:way:801','osm:way:802'],member_evidence:[{source_record_id:'osm:way:802',source:'OpenStreetMap contributors',fields:{tents:'no',caravans:'yes'},retrieved_at:'2026-10-29T02:53:12Z',source_updated_at:null,source_url:'https://www.openstreetmap.org/way/802'}]}),
  // Recreation.gov host that absorbed an OSM element with tents and caravans. Nothing is its own.
  camp('ridb:901',[-75.12,43.01],{name:'Borrowed Rig Campground',facility_id:'901',source:'recreation.gov',type:'established',description:'A campground with camping.',
    source_ids:['ridb:901','osm:way:902'],member_evidence:[{source_record_id:'osm:way:902',source:'OpenStreetMap contributors',fields:{tents:'yes',caravans:'yes'},retrieved_at:'2026-10-29T02:53:12Z',source_updated_at:null,source_url:'https://www.openstreetmap.org/way/902'}]}),
  // Own element says caravans yes, its Recreation.gov facility (exact alias) lists 0 RV-type sites of 12.
  camp('osm:way:903',[-75.14,43.02],{name:'Conflict Campground',osm_id:903,osm_type:'way',tourism:'camp_site',source:'openstreetmap',tents:'yes',caravans:'yes',legacy_ids:['ridb:904']})
];
async function open(page,context){
  const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
  await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));
  const json=(r,data)=>r.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  await page.route('**/data/campsites/index.json',r=>json(r,{states:[{state:'NY',count:3}],total_sites:3}));
  await page.route('**/data/campsites/agency/index.json',r=>json(r,{version:1,states:[]}));
  await page.route('**/data/campsites/ridb-sites.json',r=>json(r,{version:2,facilities:{'901':{t:20,r:20,L:40,g:[[40,0,20]]},'904':{t:12,r:0,L:0}}}));
  await page.route('**/data/campsites/*_merged.geojson',r=>json(r,{type:'FeatureCollection',features}));
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:43.01,lng:-75.12,zoom:12})));
  await page.goto('/');
  await page.waitForFunction(()=>KampTrailData.getCampsiteById('osm:way:903')?.properties.ridb_rig_check);
}
async function rigBox(page,id){
  await page.evaluate(id=>KampTrailData.focusCampsite(id),id);
  const name=await page.evaluate(id=>KampTrailData.getCampsiteById(id).properties.name,id);
  const popup=page.locator('.kt-site-popup').filter({has:page.locator('h2',{hasText:name})}).last();await expect(popup).toBeVisible();
  return popup.locator('.kt-rig-evidence');
}
const visible=(page,filters)=>page.evaluate(f=>{KampTrailData.updateFilters(f);return DataQuality.applyFilters(KampTrailData.getAllCampsites(),KampTrailData.getCurrentFilters()).map(s=>s.properties.id).sort();},filters);

test('popup rig line uses only own sources and the Tents and Trailers filters agree',async({page,context})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page,context);
  let box=await rigBox(page,'osm:way:801');
  await expect(box.locator('[data-rig="tent"]')).toHaveAttribute('data-status','present');
  await expect(box.locator('[data-rig="tent"]')).toContainText('Tents: reported: OpenStreetMap element way/801 (tents=yes)');
  await expect(box.locator('[data-rig="trailer"]')).toContainText('Trailers and caravans: source says no');
  const members=box.locator('.kt-rig-members');await members.locator('summary').click();
  await expect(members).toContainText('Merged elements, rig tags not used for this listing (1)');
  await expect(members).toContainText('OpenStreetMap element way/802: caravans=yes, tents=no');
  box=await rigBox(page,'ridb:901');
  await expect(box).toHaveAttribute('data-state','no_source');
  await expect(box).toContainText('Rig types reported: No rig source for this listing.');
  await expect(box.locator('.kt-rig-members')).toContainText('(1)');
  box=await rigBox(page,'osm:way:903');
  await expect(box.locator('[data-rig="trailer"]')).toHaveAttribute('data-status','conflict');
  await expect(box.locator('[data-rig="trailer"]')).toContainText('Recreation.gov facility 904: 0 of 12 campsite records list RV or trailer equipment');
  expect(await visible(page,{rigSize:'tent'})).toEqual(['osm:way:801','osm:way:903']);
  expect(await visible(page,{rigSize:'trailer'})).toEqual([]);
  expect(errors).toEqual([]);
});

test('Spanish and French popups translate the rig frame and keep tags verbatim',async({page,context})=>{
  for(const [lang,none,members] of [['es','No hay ninguna fuente de vehículos para este lugar.','Elementos fusionados, etiquetas de vehículos no usadas para este lugar (1)'],['fr','Aucune source de types de véhicule pour ce lieu.','Éléments fusionnés, attributs de véhicule non utilisés pour ce lieu (1)']]){
    await page.addInitScript(l=>localStorage.setItem('kt_language',l),lang);
    await open(page,context);
    const box=await rigBox(page,'ridb:901');
    await expect(box).toContainText(none);await expect(box.locator('.kt-rig-members summary')).toHaveText(members);
    const own=await rigBox(page,'osm:way:801');await expect(own).toContainText('tents=yes');
  }
});
