// Measurement for the real, immutable RI qualification artifact. No external tile service is used.
const {chromium,expect}=require('@playwright/test');
const points={covered:[42.007978804701,-71.75239562988281],missing:[42.007978804701,-72.03666687011719],
  att:[41.25148375190403,-71.79496765136719],'t-mobile':[41.673424709209534,-71.61781311035156],
  verizon:[41.635459840527126,-71.74278259277344]};
const origin='http://127.0.0.1:8765';
(async()=>{
  const browser=await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH}: {})});
  try {
    for(const [width,height] of [[1366,900],[390,844]]){
      const context=await browser.newContext({viewport:{width,height}}), page=await context.newPage();
      page.setDefaultTimeout(15000);
      await page.route(/^https:\/\//,route=>route.abort());
      let rangeCount=0, xyz=0;const wrong=[],errors=[];
      context.on('response',r=>{
        const url=new URL(r.url());
        if(/\.pmtiles$/.test(url.pathname)){rangeCount++;if(r.status()!==206||!r.headers()['content-range'])wrong.push(r.status());}
        if(url.pathname.startsWith('/data/fcc-coverage/')&&url.pathname.endsWith('.png'))xyz++;
      });
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(pt=>localStorage.setItem('kt_last_position',JSON.stringify({lat:pt[0],lng:pt[1],zoom:10})),points.covered);
      await page.goto(origin+'/?source=pwa',{waitUntil:'domcontentloaded'});
      await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
      await page.waitForFunction(()=>window.map&&document.querySelector('.kt-coverage-picker select'));
      const select=page.getByRole('combobox',{name:'FCC mobile coverage'}), output=page.locator('#fcc-coverage-readout'), status=output.locator('[role=status]');
      const open=async()=>{await page.locator('#map').scrollIntoViewIfNeeded();await page.getByRole('button',{name:'Map layers',exact:true}).focus();await page.getByRole('button',{name:'Map layers',exact:true}).press('Enter');};
      const move=point=>page.evaluate(pt=>window.map.setView(pt,10,{animate:false}),point);
      await open();
      for(const id of ['att','verizon','t-mobile']){
        await select.selectOption(id);await move(points.covered);await expect(status).toHaveText('Map center: modeled coverage.',{timeout:15000});
        await move(points[id]);await expect(status).toHaveText('Map center: no modeled coverage.',{timeout:15000});
        await move(points.missing);await expect(status).toHaveText('Map center: no published data here.',{timeout:15000});
      }
      await select.selectOption('att');await move(points.covered);await expect(status).toHaveText('Map center: modeled coverage.');
      await context.setOffline(true);
      await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.map&&document.querySelector('.kt-coverage-picker select'));
      await open();await select.selectOption('att');await move(points.covered);
      await expect(status).toHaveText('Map center: modeled coverage.',{timeout:15000});
      await expect(output).toContainText('Offline copy, not current.');await expect(output).toContainText(/2026/);
      // Remove test-context raster cache to demonstrate a real uncached offline miss. No user state is involved.
      await page.evaluate(async()=>{for(const key of await caches.keys())if(key.endsWith(':fcc-packed-v1'))await caches.delete(key);});
      await select.selectOption('');await select.selectOption('att');await expect(status).toHaveText('Map center: coverage tile unavailable.',{timeout:15000});
      if(!rangeCount||wrong.length||xyz||errors.length)throw Error(JSON.stringify({width,rangeCount,wrong,xyz,errors}));
      console.log(JSON.stringify({width,height,rangeCount,xyzRequests:xyz,covered:3,uncovered:3,missing:3,datedOfflineReload:true,uncachedOfflineUnavailable:true}));
      await context.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
