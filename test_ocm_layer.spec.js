const { test, expect } = require('@playwright/test');

test.describe('OpenCampingMap Layer', () => {
  test('should toggle the layer and display campsite details in the panel', async ({ page }) => {
    await page.goto('http://localhost:3000');

    // Wait for the map to be visible
    await expect(page.locator('#map')).toBeVisible({ timeout: 10000 });

    const ocmToggle = page.locator('#kt-toggle-ocm');

    // Layer should be off by default
    await expect(ocmToggle).not.toBeChecked();

    // Enable the OpenCampingMap layer
    await ocmToggle.check();
    await expect(ocmToggle).toBeChecked();

    // Wait for markers to be visible
    await page.waitForSelector('.leaflet-marker-icon', { state: 'visible', timeout: 15000 });

    // Click the first marker
    await page.locator('.leaflet-marker-icon').first().click();

    // The panel should be visible
    const panel = page.locator('#kt-detail-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/kt-panel-open/);

    // Check the content of the panel
    await expect(panel.locator('.kt-panel-content')).toContainText('Sample Campsite 1');
    await expect(panel.locator('.kt-panel-content')).toContainText('From OpenCampingMap');

    // Take a screenshot for verification
    await page.screenshot({ path: 'ocm_panel_open.png' });

    // Close the panel
    await panel.locator('.kt-panel-close').click();
    await expect(panel).not.toHaveClass(/kt-panel-open/);

    // Disable the OpenCampingMap layer
    await ocmToggle.uncheck();
    await expect(ocmToggle).not.toBeChecked();
  });
});
