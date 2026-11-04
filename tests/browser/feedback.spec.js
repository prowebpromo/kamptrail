const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const token='f'.repeat(32);
for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
  test.describe(`subscriber beta preview ${viewport.width}`, () => {
    test.use({viewport,serviceWorkers:'block'});
    test('resource directories expose existing BoB tools and guide destinations', async ({page,context}) => {
      await context.route(/^https:\/\//, route => route.abort());
      await page.goto('/tools.html', {waitUntil:'domcontentloaded'});
      await expect(page.getByRole('heading', {name:'Free RV planning tools',exact:true})).toBeVisible();
      await expect(page.locator('.resource-card')).toHaveCount(10);
      await expect(page.locator('main')).toContainText('Formula and worked examples');
      await expect(page.locator('main')).toContainText('Web app with sign-in');
      const navigation = page.getByRole('navigation', {name:'KampTrail pages'});
      await expect(navigation.getByRole('link', {name:'Free tools',exact:true})).toHaveAttribute('aria-current','page');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
      await navigation.getByRole('link', {name:'Guides',exact:true}).click();
      await expect(page.getByRole('heading', {name:'RV camping guides and how-to help',exact:true})).toBeVisible();
      await expect(page.locator('.resource-card')).toHaveCount(9);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
      await page.getByRole('link', {name:'Watch the offline walkthrough'}).click();
      await expect(page.locator('#h-offline')).toBeVisible();
    });
    test('manual feedback, founder, FAQ and release history remain usable without recruiting on arrival', async ({page,context}) => {
      await context.route(/^https:\/\//, route => route.abort());
      await page.goto('/', {waitUntil:'domcontentloaded'});await page.evaluate(()=>window.KampTrailMapLoader?.start());
      await expect(page.locator('.kt-beta-label')).toContainText('Public beta');
      await page.getByRole('link', {name:'Feedback',exact:true}).first().click();
      await expect(page).toHaveURL(/#feedback-panel$/);
      await expect(page.locator('#beta-testing')).toBeHidden();
      const preview = page.locator('#feedback-panel');
      await preview.getByRole('button', {name:'Report a bug',exact:true}).click();
      const dialog = page.getByRole('dialog', {name:'Help improve KampTrail'});
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('Feedback type')).toHaveValue('bug');
      await dialog.getByRole('button', {name:'Close feedback'}).click();
      await preview.getByRole('button', {name:'Suggest a feature',exact:true}).click();
      await expect(dialog.getByLabel('Feedback type')).toHaveValue('feature');
      await dialog.getByRole('button', {name:'Close feedback'}).click();
      await expect(page.locator('#about-chuck img')).toHaveJSProperty('naturalWidth',480);
      const routingQuestion = page.locator('#beta-faq summary').filter({hasText:'Will routes account for my RV dimensions?'});
      await routingQuestion.click();
      await expect(page.locator('#beta-faq')).toContainText('Current routes use car routing.');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await new AxeBuilder({page}).include('.kt-home-hero').include('#beta-testing').include('#about-chuck').include('#beta-faq').analyze()).violations).toEqual([]);
      await page.locator('.kt-legal-nav').getByRole('link',{name:'What’s new',exact:true}).click();
      await expect(page.getByRole('heading', {name:'What’s new',exact:true})).toBeVisible();
      await expect(page.getByRole('region', {name:'Current beta limitations'})).toContainText('Carrier coverage overlays are unavailable.');
      await page.getByRole('link', {name:'Help test KampTrail',exact:true}).click();
      await expect(page.locator('#feedback-panel')).toBeVisible();await expect(page.locator('#beta-testing')).toBeHidden();
    });
  });
}
for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  test.describe(`private feedback ${viewport.width}`,()=>{
    test.use({viewport,serviceWorkers:'block'});
    async function setup(page,context,path='/',down=false){
      const sent=[];
      await context.route(/^https:\/\//,r=>r.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64')}));
      await page.route('**/api/submit.php',r=>{sent.push(r.request().postDataJSON());return r.fulfill({status:down?503:201,contentType:'application/json',body:JSON.stringify(down?{ok:false,error:'unavailable'}:{ok:true,token,status:'received'})});});
      await page.route('**/api/status.php*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,status:'accepted',note:'We are investigating.'})}));
      await page.goto(path,{waitUntil:'domcontentloaded'});
      await page.evaluate(()=>KampTrailMapLoader.start());
      return sent;
    }
    test('bug report is private by default, tracked, accessible and leaves the map usable',async({page,context})=>{
      const sent=await setup(page,context);
      await expect(page.locator('#map')).toBeVisible();
      const trigger=page.getByRole('button',{name:'Feedback',exact:true});await trigger.click();
      const d=page.getByRole('dialog',{name:'Help improve KampTrail'});
      await expect(d.getByLabel('Include basic app diagnostics (optional)')).not.toBeChecked();
      await d.getByLabel('Short summary').fill('Search closes after Enter');
      await d.getByLabel('What happened?').fill('Search closes after I type a town and press Enter.');
      expect((await new AxeBuilder({page}).include('#kt-feedback').analyze()).violations).toEqual([]);
      await d.getByRole('button',{name:'Send feedback'}).click();
      await expect(d).toContainText('Your feedback was received');
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({kind:'bug',title:'Search closes after Enter',contact_email:''});
      for(const key of ['lat','lng','campsite_id','diagnostics','firsthand'])expect(sent[0]).not.toHaveProperty(key);
      const link=d.getByRole('link',{name:'Private report status'});await expect(link).toHaveAttribute('href',new RegExp(`#feedback=report:${token}$`));
      await link.click();await expect(d).toContainText('Accepted for follow-up.');
      await d.getByRole('button',{name:'Close feedback'}).click();await expect(trigger).toBeFocused();
      await expect(page).not.toHaveURL(/#feedback=/);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await trigger.click();await d.getByRole('button',{name:'My reports',exact:true}).click();
      await expect(page.getByRole('dialog',{name:'My reports'})).toContainText('Accepted for follow-up.');
      await expect(page.getByRole('dialog',{name:'My reports'})).not.toContainText('The data will be updated');
    });
    test('feature deep link permits explicit coarse diagnostics and optional email',async({page,context})=>{
      const sent=await setup(page,context,'/#feedback=feature');
      const d=page.getByRole('dialog',{name:'Help improve KampTrail'});
      await expect(d.getByLabel('Feedback type')).toHaveValue('feature');
      await d.getByLabel('Short summary').fill('Improve offline preparation');
      await d.getByLabel('What would help you, and why?').fill('Show the saved area before travel so I can check my download.');
      await d.getByLabel('Email (optional)').fill('qa@example.test');
      await d.getByLabel('Include basic app diagnostics (optional)').check();
      await d.getByRole('button',{name:'Send feedback'}).click();await expect(d).toContainText('Your feedback was received');
      expect(sent[0]).toMatchObject({kind:'feature',contact_email:'qa@example.test',include_diagnostics:true,diagnostics:{language:'en',width:viewport.width,height:viewport.height,connection:'online'}});
      expect(Object.keys(sent[0].diagnostics).sort()).toEqual(['browser','connection','height','language','version','width']);
    });
    test('failure preserves text and exposes a verified contact fallback',async({page,context})=>{
      await setup(page,context,'/#feedback=bug',true);
      const d=page.getByRole('dialog',{name:'Help improve KampTrail'});
      await d.getByLabel('Short summary').fill('Unable to search');
      await d.getByLabel('What happened?').fill('Search does not return results after I type a town.');
      await d.getByRole('button',{name:'Send feedback'}).click();
      await expect(d).toContainText('Your text is still here');
      await expect(d.getByLabel('Short summary')).toHaveValue('Unable to search');
      await expect(d.getByRole('link',{name:'Contact KampTrail'})).toHaveAttribute('href','https://boondockorbust.com/contact/#contact-form');
      await expect(d.getByRole('button',{name:'Send feedback'})).toBeEnabled();
    });
    test('page width is constrained and the wheel scrolls past the map to feedback',async({page,context})=>{
      await setup(page,context);
      expect((await page.locator('#app').boundingBox()).width).toBeLessThanOrEqual(1120);
      expect(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight)).toBe(true);
      const zoom=await page.evaluate(()=>map.getZoom());
      const box=await page.locator('#map').boundingBox();
      await page.mouse.move(box.x+box.width/2,Math.min(box.y+150,viewport.height-50));
      await page.mouse.wheel(0,400);
      await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
      expect(await page.evaluate(()=>map.getZoom())).toBe(zoom);
      await page.locator('#feedback-panel').getByRole('button',{name:'Report a bug',exact:true}).click();
      await expect(page.getByRole('dialog',{name:'Help improve KampTrail'})).toBeVisible();
      await page.keyboard.press('Escape');
      await page.locator('#feedback-panel').getByRole('button',{name:'Suggest a feature',exact:true}).click();
      await expect(page.getByRole('dialog').getByLabel('Feedback type')).toHaveValue('feature');
    });
    test('private link works without saved browser storage and renders moderator text literally',async({page,context})=>{
      await setup(page,context,`/#feedback=report:${token}`);
      const d=page.getByRole('dialog',{name:'Help improve KampTrail'});
      await expect(d).toContainText('Accepted for follow-up.');await expect(d).toContainText('We are investigating.');
    });
  });
}

test.describe('touch page scrolling',()=>{
  test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  test('one-finger gestures scroll the page while two-finger map gestures stay enabled',async({page})=>{
    await page.goto('/',{waitUntil:'domcontentloaded'});await page.evaluate(()=>window.KampTrailMapLoader?.start());
    await page.evaluate(()=>KampTrailMapLoader.start());
    await expect.poll(()=>page.evaluate(()=>typeof window.map?.getZoom==='function')).toBe(true);
    expect(await page.evaluate(()=>map.dragging.enabled())).toBe(false);
    expect(await page.evaluate(()=>map.touchZoom.enabled())).toBe(true);
    const box=await page.locator('#map').boundingBox();
    const client=await page.context().newCDPSession(page);
    const x=box.x+box.width/2,y=Math.min(box.y+180,740);
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let step=1;step<=6;step++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*35}]});
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
  });
});

