const {test,expect}=require('@playwright/test');
const path=require('node:path');
const {saveNamedResult,checkSourceListingCount}=require('../../scripts/smoke-deployment.js');
const script=path.resolve(__dirname,'../../trip-planner.js');
const site={type:'Feature',geometry:{type:'Point',coordinates:[-119.5,36.2]},properties:{id:'ridb:1',name:'Saved Camp',state:'CA',cost:null,fee_status:'unknown'}};
async function scaffold(page,current=site) {
  await page.route('https://kamptrail-saved.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body><div id="app"><button id="trip">Saved stops <span id="trip-count">(0)</span></button></div></body></html>'}));
  await page.goto('https://kamptrail-saved.test/');
  await page.evaluate(current=>{
    window.testErrors=[];window.testLoads=[];window.testCurrent=current;
    window.showToast=message=>testErrors.push(message);
    window.testMap={setView(coords,zoom){window.testView={coords,zoom};return this;}};
    window.KampTrailData={getCampsiteById:()=>testCurrent,loadStates:async codes=>testLoads.push(codes),getLoadStatus:()=>({totalSites:0,loadedStates:[],loading:false}),focusCampsite:()=>false};
    window.L={marker(coords){const marker={coords,addTo(){return this;},bindPopup(popup){window.testPopup=popup;return this;},openPopup(){window.testMarker=this;return this;},remove(){window.testRemoved=true;}};return marker;}};
  },current);
}
async function init(page) {await page.addScriptTag({path:script});await page.evaluate(()=>KampTrailTrip.init(testMap));}

test('saving is deduplicated and retained as a location snapshot after reload',async({page})=>{
  await scaffold(page);await init(page);
  await page.evaluate(()=>{KampTrailTrip.addStop('ridb:1');KampTrailTrip.addStop('ridb:1');});
  await expect(page.locator('#trip-count')).toHaveText('(1)');
  await expect(page.locator('#kt-trip-list')).toContainText('Saved Camp');
  await scaffold(page,null);await init(page);await page.locator('#trip').click();
  await expect(page.locator('#kt-trip-list')).toContainText('Saved Camp');
  expect(await page.evaluate(()=>KampTrailTrip.getStops()[0].feature.geometry.coordinates)).toEqual([-119.5,36.2]);
  await expect(page.getByRole('link',{name:'Directions to Saved Camp in Google Maps'})).toHaveAttribute('href','https://www.google.com/maps/dir/?api=1&destination=36.2,-119.5');
});

test('saved location can be viewed even when its source region is not loaded',async({page})=>{
  await scaffold(page,null);await page.evaluate(site=>localStorage.setItem('kt_trip',JSON.stringify([{id:site.properties.id,feature:site}])),site);
  await init(page);await page.locator('#trip').click();await page.getByRole('button',{name:'View on map'}).click();
  await expect(page.locator('#kt-trip-drawer')).toBeHidden();
  expect(await page.evaluate(()=>testView)).toEqual({coords:[36.2,-119.5],zoom:12});
  expect(await page.evaluate(()=>testPopup.textContent)).toContain('Saved Camp');
  expect(await page.evaluate(()=>document.getElementById('app').inert)).toBe(false);
});

test('legacy stop recovery waits for the data loader and resolves an alias without rewriting it',async({page})=>{
  await scaffold(page,null);await page.evaluate(()=>localStorage.setItem('kt_trip',JSON.stringify(['CA-001'])));await init(page);
  expect(await page.evaluate(()=>testLoads)).toEqual([]);
  await page.evaluate(()=>{KampTrailData.getLoadStatus=()=>({totalSites:1,loadedStates:['NY'],loading:false});window.dispatchEvent(new Event('kamptrail:dataupdated'));});
  await expect.poll(()=>page.evaluate(()=>testLoads.length)).toBe(1);
  await page.evaluate(site=>{testCurrent=site;window.dispatchEvent(new Event('kamptrail:dataupdated'));},site);
  await page.locator('#trip').click();await expect(page.locator('#kt-trip-list')).toContainText('Saved Camp');
  // 2.33.0: the stored id is kept; the listing it resolves to is shown.
  expect(await page.evaluate(()=>KampTrailTrip.getStops()[0].id)).toBe('CA-001');
  expect(await page.evaluate(()=>KampTrailTrip.getStops()[0].feature.properties.id)).toBe('ridb:1');
});

test('mobile dialog closes with Escape, restores focus, and stays above the app',async({page})=>{
  await page.setViewportSize({width:390,height:844});await scaffold(page);await init(page);
  await page.locator('#trip').click();
  await expect(page.locator('#kt-trip-close')).toBeFocused();
  const rect=await page.locator('#kt-trip-drawer').boundingBox();expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.height).toBeLessThanOrEqual(844);
  await page.keyboard.press('Shift+Tab');await expect(page.locator('#kt-trip-import')).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.locator('#kt-trip-close')).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.locator('#kt-trip-drawer')).toBeHidden();await expect(page.locator('#trip')).toBeFocused();
});

test('storage failure is explicit and an unsafe campsite name renders only as text',async({page})=>{
  await scaffold(page,{...site,properties:{...site.properties,name:'<img src=x onerror=alert(1)>'}});await init(page);
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('Blocked');};KampTrailTrip.addStop('ridb:1');});
  expect(await page.evaluate(()=>testErrors.join(' '))).toContain('only while this page stays open');
  await expect(page.locator('.kt-saved-note')).toContainText('Browser storage is unavailable');
  await expect(page.locator('#kt-trip-list')).toContainText('<img src=x onerror=alert(1)>');expect(await page.locator('#kt-trip-list img').count()).toBe(0);
  await page.getByRole('button',{name:'Remove <img src=x onerror=alert(1)>'}).click();await expect(page.locator('#trip-count')).toHaveText('(0)');
});

