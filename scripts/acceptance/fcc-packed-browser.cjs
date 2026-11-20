// Measurement for the real, immutable RI qualification artifact. No external tile service is used.
const {chromium,expect}=require('@playwright/test');
const points={covered:[42.007978804701,-71.75239562988281],missing:[42.007978804701,-72.03666687011719],
  att:[41.25148375190403,-71.79496765136719],'t-mobile':[41.673424709209534,-71.61781311035156],
  verizon:[41.635459840527126,-71.74278259277344]};
const origin='http://127.0.0.1:8765';
(async()=>{
  const alaska = process.env.FCC_TEST_REGION === 'AK';
  const browser=await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH}: {})});
  try {
    for(const [width,height] of [[1366,900],[390,844]]){
      const context=await browser.newContext({viewport:{width,height}}), page=await context.newPage();
      page.setDefaultTimeout(15000);
      await page.route(/^https:\/\//,route=>route.abort());
      let rangeCount=0, responseBytes=0, xyz=0;const wrong=[],errors=[];
      context.on('response',r=>{
        const url=new URL(r.url());
        if(/\.pmtiles$/.test(url.pathname)){rangeCount++;responseBytes+=Number(r.headers()['content-length']||0);if(r.status()!==206||!r.headers()['content-range'])wrong.push(r.status());}
        if(url.pathname.startsWith('/data/fcc-coverage/')&&url.pathname.endsWith('.png'))xyz++;
      });
      page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.text().startsWith('packed-test '))console.log(m.text());});
      await page.addInitScript(pt=>localStorage.setItem('kt_last_position',JSON.stringify({lat:pt[0],lng:pt[1],zoom:10})),alaska ? [53,0] : points.covered);
      await page.goto(origin+'/?source=pwa',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:45000});
      await page.waitForFunction(()=>window.map&&document.querySelector('.kt-coverage-picker select'));
      const select=page.getByRole('combobox',{name:'FCC mobile coverage'}), output=page.locator('#fcc-coverage-readout'), status=output.locator('[role=status]');
      const open=async()=>{await page.locator('#map').scrollIntoViewIfNeeded();await page.getByRole('button',{name:'Map layers',exact:true}).focus();await page.getByRole('button',{name:'Map layers',exact:true}).press('Enter');};
      const move=point=>page.evaluate(pt=>{
        // A pan rounds its offset to CSS pixels; reset the view to the exact original native witness pixel.
        const map=window.map;map.setView(pt,10,{animate:false,reset:true});
        const actual=map.project(map.getCenter(),10).floor(), expected=map.project(pt,10).floor();
        if(!actual.equals(expected))throw Error('Witness center did not reach the requested native pixel');
      },point);
      await page.evaluate(()=>window.map.on('layeradd',event=>{if(event.layer.options?.className==='kt-coverage-tiles'){let count=0;event.layer.on('tileerror',e=>{if(count++<2)console.log('packed-test tile error: '+String(e.error?.message||e.error));});}}));
      await open();
      if(alaska){
        await expect(select.locator('option')).toHaveCount(3);
        await move([53,0]);
        for(const id of ['verizon','att']){
          await select.selectOption(id);
          await expect(status).toHaveText('Map center: no published data here.');
        }
        if(rangeCount!==0)throw Error('Range requested for gap outside Alaska footprints');
        for(const [id,west] of [['verizon',[58.25859131025997,-134.2961883544922]],['att',[58.81480837943604,-134.9993133544922]]]){
          await select.selectOption(id);
          await move(west);await expect(status).toHaveText('Map center: modeled coverage.',{timeout:15000});
          await move([69.84127843782623,-163.1256866455078]);await expect(status).toHaveText('Map center: no modeled coverage.',{timeout:15000});
          await move([53.04657961401141,172.99415588378906]);await expect(status).toHaveText('Map center: no modeled coverage.',{timeout:15000});
        }
        if(!rangeCount||wrong.length||xyz||errors.length)throw Error(JSON.stringify({width,rangeCount,wrong,xyz,errors}));
        console.log(JSON.stringify({region:'AK',width,height,rangeCount,responseBytes,westCovered:2,westUncovered:2,eastUncovered:2,gapRangeRequests:0,xyzRequests:xyz}));
        await context.close();continue;
      }
      for(const id of ['att','verizon','t-mobile']){
        console.log('Checking online carrier',width,id);
        await select.selectOption(id);await move(points.covered);await expect(status).toHaveText('Map center: modeled coverage.',{timeout:15000});
        await move(points[id]);await expect(status).toHaveText('Map center: no modeled coverage.',{timeout:15000});
        await move(points.missing);await expect(status).toHaveText('Map center: no published data here.',{timeout:15000});
      }
      await select.selectOption('att');await move(points.covered);await expect(status).toHaveText('Map center: modeled coverage.');
      console.log('Checking offline reload',width,'prior requests',rangeCount,wrong);
      await context.setOffline(true);
      await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.map&&document.querySelector('.kt-coverage-picker select'));
      await open();await select.selectOption('att');await move(points.covered);
      await expect(status).toHaveText('Map center: modeled coverage.',{timeout:15000});
      await expect(output).toContainText('Offline copy, not current.');await expect(output).toContainText(/2026/);
      // Remove test-context raster cache to demonstrate a real uncached offline miss. No user state is involved.
      await page.evaluate(async()=>{for(const key of await caches.keys())if(key.endsWith(':fcc-packed-v1'))await caches.delete(key);});
      await select.selectOption('');await select.selectOption('att');await expect(status).toHaveText('Map center: coverage tile unavailable.',{timeout:15000});
      if(!rangeCount||wrong.length||xyz||errors.length)throw Error(JSON.stringify({width,rangeCount,wrong,xyz,errors}));
      console.log(JSON.stringify({width,height,rangeCount,responseBytes,xyzRequests:xyz,covered:3,uncovered:3,missing:3,datedOfflineReload:true,uncachedOfflineUnavailable:true}));
      await context.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