for(const viewport of [{width:1920,height:1080},{width:1000,height:520},{width:698,height:480}]){
  test.describe(`page layout ${viewport.width}x${viewport.height}`,()=>{
    test.use({viewport,serviceWorkers:'block'});
    test('wide and short windows retain a bounded map and normal document scrolling',async({page})=>{
      await page.goto('/',{waitUntil:'domcontentloaded'});await page.evaluate(()=>window.KampTrailMapLoader?.start());
      expect((await page.locator('#app').boundingBox()).width).toBeLessThanOrEqual(1120);
      const height=(await page.locator('#map').boundingBox()).height;
      expect(height).toBeGreaterThanOrEqual(560);expect(height).toBeLessThanOrEqual(680);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight)).toBe(true);
      await page.locator('#feedback-panel').getByRole('button',{name:'Suggest a feature',exact:true}).click();
      await expect(page.getByRole('dialog').getByLabel('Feedback type')).toHaveValue('feature');
      await expect(page.getByRole('dialog').getByRole('button',{name:'Close feedback'})).toBeInViewport();
    });
  });
}

test('the campsite list keeps independent scrolling within the scrolling page',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:43,lng:-75,zoom:8})));
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.evaluate(()=>window.KampTrailMapLoader?.start());
  await page.waitForFunction(()=>window.KampTrailData?.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading);
  const results=page.locator('#results');
  await expect.poll(()=>results.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
  await results.scrollIntoViewIfNeeded();
  const before=await page.evaluate(()=>scrollY),box=await results.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+180);await page.mouse.wheel(0,250);
  await expect.poll(()=>results.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>scrollY)).toBe(before);
});
