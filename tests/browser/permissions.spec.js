const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const AxeBuilder = require('@axe-core/playwright').default;
test.use({serviceWorkers: 'block'});
const source = fs.readFileSync(path.resolve(__dirname, '../../permissions.js'), 'utf8');
const place = {kind: 'campsite', id: 'usfs:77', name: 'Permission Test Campground', coordinates: [-108.7, 39.33]};
const token = 'c'.repeat(64);
const report = {id: 7, place, activity: 'overnight_occupancy', observation: 'granted_to_me', visited_on: '2026-01-01', display_name: '<img src=x onerror=alert(1)>', body: 'A manager gave me permission for this one visit. <script>alert(1)</script>', authority_role: 'Duty manager', authority_office: 'Ranger office', status: 'published', version: 1, created_at: '2026-01-02'};
const official = {status: 'historical', activity: 'overnight_occupancy', summary: 'Only expired official evidence is available.', as_of: '2026-10-30T00:00:00Z', evidence: [{issuer: 'Example land manager', statement: 'conditional', quote: 'One night with permission.', conditions: ['Ask the duty manager.'], effective_from: '2025-01-01', effective_until: '2025-12-31', retrieved_at: '2025-01-01', reviewed_at: '2025-01-02', review_after: '2026-01-01', freshness: 'expired', source_url: 'https://example.org/rules'}]};
function response(overrides = {}) {return {ok: true, official, reports_available: true, count: 1, reports: [report], next_before: null, ...overrides};}
async function fixture(page, handler) {
  const sent = [];
  await page.route('**/permissions-fixture', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Permission fixture</title></head><body><button id="trigger">Open permission</button></body></html>'}));
  await page.route('**/api/permissions.php*', async route => {
    const request = route.request(), data = request.postDataJSON(); sent.push({url: request.url(), method: request.method(), headers: request.headers(), data});
    if (handler && await handler(route, data, sent)) return;
    await route.fulfill({contentType: 'application/json', body: JSON.stringify(response())});
  });
  await page.goto('/permissions-fixture');
  await page.addScriptTag({content: source});
  await page.addStyleTag({content: '#kt-permissions{width: min(720px,calc(100vw - 24px));max-height:90vh;box-sizing:border-box;overflow-wrap:anywhere}#kt-permissions input,#kt-permissions select,#kt-permissions textarea{max-width:100%;box-sizing:border-box}.kt-field{display:flex;flex-direction:column;margin:12px 0}.kt-permission-card{padding:12px;border:1px solid #888;margin:8px 0}'});
  await page.evaluate(p => {document.getElementById('trigger').onclick = () => KampTrailPermissions.open(p);}, place);
  await page.getByRole('button', {name: 'Open permission', exact: true}).click();
  return sent;
}
test('scoped dated evidence stays separate from firsthand reports and public requests are private POSTs', async ({page}) => {
  const sent = await fixture(page);
  const d = page.getByRole('dialog', {name: 'Overnight permission', exact: true});
  await expect(d).toContainText('Source reports: historical evidence only for overnight occupancy.');
  await expect(d).toContainText('1 published firsthand report');
  await expect(d).toContainText('<script>alert(1)</script>');
  await expect(d.locator('script,img')).toHaveCount(0);
  await d.getByText('Source evidence and history (1)', {exact: true}).click();
  await expect(d).toContainText('Evidence: expired');
  await expect(d).toContainText('this does not establish current permission');
  await expect(d).toContainText('Retrieved 2025-01-01; reviewed 2025-01-02');
  await expect(d.getByRole('link', {name: 'Open source evidence'})).toHaveAttribute('href', 'https://example.org/rules');
  expect(sent[0].method).toBe('POST'); expect(sent[0].url).not.toContain('?'); expect(sent[0].data.place).toEqual(place);
  await d.getByLabel('Activity scope').selectOption('unoccupied_vehicle_parking');
  await expect(d).toContainText('permission unknown for unoccupied vehicle parking');
  await expect(d.locator('article')).toHaveCount(0);
  expect(sent[1].data.activity).toBe('unoccupied_vehicle_parking');
});
test('dialog traps focus, restores trigger on escape, is accessible, and fits mobile', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844}); await fixture(page);
  const d = page.getByRole('dialog'); await expect(d).toContainText('1 published firsthand report');
  await d.getByRole('button', {name: 'Close', exact: true}).focus(); await page.keyboard.press('Shift+Tab');
  await expect(d.getByRole('button', {name: 'Flag report', exact: true})).toBeFocused();
  await page.keyboard.press('Tab'); await expect(d.getByRole('button', {name: 'Close', exact: true})).toBeFocused();
  expect(await d.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  expect((await new AxeBuilder({page}).include('#kt-permissions').analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape'); await expect(d).not.toBeVisible(); await expect(page.locator('#trigger')).toBeFocused();
});
test('failed reads and unavailable report storage never look like zero reports; retry recovers', async ({page, context}) => {
  let calls = 0;
  await fixture(page, async route => {calls++; await route.fulfill({status: calls === 1 ? 503 : 200, contentType: 'application/json', body: JSON.stringify(calls === 1 ? {ok: false} : response({reports_available: false, reports: []}))}); return true;});
  const d = page.getByRole('dialog'); await expect(d).toContainText('permission remain unknown'); await expect(d).not.toContainText('0 published');
  await d.getByRole('button', {name: 'Retry', exact: true}).click(); await expect(d).toContainText('Published reports are unavailable. This is not a zero count');
  await expect(d).toContainText('historical evidence only');
  await context.setOffline(true);
  await page.unroute('**/api/permissions.php*'); await page.evaluate(p => KampTrailPermissions.open(p), place);
  await expect(d).toContainText('Offline: current permission information and reports are unavailable'); await expect(d).not.toContainText('0 published');
});
test('pagination retains reports without duplicates and keeps concerns separate from official conclusion', async ({page}) => {
  await fixture(page, async (route, data) => {await route.fulfill({contentType: 'application/json', body: JSON.stringify(response({count: 2, next_before: data.before ? null : 7, reports: data.before ? [report, {...report, id: 6, observation: 'prohibition_sign_seen', body: 'A prohibition sign was posted beside the entrance.'}] : [report]}))}); return true;});
  const d = page.getByRole('dialog'); await d.getByRole('button', {name: 'Load more reports'}).click();
  await expect(d.locator('.kt-permission-card')).toHaveCount(3); // One source record, two reports.
  await expect(d.getByRole('region', {name: 'Reported concerns'})).toContainText('do not change the source conclusion');
  await expect(d).toContainText('Source reports: historical evidence only'); await expect(d.getByRole('button', {name: 'Load more reports'})).toBeHidden();
});
test('late responses cannot replace a newer place and abort superseded reads', async ({page}) => {
  await fixture(page);
  await page.evaluate(() => {
    window.pendingPermissions = []; window.permissionAborts = 0;
    window.fetch = (_url, options) => new Promise(resolve => {
      options.signal.addEventListener('abort', () => window.permissionAborts++);
      window.pendingPermissions.push({body: JSON.parse(options.body), resolve: data => resolve({ok: true, json: async () => data})});
    });
  });
  await page.evaluate(p => {KampTrailPermissions.open({...p, name: 'Old place'}); KampTrailPermissions.open({...p, id: 'usfs:88', name: 'New place'});}, place);
  await page.evaluate(payload => {pendingPermissions[1].resolve({...payload, reports: [{...payload.reports[0], body: 'New place report displayed here.'}]});}, response());
  await expect(page.getByRole('dialog')).toContainText('New place report displayed here.');
  await page.evaluate(payload => pendingPermissions[0].resolve(payload), response());
  await expect(page.getByRole('dialog')).not.toContainText('A manager gave me permission');
  expect(await page.evaluate(() => permissionAborts)).toBe(1);
});
async function fillReport(page) {
  await page.getByRole('button', {name: 'Share firsthand report'}).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Firsthand observation', {exact: true}).selectOption('granted_to_me');
  await d.getByLabel('Date observed', {exact: true}).fill('2026-01-01');
  await d.getByLabel('Public display name', {exact: true}).fill('Camper');
  await d.getByLabel('Role or title', {exact: true}).fill('Duty manager');
  await d.getByLabel('Office or organization', {exact: true}).fill('Ranger office');
  await d.getByLabel('What happened?', {exact: true}).fill('The manager granted permission for one night only.');
  await d.getByLabel('I confirm this is my firsthand experience.', {exact: true}).check();
  return d;
}
test('text-only submission keeps code masked and stores management metadata without report/location content', async ({page}) => {
  const sent = await fixture(page, async (route, data) => {
    if (data.action !== 'submit') return false;
    await route.fulfill({status: 201, contentType: 'application/json', body: JSON.stringify({ok: true, id: 7, token, version: 1, status: 'pending'})}); return true;
  });
  const d = await fillReport(page);
  await expect(d).toContainText('this location, observation date, display name, report text');
  await expect(d.locator('input[type=file]')).toHaveCount(0);
  await expect(d.getByLabel('Date observed', {exact: true})).toHaveAttribute('max', new Date().toISOString().slice(0, 10));
  expect((await new AxeBuilder({page}).include('#kt-permissions').analyze()).violations).toEqual([]);
  await d.getByRole('button', {name: 'Send for moderation'}).click();
  await expect(d).toContainText('pending moderation and is not public');
  await expect(d.getByLabel('Private management code', {exact: true})).toHaveAttribute('type', 'password');
  await d.getByRole('button', {name: 'Show code', exact: true}).click(); await expect(d.getByLabel('Private management code', {exact: true})).toHaveAttribute('type', 'text');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kt_permission_owners_v1')));
  expect(Object.keys(stored[0]).sort()).toEqual(['at', 'id', 'name', 'token']); expect(stored[0].token).toBe(token);
  const submitted = sent.find(x => x.data.action === 'submit'); expect(submitted.data.firsthand).toBe(true); expect(submitted.data.authority_office).toBe('Ranger office'); expect(submitted.url).not.toContain('?'); expect(submitted.data).not.toHaveProperty('rating');
});
test('management uses Bearer POST; edits detect stale versions and delete removes saved ownership', async ({page}) => {
  let ownerVersion = 1;
  const sent = await fixture(page, async (route, data) => {
    if (data.action === 'read') return false;
    let body = {ok: true}, status = 200;
    if (data.action === 'owner') body.report = {...report, version: ownerVersion, status: 'pending'};
    if (data.action === 'edit') {ownerVersion = 2; status = 409; body = {ok: false, error: 'conflict'};}
    await route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)}); return true;
  });
  await page.evaluate(({token}) => localStorage.setItem('kt_permission_owners_v1', JSON.stringify([{id: 7, name: 'My saved report', token}])), {token});
  await page.getByRole('button', {name: 'My permission reports', exact: true}).click(); await page.getByRole('button', {name: 'My saved report', exact: true}).click();
  await expect(page.getByRole('dialog')).toContainText('Status: pending. Version 1.');
  await page.getByRole('button', {name: 'Edit report', exact: true}).click();
  await page.getByLabel('I confirm this is my firsthand experience.', {exact: true}).check();
  await page.getByRole('button', {name: 'Save and resubmit', exact: true}).click();
  await expect(page.getByRole('dialog')).toContainText('changed elsewhere');
  await page.getByRole('button', {name: 'Load latest report'}).click(); await expect(page.getByRole('dialog')).toContainText('Version 2.');
  await page.getByRole('button', {name: 'Delete report', exact: true}).click(); await page.getByRole('button', {name: 'Confirm delete', exact: true}).click();
  await expect(page.getByRole('dialog')).toContainText('Your report has been deleted.');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kt_permission_owners_v1')))).toEqual([]);
  for (const request of sent.filter(r => ['owner', 'edit', 'delete'].includes(r.data.action))) {expect(request.method).toBe('POST'); expect(request.url).not.toContain('?'); expect(request.headers.authorization).toBe('Bearer ' + token);}
  expect(sent.find(r => r.data.action === 'edit').data.version).toBe(1); expect(sent.find(r => r.data.action === 'delete').data.version).toBe(2);
});
test('online to offline clears displayed public information and preserves an unsent draft without reconnect submission', async ({page, context}) => {
  const sent = await fixture(page), d = page.getByRole('dialog');
  await expect(d).toContainText('1 published firsthand report'); await expect(d).toContainText('Only expired official evidence');
  await context.setOffline(true);
  await expect(d).toContainText('Offline: current permission information and reports are unavailable');
  await expect(d).not.toContainText('A manager gave me permission'); await expect(d).not.toContainText('Only expired official evidence');
  await expect(d).not.toContainText('1 published firsthand report');
  const reads = sent.length; await context.setOffline(false); expect(sent).toHaveLength(reads);
  await d.getByRole('button', {name: 'Retry', exact: true}).click(); await expect(d).toContainText('1 published firsthand report');
  await fillReport(page); await context.setOffline(true);
  await expect(d).toContainText('Your draft remains here'); await expect(d.getByLabel('What happened?', {exact: true})).toHaveValue('The manager granted permission for one night only.');
  await context.setOffline(false); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(d.getByLabel('What happened?', {exact: true})).toHaveValue('The manager granted permission for one night only.');
  expect(sent.filter(r => r.data.action === 'submit')).toHaveLength(0);
});
test('current evidence is cleared at its review deadline without polling and visible resume rereads', async ({page}) => {
  const now = Date.now(); await page.clock.install({time: new Date(now)});
  const sent = await fixture(page, async route => {
    await route.fulfill({contentType: 'application/json', body: JSON.stringify(response({official: {...official, status: 'conditional', as_of: new Date(now).toISOString(), summary: 'Current scoped permission evidence.', evidence: [{...official.evidence[0], freshness: 'current', effective_until: null, review_after: new Date(now + 60000).toISOString()}]}}))}); return true;
  });
  const d = page.getByRole('dialog'); await expect(d).toContainText('Current scoped permission evidence.');
  await page.clock.fastForward(61000); await expect(d).toContainText('no longer current');
  await expect(d).not.toContainText('Current scoped permission evidence.'); await expect(d).not.toContainText('A manager gave me permission'); expect(sent).toHaveLength(1);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => sent.length).toBe(2);
});
