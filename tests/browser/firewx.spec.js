const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fx = require('../fixtures/fire-weather/load.js');
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');
const LAYER = 'Fire weather alerts (NWS)';
// Centre of the real Colorado fire zone COZ214, so the polygon alert sits in the opening viewport.
const ring = fx.file.zones['fire/COZ214'].data.features[0].geometry.coordinates[0];
const centre = { lat: (Math.min(...ring.map(p => p[1])) + Math.max(...ring.map(p => p[1]))) / 2, lng: (Math.min(...ring.map(p => p[0])) + Math.max(...ring.map(p => p[0]))) / 2 };
const smokePolygon = { type: 'Polygon', coordinates: [[[centre.lng - .1, centre.lat - .1], [centre.lng + .1, centre.lat - .1], [centre.lng + .1, centre.lat + .1], [centre.lng - .1, centre.lat - .1]]] };

/* Every response is a labelled fixture rebased to the browser clock, so it never reads as a historical alert. */
async function setup(page, context, { lang = 'en', cases = 'polygon', ageMinutes = 0, zoneFail = false, firewxStatus = 200, zoom = 9 } = {}) {
  const s = { requested: [], zones: [], errors: [], cases, firewxStatus, zoneFail, ageMinutes };
  page.on('pageerror', e => s.errors.push(e.message));
  await context.route(/^https:\/\//, r => r.fulfill({ contentType: 'image/png', body: pixel }));
  await context.route('**/api/environment.php?**', r => {
    const u = new URL(r.request().url()), kind = u.searchParams.get('kind'), now = Date.now();
    s.requested.push(kind);
    if (kind === 'firewx') {
      if (s.firewxStatus !== 200) return r.fulfill({ status: s.firewxStatus, contentType: 'application/json', body: '{"ok":false}' });
      const body = fx.payload(s.cases, now); body.retrieved_at = new Date(now - s.ageMinutes * 60000).toISOString();
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (kind === 'zone') {
      const id = u.searchParams.get('zone'); s.zones.push(id);
      if (s.zoneFail) return r.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false}' });
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(fx.zone(id, now)) });
    }
    const properties = kind === 'fire' ? { id: '1', name: 'Example fire', type: 'WF', acres: 20, source_updated_at: new Date(now - 3600000).toISOString() } : { id: '2', density: 'Light', start: new Date(now - 7200000).toISOString(), end: new Date(now - 3600000).toISOString() };
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, version: 1, kind, partial: false, retrieved_at: new Date(now).toISOString(), source: { name: 'Example', url: 'https://www.weather.gov/', ...(kind === 'smoke' ? { observation_date: new Date(now - 3600000).toISOString().slice(0, 10) } : {}) }, data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: smokePolygon, properties }] } }) });
  });
  await page.addInitScript(([z, l, language]) => { localStorage.setItem('kt_last_position', JSON.stringify({ lat: l.lat, lng: l.lng, zoom: z })); if (language !== 'en') localStorage.setItem('kt_language', language); }, [zoom, centre, lang]);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.KampTrailFireWeather && window.KampTrailEnvironment && window.KampTrailData && !KampTrailData.getLoadStatus().loading);
  return s;
}
async function enable(page, name = LAYER) {
  const checkbox = page.getByRole('checkbox', { name, exact: true });
  if (!await checkbox.isVisible()) { await page.getByRole('button', { name: /Map layers|Capas del mapa|Couches de la carte/ }).press('Enter'); await page.waitForTimeout(50); }
  await checkbox.press('Space'); await expect(checkbox).toBeChecked();
}
const panel = page => page.locator('.kt-firewx-control');
const card = (page, id) => page.locator(`.kt-firewx-alert[data-alert-id="${id}"]`);
async function open(page) { const d = panel(page).locator('details'); if (!await d.evaluate(e => e.open)) await panel(page).locator('summary').click(); }
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll('.kt-firewx-control')].every(e => e.getBoundingClientRect().right <= innerWidth + 1));

