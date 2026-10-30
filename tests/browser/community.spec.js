const{test,expect}=require('@playwright/test');
const token='c'.repeat(64),pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
async function setup(page,context,{down=false,monthly}={}){
 const sent=[];
 await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));
 await page.route('**/api/photo.php*',r=>r.fulfill({contentType:'image/png',body:pixel}));
 await page.route('**/api/community.php*',r=>{
  const req=r.request();if(down&&req.method()==='GET')return r.fulfill({status:503,contentType:'application/json',body:'{"ok":false}'});
  if(req.method()==='POST'){sent.push({headers:req.headers(),body:req.postData()});return r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,id:1,token,status:'pending',message:'Report received. A moderator will review it.'})});}
  if(req.headers().authorization)return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,review:{id:1,campsite_id:'usfs:1',campsite_name:'Test campground',display_name:'Camper',rating:4,body:'A firsthand campsite review with useful details.',visited_on:'2026-10-01',rig:'Van',status:'pending',photos:[],updated_at:'2026-10-28'}})});
  return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,count:1,average:4,monthly,reviews:[{id:1,display_name:'<img src=x onerror=alert(1)>',rating:4,body:'Quiet night. <script>alert(1)</script>',visited_on:'2026-10-01',rig:'22-foot van',created_at:'2026-10-02',photos:[{id:1,width:1,height:1}]}],next_before:null})});
 });
 await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:39.33,lng:-108.7,zoom:11})));
 await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>KampTrailData.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading);
 const id=await page.evaluate(()=>KampTrailData.getVisibleCampsites()[0].properties.id);await page.evaluate(id=>KampTrailData.focusCampsite(id),id);
 await page.locator('.leaflet-popup').getByRole('button',{name:'Reviews and photos',exact:true}).click();return sent;
}
test('read moderated reviews and photos, safely render text, and report content',async({page,context})=>{
 const sent=await setup(page,context),d=page.getByRole('dialog',{name:'Reviews and photos'});
 await expect(d).toContainText('4/5 from 1 published review');await expect(d).toContainText('<script>alert(1)</script>');await expect(d.locator('script')).toHaveCount(0);await expect(d.locator('figure img')).toBeVisible();
 await d.getByRole('button',{name:'Report photo',exact:true}).click();const form=page.getByRole('dialog',{name:'Report a photo'});await form.getByLabel('What is the problem?').fill('This photograph contains private information.');await form.getByRole('button',{name:'Send report'}).click();await expect(form).toContainText('Report received');expect(sent[0].body).toContain('name="photo_id"');
});
test('write a review with a photo, save the private code, and reopen for editing',async({page,context})=>{
 const sent=await setup(page,context);await page.getByRole('button',{name:'Write a review',exact:true}).click();const d=page.getByRole('dialog',{name:'Write a review'});
 await d.getByLabel('Public name', {exact:false}).fill('Camper');await d.getByLabel('Overall rating').selectOption('4');await d.getByLabel('Date visited').fill('2026-10-01');await d.getByLabel('Noise',{exact:true}).selectOption('quiet');await d.getByLabel('Verizon signal',{exact:true}).selectOption('usable');await d.getByLabel('Verizon setting',{exact:true}).selectOption('inside_rv');await d.getByLabel('Your experience').fill('A firsthand campsite review with useful details.');
 await d.getByLabel('Photos (optional)',{exact:false}).setInputFiles({name:'test.png',mimeType:'image/png',buffer:pixel});await expect(d.locator('img')).toBeVisible();await d.getByLabel(/This is my firsthand experience/).check();await d.getByRole('button',{name:'Send for review'}).click();await expect(page.getByRole('dialog',{name:'Review received'})).toContainText('waiting for moderation');expect(sent).toHaveLength(1);expect(sent[0].body).toContain('name="photos[]"');expect(sent[0].body).toContain('\"noise\":\"quiet\"');expect(sent[0].body).toContain('inside_rv');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('kt_reviews_v1'))[0].token)).toBe(token);
 await page.getByRole('button',{name:'My reviews',exact:true}).click();await page.getByRole('dialog',{name:'My reviews',exact:true}).locator('li button').click();await expect(page.getByRole('dialog',{name:'Manage your review'})).toContainText('Status: pending');await page.getByRole('button',{name:'Edit review',exact:true}).click();await expect(page.getByRole('dialog',{name:'Edit your review'})).toContainText('until they are reviewed again');
});
test('mobile: recoverable service failure and management-code recovery remain usable',async({page,context})=>{
 await page.setViewportSize({width:390,height:844});await setup(page,context,{down:true});const d=page.getByRole('dialog',{name:'Reviews and photos'});await expect(d).toContainText('could not be loaded');await expect(d.getByRole('button',{name:'Retry',exact:true})).toBeEnabled();expect(await d.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await d.getByRole('button',{name:'My reviews',exact:true}).click();await expect(page.getByRole('dialog',{name:'My reviews'}).getByLabel('Restore a private management code')).toBeVisible();
});

test('review form hides spam controls from screen readers and passes its accessibility scan',async({page,context})=>{
 const AxeBuilder=require('@axe-core/playwright').default;
 await setup(page,context);await page.getByRole('button',{name:'Write a review',exact:true}).click();const d=page.getByRole('dialog',{name:'Write a review'});
 expect(await d.getByRole('textbox').evaluateAll(nodes=>nodes.some(n=>n.name==='website'))).toBe(false);
 const audit=await new AxeBuilder({page}).include('#kt-community').analyze();expect(audit.violations).toEqual([]);
});
test('the old GitHub Pages address hands community features to the live host without a dead form',async({page})=>{
 const fs=require('node:fs'),path=require('node:path');let apiRequests=0;
 await page.route('https://prowebpromo.github.io/**',r=>{
  if(r.request().url().includes('/api/')){apiRequests++;return r.fulfill({status:404,body:'No PHP here'});}
  const script=fs.readFileSync(path.resolve(__dirname,'../../community.js'),'utf8');
  return r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><title>Legacy address fixture</title><script>'+script+'</script><button onclick="KampTrailCommunity.open({properties:{id:\'usfs:77\',name:\'Test campsite\'}})">Read reviews</button><button onclick="KampTrailCommunity.mine()">Manage reviews</button></html>'});
 });
 await page.goto('https://prowebpromo.github.io/kamptrail/');await page.getByRole('button',{name:'Read reviews',exact:true}).click();await expect(page.getByRole('link',{name:'Open KampTrail reviews'})).toHaveAttribute('href','https://kamptrail.com/#site=usfs%3A77');await expect(page.getByRole('button',{name:'Write a review',exact:true})).toHaveCount(0);expect(apiRequests).toBe(0);
});
test('mobile visit-month evidence keeps descriptive counts, dates, empty states and keyboard access',async({page,context})=>{
 await page.setViewportSize({width:390,height:844});
 const axes=values=>Object.fromEntries(['access','noise','shade','crowding','comfort'].map(k=>[k,values[k]||{}]));
 const monthly={version:1,available:true,checked_at:new Date().toISOString(),basis:'calendar_visit_month_all_years',published_reviews:4,condition_reports:3,unreported_reviews:1,excluded_dates:0,invalid_observations:0,months:{'01':{reports:2,first_visit:'2025-01-20',latest_visit:'2026-01-05',axes:axes({noise:{quiet:2},shade:{partial:1}})},'07':{reports:1,first_visit:'2026-07-02',latest_visit:'2026-07-02',axes:axes({noise:{noisy:1},comfort:{concerns:1}})}}};
 await setup(page,context,{monthly});const d=page.getByRole('dialog',{name:'Reviews and photos'}),panel=d.locator('.kt-monthly-reports');
 await panel.locator('summary').press('Enter');await expect(panel).toContainText('3 published condition reports');await expect(panel).toContainText('Calendar visit months across all reported years');await expect(panel).toContainText('Quiet: 2');
 await panel.getByLabel('Visit month',{exact:true}).selectOption('01');await expect(panel).toContainText('2 published condition reports');await expect(panel).toContainText('2025-01-20 through 2026-01-05');await expect(panel).toContainText('Not reported: 1');await expect(panel).not.toContainText('Noisy: 1');
 await panel.getByLabel('Visit month',{exact:true}).selectOption('02');await expect(panel).toContainText('Missing evidence stays unknown');await expect(panel.locator('li')).toHaveCount(0);expect(await d.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 const AxeBuilder=require('@axe-core/playwright').default;expect((await new AxeBuilder({page}).include('#kt-community').analyze()).violations).toEqual([]);
});
test('expired or unavailable visit-month evidence never appears as zero condition reports',async({page,context})=>{
 await setup(page,context,{monthly:{version:1,available:false,reason:'limit'}});const d=page.getByRole('dialog',{name:'Reviews and photos'});await d.locator('.kt-monthly-reports summary').click();await expect(d).toContainText('Visit-month summaries are unavailable');await expect(d).toContainText('Quiet night.');await expect(d.locator('.kt-monthly-reports')).not.toContainText('No published condition reports');
});
test('an expired visit-month snapshot explains its limit while individual reviews remain readable',async({page,context})=>{
 await setup(page,context,{monthly:{version:1,available:true,checked_at:'2020-01-01T00:00:00Z',basis:'calendar_visit_month_all_years',published_reviews:1,condition_reports:0,unreported_reviews:1,excluded_dates:0,invalid_observations:0,months:{}}});const d=page.getByRole('dialog',{name:'Reviews and photos'});await d.locator('.kt-monthly-reports summary').click();await expect(d).toContainText('summary is expired');await expect(d).toContainText('Quiet night.');await expect(d.getByLabel('Visit month',{exact:true})).toHaveCount(0);
});
