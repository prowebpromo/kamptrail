const { test, expect } = require('@playwright/test');

test.describe('Feature Audit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8000');
  });

  test('should open and close the filter panel', async ({ page }) => {
    const filterPanel = page.locator('#kt-filter-panel');
    await expect(filterPanel).not.toBeVisible();

    await page.click('#filters');
    await expect(filterPanel).toBeVisible();

    await page.click('#filters');
    await expect(filterPanel).not.toBeVisible();
  });

  test('should add a campsite to the trip planner', async ({ page }) => {
    await page.waitForSelector('#loading', { state: 'hidden' });

    const tripCount = page.locator('#trip-count');
    await expect(tripCount).toHaveText('(0)');

    await page.locator('.leaflet-marker-icon').first().click();
    await page.waitForSelector('.leaflet-popup-content');

    await page.click('button:has-text("Add to Trip")');
    await expect(tripCount).toHaveText('(1)');
  });

  test('should zoom to the user\'s location', async ({ page, context }) => {
    await context.setGeolocation({ latitude: 34.0522, longitude: -118.2437 });

    const getMapState = () => page.evaluate(() => ({
      center: map.getCenter(),
      zoom: map.getZoom(),
    }));

    const initialState = await getMapState();
    expect(initialState.zoom).toBe(5);

    await page.click('#near');
    await page.waitForFunction(
      (expectedZoom) => map.getZoom() > expectedZoom,
      initialState.zoom
    );

    const newState = await getMapState();
    expect(newState.zoom).toBe(11);
    expect(newState.center.lat).toBeCloseTo(34.0522);
    expect(newState.center.lng).toBeCloseTo(-118.2437);
  });

  test('should toggle the public lands overlay', async ({ page }) => {
    const publicLandsCheckbox = page.locator('#kt-toggle-lands');
    await expect(publicLandsCheckbox).toBeChecked();

    const getPublicLandsLayer = () => page.locator('img[src*="arcgis.com"]');

    await expect(getPublicLandsLayer().first()).toBeVisible();

    await publicLandsCheckbox.uncheck();
    await page.waitForTimeout(500); // Wait for layer to fade
    await expect(getPublicLandsLayer().first()).not.toBeVisible();

    await publicLandsCheckbox.check();
    await expect(getPublicLandsLayer().first()).toBeVisible();
  });

  test('should toggle the cell towers overlay', async ({ page }) => {
    // Mock the OpenCelliD API response
    await page.route('**/opencellid.org/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cells: [
            { lat: 39.8, lon: -98.5, radio: 'LTE' },
            { lat: 39.9, lon: -98.6, radio: 'GSM' },
          ],
        }),
      });
    });

    const cellTowersCheckbox = page.locator('#kt-toggle-towers');
    await expect(cellTowersCheckbox).not.toBeChecked();

    // Zoom in to a level where towers are visible
    await page.evaluate(() => map.setView([39.85, -98.55], 10));

    await cellTowersCheckbox.check();

    const towerMarkers = page.locator('.kt-tower');
    await expect(towerMarkers.first()).toBeVisible();
    await expect(await towerMarkers.count()).toBe(2);

    await cellTowersCheckbox.uncheck();
    await expect(towerMarkers.first()).not.toBeVisible();
  });

  test('should toggle the POI overlay', async ({ page }) => {
    const poiCheckbox = page.locator('#kt-toggle-poi');
    await expect(poiCheckbox).toBeChecked();

    const poiMarkers = page.locator('.kt-poi');
    await expect(poiMarkers.first()).toBeVisible();

    await poiCheckbox.uncheck();
    await expect(poiMarkers.first()).not.toBeVisible();

    await poiCheckbox.check();
    await expect(poiMarkers.first()).toBeVisible();
  });

  test('should toggle the OpenCampingMap overlay', async ({ page }) => {
    // Mock the OpenCampingMap geojson response
    await page.route('**/data/opencampingmap.geojson', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [-98.5, 39.8] },
              properties: { name: 'OCM Test Camp' },
            },
          ],
        }),
      });
    });

    const ocmCheckbox = page.locator('#kt-toggle-ocm');
    await expect(ocmCheckbox).not.toBeChecked();

    const ocmMarkers = page.locator('img.leaflet-marker-icon[title="OCM Test Camp"]');
    await expect(ocmMarkers).not.toBeVisible();

    await ocmCheckbox.check();
    await expect(ocmMarkers).toBeVisible();

    await ocmCheckbox.uncheck();
    await expect(ocmMarkers).not.toBeVisible();
  });
});
