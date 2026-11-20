const {test, expect} = require('@playwright/test');
const {bindCampsiteFixture} = require('./helpers/campsite-fixture');
test.use({serviceWorkers:'block'});

test('published carrier maps load on selection, classify the center and preserve unknown areas', async ({page}) => {
  const region = {id:'RI',bounds:[-72,41,-71,42],minZoom:6,maxZoom:9};
  const manifest = {schema:1,release:'2024-06-30-example',asOf:'2024-06-30',retrievedAt:'2025-01-01',
    technology:'4G LTE',environment:'Outdoor stationary',carriers:['att','verizon','t-mobile'].map(id=>({id,regions:[region]}))};
  await bindCampsiteFixture(page,{states:['RI']});
  await page.route('**/data/fcc-coverage/manifest.json', route => route.fulfill({json:manifest}));
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:41.55,lng:-71.5,zoom:8})));
  await page.goto('/');
  const fixtures = await page.evaluate(() => ['#1860b0','#707070'].map(color => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0,0,256,256);
    return c.toDataURL('image/png').split(',')[1];
  }));
  const carrierRequests = [];
  await page.route('**/data/fcc-coverage/**/*.png', route => {
    const url=route.request().url(), carrier=['att','verizon','t-mobile'].find(id=>url.includes('/'+id+'/'));
    carrierRequests.push(carrier);
    if (carrier === 't-mobile') return route.fulfill({status:503,body:''});
    return route.fulfill({contentType:'image/png',body:Buffer.from(fixtures[carrier==='att'?0:1],'base64')});
  });
  await page.evaluate(()=>window.KampTrailMapLoader.start());
  await page.locator('#map').scrollIntoViewIfNeeded();
  await page.getByRole('button',{name:'Map layers',exact:true}).press('Enter');
  const select=page.getByRole('combobox',{name:'FCC mobile coverage'}), out=page.locator('#fcc-coverage-readout');
  await expect(select).toHaveValue(''); await expect(out).toBeHidden(); expect(carrierRequests).toEqual([]);
  await select.selectOption('att'); await expect(out).toContainText('Map center: modeled coverage.');
  await expect(out).toContainText('Older filing, not current.'); expect([...new Set(carrierRequests)]).toEqual(['att']);
  await select.selectOption('verizon'); await expect(out).toContainText('Map center: no modeled coverage.');
  await select.selectOption('t-mobile'); await expect(out).toContainText('Map center: coverage tile unavailable.');
  await page.evaluate(()=>map.setView([37,-110],12,{animate:false}));
  await expect(out).toContainText('Map center: no published data here.');
  await page.getByRole('combobox',{name:'Published coverage area'}).selectOption('RI');
  await expect.poll(()=>page.evaluate(()=>map.getCenter().lng)).toBeCloseTo(-71.5,1);
  await select.selectOption(''); await expect(out).toBeHidden();
});
