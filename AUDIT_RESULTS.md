# Feature Audit Results

This report summarizes the results of the automated feature audit performed on the Kamptrail application. The audit was conducted using a Playwright test suite that verified the functionality of the main toolbar buttons and map style overlays.

## Summary

| Feature | Status | Details |
| --- | --- | --- |
| **Filters** | ✅ Passed | The filter panel opens and closes correctly. |
| **My Trip** | ❌ Failed | The test timed out while attempting to add a campsite to the trip. |
| **Near Me** | ❌ Failed | The test timed out while waiting for the map to zoom to the user's location. |
| **Public Lands Overlay** | ❌ Failed | The public lands layer was not visible when the test expected it to be. |
| **Cell Towers Overlay** | ❌ Failed | The cell tower markers were not visible after enabling the layer. |
| **Dump/Water/Propane Overlay** | ✅ Passed | The POI markers are displayed and can be toggled correctly. |
| **OpenCampingMap Overlay** | ❌ Failed | The OpenCampingMap markers were not visible after enabling the layer. |

## Failures

### 1. My Trip
- **Error**: `Test timeout of 30000ms exceeded.`
- **Details**: The test timed out while trying to click on the first campsite marker. This suggests an issue with the marker's visibility or interactivity.

### 2. Near Me
- **Error**: `Test timeout of 30000ms exceeded.`
- **Details**: The test timed out while waiting for the map to zoom to the user's mocked location. This indicates that the geolocation functionality is not working as expected.

### 3. Public Lands Overlay
- **Error**: `expect(locator).toBeVisible() failed`
- **Details**: The test expected the public lands layer to be visible by default, but it was hidden. This points to a problem with the layer's initial state.

### 4. Cell Towers Overlay
- **Error**: `expect(locator).toBeVisible() failed`
- **Details**: The cell tower markers did not appear after the layer was enabled. This suggests an issue with the OpenCelliD API integration or the rendering of the markers.

### 5. OpenCampingMap Overlay
- **Error**: `expect(locator).toBeVisible() failed`
- **Details**: The OpenCampingMap markers were not visible after enabling the layer. This indicates a problem with the loading or rendering of the `opencampingmap.geojson` data.
