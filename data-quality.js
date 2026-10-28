/* Normalize source records without turning missing information into camping advice. */
(function (global) {
  'use strict';
  const validNumber = n => typeof n === 'number' && Number.isFinite(n);
  const normalizeName = value => String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  function getLatLng(feature) {
    if (feature?.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) return null;
    const [lon, lat] = feature.geometry.coordinates;
    return validNumber(lat) && validNumber(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0) ? {lat, lon} : null;
  }
  function isPlaceholder(name) {
    return !String(name || '').trim() || /^(?:sample|test|demo|fake|dummy|placeholder)(?:\s+(?:campsite|campground|site|data|meadow))?\s*\d*$/i.test(String(name).trim()) || /^(?:unknown campsite|unnamed site(?: \(osm\))?|tbd|coming soon|lorem ipsum)$/i.test(String(name).trim());
  }
  function normalizeFeature(feature, options = {}) {
    const ll = getLatLng(feature);
    if (!ll) return null;
    const raw = feature.properties || {};
    const name = String(raw.name || raw.Name || raw.title || raw.site_name || raw.location_name || '').trim();
    if (isPlaceholder(name)) return null;
    const sources = [...new Set([...(Array.isArray(raw.sources) ? raw.sources : []), raw.source, raw.provider].filter(Boolean).map(String))];
    const ridb = raw.facility_id != null || sources.some(s => /recreation\.gov|\bridb\b/i.test(s));
    const osm = raw.osm_id != null || raw.tourism === 'camp_site' || raw.tourism === 'caravan_site';
    const legacyRIDB = ridb && !(Number(raw.schema_version) >= 3) && !raw._kt_normalized;
    const p = {...raw, name, sources, state: raw.state || raw['addr:state'] || options.state || null};
    p.legacy_ids = [...new Set([...(Array.isArray(raw.legacy_ids) ? raw.legacy_ids : []), raw.id].filter(v => v != null && v !== '').map(String))];
    const coordKey = `${ll.lon.toFixed(6)},${ll.lat.toFixed(6)}`;
    if (ridb && raw.facility_id != null) p.id = `ridb:${raw.facility_id}`;
    else if (osm && raw.osm_id != null) {
      const elementType = raw.osm_type || (['node', 'way', 'relation'].includes(raw.type) ? raw.type : 'unknown');
      p.id = `osm:${elementType}:${raw.osm_id}${elementType === 'unknown' ? ':' + coordKey : ''}`;
    } else p.id = raw.id != null && raw.id !== '' ? String(raw.id) : `site:${normalizeName(name)}:${coordKey}`;
    if (legacyRIDB) p.legacy_inferred = {cost:raw.cost, amenities:raw.amenities, rig_friendly:raw.rig_friendly, road_difficulty:raw.road_difficulty};
    const feeEvidence = raw._kt_normalized || Number(raw.schema_version) >= 3 || !!raw.field_provenance?.cost;
    p.cost = feeEvidence && !legacyRIDB && validNumber(raw.cost) && raw.cost >= 0 ? raw.cost : null;
    p.fee_status = feeEvidence && !legacyRIDB && ['free', 'paid', 'unknown'].includes(raw.fee_status) ? raw.fee_status : 'unknown';
    if (feeEvidence && !legacyRIDB && p.cost !== null) p.fee_status = p.cost === 0 ? 'free' : 'paid';
    if (osm && /^(no|0|false)$/i.test(String(raw.fee))) {p.fee_status = 'free'; p.cost = 0;}
    else if (osm && /^(yes|true)$/i.test(String(raw.fee))) {p.fee_status = 'paid'; if (p.cost === 0) p.cost = null;}
    p.type = ['established', 'dispersed', 'parking', 'backcountry', 'other'].includes(raw.type) ? raw.type : (osm ? 'established' : 'other');
    const aliases = {toilets:'toilet', restrooms:'toilet', drinking_water:'water', potable_water:'water', fire_rings:'fire_ring', picnic_tables:'picnic_table', sanitary_dump_station:'dump', waste_disposal:'dump'};
    p.amenity_negatives = Array.isArray(raw.amenity_negatives) ? [...raw.amenity_negatives] : [];
    p.amenities = !legacyRIDB && Array.isArray(raw.amenities) ? [...new Set(raw.amenities.filter(a => typeof a === 'string').map(a => aliases[a] || a))] : [];
    // OSM tags retain explicit yes/no values. Missing tags are unknown.
    if (osm) {
      const tags = {toilet:['toilets'], water:['drinking_water'], dump:['sanitary_dump_station'], fire_ring:['fireplace'], picnic_table:['picnic_table'], shower:['shower']};
      for (const [amenity, names] of Object.entries(tags)) {
        if (names.some(tag => String(raw[tag]).toLowerCase() === 'yes')) p.amenities.push(amenity);
        if (names.some(tag => String(raw[tag]).toLowerCase() === 'no')) {p.amenity_negatives.push(amenity);p.amenities = p.amenities.filter(a => a !== amenity);}
      }
      p.amenities = [...new Set(p.amenities)];
    }
    p.rig_friendly = !legacyRIDB && Array.isArray(raw.rig_friendly) ? [...new Set(raw.rig_friendly.filter(v => typeof v === 'string').map(v => v === 'RV' ? 'rv' : v))] : [];
    if (osm) {
      if (raw.tents === 'yes') p.rig_friendly.push('tent');
      if (raw.caravans === 'yes') p.rig_friendly.push('trailer');
      if (raw.motorhome === 'yes') p.rig_friendly.push('rv');
      p.rig_friendly = [...new Set(p.rig_friendly)];
    }
    p.road_difficulty = !legacyRIDB && typeof raw.road_difficulty === 'string' ? raw.road_difficulty : null;
    p.rating = !legacyRIDB && validNumber(raw.rating) && raw.rating >= 0 && raw.rating <= 5 ? raw.rating : null;
    p.reviews_count = p.rating !== null && Number.isInteger(raw.reviews_count) && raw.reviews_count >= 0 ? raw.reviews_count : 0;
    if (ridb && raw.facility_id != null) p.source_url = `https://www.recreation.gov/camping/campgrounds/${encodeURIComponent(raw.facility_id)}`;
    else if (osm && raw.osm_id != null && /^(node|way|relation)$/.test(raw.osm_type || '')) p.source_url = `https://www.openstreetmap.org/${raw.osm_type}/${raw.osm_id}`;
    else p.source_url = raw.source_url || raw.website || raw.url || null;
    p.attributes_unverified = legacyRIDB || !!raw.attributes_unverified;
    p._kt_normalized = true;
    if (osm && !p.sources.includes('OpenStreetMap')) p.sources.push('OpenStreetMap');
    if (ridb && !p.sources.includes('Recreation.gov')) p.sources.push('Recreation.gov');
    return {...feature, type:'Feature', geometry:{type:'Point',coordinates:[ll.lon,ll.lat]}, properties:p};
  }
  function distanceMeters(a, b) {
    const rad = v => v * Math.PI / 180, dLat = rad(b.lat-a.lat), dLon = rad(b.lon-a.lon);
    const h = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }
  function mergeFeatures(primary, secondary) {
    const p=primary.properties, q=secondary.properties;
    p.legacy_ids = [...new Set([...(p.legacy_ids || []), ...(q.legacy_ids || []), q.id])];
    p.sources = [...new Set([...(p.sources || []), ...(q.sources || [])])];
    // Preserve known facts, but do not hide conflicts between sources.
    if (p.fee_status === 'unknown' && q.fee_status !== 'unknown' && !p.fee_conflict) {p.fee_status=q.fee_status; p.cost=q.cost;}
    else if (p.fee_status !== 'unknown' && q.fee_status !== 'unknown' && p.fee_status !== q.fee_status) {p.fee_status='unknown'; p.cost=null; p.fee_conflict=true;}
    if (p.cost === null && q.cost !== null && !p.fee_conflict && p.fee_status === q.fee_status) p.cost=q.cost;
    p.amenity_negatives = [...new Set([...(p.amenity_negatives || []), ...(q.amenity_negatives || [])])];
    p.amenities = [...new Set([...p.amenities,...q.amenities])].filter(a => !p.amenity_negatives.includes(a));
    p.rig_friendly = [...new Set([...p.rig_friendly,...q.rig_friendly])];
    for (const key of ['description','website','source_url','road_difficulty','rating']) if (p[key] == null || p[key] === '') p[key]=q[key] ?? p[key];
    return primary;
  }
  function cleanAndDedupeGeoJSON(input, options = {}) {
    if (!input || !Array.isArray(input.features)) return {type:'FeatureCollection',features:[]};
    const features=[], ids=new Map(), grid=new Map();
    const cellSize=.003, radius=options.radiusMeters ?? 100;
    for (const raw of input.features) {
      const f=normalizeFeature(raw,options); if (!f) continue;
      const p=f.properties, ll=getLatLng(f), cx=Math.floor(ll.lon/cellSize), cy=Math.floor(ll.lat/cellSize);
      let found=ids.get(p.id);
      if (!found) {
        for (let x=cx-2; x<=cx+2 && !found; x++) for(let y=cy-1; y<=cy+1 && !found; y++) {
          for (const other of grid.get(`${x},${y}`) || []) {
            const op=other.properties;
            if (p.facility_id && op.facility_id && String(p.facility_id)!==String(op.facility_id)) continue;
            if (normalizeName(op.name) === normalizeName(p.name) && distanceMeters(ll,getLatLng(other))<=radius) {found=other;break;}
          }
        }
      }
      if (found) {mergeFeatures(found,f);ids.set(p.id,found);continue;}
      features.push(f);ids.set(p.id,f);
      const key=`${cx},${cy}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(f);
    }
    return {type:'FeatureCollection',features};
  }
  function applyFilters(sites, filters = {}) {
    return sites.filter(site => {
      const p=site.properties;
      if (filters.cost && filters.cost !== 'all' && p.fee_status !== filters.cost) return false;
      if (filters.type && filters.type !== 'all' && p.type !== filters.type) return false;
      if (filters.rigSize && filters.rigSize !== 'all' && !p.rig_friendly.includes(filters.rigSize)) return false;
      if (filters.roadDifficulty && filters.roadDifficulty !== 'all' && p.road_difficulty !== filters.roadDifficulty) return false;
      if (Array.isArray(filters.amenities) && !filters.amenities.every(a => p.amenities.includes(a))) return false;
      if (+filters.minRating > 0 && (p.rating === null || p.rating < +filters.minRating)) return false;
      return true;
    });
  }
  global.DataQuality={normalizeFeature,cleanAndDedupeGeoJSON,applyFilters,getLatLng};
  if(typeof module !== 'undefined' && module.exports)module.exports=global.DataQuality;
})(typeof window !== 'undefined' ? window : globalThis);
