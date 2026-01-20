/*
 * KampTrail Google Places Service
 *
 * This service handles all interactions with the Google Maps JavaScript API's
 * Places Service. It finds places, fetches details (photos, ratings), and
 * caches results to minimize API costs.
 */
(function() {
  'use strict';

  // This will hold the google.maps.places.PlacesService instance.
  // It's initialized on the first request to ensure the Maps API is loaded.
  let placesService;

  /**
   * Simple localStorage cache with a 24-hour expiration.
   */
  const cache = {
    _getLocalStorageKey: (key) => `kt_google_cache_${key}`,

    get: (key) => {
      try {
        const itemStr = localStorage.getItem(cache._getLocalStorageKey(key));
        if (!itemStr) return null;

        const item = JSON.parse(itemStr);
        const now = new Date().getTime();

        if (now - item.timestamp > 86400000) { // 24 hours
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
   * Initializes the PlacesService. We need a map element to instantiate it,
   * so we'll temporarily create a hidden one.
   */
  function initService() {
    if (placesService) return;
    // The PlacesService constructor needs a map or an HTMLDivElement.
    // It doesn't need to be visible or attached to the DOM.
    const mapDiv = document.createElement('div');
    placesService = new google.maps.places.PlacesService(mapDiv);
  }

  /**
   * Uses the textSearch method to find the Place ID for a given campsite.
   *
   * @param {string} campsiteName
   * @param {number} lat
   * @param {number} lng
   * @returns {Promise<string|null>} Resolves with the Place ID or null.
   */
  function findPlaceId(campsiteName, lat, lng) {
    return new Promise((resolve, reject) => {
      const cacheKey = `placeid_${campsiteName}_${lat}_${lng}`;
      const cachedId = cache.get(cacheKey);
      if (cachedId) {
        console.log(`[Google Places] Cache HIT for Place ID search: ${campsiteName}`);
        return resolve(cachedId);
      }

      const request = {
        query: campsiteName,
        location: new google.maps.LatLng(lat, lng),
        rankBy: google.maps.places.RankBy.DISTANCE // Prioritize closest results
      };

      placesService.textSearch(request, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results.length > 0) {
          const placeId = results[0].place_id;
          cache.set(cacheKey, placeId);
          resolve(placeId);
        } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
          resolve(null);
        } else if (status === google.maps.places.PlacesServiceStatus.OVER_QUERY_LIMIT) {
          console.warn('[Google Places] API quota exceeded.');
          reject({ error: 'QUOTA_EXCEEDED' });
        }
        else {
          console.error(`[Google Places] textSearch failed with status: ${status}`);
          reject(new Error(`PlacesService textSearch error: ${status}`));
        }
      });
    });
  }

  /**
   * Fetches details for a specific Place ID.
   * Uses a field mask to request only the necessary data.
   *
   * @param {string} placeId
   * @returns {Promise<Object|null>} Resolves with place details or null.
   */
  function fetchPlaceDetails(placeId) {
    return new Promise((resolve, reject) => {
        const cachedData = cache.get(placeId);
        if (cachedData) {
            console.log(`[Google Places] Cache HIT for Place ID: ${placeId}`);
            // The cached data already has photo URLs processed.
            return resolve(cachedData);
        }
        console.log(`[Google Places] Cache MISS for Place ID: ${placeId}. Fetching from API...`);

      const request = {
        placeId: placeId,
        // Crucial field mask to control costs
        fields: ['name', 'rating', 'user_ratings_total', 'photos', 'place_id', 'url']
      };

      placesService.getDetails(request, (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK) {
            // Process photo URLs before caching and returning
            const processedPlace = { ...place };
            if (processedPlace.photos && processedPlace.photos.length > 0) {
                processedPlace.photos = processedPlace.photos.slice(0, 5).map(p => ({
                    // Get a URL for a reasonable size
                    url: p.getUrl({ maxWidth: 400, maxHeight: 400 }),
                    // The attribution is required by Google's ToS
                    attribution: p.html_attributions[0]
                }));
            }
          cache.set(placeId, processedPlace);
          resolve(processedPlace);
        } else if (status === google.maps.places.PlacesServiceStatus.OVER_QUERY_LIMIT) {
            console.warn('[Google Places] API quota exceeded.');
            reject({ error: 'QUOTA_EXCEEDED' });
        } else {
            console.error(`[Google Places] getDetails failed with status: ${status}`);
            reject(new Error(`PlacesService getDetails error: ${status}`));
        }
      });
    });
  }


  window.KampTrailGoogle = {
    /**
     * Checks if the Google Maps JavaScript API with the 'places' library is available.
     * @returns {boolean}
     */
    isInitialized: () => {
      return typeof google !== 'undefined' && google.maps && google.maps.places;
    },

    /**
     * Main public method to get Google Places data for a campsite.
     *
     * @param {string} campsiteName
     * @param {number} lat
     * @param {number} lng
     * @returns {Promise<Object|null>} Place details or null.
     */
    getPlaceDetails: async (campsiteName, lat, lng) => {
      if (!KampTrailGoogle.isInitialized()) {
        console.warn('[Google Places] Google Maps API not loaded. Cannot fetch details.');
        return { error: 'API_NOT_LOADED' };
      }

      // Initialize the service on the first call
      initService();

      try {
        const placeId = await findPlaceId(campsiteName, lat, lng);
        if (!placeId) return null;

        return await fetchPlaceDetails(placeId);
      } catch (error) {
        if (error.error === 'QUOTA_EXCEEDED') {
            return { error: 'QUOTA_EXCEEDED' };
        }
        console.error(`[Google Places] Failed to get details for ${campsiteName}:`, error);
        return null;
      }
    }
  };

})();
