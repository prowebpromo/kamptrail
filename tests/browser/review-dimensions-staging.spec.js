// Staging proof for R5: the real review form, served by the real PHP application with an isolated database.
// No route mocks for app endpoints. Only third-party https tiles are stubbed. Moderation uses the real admin endpoint.
const{test,expect}=require('@playwright/test');
const H=require('../helpers/php-harness.js');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
test.skip(!H.capable,'PHP with pdo_sqlite, gd and mbstring is required');
test.describe.configure({mode:'serial'});
let harness;
test.beforeAll(async()=>{harness=await H.start({port:Number(process.env.KT_HARNESS_PORT||18940),mysql:''});});
test.afterAll(()=>harness?.close());

async function openSite(page,context){
 await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));
 await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:39.33,lng:-108.7,zoom:11})));
 await page.goto(harness.base+'/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>KampTrailData.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading);
 const id=await page.evaluate(()=>{const p=KampTrailData.getVisibleCampsites()[0].properties;KampTrailData.focusCampsite(p.id);return String(KampTrailData.publishedId?.(p.id)??p.id);});
 await page.locator('.leaflet-popup').getByRole('button',{name:'Reviews and photos',exact:true}).click();
 return id;
}
async function submit(page,{crowds,fullness,visited,season,expectSeasons}){
 await page.getByRole('button',{name:'Write a review',exact:true}).click();const d=page.getByRole('dialog',{name:'Write a review'});
 await d.getByLabel('Public name',{exact:true}).fill('Staging camper');await d.getByLabel('Overall rating',{exact:true}).selectOption('4');
 const seasonField=d.getByLabel('Season being rated',{exact:true});
 await expect(seasonField).toBeDisabled();await expect(d).toContainText('Without one, your sub-ratings add nothing to any season');
 await d.getByLabel('Date visited',{exact:true}).fill(visited);
 await expect(seasonField).toBeEnabled();expect(await seasonField.locator('option').evaluateAll(o=>o.map(x=>x.value))).toEqual(expectSeasons);
 await expect(seasonField).toHaveValue(expectSeasons[0]);await expect(d.locator('.kt-season-note')).toContainText('Your visit date '+visited+' falls in');
 await d.getByLabel('Crowds (how crowded it felt)',{exact:true}).selectOption(String(crowds));
 await d.getByLabel('Fullness (camping spaces occupied)',{exact:true}).selectOption(String(fullness));
 await d.getByLabel('Quietness by day',{exact:true}).selectOption('4');await d.getByLabel('Quietness by night',{exact:true}).selectOption('5');await d.getByLabel('Cleanliness',{exact:true}).selectOption('3');
 await expect(d.getByLabel('Crowding',{exact:true})).toHaveValue('');
 if(season)await seasonField.selectOption(season);
 await d.getByLabel('Your experience',{exact:true}).fill('Staging visit report from the review form with the new dimensions.');
 await d.locator('[name=firsthand]').check();
 // The API rejects submissions under three seconds; the form measures the time it was open.
 await page.waitForTimeout(3100);
 const posted=page.waitForRequest(r=>r.url().includes('/api/community.php')&&r.method()==='POST');
 const response=page.waitForResponse(r=>r.url().includes('/api/community.php')&&r.request().method()==='POST');
 await d.getByRole('button',{name:'Send for review',exact:true}).click();const sent=(await posted).postData()||'',payload=JSON.parse(sent.match(/name="observations"\r\n\r\n([^\r]+)/)[1]);
 expect(payload).toEqual({scores:{crowds,fullness,noise_day:4,noise_night:5,cleanliness:3},...(season?{season}:{})});
 const res=await response;expect(res.status()).toBe(201);
 await expect(page.getByRole('dialog',{name:'Review received'})).toContainText('waiting for moderation');
 const id=(await res.json()).id;await reopen(page);return id;
}
// Close whatever the community dialog shows and reopen the site's reviews, which reloads them from the API.
async function reopen(page){await page.locator('#kt-community').getByRole('button',{name:'Close',exact:true}).first().click();await page.locator('.leaflet-popup').getByRole('button',{name:'Reviews and photos',exact:true}).click();const region=page.getByRole('region',{name:'Visit sub-rating averages'});await expect(region.locator('.kt-site-score-values')).not.toHaveText('Loading visit sub-ratings…');return region;}

