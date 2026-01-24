
(function() {
  'use strict';

  const cache = new Map();
  const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

  // API key is loaded from config.js, which is git-ignored.
  const API_KEY = window.GOOGLE_API_KEY || '';

  /**
   * Fetches place details from Google Places API using a text query.
   * Caches results to minimize API calls.
   * @param {string} campsiteName The name of the campsite to search for.
   * @param {number} lat The latitude of the campsite.
   * @param {number} lng The longitude of the campsite.
   * @returns {Promise<object|null>} A promise that resolves to the place details or null if not found.
   */
  async function findPlace(campsiteName, lat, lng) {
    const cacheKey = `${campsiteName}_${lat}_${lng}`;
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_DURATION_MS) {
        console.log('CACHE HIT:', cacheKey);
        return cached.data;
      }
    }

    console.log('API CALL: Searching for place:', campsiteName);

    if (API_KEY === 'YOUR_GOOGLE_API_KEY') {
        console.error('API Key not set. Please replace YOUR_GOOGLE_API_KEY.');
        // Gracefully fail without breaking the UI
        return { error: 'API key not configured.' };
    }

    const searchUrl = 'https://places.googleapis.com/v1/places:searchText';

    // The text query is the primary signal. Location is a strong bias.
    const requestBody = {
      textQuery: campsiteName,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 500.0 // Bias search within a 500-meter radius
        }
      }
    };

    // This FieldMask is CRITICAL for controlling API costs.
    // We request all the data we need in a single, efficient call.
    const fields = 'places.id,places.displayName,places.rating,places.userRatingCount,places.photos,places.googleMapsUri';

    try {
      const response = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': fields
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        if (response.status === 429) {
            console.warn('Google Places API quota exceeded.');
            return { error: 'QUOTA_EXCEEDED' };
        }
        const errorData = await response.json();
        console.error('Error searching for place:', errorData.error.message);
        throw new Error(`Google Places search failed: ${errorData.error.message}`);
      }

      const data = await response.json();

      if (!data.places || data.places.length === 0) {
        console.log('No Google Place found for:', campsiteName);
        return null;
      }

      const place = data.places[0];
      console.log('Found and fetched place details:', place);

      // Cache the successful result
      cache.set(cacheKey, { timestamp: Date.now(), data: place });

      return place;

    } catch (error) {
      console.error('Error in findPlace:', error);
      return null;
    }
  }

  /**
   * Constructs a full, usable photo URL from a photo reference name.
   * @param {string} photoName The 'name' property of a photo object from the Places API response.
   * @param {number} maxWidth The maximum desired width of the photo.
   * @returns {string} The full photo URL.
   */
  function getPhotoUrl(photoName, maxWidth = 400) {
    if (!photoName) return '';
    // The URL format is `https://places.googleapis.com/v1/{PHOTO_RESOURCE_NAME}/media?maxHeightPx=...&key=...`
    return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidth}&key=${API_KEY}`;
  }


  window.GooglePlacesService = {
    findPlace,
    getPhotoUrl
  };

})();