test('clear removes all saved stops and hides the empty clear control',async({page})=>{
  await scaffold(page);await init(page);await page.evaluate(()=>KampTrailTrip.addStop('ridb:1'));
  page.on('dialog',dialog=>dialog.accept());await page.locator('#kt-trip-clear').click();
  await expect(page.locator('#trip-count')).toHaveText('(0)');await expect(page.locator('#kt-trip-clear')).toBeHidden();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('kt_trip')))).toEqual([]);
});

test('deployment smoke saves the named card after results reorder',async({page})=>{
  await page.setContent('<div id="result-list"><article class="site-card"><h3>Camp [A].*</h3><button>Save stop</button></article><article class="site-card"><h3>Camp B</h3><button>Save stop</button></article></div><div id="kt-trip-list"></div>');
  await page.evaluate(()=>document.querySelectorAll('.site-card button').forEach(button=>button.onclick=()=>{document.querySelector('#kt-trip-list').textContent=button.closest('.site-card').querySelector('h3').textContent;}));
  const name=await page.locator('#result-list h3').first().textContent();
  await page.evaluate(()=>{const list=document.querySelector('#result-list');list.prepend(list.lastElementChild);});
  await expect(page.locator('#result-list h3').first()).toHaveText('Camp B');
  await saveNamedResult(page,name);
  await expect(page.locator('#kt-trip-list')).toHaveText('Camp [A].*');
});

test('deployment smoke distinguishes source listings from the deduplicated catalogue',async({page})=>{
  await page.setContent('<p id="catalogue-summary">About 69,574 source listings across 50 states, before duplicates are merged.</p>');
  await page.evaluate(()=>{window.KampTrailData={getStateTotals:()=>({NY:40000,CA:29574})};});
  expect(await checkSourceListingCount(page)).toBe(69574);
  await page.locator('#catalogue-summary').evaluate(el=>{el.textContent='About 33,286 source listings across 50 states.';});
  await expect(checkSourceListingCount(page)).rejects.toThrow('Data panel source-listing count mismatch');
});

test('deployment smoke does not accept unavailable source totals as a zero count',async({page})=>{
  await page.setContent('<p id="catalogue-summary">Catalogue count is unavailable. Source coverage is incomplete.</p>');
  await page.evaluate(()=>{window.KampTrailData={getStateTotals:()=>({})};});
  await expect(checkSourceListingCount(page)).rejects.toThrow('Source catalogue totals unavailable');
});
test('after-stay prompt shows only for past dated campsite stops, opens the review form and stays dismissed',async({page})=>{
  await scaffold(page);
  const day=n=>{const d=new Date();d.setDate(d.getDate()+n);const p=x=>String(x).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
  await page.evaluate(({past,future})=>{
    localStorage.setItem('kt_trip',JSON.stringify([
      {id:'ridb:1',feature:testCurrent,note:'',arrive:past,depart:past},
      {id:'ridb:2',feature:{...testCurrent,properties:{...testCurrent.properties,id:'ridb:2',name:'Future Camp'}},note:'',arrive:future,depart:future},
      {id:'ridb:3',feature:{...testCurrent,properties:{...testCurrent.properties,id:'ridb:3',name:'Undated Camp'}},note:'',arrive:'',depart:''}]));
    window.KampTrailData.getCampsiteById=id=>({...testCurrent,properties:{...testCurrent.properties,id,name:{'ridb:1':'Saved Camp','ridb:2':'Future Camp','ridb:3':'Undated Camp'}[id]}});
    window.reviewOpened=[];window.KampTrailCommunity={open:site=>reviewOpened.push(site.properties.id)};
  },{past:day(-1),future:day(3)});
  await init(page);await page.locator('#trip').click();
  const prompts=page.locator('.kt-stay-prompt');
  await expect(prompts).toHaveCount(1);
  await page.getByRole('button',{name:'Write a review for Saved Camp'}).click();
  expect(await page.evaluate(()=>reviewOpened)).toEqual(['ridb:1']);
  await expect(page.locator('#kt-trip-drawer')).toHaveAttribute('aria-hidden','true');
  await page.locator('#trip').click();
  await page.getByRole('button',{name:'Dismiss the review reminder for Saved Camp'}).click();
  await expect(prompts).toHaveCount(0);
  expect(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('kt_stay_prompts_v1')))))
    .toEqual([`ridb:1|${day(-1)}`]);
  await page.reload();await scaffold(page);
  await page.evaluate(()=>{window.KampTrailCommunity={open(){}};});
  await init(page);await page.locator('#trip').click();
  await expect(page.locator('.kt-stay-prompt')).toHaveCount(0);
});
test('after-stay prompt survives corrupted reminder storage',async({page})=>{
  await scaffold(page);
  await page.evaluate(()=>{const d=new Date(Date.now()-86400000),p=x=>String(x).padStart(2,'0'),v=`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
    localStorage.setItem('kt_trip',JSON.stringify([{id:'ridb:1',feature:testCurrent,note:'',arrive:v,depart:v}]));localStorage.setItem('kt_stay_prompts_v1','{not json');});
  await init(page);await page.locator('#trip').click();
  await expect(page.locator('.kt-stay-prompt')).toHaveCount(1);
  expect(await page.evaluate(()=>testErrors)).toEqual([]);
});
