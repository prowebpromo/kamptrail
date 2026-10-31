const {test,expect}=require('@playwright/test');
const ridbSource=require('../../data/campsites/ridb-amenities.json').source;
const usfsSource=require('../../data/campsites/usfs-site-amenities.json').source;
test.use({serviceWorkers:'block',viewport:{width:390,height:844}});
const LAYER='https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0';
async function open(page,context,{facility,name}){
  const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
  await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));
  const json=(r,data)=>r.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  const usfs={version:1,source:{...usfsSource,retrieved:'2026-10-31'},facilities:{'123':{conflicts:[],records:[{cn:'5005.1',name:'Pine <img src=x> Campground',type:'CAMPGROUND',
    water:{text:'Yes, drinking water is available from a hand pump',class:'drinking_water',qualifiers:['hand_pump']},toilet:{text:'Yes',class:'unknown'},
    season:{open_season:'05/15 - 09/30',description:'Water off in winter'},updated:'2026-08-05',edw_modified:'2026-08-06'}]}}};
  const ridb={version:1,source:ridbSource,facilities:{'123':{sites:2,amenities:{toilet:{reported:1,negative:0,unknown:1,conflict:0,qualifiers:{seasonal:1}}}}}};
  const camp={type:'Feature',geometry:{type:'Point',coordinates:[-75.1,43]},properties:{id:`ridb:${facility}`,facility_id:facility,name,schema_version:3,type:'established',amenities:[],rig_friendly:[]}};
  await page.route('**/data/campsites/index.json',r=>json(r,{states:[{state:'NY',count:1}],total_sites:1}));
  await page.route('**/data/campsites/agency/index.json',r=>json(r,{version:1,states:[]}));
  await page.route('**/data/campsites/ridb-sites.json',r=>json(r,{version:2,facilities:{}}));
  await page.route('**/data/campsites/ridb-amenities.json',r=>json(r,ridb));
  await page.route('**/data/campsites/usfs-site-amenities.json',r=>json(r,usfs));
  await page.route('**/data/campsites/*_merged.geojson',r=>json(r,{type:'FeatureCollection',features:[camp]}));
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:43,lng:-75.1,zoom:11})));
  const evidenceRequested=page.waitForResponse('**/data/campsites/usfs-site-amenities.json');
  await page.goto('/');
  await evidenceRequested;
  await page.waitForFunction(id=>KampTrailData.getCampsiteById(id),`ridb:${facility}`);
  if(facility==='123')await page.waitForFunction(()=>{const p=KampTrailData.getCampsiteById('ridb:123').properties;return p.usfs_site_evidence&&p.ridb_amenity_evidence;});
  else await page.waitForTimeout(500);
  await page.evaluate(id=>KampTrailData.focusCampsite(id),`ridb:${facility}`);
  return page.locator('.kt-site-popup');
}
test('a matched campground shows the Forest Service text, credit and date apart from Recreation.gov records',async({page,context})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const popup=await open(page,context,{facility:'123',name:'Pine Campground'});
  await expect(popup.locator('img')).toHaveCount(0);
  const section=popup.locator('.kt-usfs-site');
  await section.locator('summary').click();
  await expect(section).toContainText('Water (Forest Service text):');
  await expect(section).toContainText('“Yes, drinking water is available from a hand pump”');
  await expect(section).toContainText('Normalized: Drinking water stated, hand pump');
  await expect(section).toContainText('Restrooms (Forest Service text):');
  await expect(section).toContainText('“Yes”');
  await expect(section).toContainText('No normalized label: the wording is ambiguous.');
  await expect(section).toContainText('Source: USDA Forest Service Recreation Site record, updated 2026-08-05.');
  await expect(section).toContainText('Data retrieved 2026-10-31. CC BY 4.0.');
  await expect(section).toContainText('Season text on this record (context only, not about water or restrooms): Open season: 05/15 - 09/30; Season description: Water off in winter');
  await expect(section.getByRole('link',{name:'Forest Service source layer'})).toHaveAttribute('href',LAYER);
  // The Recreation.gov campsite-record section stays separate and unchanged.
  const ridb=popup.locator('.kt-ridb-amenities');await expect(ridb).toHaveCount(1);
  await ridb.locator('summary').click();
  await expect(ridb).toContainText('mentioned in 1 of 2 records');
  await expect(ridb).not.toContainText('Forest Service');await expect(section).not.toContainText('mentioned in');
  expect(await popup.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  expect(await page.evaluate(()=>KampTrailData.getCampsiteById('ridb:123').properties.amenities)).toEqual([]);
  expect(await page.evaluate(()=>{KampTrailData.updateFilters({amenities:['water']});return KampTrailData.getVisibleCampsites().length;})).toBe(0);
  expect(errors).toEqual([]);
});
test('an unmatched campground shows nothing from the Forest Service layer',async({page,context})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const popup=await open(page,context,{facility:'999',name:'Other Campground'});
  await expect(popup).toContainText('Other Campground');
  await expect(popup.locator('.kt-usfs-site')).toHaveCount(0);
  await expect(popup).not.toContainText('Forest Service');
  expect(await page.evaluate(()=>KampTrailData.getCampsiteById('ridb:999').properties.usfs_site_evidence)).toBeUndefined();
  expect(errors).toEqual([]);
});