for (const view of [{ name: 'desktop', size: { width: 1440, height: 1000 } }, { name: 'mobile', size: { width: 390, height: 844 } }]) {
  test.describe(view.name, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize(view.size); });

    test('layer is opt-in, separate from fire and smoke, and requests only the fixed fire-weather query', async ({ page, context }) => {
      const s = await setup(page, context);
      expect(s.requested).toEqual([]);
      await enable(page);
      await expect(panel(page)).toBeVisible();
      await expect.poll(() => s.requested.includes('firewx')).toBe(true);
      expect(s.requested.filter(k => k !== 'firewx')).toEqual([]);
      for (const other of ['Fire perimeters (NIFC)', 'Smoke plumes (NOAA)']) await expect(page.getByRole('checkbox', { name: other, exact: true })).not.toBeChecked();
      await expect(page.locator('.kt-environment-control')).toHaveCount(0);
      expect(s.errors).toEqual([]);
    });

    test('polygon alert is drawn and listed with event, issued, effective, expires, source and retrieval time', async ({ page, context }) => {
      const s = await setup(page, context);
      await enable(page); await open(page);
      const a = card(page, 'urn:synthetic:polygon');
      await expect(a).toBeVisible();
      await expect(a).toHaveAttribute('data-shape', 'polygon');
      await expect(a.getByRole('heading', { name: 'Red Flag Warning' })).toBeVisible();
      await expect(a).toContainText(/Issued .* · effective .* · expires /);
      await expect(a).toContainText('Map area: the alert polygon from NWS.');
      await expect(a.getByRole('link', { name: 'National Weather Service source' })).toHaveAttribute('href', 'https://www.weather.gov/fire/');
      await expect(panel(page)).toContainText('National Weather Service · retrieved');
      await expect(panel(page)).toContainText('Synthetic test data, not a current alert.');
      await expect(page.locator('path.kt-firewx-shape')).toHaveCount(1);
      await expect(page.locator('path.kt-firewx-shape')).toHaveAttribute('aria-label', 'Fire weather alert: Red Flag Warning');
      expect(await page.locator('path.kt-firewx-shape').getAttribute('d')).toMatch(/^M/);
      expect(s.zones).toEqual([]);
      expect(await noOverflow(page)).toBe(true);
      expect(s.errors).toEqual([]);
    });

    test('zone-only alert is resolved through NWS zone geometry and drawn from the zones', async ({ page, context }) => {
      const s = await setup(page, context, { cases: 'zone_only' });
      await enable(page); await open(page);
      const a = card(page, 'urn:synthetic:zone-only');
      await expect(a).toBeVisible();
      await expect(a).toContainText('Not yet in effect. Begins');
      await expect(a).toHaveAttribute('data-shape', 'zones', { timeout: 20000 });
      await expect(a).toContainText('Map area: 2 NWS zones.');
      expect(s.zones.sort()).toEqual(['fire/CAZ281', 'fire/NMZ104']);
      await expect(page.locator('path.kt-firewx-shape')).toHaveCount(1);
      await a.getByRole('button', { name: 'Show on map' }).click();
      await expect.poll(async () => (await page.locator('path.kt-firewx-shape').getAttribute('d')) || '').toMatch(/^M.{20,}/);
      expect(s.errors).toEqual([]);
    });

    test('geometry-fetch failure keeps a usable alert list and says the map area is unavailable', async ({ page, context }) => {
      const s = await setup(page, context, { cases: 'geometry_failure', zoneFail: true });
      await enable(page); await open(page);
      const a = card(page, 'urn:synthetic:zone-fail');
      await expect(a).toHaveAttribute('data-shape', 'unavailable', { timeout: 20000 });
      await expect(a).toContainText('Map area unavailable. This alert is listed without a drawn area.');
      await expect(a.getByRole('heading', { name: 'Red Flag Warning' })).toBeVisible();
      await expect(a).toContainText(/Issued .* expires /);
      await expect(a.getByRole('link', { name: 'National Weather Service source' })).toBeVisible();
      await expect(page.locator('path.kt-firewx-shape')).toHaveCount(0);
      await expect(panel(page).locator('[data-firewx-status]')).toContainText('1 current alerts');
      expect(await noOverflow(page)).toBe(true);
      const audit = await new AxeBuilder({ page }).include('.kt-firewx-control').analyze();
      expect(audit.violations).toEqual([]);
    });

    test('empty result says so without implying safety', async ({ page, context }) => {
      await setup(page, context, { cases: 'empty' });
      await enable(page); await open(page);
      await expect(panel(page).locator('.kt-firewx-empty')).toContainText('No current Red Flag Warnings or Fire Weather Watches were returned.');
      await expect(panel(page).locator('.kt-firewx-empty')).toContainText('does not mean fire danger is low');
      await expect(panel(page).locator('.kt-firewx-alert')).toHaveCount(0);
      await expect(page.locator('path.kt-firewx-shape')).toHaveCount(0);
    });

    test('expired, ended, cancelled and replaced alerts are never shown as active', async ({ page, context }) => {
      await setup(page, context, { cases: 'expired' });
      await enable(page); await open(page);
      await expect(card(page, 'urn:synthetic:polygon')).toBeVisible();
      await expect(card(page, 'urn:synthetic:expired')).toHaveCount(0);
      await expect(card(page, 'urn:synthetic:ended-early')).toHaveCount(0);
      await expect(panel(page)).toContainText('2 ended, cancelled or replaced alerts are not shown.');
    });

    test('cancelled alert disappears and an update replaces the original', async ({ page, context }) => {
      const s = await setup(page, context, { cases: 'cancelled' });
      await enable(page); await open(page);
      await expect(panel(page).locator('.kt-firewx-empty')).toBeVisible();
      await expect(card(page, 'urn:synthetic:to-cancel')).toHaveCount(0);
      await expect(panel(page)).toContainText('1 ended, cancelled or replaced alerts are not shown.');
      s.cases = 'updated';
      await panel(page).getByRole('button', { name: 'Refresh fire weather alerts' }).click();
      await expect(card(page, 'urn:synthetic:update')).toBeVisible();
      await expect(card(page, 'urn:synthetic:original')).toHaveCount(0);
    });

    test('stale data is labelled stale and still lists the alert', async ({ page, context }) => {
      await setup(page, context, { ageMinutes: 30 });
      await enable(page); await open(page);
      await expect(panel(page).locator('.kt-firewx-stale')).toContainText('Stale: retrieved');
      await expect(card(page, 'urn:synthetic:polygon')).toBeVisible();
      await expect(panel(page).locator('[data-firewx-status]')).toContainText('Stale.');
    });

    test('a failed refresh keeps the last alerts labelled stale, and a first failure shows an unavailable message', async ({ page, context }) => {
      const s = await setup(page, context);
      await enable(page); await open(page);
      await expect(card(page, 'urn:synthetic:polygon')).toBeVisible();
      await expect(panel(page).locator('.kt-firewx-stale')).toHaveCount(0);
      s.firewxStatus = 503;
      await panel(page).getByRole('button', { name: 'Refresh fire weather alerts' }).click();
      await expect(panel(page).locator('.kt-firewx-stale')).toBeVisible({ timeout: 20000 });
      await expect(panel(page).locator('[data-firewx-status]')).toContainText('Could not refresh');
      await expect(card(page, 'urn:synthetic:polygon')).toBeVisible();
    });

    test('first-load failure hides everything and offers a retry', async ({ page, context }) => {
      await setup(page, context, { firewxStatus: 503 });
      await enable(page); await open(page);
      await expect(panel(page).locator('[data-firewx-status]')).toContainText('Fire weather alerts are unavailable', { timeout: 20000 });
      await expect(panel(page).locator('.kt-firewx-alert')).toHaveCount(0);
      await expect(page.locator('path.kt-firewx-shape')).toHaveCount(0);
      await expect(panel(page).getByRole('button', { name: 'Refresh fire weather alerts' })).toBeEnabled();
      expect(await noOverflow(page)).toBe(true);
    });

    test('warnings and watches stay separate from fire perimeters and smoke, in layer, panel and look', async ({ page, context }) => {
      const s = await setup(page, context, { cases: 'mixed' });
      await enable(page, 'Fire perimeters (NIFC)');
      await expect(page.locator('[data-environment=fire]')).toContainText('1 reported perimeters');
      await enable(page, 'Smoke plumes (NOAA)');
      await expect(page.locator('[data-environment=smoke]')).toContainText('1 satellite plumes');
      await enable(page); await open(page);
      await expect(card(page, 'urn:synthetic:polygon')).toBeVisible();
      await expect(page.locator('.kt-environment-control')).not.toContainText('Red Flag Warning');
      await expect(panel(page)).not.toContainText('Fire perimeter');
      await expect(panel(page)).not.toContainText('Smoke plume');
      await expect(page.locator('path[aria-label^="Fire perimeter:"]')).toHaveCount(1);
      await expect(page.locator('path[aria-label^="Smoke plume:"]')).toHaveCount(1);
      await expect(page.locator('path.kt-firewx-shape')).toHaveCount(1);
      const strokes = await page.evaluate(() => ({ fire: document.querySelector('path[aria-label^="Fire perimeter:"]').getAttribute('stroke'), warning: document.querySelector('path.kt-firewx-shape').getAttribute('stroke') }));
      expect(strokes.warning).not.toBe(strokes.fire);
      // Turning fire weather off removes only its own panel and shapes.
      await page.getByRole('button', { name: /Map layers/ }).press('Enter');
      await page.getByRole('checkbox', { name: LAYER, exact: true }).press('Space');
      await expect(panel(page)).toHaveCount(0);
      await expect(page.locator('path.kt-firewx-shape')).toHaveCount(0);
      await expect(page.locator('path[aria-label^="Fire perimeter:"]')).toHaveCount(1);
      await expect(page.locator('[data-environment=fire]')).toContainText('1 reported perimeters');
      expect(s.requested.filter(k => k === 'firewx').length).toBe(1);
      expect(s.errors).toEqual([]);
    });

    test('Spanish and French show translated labels, event names and states', async ({ page, context }) => {
      await setup(page, context, { lang: 'es', cases: 'empty' });
      await enable(page, 'Alertas de clima de incendio (NWS)'); await open(page);
      await expect(panel(page).locator('summary')).toHaveText('Alertas de clima de incendio');
      await expect(panel(page)).toContainText('No se devolvieron advertencias de bandera roja');
      await page.close();
      const fr = await context.newPage(); await fr.setViewportSize(view.size);
      await fr.addInitScript(([l]) => { localStorage.setItem('kt_last_position', JSON.stringify({ lat: l.lat, lng: l.lng, zoom: 9 })); localStorage.setItem('kt_language', 'fr'); }, [centre]);
      await fr.goto('/', { waitUntil: 'domcontentloaded' });
      await fr.waitForFunction(() => window.KampTrailFireWeather && window.KampTrailData && !KampTrailData.getLoadStatus().loading);
      await enable(fr, 'Alertes météo d’incendie (NWS)'); await open(fr);
      await expect(fr.locator('.kt-firewx-control summary')).toHaveText('Alertes météo d’incendie');
      await expect(fr.locator('.kt-firewx-control')).toContainText('Aucun avertissement de drapeau rouge');
    });
  });
}

test('offline hides fire-weather alerts instead of showing old ones as current', async ({ page, context }) => {
  await setup(page, context);
  await enable(page); await open(page);
  await expect(card(page, 'urn:synthetic:polygon')).toBeVisible();
  await context.setOffline(true);
  await expect(panel(page).locator('[data-firewx-status]')).toContainText('Offline: live context is hidden');
  await expect(panel(page).locator('.kt-firewx-alert')).toHaveCount(0);
  await expect(page.locator('path.kt-firewx-shape')).toHaveCount(0);
});
