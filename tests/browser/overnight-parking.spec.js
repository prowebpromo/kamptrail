const {test, expect} = require('@playwright/test');
const seed = require('../../data/overnight/stops.json');
const base = 'https://boondockorbust.com/resources/';
const slugs = ['overnight-rv-parking-new-york', 'overnight-rv-parking-maine', 'i-81-overnight-rv-parking', 'i-90-overnight-rv-parking'];
test.use({serviceWorkers:'block'});
test.beforeEach(async ({context}) => {
  await context.route(/^https:\/\//, route => route.abort());
});

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
  const saved = await page.evaluate(() => KampTrailTrip.getStops().find(stop => stop.id === 'casino:oxford-me').feature.properties);
  expect(saved.overnight_states).toEqual(['ME']);
  expect(saved.overnight_status).toBe('official-policy');
});

test('rest-area and dump pins use the same disclaimer and live guide fallback', async ({page}) => {
  const data = require('../../data/rest-areas/TX.json');
  const rest = data.records[0];
  const [lng, lat] = rest.coordinates;
  await page.route('**/data/rest-areas/index.json', route => route.fulfill({json:{version:1,regions:[{region:'TX',file:'TX.json'}]}}));
  await page.route('**/data/rest-areas/TX.json', route => route.fulfill({json:{...data,records:[rest]}}));
  await page.goto('/?mode=overnight-parking&state=TX');
  const filters = page.getByRole('group', {name:'Overnight parking filters'});
  await expect(filters).toBeVisible();
  await page.evaluate(({lat,lng}) => {
    // Inject one known dump after exercising the production service loader in its own suite.
    KampTrailServices.loadBounds = async () => ({
      items:[{id:'osm:node:100',osm_type:'node',osm_id:'100',name:'Fixture dump station',coordinates:[lng+0.02,lat],
        source_region:'TX',states:['TX'],categories:['dump'],tags:{amenity:'sanitary_dump_station'}}],
      manifest:{coverage:[{region:'TX',retrieved_at:'2026-11-01T00:00:00Z'}]}
    });
    map.setView([lat,lng], 12, {animate:false});
  }, {lat,lng});
  for (const name of [rest.name, 'Fixture dump station']) {
    await page.getByTitle(name,{exact:true}).click();
    const popup = page.locator('.kt-overnight-popup');
    await expect(popup).toContainText('A pin is a place to ask about, not permission to stay.');
    await expect(popup.getByRole('link', {name:'State parking guide index'})).toHaveAttribute('href', /#state-guides$/);
    await page.evaluate(() => map.closePopup());
  }
  await filters.getByLabel('Verified policy only').check();
  await expect(page.getByTitle('Fixture dump station',{exact:true})).toHaveCount(0);
});
