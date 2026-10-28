const {test,expect}=require('@playwright/test');
const path=require('node:path');
const root=path.join(__dirname,'../..');
const site={type:'Feature',geometry:{type:'Point',coordinates:[-119.5,36.2]},properties:{id:'ridb:1',name:'Saved Camp',state:'CA',cost:null,fee_status:'unknown',amenities:[],rig_friendly:[]}};
async function scaffold(page) {
  await page.route('https://kamptrail.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body><div class="actions"><button id="filters">Filters</button><button id="trip">My Trip <span id="trip-count">(0)</span></button></div></body></html>'}));
  await page.goto('https://kamptrail.test/');
  await page.evaluate(()=>{
    window.escapeHtml=value=>{const div=document.createElement('div');div.textContent=String(value);return div.innerHTML;};
    window.showToast=()=>{};
    window.testMap={setView(){return this;}};
    window.KampTrailData={getCampsiteById(){return null;},loadStates:async()=>{}};
  });
}
test('namespaced GPX keeps disconnected segments separate and rejects non-GPX XML',async({page})=>{
  await scaffold(page);
  await page.addScriptTag({path:path.join(root,'gpx-importer.js')});
  const result=await page.evaluate(()=>{
    const xml='<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:wpt lat="40" lon="-74"><g:name>Camp</g:name></g:wpt><g:trk><g:name>Walk</g:name><g:trkseg><g:trkpt lat="40" lon="-74"/></g:trkseg><g:trkseg><g:trkpt lat="41" lon="-75"/></g:trkseg></g:trk></g:gpx>';
    const parsed=KampTrailGPX.parseGPX(xml);
    let rejected=false;try{KampTrailGPX.parseGPX('<html/>');}catch{rejected=true;}
    return {parsed,rejected};
  });
  expect(result.parsed.waypoints[0].name).toBe('Camp');
  expect(result.parsed.tracks).toHaveLength(2);
  expect(result.parsed.tracks.map(t=>t.points.length)).toEqual([1,1]);
  expect(result.rejected).toBe(true);
});
test('trip snapshots remain visible when the saved region is no longer loaded',async({page})=>{
  await scaffold(page);
  await page.evaluate(site=>localStorage.setItem('kt_trip',JSON.stringify([{id:site.properties.id,feature:site}])),site);
  await page.addScriptTag({path:path.join(root,'trip-planner.js')});
  await page.evaluate(()=>KampTrailTrip.init(testMap));
  await page.locator('#trip').click();
  await expect(page.locator('#kt-trip-list')).toContainText('Saved Camp');
  expect(await page.evaluate(()=>KampTrailTrip.getStops()[0].feature.geometry.coordinates)).toEqual([-119.5,36.2]);
});
test('legacy unresolved trip IDs stay visible and can be removed',async({page})=>{
  await scaffold(page);
  await page.evaluate(()=>localStorage.setItem('kt_trip',JSON.stringify(['CA-001'])));
  await page.addScriptTag({path:path.join(root,'trip-planner.js')});
  await page.evaluate(()=>KampTrailTrip.init(testMap));
  await page.locator('#trip').click();
  await expect(page.locator('#kt-trip-list')).toContainText('Saved stop CA-001');
  await page.locator('.kt-trip-del').click();
  await expect(page.locator('#trip-count')).toHaveText('(0)');
});
test('comparison does not advertise an unknown fee as free and removes legacy aliases',async({page})=>{
  await scaffold(page);
  await page.evaluate(site=>{
    localStorage.setItem('kt_compare_list',JSON.stringify(['CA-001']));
    window.KampTrailData.getCampsiteById=()=>site;
  },site);
  await page.addScriptTag({path:path.join(root,'campsite-compare.js')});
  await page.evaluate(()=>KampTrailCompare.init(testMap));
  await page.locator('#compare-btn').click();
  await expect(page.locator('#compare-drawer')).toContainText('Fee unknown');
  await expect(page.locator('#compare-drawer')).not.toContainText('FREE');
  await page.locator('[data-remove-index]').click();
  expect(await page.evaluate(()=>KampTrailCompare.getCompareList())).toEqual([]);
});
