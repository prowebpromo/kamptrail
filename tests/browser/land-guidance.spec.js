const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;

// Isolate the general guide from live campsite, weather and map services.
test.use({serviceWorkers:'block'});
async function openGuide(page){
  await page.route(/^https:\/\//,r=>r.abort());
  await page.route('**/data/campsites/*_merged.geojson',r=>r.fulfill({contentType:'application/geo+json',body:'{"type":"FeatureCollection","features":[]}'}));
  await page.route('**/data/campsites/agency/*.geojson',r=>r.fulfill({contentType:'application/geo+json',body:'{"type":"FeatureCollection","features":[]}'}));
  await page.goto('/');
  await page.getByRole('button',{name:'About the data',exact:true}).click();
  const guide=page.locator('#kt-camping-care');await guide.locator('summary').click();return guide;
}

test('general land care is reachable by keyboard and keeps rule/source context readable offline',async({page,context})=>{
  const guide=await openGuide(page);
  await expect(page.getByRole('dialog',{name:'About the data'})).toBeVisible();
  await expect(guide.locator('summary')).toBeVisible();
  await expect(guide.locator('li')).toHaveCount(6);
  await expect(guide).toContainText('Current local orders and posted rules control.');
  await expect(guide).toContainText('camping permission, closures, fire restrictions');
  await expect(guide).toContainText('If a fire is allowed');
  await expect(guide.locator('time')).toHaveAttribute('datetime','2026-10-30');
  const links=guide.getByRole('link');
  expect(await links.evaluateAll(items=>items.map(a=>a.href))).toEqual([
    'https://www.blm.gov/programs/recreation/camping',
    'https://www.fs.usda.gov/visit/know-before-you-go/camping',
    'https://lnt.org/why/7-principles/'
  ]);
  for(const link of await links.all())await expect(link).toHaveAttribute('rel','noopener noreferrer');
  await context.setOffline(true);
  await expect(guide).toContainText('source pages need a connection');
  await expect(guide).toContainText('Remove trash, food scraps and pet waste when you leave.');
  await page.keyboard.press('Escape');
  await expect(page.locator('#data-dialog')).not.toBeVisible();
  await expect(page.locator('#about-data')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(guide).toBeVisible();
});

test('land care remains readable on mobile and passes dialog accessibility checks',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const guide=await openGuide(page);
  await guide.scrollIntoViewIfNeeded();
  expect(await page.locator('#data-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(guide.getByRole('link',{name:'Leave No Trace',exact:true})).toBeVisible();
  const audit=await new AxeBuilder({page}).include('#data-dialog').analyze();
  expect(audit.violations).toEqual([]);
});
