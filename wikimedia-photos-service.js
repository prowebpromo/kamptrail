/*
 * KampTrail Wikimedia Commons Photos Service
 *
 * Fetches nearby geo-tagged photos from Wikimedia Commons using their free,
 * key-less public API. Photos are searched by proximity to campsite coordinates.
 */
(function() {
  'use strict';

  const API_BASE = 'https://commons.wikimedia.org/w/api.php';
  const SEARCH_RADIUS_METERS = 2000;
  const MAX_PHOTOS = 5;
  const THUMB_WIDTH = 400;

  // Simple in-memory cache (session lifetime)
  const cache = new Map();

  /**
   * Searches Wikimedia Commons for geotagged images near a coordinate.
   * @param {number} lat
   * @param {number} lng
   * @returns {Promise<Array>} Array of {url, title, page} objects, or empty array.
   */
  async function fetchNearbyPhotos(lat, lng) {
    const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    try {
      // Step 1: geosearch for nearby image pages
      const geoParams = new URLSearchParams({
        action: 'query',
        list: 'geosearch',
        gscoord: `${lat}|${lng}`,
        gsradius: SEARCH_RADIUS_METERS,
        gslimit: MAX_PHOTOS,
        gsnamespace: 6, // File namespace
        format: 'json',
        origin: '*'
      });

      const geoResp = await fetch(`${API_BASE}?${geoParams}`);
      if (!geoResp.ok) throw new Error(`Geosearch HTTP ${geoResp.status}`);
      const geoData = await geoResp.json();

      const pages = (geoData.query && geoData.query.geosearch) || [];
      if (pages.length === 0) {
        cache.set(cacheKey, []);
        return [];
      }

      // Step 2: fetch thumbnail URLs for those page IDs
      const pageIds = pages.map(p => p.pageid).join('|');
      const infoParams = new URLSearchParams({
        action: 'query',
        pageids: pageIds,
        prop: 'imageinfo',
        iiprop: 'url|extmetadata',
        iiurlwidth: THUMB_WIDTH,
        format: 'json',
        origin: '*'
      });

      const infoResp = await fetch(`${API_BASE}?${infoParams}`);
      if (!infoResp.ok) throw new Error(`Imageinfo HTTP ${infoResp.status}`);
      const infoData = await infoResp.json();

      const results = [];
      const queryPages = (infoData.query && infoData.query.pages) || {};
      for (const page of Object.values(queryPages)) {
        const info = page.imageinfo && page.imageinfo[0];
        if (!info || !info.thumburl) continue;
        const meta = info.extmetadata || {};
        const author = (meta.Artist && meta.Artist.value) ? meta.Artist.value.replace(/<[^>]*>/g, '') : null;
        results.push({
          url: info.thumburl,
          title: page.title ? page.title.replace('File:', '') : '',
          pageUrl: info.descriptionurl || null,
          author
        });
      }

      cache.set(cacheKey, results);
      return results;

    } catch (err) {
      console.error('[Wikimedia Photos] Error fetching photos:', err);
      return [];
    }
  }

  window.KampTrailPhotos = {
    /**
     * Fetches nearby Wikimedia Commons photos for a campsite location.
     * @param {number} lat
     * @param {number} lng
     * @returns {Promise<Array>}
     */
    getNearbyPhotos: (lat, lng) => fetchNearbyPhotos(lat, lng)
  };

})();