for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
 test(`${viewport.name}: new dimensions submit, moderate and publish an average only at 3 ratings`,async({page,context})=>{
  await page.setViewportSize({width:viewport.width,height:viewport.height});harness.sql(`$p->exec("DELETE FROM community_observations");$p->exec("DELETE FROM community_reviews");`);harness.resetQuota();
  const site=await openSite(page,context);
  const ids=[];
  ids.push(await submit(page,{crowds:2,fullness:5,visited:'2026-07-10',expectSeasons:['summer','spring','fall']}));
  // The stay began in late February: the visitor rates the season before the visit date.
  ids.push(await submit(page,{crowds:4,fullness:4,visited:'2026-03-01',season:'winter',expectSeasons:['spring','winter','summer']}));
  let region=await reopen(page);await expect(region).toContainText('No published numeric sub-ratings yet');
  for(const id of ids)await harness.publish(id);
  region=await reopen(page);
  await expect(region).toContainText('Crowds (how crowded it felt): insufficient evidence · 2 explicit ratings · 1 = not crowded, 5 = very crowded');
  await expect(region).toContainText('Fullness (camping spaces occupied): insufficient evidence · 2 explicit ratings');await expect(region).not.toContainText('/5 ·');
  const seasonal=page.getByRole('region',{name:'Seasonal visit sub-ratings'});await expect(seasonal).toBeVisible();
  const stored=await harness.get('/api/community.php?site='+encodeURIComponent(site));expect(stored.seasonal_scores.winter.crowds.count).toBe(1);expect(stored.seasonal_scores.summer.crowds.count).toBe(1);
  ids.push(await submit(page,{crowds:3,fullness:5,visited:'2026-08-31',expectSeasons:['summer','spring','fall']}));
  region=await reopen(page);await expect(region).toContainText('insufficient evidence · 2 explicit ratings','pending third rating stays out');
  await harness.publish(ids[2]);region=await reopen(page);
  await expect(region).toContainText('Crowds (how crowded it felt): 3.0/5 · 3 explicit ratings · 1 = not crowded, 5 = very crowded');
  await expect(region).toContainText('Fullness (camping spaces occupied): 4.7/5 · 3 explicit ratings · 1 = nearly empty, 5 = completely full');
  await expect(region).toContainText('Quietness by night: 5.0/5 · 3 explicit ratings');await expect(region).toContainText('Cleanliness: 3.0/5');
  await expect(region).not.toContainText('Quietness: ');
  const dialog=page.getByRole('dialog',{name:'Reviews and photos'});await expect(dialog).toContainText('Season rated: Winter');
  expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  const AxeBuilder=require('@axe-core/playwright').default;expect((await new AxeBuilder({page}).include('#kt-community').analyze()).violations).toEqual([]);
 });
}

// Codex finding 2: a discovery page that mixes dated and undated published reviews must load, not be rejected.
for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
 test(`${viewport.name}: mixed dated and undated reviews load in the dialog and in camper filters`,async({page,context})=>{
  await page.setViewportSize({width:viewport.width,height:viewport.height});harness.sql(`$p->exec("DELETE FROM community_observations");$p->exec("DELETE FROM community_reviews");`);harness.resetQuota();
  const site=await openSite(page,context);const raw=await page.evaluate(()=>KampTrailData.getVisibleCampsites()[0].properties.id);
  // Published fixtures written straight to the isolated database: two dated visits and one legacy undated visit.
  harness.sql(`$q=$p->prepare("INSERT INTO community_reviews(owner_hash,campsite_id,campsite_name,display_name,rating,body,visited_on,rig,status,created_at,updated_at) VALUES(?,?,'Mixed fixture',?,4,?,?,'','published','2026-07-02','2026-07-02')");$o=$p->prepare('INSERT INTO community_observations(review_id,details) VALUES(?,?)');
   foreach([['dated-a','Dated camper A','2026-07-01','{"noise":"quiet","scores":{"crowds":3}}'],['dated-b','Dated camper B','2026-07-20','{"noise":"quiet","scores":{"crowds":2}}'],['undated','Undated camper','','{"noise":"noisy","scores":{"crowds":5},"season":"summer"}']] as $r){$q->execute([hash('sha256',$r[0]),${JSON.stringify(site)},$r[1],'Disposable mixed-date staging fixture body.',$r[2]]);$o->execute([$p->lastInsertId(),$r[3]]);}$p->exec('UPDATE community_discovery_state SET revision=revision+1 WHERE id=1');`);
  const disc=await harness.get('/api/community-discovery.php');expect(disc.sites[site].observations.map(g=>g.latest_visit).sort()).toEqual(['','2026-07-01','2026-07-20']);
  const region=await reopen(page),dialog=page.getByRole('dialog',{name:'Reviews and photos'});
  await expect(dialog).toContainText('4/5 from 3 published reviews');
  await expect(region).toContainText('Crowds (how crowded it felt): 3.3/5 · 3 explicit ratings');
  await expect(dialog).toContainText('Visited visit date not reported');await expect(dialog).toContainText('Visited 2026-07-20');await expect(dialog).toContainText('Visited 2026-07-01');
  expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await dialog.getByRole('button',{name:'Close',exact:true}).first().click();
  // Load the real discovery page through the filters. A rejected page would show the refresh error instead.
  await page.getByRole('button',{name:'Open filters',exact:true}).click();const panel=page.getByRole('region',{name:'Campsite filters'});
  await panel.getByLabel('Observation age',{exact:true}).selectOption('0');await panel.getByLabel('Reported noise',{exact:true}).selectOption('noisy');
  await expect.poll(()=>page.evaluate(()=>KampTrailDiscovery.status())).toContain('Published camper evidence checked');
  await expect(panel).not.toContainText('could not refresh');
  await expect.poll(()=>page.evaluate(id=>KampTrailData.getVisibleCampsites().map(s=>s.properties.id).includes(id),raw)).toBe(true);
  expect(await page.evaluate(id=>{const s=KampTrailDiscovery.summary(id);return {groups:s.observations.length,seasons:KampTrailDiscovery.seasonalScores(s.observations).summer.crowds.count};},site)).toEqual({groups:3,seasons:2});
  // An age limit excludes the undated noisy report, so the site no longer matches noisy.
  await panel.getByLabel('Observation age',{exact:true}).selectOption('365');
  await expect.poll(()=>page.evaluate(id=>KampTrailDiscovery.matchesSummary(KampTrailDiscovery.summary(id),{observed_noise:'noisy',observedDays:365},Date.parse('2026-10-29T12:00:00Z')),site)).toBe(false);
 });
}
