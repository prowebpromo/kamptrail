const {test,expect}=require('@playwright/test');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
test.beforeEach(async({context})=>{await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));});
const national=page=>page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:39.8,lng:-98.6,zoom:4})));

test('national view downloads no state listings or search index and shows state totals',async({page})=>{
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await national(page);await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#result-summary')).toContainText('Zoomed out',{timeout:15000});
  await expect.poll(()=>page.locator('.kt-state-bubble').count()).toBeGreaterThan(40);
  await page.waitForTimeout(1500);
  expect(requests.filter(u=>/_merged\.geojson|agency\/[A-Z]{2}\.geojson/.test(u))).toEqual([]);
  expect(requests.some(u=>u.includes('search-index.json'))).toBe(false);
  expect(await page.evaluate(()=>KampTrailData.getLoadStatus().totalSites)).toBe(0);
  await expect(page.locator('#result-list')).toContainText('Zoom in, search, or select a state bubble');
});

test('selecting a state bubble zooms in and loads only nearby states',async({page})=>{
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await national(page);await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>page.locator('.kt-state-bubble').count()).toBeGreaterThan(40);
  await page.locator('.kt-state-bubble[title^="CO:"]').click();
  await page.waitForFunction(()=>KampTrailData.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading,null,{timeout:30000});
  expect(await page.evaluate(()=>map.getZoom())).toBeGreaterThanOrEqual(7);
  const loaded=[...new Set(requests.map(u=>u.match(/campsites\/([A-Z]{2})_merged/)?.[1]).filter(Boolean))];
  expect(loaded).toContain('CO');expect(loaded.length).toBeLessThanOrEqual(6);
  await expect(page.locator('#result-summary')).toContainText('in this view');
});

test('national search fetches the name index on first search only and opens a campsite',async({page})=>{
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await national(page);await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#result-summary')).toContainText('Zoomed out',{timeout:15000});
  expect(requests.some(u=>u.includes('search-index.json'))).toBe(false);
  await page.locator('#destination').fill('North Fruita Desert');await page.locator('#search-form button').click();
  await page.getByRole('button',{name:/North Fruita Desert.*Campsite/}).first().click();
  await expect(page.locator('.leaflet-popup')).toContainText('Fruita',{timeout:30000});
  expect(requests.filter(u=>u.includes('search-index.json')).length).toBe(1);
});

test('a shared link opens from a zoomed-out saved view with the full dataset',async({page})=>{
  await national(page);
  const id=await (async()=>{await page.goto('/',{waitUntil:'domcontentloaded'});return page.evaluate(async()=>{const d=await (await fetch('data/campsites/search-index.json')).json();return d.sites.find(s=>s.id.startsWith('usfs:')&&s.states.length===1).id;});})();
  await page.goto(`/#site=${encodeURIComponent(id)}`,{waitUntil:'domcontentloaded'});
  await expect(page.locator('.leaflet-popup')).toBeVisible({timeout:30000});
  await expect(page.locator('.leaflet-popup')).toContainText('US Forest Service');
});

test('state jump opens at listing zoom and filters apply to the full dataset',async({page})=>{
  await national(page);await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.locator('#state-select').selectOption('TX');
  await page.waitForFunction(()=>KampTrailData.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading,null,{timeout:30000});
  expect(await page.evaluate(()=>map.getZoom())).toBeGreaterThanOrEqual(7);
  await page.locator('#filters').click();await page.locator('[name="f-cost"][value="free"]').check();
  expect(await page.evaluate(()=>KampTrailData.getVisibleCampsites().every(s=>s.properties.fee_status==='free'))).toBe(true);
  await page.evaluate(()=>map.setZoom(5));
  await expect(page.locator('#result-summary')).toContainText('Zoomed out');
  expect(await page.evaluate(()=>KampTrailData.getVisibleCampsites().length)).toBe(0);
});

test('state bubbles do not overlap at national zoom, and moved bubbles keep a leader line',async({page})=>{
  await national(page);await page.setViewportSize({width:1280,height:800});await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>page.locator('.kt-state-bubble').count()).toBeGreaterThan(40);
  for(const zoom of [4,5,6]){
    await page.evaluate(z=>map.setView([40,-80],z),zoom);await page.waitForTimeout(400);
    const boxes=await page.locator('.kt-state-bubble span').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,r:r.width/2,t:e.parentElement.title.slice(0,2)};}));
    const overlaps=[];
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(Math.hypot(a.x-b.x,a.y-b.y)<a.r+b.r)overlaps.push(a.t+'/'+b.t);}
    expect(overlaps,`zoom ${zoom}`).toEqual([]);
  }
  await page.evaluate(()=>map.setView([40,-80],4));await page.waitForTimeout(400);
  const moved=await page.evaluate(()=>KampTrailData._overviewMoved());
  expect(moved.length).toBeGreaterThan(0);
  expect(moved.every(m=>m.leader)).toBe(true);
  await page.locator('.kt-state-bubble[title^="RI:"]').click();
  await expect.poll(()=>page.evaluate(()=>map.getZoom())).toBeGreaterThanOrEqual(8);
  expect(await page.evaluate(()=>map.getBounds().contains([41.7,-71.5]))).toBe(true);
});

test('explicitly focusing a second campsite replaces an already open popup',async({page,context})=>{
 await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64')}));
 await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:40,lng:-105.5,zoom:9})));
 await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.KampTrailData?.getLoadStatus().totalSites>1&&!KampTrailData.getLoadStatus().loading);
 const sites=await page.evaluate(()=>{const all=KampTrailData.getAllCampsites(),first=all[0],second=all.find(f=>f.properties.name!==first.properties.name);return[first,second].map(f=>({id:f.properties.id,name:f.properties.name}));});
 await page.evaluate(id=>KampTrailData.focusCampsite(id),sites[0].id);await expect(page.locator('.kt-site-popup h3')).toHaveText(sites[0].name);
 await page.evaluate(id=>KampTrailData.focusCampsite(id),sites[1].id);await expect(page.locator('.kt-site-popup h3')).toHaveText(sites[1].name);
});
