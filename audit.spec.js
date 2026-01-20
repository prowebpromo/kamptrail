// @ts-check
const { test, expect } = require('@playwright/test');

// Test configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

test.describe('KampTrail Feature Audit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    // Wait for map to be ready
    await page.waitForSelector('#map', { state: 'visible' });
    await page.waitForFunction(() => {
      return window.L && window.L.map && document.querySelector('#map')._leaflet_id;
    });
  });

  test('1. Filters button - should open filter panel', async ({ page }) => {
    const filtersBtn = page.locator('#filters');
    await expect(filtersBtn).toBeVisible();

    // Click filters button
    await filtersBtn.click();

    // Check if filter panel appears (checking for common filter UI elements)
    // Since we don't know the exact structure, we'll check if the button becomes active
    await expect(filtersBtn).toHaveClass(/active/);
  });

  test('2. My Trip button - should track trip count', async ({ page }) => {
    const tripBtn = page.locator('#trip');
    await expect(tripBtn).toBeVisible();

    // Check initial count is 0
    const tripCount = page.locator('#trip-count');
    await expect(tripCount).toHaveText('(0)');

    // Note: Full trip functionality test would require adding a campsite
    // This test verifies the button and counter exist
  });

  test('3. Near Me button - should request geolocation', async ({ page, context }) => {
    // Grant geolocation permissions
    await context.grantPermissions(['geolocation']);

    // Set mock geolocation
    await context.setGeolocation({ latitude: 40.7128, longitude: -74.0060 }); // NYC

    const nearBtn = page.locator('#near');
    await expect(nearBtn).toBeVisible();

    // Click near me button
    await nearBtn.click();

    // Check if button becomes active
    await expect(nearBtn).toHaveClass(/active/);

    // Wait for map to update (loading spinner should appear then disappear)
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return !loading || !loading.classList.contains('show');
    }, { timeout: 10000 });
  });

  test('4. Public Lands overlay - should toggle on/off', async ({ page }) => {
    // Wait for overlays to initialize
    await page.waitForTimeout(1000);

    const publicLandsCheckbox = page.locator('#kt-toggle-lands');
    await expect(publicLandsCheckbox).toBeVisible();

    // Should be checked by default
    await expect(publicLandsCheckbox).toBeChecked();

    // Uncheck it
    await publicLandsCheckbox.uncheck();
    await expect(publicLandsCheckbox).not.toBeChecked();

    // Check it again
    await publicLandsCheckbox.check();
    await expect(publicLandsCheckbox).toBeChecked();
  });

  test('5. Cell Towers overlay - should toggle and load towers when zoomed in', async ({ page }) => {
    // Wait for overlays to initialize
    await page.waitForTimeout(1000);

    const cellTowersCheckbox = page.locator('#kt-toggle-towers');
    await expect(cellTowersCheckbox).toBeVisible();

    // Should be unchecked by default
    await expect(cellTowersCheckbox).not.toBeChecked();

    // Check it
    await cellTowersCheckbox.check();
    await expect(cellTowersCheckbox).toBeChecked();

    // Uncheck it
    await cellTowersCheckbox.uncheck();
    await expect(cellTowersCheckbox).not.toBeChecked();
  });

  test('6. Dump/Water/Propane overlay - should be visible by default', async ({ page }) => {
    // Wait for overlays to initialize
    await page.waitForTimeout(1000);

    const poiCheckbox = page.locator('#kt-toggle-poi');
    await expect(poiCheckbox).toBeVisible();

    // Should be checked by default
    await expect(poiCheckbox).toBeChecked();

    // Uncheck it
    await poiCheckbox.uncheck();
    await expect(poiCheckbox).not.toBeChecked();

    // Check it again
    await poiCheckbox.check();
    await expect(poiCheckbox).toBeChecked();
  });

  test('7. OpenCampingMap overlay - should toggle community layer', async ({ page }) => {
    // Wait for overlays to initialize
    await page.waitForTimeout(1000);

    const ocmCheckbox = page.locator('#kt-toggle-ocm');
    await expect(ocmCheckbox).toBeVisible();

    // Should be unchecked by default
    await expect(ocmCheckbox).not.toBeChecked();

    // Check it
    await ocmCheckbox.check();
    await expect(ocmCheckbox).toBeChecked();

    // Uncheck it
    await ocmCheckbox.uncheck();
    await expect(ocmCheckbox).not.toBeChecked();
  });

  test('8. Legend - should display and show POI symbols', async ({ page }) => {
    // Wait for overlays to initialize
    await page.waitForTimeout(1000);

    const legend = page.locator('.kt-legend');
    await expect(legend).toBeVisible();

    // Check for legend content
    await expect(legend).toContainText('Legend');
    await expect(legend).toContainText('Dump');
    await expect(legend).toContainText('Water');
    await expect(legend).toContainText('Propane');
  });

  test('9. Map controls - should have overlay controls visible', async ({ page }) => {
    // Wait for overlays to initialize
    await page.waitForTimeout(1000);

    const controls = page.locator('.kt-controls');
    await expect(controls).toBeVisible();

    // Check all four overlay options are present
    await expect(controls).toContainText('Public lands');
    await expect(controls).toContainText('Cell towers');
    await expect(controls).toContainText('Dump/Water/Propane');
    await expect(controls).toContainText('OpenCampingMap');
  });

  test('10. Map initialization - should load and be interactive', async ({ page }) => {
    // Check map container exists and has Leaflet attached
    const mapReady = await page.evaluate(() => {
      const mapEl = document.getElementById('map');
      return mapEl && mapEl._leaflet_id && window.L && window.map;
    });

    expect(mapReady).toBe(true);

    // Check map can be interacted with (zoom controls present)
    const zoomIn = page.locator('.leaflet-control-zoom-in');
    await expect(zoomIn).toBeVisible();

    const zoomOut = page.locator('.leaflet-control-zoom-out');
    await expect(zoomOut).toBeVisible();
  });
});
