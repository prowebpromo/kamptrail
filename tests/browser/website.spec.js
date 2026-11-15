const {test,expect}=require('@playwright/test');const AxeBuilder=require('@axe-core/playwright').default;
test.use({serviceWorkers:'block'});
for(const width of [390,1440])test(`deferred homepage sections remain reachable by keyboard and anchors at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/');
 const sections=page.locator('#how-it-works,#about-chuck');
 const initial=await sections.evaluateAll(nodes=>nodes.map(n=>({top:n.getBoundingClientRect().top,visibility:getComputedStyle(n).contentVisibility})));
 expect(initial.every(n=>n.top>900&&n.visibility==='auto')).toBe(true);
 const reached=new Set();
 for(let i=0;i<120&&reached.size<2;i++){
  await page.keyboard.press('Tab');
  const id=await page.evaluate(()=>document.activeElement?.closest('#how-it-works,#about-chuck')?.id);
  if(id)reached.add(id);
 }
 expect([...reached].sort()).toEqual(['about-chuck','how-it-works']);
 await page.locator('a[href="#how-it-works"]').first().click();
 await expect(page.locator('#workflow-title')).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('website planning and founder pages form a usable mobile path without loading the map runtime',async({page})=>{
 await page.setViewportSize({width:390,height:844});const requests=[];page.on('request',r=>requests.push(r.url()));
 for(const file of ['plan.html','about.html','tools.html','guides.html']){await page.goto('/'+file);await expect(page.locator('h1')).toHaveCount(1);await expect(page.locator('nav.kt-site-nav a[aria-current="page"]')).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);}
 expect(requests.some(u=>/app\.bundle|leaflet\.js|data-loader\.js/.test(u))).toBe(false);
 await page.goto('/tools.html');await page.getByRole('link',{name:'Power and water',exact:true}).click();await expect(page.getByRole('heading',{name:'Plan power, water and refills'})).toBeInViewport();await page.getByRole('link',{name:'Plan a trip',exact:true}).first().click();await expect(page.locator('h1')).toHaveText('Plan your next stop with KampTrail');
});
test('offline feedback preserves the draft and announces failure without attempting a submission',async({page,context})=>{
 await page.goto('/#feedback-panel');await page.locator('#feedback-panel [data-feedback-kind="bug"]').click();const d=page.getByRole('dialog',{name:'Help improve KampTrail'});await d.locator('input[name="title"]').fill('Offline acceptance');await d.locator('textarea[name="details"]').fill('Keep this unsent test draft intact.');const submissions=[];page.on('request',r=>{if(r.url().includes('api/submit.php'))submissions.push(r.url());});await context.setOffline(true);await d.getByRole('button',{name:'Send feedback',exact:true}).click();await expect(d.locator('.kt-report-msg')).toContainText('Your text is still here',{timeout:2000});await expect(d.locator('textarea')).toHaveValue('Keep this unsent test draft intact.');expect(submissions).toEqual([]);
});
test('offline coordinate lookups announce unavailable evidence immediately',async({page,context})=>{
 await page.goto('/?source=pwa');await page.evaluate(()=>KampTrailMapLoader.start());await page.waitForFunction(()=>window.KampTrailSpot);await context.setOffline(true);const elapsed=await page.evaluate(async()=>{const start=performance.now();const land=document.createElement('div'),weather=document.createElement('div');land.id='acceptance-land';weather.id='acceptance-weather';document.body.append(land,weather);await Promise.all([KampTrailSpot.renderLand(land,42.111,-73.222),KampTrailSpot.renderForecast(weather,42.111,-73.222)]);return performance.now()-start;});expect(elapsed).toBeLessThan(2000);await expect(page.locator('#acceptance-land')).toHaveAttribute('aria-live','polite');await expect(page.locator('#acceptance-land')).toContainText('unavailable');await expect(page.locator('#acceptance-weather')).toContainText('unavailable');
});
