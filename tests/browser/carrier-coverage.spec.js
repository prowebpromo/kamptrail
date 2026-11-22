const {test, expect} = require('@playwright/test');
const {bindCampsiteFixture} = require('./helpers/campsite-fixture');
test.use({serviceWorkers:'block'});

test('published carrier maps load on selection, classify the center and preserve unknown areas', async ({page}) => {
  const region = {id:'RI',bounds:[-72,41,-71,42],minZoom:6,maxZoom:9};
  const manifest = {schema:1,release:'2024-06-30-example',asOf:'2024-06-30',retrievedAt:'2025-01-01',
    technology:'4G LTE',environment:'Outdoor stationary',carriers:['att','verizon','t-mobile'].map(id=>({id,regions:[region]}))};
  await page.route(/^https:\/\/(?:[^/]+\.)?(?:openstreetmap\.org|nationalmap\.gov)\//, route => route.abort());
  await bindCampsiteFixture(page,{states:['RI']});
  await page.route('**/data/fcc-coverage/manifest.json', route => route.fulfill({json:manifest}));
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:41.55,lng:-71.5,zoom:8})));
  await page.goto('/', {waitUntil:'domcontentloaded'});
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
  await expect(out).toContainText('Published areas: Rhode Island.');
  await expect(out).toContainText('at least 5 Mbps down and 1 Mbps up. Signal inside your RV may differ.');
  await expect(out).toContainText('Older filing, not current.'); expect([...new Set(carrierRequests)]).toEqual(['att']);
  await select.selectOption('verizon'); await expect(out).toContainText('Map center: no modeled coverage.');
  await select.selectOption('t-mobile'); await expect(out).toContainText('Map center: coverage tile unavailable.');
  await page.evaluate(()=>map.setView([37,-110],12,{animate:false}));
  await expect(out).toContainText('Map center: no published data here.');
  await page.getByRole('combobox',{name:'Published coverage area'}).selectOption('RI');
  await expect.poll(()=>page.evaluate(()=>map.getCenter().lng)).toBeCloseTo(-71.5,1);
  await select.selectOption(''); await expect(out).toBeHidden();
});

// A small standards-compliant single-PNG archive: the root directory maps every native
// tile at zoom 10 to one image. Transport and decoding still use the production reader.
function oneColorArchive(png) {
  function varint(value) {
    const bytes = [];
    while (value >= 128) {
      bytes.push((value % 128) + 128);
      value = Math.floor(value / 128);
    }
    return [...bytes,value];
  }
  const firstTile = (4**10 - 1) / 3;
  const root = Buffer.from([1,...varint(firstTile),...varint(4**10),...varint(png.length),1]);
  const header = Buffer.alloc(127);
  header.write('PMTiles',0);
  header[7] = 3;
  for (const [offset,value] of [[8,127],[16,root.length],[24,127+root.length],[32,2],
      [56,129+root.length],[64,png.length],[72,4**10],[80,1],[88,1]]) {
    header.writeBigUInt64LE(BigInt(value),offset);
  }
  // Clustered, uncompressed index and tiles, PNG tile type, min/max native zoom.
  header.set([1,1,1,2,10,10],96);
  return Buffer.concat([header,root,Buffer.from('{}'),png]);
}

test('the packed 48-state catalogue opens only on-screen archives and changes states without a full download',async ({page})=>{
  // The test is about viewport loading. Non-witness footprints are placed outside both test viewports.
  const states='AL AZ AR CA CO CT DE FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
  const {createHash}=require('node:crypto');
  const requests=[];
  await bindCampsiteFixture(page,{states:['NY']});
  await page.route(/^https:\/\//,route=>route.abort());
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:42.7,lng:-74,zoom:10})));
  const context=page.context(), fixturePage=await context.newPage();
  const png=await fixturePage.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#1860b0';ctx.fillRect(0,0,256,256);
    return canvas.toDataURL().split(',')[1];
  });
  await fixturePage.close();
  const archive=oneColorArchive(Buffer.from(png,'base64')),sha256=createHash('sha256').update(archive).digest('hex');
  const regions=states.map(id=>({id,minZoom:10,maxZoom:10,
    bounds:id==='NY'?[-75,42,-73,43]:id==='CA'?[-122,36,-120,38]:[-100,31,-99,32],
    archive:{format:'pmtiles-v3',bytes:archive.length,sha256}}));
  const manifest={schema:2,release:'2024-06-30-packed-test',asOf:'2024-06-30',retrievedAt:'2025-01-01',
    technology:'4G LTE',environment:'Outdoor stationary',carriers:['att','verizon','t-mobile'].map(id=>({id,regions}))};
  await page.route('**/data/fcc-coverage/manifest-v2.json',route=>route.fulfill({json:manifest}));
  await page.route('**/data/fcc-coverage/**/*.pmtiles?*',async route=>{
    const request=route.request(),url=new URL(request.url());
    const match=/^bytes=(\d+)-(\d+)$/.exec(await request.headerValue('range')||'');
    requests.push({path:url.pathname,range:!!match});
    if(!match)return route.fulfill({status:400});
    const [,from,to]=match.map(Number);
    if(from<0||to<from||to>=archive.length)return route.fulfill({status:416});
    return route.fulfill({status:206,headers:{'Content-Range':`bytes ${from}-${to}/${archive.length}`,
      'Content-Length':String(to-from+1),'Content-Type':'application/vnd.pmtiles',ETag:'"fixture"'},
      body:archive.subarray(from,to+1)});
  });
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>KampTrailMapLoader.start());
  await page.locator('#map').scrollIntoViewIfNeeded();
  await page.getByRole('button',{name:'Map layers',exact:true}).press('Enter');
  const carrier=page.getByRole('combobox',{name:'FCC mobile coverage'}),output=page.locator('#fcc-coverage-readout');
  await expect(carrier).toHaveValue('');
  expect(requests).toEqual([]);
  await carrier.selectOption('att');
  await expect(output).toContainText('Map center: modeled coverage.');
  await expect(output).toContainText('Published areas: 48.');
  await expect(page.getByRole('combobox',{name:'Published coverage area'}).locator('option')).toHaveCount(49);
  await expect(page.locator('.kt-coverage-tiles')).toHaveCount(1);
  expect([...new Set(requests.map(r=>r.path.split('/').pop()))]).toEqual(['NY.pmtiles']);
  await page.evaluate(()=>map.setView([37,-121],10,{animate:false,reset:true}));
  await expect(output).toContainText('Map center: modeled coverage.');
  await expect(page.locator('.kt-coverage-tiles')).toHaveCount(1);
  await expect.poll(()=>requests.some(r=>r.path.endsWith('CA.pmtiles'))).toBe(true);
  expect([...new Set(requests.map(r=>r.path.split('/').pop()))].sort()).toEqual(['CA.pmtiles','NY.pmtiles']);
  expect(requests.every(r=>r.range)).toBe(true);
  await page.evaluate(()=>map.setView([45,-110],10,{animate:false,reset:true}));
  await expect(output).toContainText('Map center: no published data here.');
  await expect(page.locator('.kt-coverage-tiles')).toHaveCount(0);
});
