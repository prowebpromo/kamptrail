/*
 * KampTrail Google Places Service
 *
 * This service handles all interactions with the Google Places API (New),
 * including searching for campsites, fetching details, and caching results
 * to minimize API costs and stay within the free tier.
 */
(function() {
  'use strict';

  const state = {
    apiKey: null,
    // Base URL for the new Places API
    apiUrl: 'https://places.googleapis.com/v1/places'
  };

  /**
   * Simple in-memory cache and localStorage cache with a 24-hour expiration.
   */
  const cache = {
    _getLocalStorageKey: (key) => `kt_google_cache_${key}`,

    get: (key) => {
      try {
        const itemStr = localStorage.getItem(cache._getLocalStorageKey(key));
        if (!itemStr) return null;

        const item = JSON.parse(itemStr);
        const now = new Date().getTime();

        // Check if item is older than 24 hours (24 * 60 * 60 * 1000 ms)
        if (now - item.timestamp > 86400000) {
          localStorage.removeItem(cache._getLocalStorageKey(key));
          return null;
        }
        return item.data;
      } catch (e) {
        console.error('Cache read error:', e);
        return null;
      }
    },

    set: (key, value) => {
      try {
        const item = {
          data: value,
          timestamp: new Date().getTime()
        };
        localStorage.setItem(cache._getLocalStorageKey(key), JSON.stringify(item));
      } catch (e) {
        console.error('Cache write error:', e);
      }
    }
  };


  /**
   * Fetches details for a specific Place ID from the Google Places API.
   * Uses a field mask to request only the necessary data to control costs.
   *
   * @param {string} placeId - The Google Place ID.
   * @returns {Promise<Object|null>} A promise that resolves with the place details or null on error.
   */
  async function fetchPlaceDetails(placeId) {
    if (!state.apiKey) throw new Error('Google Places API key is not set.');
    if (!placeId) return null;

    // Check cache first
    const cachedData = cache.get(placeId);
    if (cachedData) {
      console.log(`[Google Places] Cache HIT for Place ID: ${placeId}`);
      return cachedData;
    }
    console.log(`[Google Places] Cache MISS for Place ID: ${placeId}. Fetching from API...`);

    // Field mask to control costs - this is crucial.
    const fields = 'id,displayName,rating,userRatingCount,photos';
    const url = `${state.apiUrl}/${placeId}?fields=${fields}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': state.apiKey,
        }
      });

      if (response.status === 429 || response.status === 403) {
        console.warn('[Google Places] API quota exceeded or key issue. Gracefully disabling for now.');
        return { error: 'QUOTA_EXCEEDED' };
      }
      if (!response.ok) {
        throw new Error(`API returned status ${response.status}`);
      }

      const data = await response.json();

      // Remap photos to full URLs for easier use on the frontend
      if (data.photos && data.photos.length > 0) {
        data.photos = data.photos.map(photo => ({
          ...photo,
          url: `https://places.googleapis.com/v1/${photo.name}/media?key=${state.apiKey}&maxWidthPx=400`
        }));
      }

      cache.set(placeId, data);
      return data;

    } catch (error) {
      console.error('[Google Places] Error fetching place details:', error);
      return null;
    }
  }

  /**
   * Uses the searchText endpoint to find the Place ID for a given campsite.
   *
   * @param {string} campsiteName - The name of the campsite.
   * @param {number} lat - The latitude of the campsite.
   * @param {number} lng - The longitude of the campsite.
   * @returns {Promise<string|null>} A promise that resolves with the Place ID or null if not found.
   */
  async function findPlaceId(campsiteName, lat, lng) {
     if (!state.apiKey) throw new Error('Google Places API key is not set.');

     const cacheKey = `placeid_${campsiteName}_${lat}_${lng}`;
     const cachedId = cache.get(cacheKey);
     if(cachedId) {
       console.log(`[Google Places] Cache HIT for Place ID search: ${campsiteName}`);
       return cachedId;
     }

    const url = `${state.apiUrl}:searchText`;
    const query = `${campsiteName}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': state.apiKey,
        },
        body: JSON.stringify({
          textQuery: query,
          locationBias: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: 5000.0 // 5km radius bias
            }
          }
        })
      });

      if (response.status === 429 || response.status === 403) {
        console.warn('[Google Places] API quota exceeded or key issue.');
        return { error: 'QUOTA_EXCEEDED' };
      }
      if (!response.ok) throw new Error(`API returned status ${response.status}`);

      const data = await response.json();

      if (data.places && data.places.length > 0) {
        const placeId = data.places[0].id;
        cache.set(cacheKey, placeId);
        return placeId;
      }
      return null;

    } catch (error) {
      console.error('[Google Places] Error searching for place:', error);
      return null;
    }
  }


  window.KampTrailGoogle = {
    /**
     * Initializes the service with the Google Places API key.
     * @param {string} apiKey
     */
    init: (apiKey) => {
      if (!apiKey) {
        console.warn('[Google Places] API key is missing. Google Places integration is disabled.');
        return;
      }
      state.apiKey = apiKey;
      console.log('[Google Places] Service initialized.');
    },

    /**
     * The main public method to get Google Places data for a campsite.
     * It orchestrates finding the place ID and then fetching the details.
     *
     * @param {string} campsiteName - The name of the campsite.
     * @param {number} lat - The latitude.
     * @param {number} lng - The longitude.
     * @returns {Promise<Object|null>} Place details or null.
     */
    getPlaceDetails: async (campsiteName, lat, lng) => {
      try {
        const placeId = await findPlaceId(campsiteName, lat, lng);
        if (placeId && placeId.error) return placeId; // Propagate quota error
        if (!placeId) return null;

        return await fetchPlaceDetails(placeId);
      } catch (error) {
        console.error(`[Google Places] Failed to get details for ${campsiteName}:`, error);
        return null;
      }
    }
  };

})();
