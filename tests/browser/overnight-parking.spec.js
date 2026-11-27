const {test, expect} = require('@playwright/test');
const seed = require('../../data/overnight/stops.json');
const base = 'https://boondockorbust.com/resources/';
const slugs = ['overnight-rv-parking-new-york', 'overnight-rv-parking-maine', 'i-81-overnight-rv-parking', 'i-90-overnight-rv-parking'];

test('overnight entry opens sourced operator pins, filters and saves a stop', async ({page}) => {
  await page.route('https://boondockorbust.com/wp-json/wp/v2/posts?**', route => route.fulfill({
    json: slugs.map((slug, i) => ({id: i + 1, slug, link: base + slug + '/', status: 'publish'})),
    headers: {'Access-Control-Allow-Origin': '*'}
  }));
  await page.goto('/?mode=overnight-parking');
  const filters = page.getByRole('group', {name: 'Overnight parking filters'});
  await expect(filters).toBeVisible();
  await filters.getByLabel('Rest areas', {exact:true}).uncheck();
  await filters.getByLabel('Dump stations', {exact:true}).uncheck();
  for (const row of seed) {
    await page.evaluate(({lat,lng}) => window.map.setView([lat,lng], 11, {animate: false}), row);
    await page.getByTitle(row.name, {exact:true}).click();
    const popup = page.locator('.kt-overnight-popup');
    await expect(popup).toContainText('A pin is a place to ask about, not permission to stay.');
    await expect(popup.getByRole('link', {name: 'Directions'})).toHaveAttribute('href', row.directions);
    if (row.state === 'NY') await expect(popup.getByRole('link', {name:'New York parking guide'})).toHaveAttribute('href', base + slugs[0] + '/');
    else if (row.state === 'PA') await expect(popup.getByRole('link', {name:'State parking guide index'})).toHaveAttribute('href', /#state-guides$/);
    if (row.interstates.includes('I-81')) await expect(popup.getByRole('link', {name:'I-81 parking guide'})).toHaveAttribute('href', base + slugs[2] + '/');
    await page.evaluate(() => window.map.closePopup());
  }
  await filters.getByLabel('Verified policy only').check();
  const lead = seed.find(row => row.status === 'unverified');
  await expect(page.getByTitle(lead.name, {exact:true})).toHaveCount(0);
  await filters.getByLabel('Casino parking by state').selectOption('ME');
  await page.locator('.leaflet-marker-icon[title="Oxford Casino Hotel & Sportsbook"]').click();
  await page.locator('.kt-overnight-popup').getByRole('button', {name:'Save stop'}).click();
  await expect.poll(() => page.evaluate(() => KampTrailTrip.getStops().map(stop => stop.id))).toContain('casino:oxford-me');
});
