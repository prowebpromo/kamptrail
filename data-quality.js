/* Normalize source records without turning missing information into camping advice. */
(function (global) {
  'use strict';
  const t=(key,params={})=>global.KampTrailI18n?.t(key,params)??String(key).replace(/\{([a-zA-Z0-9_]+)\}/g,(token,name)=>Object.hasOwn(params,name)?String(params[name]):token);
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
  // Accommodation named by the record's own name (fire lookouts, cabins, houses). Not a campground.
  // Candidate decisions are keyed to prior published facilities. Evidence and source dates are in
  // docs/candidates/tourism-independent-source-review.json. These sets never admit a new listing.
  const REVIEWED_CAMPING = new Set(['ridb:10068990', 'ridb:237148', 'ridb:243218', 'ridb:243702', 'ridb:245164', 'ridb:245165', 'ridb:249627', 'ridb:249642', 'ridb:249674', 'ridb:249741', 'ridb:249752', 'ridb:249902', 'ridb:255188', 'ridb:255232', 'ridb:255239']);
  const PENDING_ADMISSION = new Set(['ridb:10049041', 'ridb:240871', 'ridb:240903', 'ridb:241301', 'ridb:243195', 'ridb:244320', 'ridb:244321']);
  // Pin the reviewed retrievals. A subsequent source refresh is evaluated afresh.
  const REVIEWED_RECORDS = new Set([
    "ridb:10049041|Morrow Bridge and Midway Seasonal Camps|2026-10-29T03:32:57Z",
    "ridb:10068990|Willow Creek Transfer Camp|2026-10-29T02:57:25Z",
    "ridb:10068990|Willow Creek Transfer Camp|2026-10-29T03:36:53Z",
    "ridb:237148|Gateway Boat Camp|2026-10-29T02:57:25Z",
    "ridb:237148|Gateway Boat Camp|2026-10-29T03:10:59Z",
    "ridb:240871|Enduro Camp|2026-10-29T03:03:23Z",
    "ridb:240903|Sugar Creek Hunter Camp|2026-10-29T03:03:23Z",
    "ridb:241301|Bear Creek Lake Recreation Area|2026-10-29T02:48:25Z",
    "ridb:243195|McDougle Camp|2026-10-29T02:45:26Z",
    "ridb:243218|Coleman Lake Recreation Area|2026-10-29T02:45:26Z",
    "ridb:243702|Head O' Boulder Forest Camp|2026-10-29T03:28:33Z",
    "ridb:244320|Bowman Lake Area|2026-10-29T03:06:41Z",
    "ridb:244321|Condon Lakes West|2026-10-29T03:06:41Z",
    "ridb:245164|Hunter Creek Transfer Camp|2026-10-29T02:57:25Z",
    "ridb:245164|Hunter Creek Transfer Camp|2026-10-29T03:36:53Z",
    "ridb:245165|Bear Creek Transfer Camp|2026-10-29T02:57:25Z",
    "ridb:249627|Joe Elliot Yellow Post Sites|2026-10-29T02:50:45Z",
    "ridb:249642|Coon Creek Yellow Post Sites|2026-10-29T02:50:45Z",
    "ridb:249674|Stockton Flats Yellow Post Sites|2026-10-29T02:50:45Z",
    "ridb:249741|Thomas Hunting Grounds Yellow Post Sites|2026-10-29T02:50:45Z",
    "ridb:249752|Clark's Ranch Yellow Post Site|2026-10-29T02:50:45Z",
    "ridb:249902|Wolf Gap Recreation Area|2026-10-29T03:01:56Z",
    "ridb:249902|Wolf Gap Recreation Area|2026-10-29T03:38:40Z",
    "ridb:249902|Wolf Gap Recreation Area|2026-10-29T03:40:29Z",
    "ridb:255188|Spring Recreation Site|2026-10-29T03:28:33Z",
    "ridb:255232|Mica Bay Boater Park|2026-10-29T02:57:25Z",
    "ridb:255239|McKay's Bend Recreation Site|2026-10-29T02:57:25Z"
  ]);
  // Also guard a cold single-state load and identity-host fallback, before the parent state arrives.
  const WITHDRAWN_IDS = new Set(['ridb:237765', 'ridb:244404', 'usfs:18814', 'ridb:245273', 'usfs:5889', 'ridb:246536', 'usfs:65003', 'ridb:247835', 'osm:way:941066426', 'ridb:247915', 'osm:relation:13942065', 'ridb:247922', 'ridb:248072', 'ridb:248261']);
  const isWithdrawnId = id => WITHDRAWN_IDS.has(String(id));
  const DON_CARTER_ELEMENT = 'osm:way:456269017'; // independently published listing in NC
  const discoverable = p => p.camping_classification === 'campsite' || p.camping_classification === 'published_pending_review';
  const ACCOMMODATION_NAME = /\b(?:cabins?|lodges?|lookouts?|guard\s+stations?|hotels?|motels?|chalets?|yurts?|huts?|houses?|bunkhouses?)\s*$/i;
  function classifyCampingRecord(raw, name, {osm = false, ridb = false, overnightSites = 0} = {}) {
    const access = String(raw.access || '').trim().toLowerCase();
    const accessInfo = {
      yes: ['allowed', 'Access allowed (source reported)'],
      public: ['allowed', 'Public access (source reported)'],
      permissive: ['permissive', 'Permissive access; permission may change'],
      customers: ['customers', 'Customers only; confirm booking and fees'],
      permit: ['permit', 'Permit required (source reported)'],
      destination: ['destination', 'Destination access only (source reported)'],
      private: ['private', 'Private access; not a public campsite'],
      no: ['prohibited', 'Public access prohibited (source reported)'],
      military: ['military', 'Military access only (source reported)']
    };
    const [access_status, access_label] = accessInfo[access] || ['unknown', access ? `Access reported: ${access}` : 'Access not verified'];
    const agencyCamping = typeof raw.camping_activity === 'string' && /camp/i.test(raw.camping_activity);
    const explicitlyCamping = agencyCamping || /^(camp_site|caravan_site)$/.test(String(raw.tourism || '').toLowerCase());
    const intro = String(raw.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().replace(/^overview\s*/i, '').split(/(?<=[.!?])\s+/)[0].slice(0, 600);
    const campingIntro = /\b(?:campgrounds?|campsites?|(?:tent|rv|recreational vehicle)\s+camping|camping\s+(?:area|site|facility|grounds))\b/i.test(intro);
    const campingName = /\b(?:campgrounds?|campsites?|camping|(?:rv|recreational vehicle|trailer)\s+(?:parks?|sites?|camp)|(?:group|horse|equestrian|primitive|tent|backcountry)\s+camp(?:s|\s+sites?)?)\b/i.test(name);
    // A Recreation.gov record's own facility type (derived from FacilityTypeDescription at import) counts
    // only when the same facility also lists its own overnight campsite records (ridb-sites.json).
    const ownRIDB = /^recreation\.gov$/i.test(raw.source || '');
    const ownType = ownRIDB ? (raw._kt_normalized ? raw.ridb_facility_type : raw.type) : null;
    const ridbOvernight = ridb && raw.facility_id != null && ['established', 'dispersed', 'backcountry'].includes(ownType) && Number.isInteger(overnightSites) && overnightSites > 0;
    const accommodation = (ridbOvernight || (agencyCamping && raw.facility_id != null && overnightSites > 0)) && !campingName && !campingIntro && !/\bscreen\s+cabins?\b/i.test(name) && ACCOMMODATION_NAME.test(name) ? name.match(ACCOMMODATION_NAME)[0].toLowerCase() : null;
    let exclusion_reason = null;
    if (['private', 'no', 'military'].includes(access)) exclusion_reason = `access_${access}`;
    else if (/^(yes|true|1)$/i.test(String(raw.disused || raw.abandoned || '')) || raw['disused:tourism'] || raw['abandoned:tourism'] || String(raw.camping).toLowerCase() === 'no' || /\b(?:camping (?:is )?(?:not (?:allowed|permitted)|prohibited)|no overnight camping)\b/i.test(intro)) exclusion_reason = 'camping_not_operating_or_prohibited';
    // An explicit campsite tag is stronger evidence than a facility's ambiguous name.
    // Do not infer public access from private ownership, a business name, or a fee.
    else if (!explicitlyCamping && !campingName && !ridbOvernight) {
      if (/\b(?:ranger\s+(?:district|station)|(?:naval|air\s*force|military)\s+(?:air\s+)?(?:base|station)|(?:district|administrative|forest|ranger|supervisor(?:s)?)\s+office|visitor\s+(?:center|centre)|information\s+(?:center|centre)|contact\s+station|headquarters)\b/i.test(name)) exclusion_reason = 'administrative_facility';
      else if (/\b(?:day[ -]?use|picnic|pavilions?|shelters?|boat\s+(?:launch|ramp)|launch\s+ramp)\b/i.test(name)) exclusion_reason = 'day_use_facility';
      else if (/\b(?:cabins?|lodges?|lookouts?|guard\s+stations?|hotels?|motels?|chalets?|yurts?|huts?)\b/i.test(name)) exclusion_reason = 'lodging_or_lookout';
    }
    return {
      access: access || null, access_status, access_label, exclusion_reason,
      camping_evidence: agencyCamping ? 'agency_camping_activity' : explicitlyCamping ? 'osm_campsite_tag' : campingName ? 'camping_facility_name' : campingIntro ? 'source_intro_camping' : ridbOvernight ? 'ridb_facility_type_overnight_sites' : ridb ? 'ridb_activity_listing' : 'source_listing',
      camping_classification: explicitlyCamping || campingName || campingIntro || ridbOvernight ? 'campsite' : 'unverified_camping_record',
      ...(accommodation ? {kt_accommodation:accommodation} : {}),
      ...(campingName ? {camping_name_text:name} : campingIntro ? {camping_intro_text:intro.slice(0, 300)} : {})
    };
  }
  // Keep full, attributable source wording when records are reconciled.
  function evidenceURL(value) {
    try {const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
  }
  function evidenceDate(value) {
    if(typeof value==='number'&&Number.isFinite(value)&&value>0&&value<4102444800000)return new Date(value).toISOString();
    return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(value)&&Number.isFinite(Date.parse(value))?value:null;
  }
  function mergeFeeEvidence(...lists) {
    const records=new Map();
    for(const list of lists)for(const raw of Array.isArray(list)?list:[]){
      if(!raw||typeof raw.source!=='string'||!raw.source.trim()||typeof raw.text!=='string'||!raw.text.trim()||raw.text.length>65536)continue;
      const clean=(value,max)=>typeof value==='string'?value.slice(0,max):null;
      const r={source:clean(raw.source,160),source_field:clean(raw.source_field,160),source_record_id:clean(raw.source_record_id,240),source_url:evidenceURL(raw.source_url),query_url:evidenceURL(raw.query_url),retrieved_at:evidenceDate(raw.retrieved_at),source_updated_at:evidenceDate(raw.source_updated_at),text:raw.text,sha256:typeof raw.sha256==='string'&&/^[a-f0-9]{64}$/i.test(raw.sha256)?raw.sha256.toLowerCase():null};
      if(raw.classification_use==='not_used')r.classification_use='not_used';
      if(typeof raw.classification_text==='string'&&raw.classification_text.length<=65536)r.classification_text=raw.classification_text;
      if(typeof raw.qualification_text==='string'&&raw.qualification_text.length<=65536)r.qualification_text=raw.qualification_text;
      const key=JSON.stringify([r.source,r.source_field,r.source_record_id,r.text]),old=records.get(key);
      if(!old||Date.parse(r.retrieved_at)>Date.parse(old.retrieved_at)||(!old.retrieved_at&&r.retrieved_at))records.set(key,r);
    }
    return [...records.values()].sort((a,b)=>(Date.parse(b.retrieved_at)||0)-(Date.parse(a.retrieved_at)||0)).slice(0,24);
  }
  // Amenity ownership (R8, 2.31.0). The same key set guards snapshot merging in scripts/merge_campsite_data.js.
  const OSM_ELEMENT = /^osm:(?:node|way|relation|unknown):/;
  const OSM_AMENITY_TAG = /^(?:toilets?|drinking_water|water|water_point|water_tap|water_hookup|water_supply|water_source|hot_water|shower|showers|sanitary_dump_station|waste|waste_disposal|waste_basket|bin|power|power_supply|socket|electric_hookup|electricity|sewer|sewer_hookup|hookups?|internet_access|wifi|washing_machine|dryer|laundry|laundry_service|kitchen|bbq|grill|fireplace|firepit|fire_pit|fire|openfire|campfire|firewood|wood_available|picnic_table|picnic_site|shelter|swimming_pool|sauna|playground|amenity(?:_[0-9]+)?|camp_site:fire|camp_site:water|check_date)(?::|$)/;
  const OSM_AMENITY_FIELDS = {toilet:['toilets'], water:['drinking_water'], dump:['sanitary_dump_station'], fire_ring:['fireplace'], picnic_table:['picnic_table'], shower:['shower']};
  const MAX_AMENITY_MEMBERS = 128;
  // Attributed observations from merged member elements: element id, source, dates and the element's own tags.
  function amenityMembers(previous, memberEvidence, ownId) {
    const records = new Map(), list = v => Array.isArray(v) ? v : [];
    const add = r => {
      if (!r || typeof r.source_record_id !== 'string' || r.source_record_id === ownId || r.source_record_id.length > 240 || !r.fields || typeof r.fields !== 'object') return;
      const fields = {};
      for (const key of Object.keys(r.fields).sort()) if ((OSM_AMENITY_TAG.test(key) || key === 'amenities') && r.fields[key] != null && r.fields[key] !== '') fields[key] = String(r.fields[key]).slice(0, 200);
      if (!Object.keys(fields).length || records.has(r.source_record_id)) return;
      records.set(r.source_record_id, {source_record_id:r.source_record_id, source:typeof r.source === 'string' ? r.source.slice(0, 160) : null, source_url:evidenceURL(r.source_url), retrieved_at:evidenceDate(r.retrieved_at), source_updated_at:evidenceDate(r.source_updated_at), observed_at:evidenceDate(fields.check_date) ? fields.check_date : null, fields});
    };
    list(previous).forEach(add);
    for (const e of list(memberEvidence)) if (e && OSM_ELEMENT.test(e.source_record_id || '')) add(e);
    return [...records.values()].sort((a, b) => a.source_record_id < b.source_record_id ? -1 : a.source_record_id > b.source_record_id ? 1 : 0).slice(0, MAX_AMENITY_MEMBERS);
  }
  // Rig suitability ownership (2.34.0). The same key set guards snapshot merging in scripts/merge_campsite_data.js.
  // tents, caravans and motorhome are read only from the listing's own OSM element. Other elements' rig tags,
  // and other records' rig lists, are kept as attributed member evidence and never used.
  const OSM_RIG_TAG = /^(?:tents|caravans|motorhome|capacity|backcountry|group_only|static_caravans|horse|maxlength|maxtents)(?::|$)/;
  const RIG_CATEGORIES = {tent:'tents', trailer:'caravans', rv:'motorhome'};
  function rigMembers(previous, memberEvidence, ownId) {
    const records = new Map(), list = v => Array.isArray(v) ? v : [];
    const add = r => {
      if (!r || typeof r.source_record_id !== 'string' || r.source_record_id === ownId || r.source_record_id.length > 240 || !r.fields || typeof r.fields !== 'object') return;
      const fields = {};
      for (const key of Object.keys(r.fields).sort()) if ((OSM_RIG_TAG.test(key) || key === 'rig_friendly') && r.fields[key] != null && r.fields[key] !== '') fields[key] = String(r.fields[key]).slice(0, 200);
      if (!Object.keys(fields).length || records.has(r.source_record_id)) return;
      records.set(r.source_record_id, {source_record_id:r.source_record_id, source:typeof r.source === 'string' ? r.source.slice(0, 160) : null, source_url:evidenceURL(r.source_url), retrieved_at:evidenceDate(r.retrieved_at), source_updated_at:evidenceDate(r.source_updated_at), fields});
    };
    list(previous).forEach(add);
    for (const e of list(memberEvidence)) if (e && OSM_ELEMENT.test(e.source_record_id || '')) add(e);
    return [...records.values()].sort((a, b) => a.source_record_id < b.source_record_id ? -1 : a.source_record_id > b.source_record_id ? 1 : 0).slice(0, MAX_AMENITY_MEMBERS);
  }
  // A merged record's own rig observation, kept as member evidence on the retained listing.
  function ownRigObservation(q) {
    if (q.osm_rig_tags) return {source_record_id:q.id, source:'OpenStreetMap contributors', source_url:q.source_url, retrieved_at:q.source_retrieved_at, fields:q.osm_rig_tags};
    if (q.rig_record && q.rig_friendly?.length) return {source_record_id:q.id, source:q.rig_record.source, retrieved_at:q.rig_record.retrieved_at, fields:{rig_friendly:q.rig_friendly.join(';')}};
    return null;
  }
  // Rig evidence for one listing: its own OSM element, its own record's list and, as a check only, its own
  // Recreation.gov campsite records. Recreation.gov never adds a category. It can only contradict an own tag.
  function rigEvidence(p) {
    const categories = Object.fromEntries(Object.keys(RIG_CATEGORIES).map(c => [c, {positive:[], negative:[], other:[], conflict:[], status:'unknown'}]));
    const members = Array.isArray(p?.rig_members) ? p.rig_members : [];
    if (!p) return {state:'no_source', categories, members};
    const own = p.osm_rig_tags && OSM_ELEMENT.test(p.id) ? p.osm_rig_tags : null;
    const fromTags = !!p.osm_rig_tags || Object.hasOwn(p, 'rig_record');
    let any = false;
    if (own) for (const [c, key] of Object.entries(RIG_CATEGORIES)) {
      if (own[key] == null) continue;
      any = true;
      const v = String(own[key]).trim().toLowerCase(), ref = {source:'osm', record:p.id, key, value:String(own[key]), retrieved:evidenceDate(p.source_retrieved_at)};
      categories[c][v === 'yes' ? 'positive' : v === 'no' ? 'negative' : 'other'].push(ref);
    }
    const listed = Array.isArray(p.rig_friendly) ? p.rig_friendly : [];
    if (p.rig_record) for (const c of listed) if (categories[c]) {any = true; categories[c].positive.push({source:'record', label:p.rig_record.source, record:p.id, retrieved:p.rig_record.retrieved_at || null});}
    // An index row carries only its published categories (no evidence fields). They stand as given.
    if (!fromTags) for (const c of listed) if (categories[c] && !categories[c].positive.length) {any = true; categories[c].positive.push({source:'index', record:p.id});}
    // Recreation.gov campsite records with RV-type equipment counts. Zero RV-type sites of a non-zero total
    // contradicts an own trailer or motorhome yes. It is shown as a conflict and neither value is picked.
    const check = p.facility_id != null ? {fid:String(p.facility_id), t:p.site_count, r:p.rv_sites} : p.ridb_rig_check;
    const total = Number.isInteger(check?.t) ? check.t : 0, rv = Number.isInteger(check?.r) ? check.r : 0;
    if (own && total > 0) for (const c of ['trailer', 'rv']) {
      if (categories[c].positive.some(r => r.source === 'osm') && rv === 0) categories[c].conflict.push({source:'ridb', record:'ridb:' + check.fid, count:rv, total});
    }
    for (const x of Object.values(categories)) {
      x.status = x.conflict.length || (x.positive.length && x.negative.length) ? 'conflict' : x.positive.length ? 'present' : x.negative.length ? 'absent' : x.other.length ? 'unrecognized' : 'unknown';
    }
    return {state:any ? 'evidence' : 'no_source', categories, members};
  }
  // Rig categories a listing matches in filters: present evidence only. A conflict never matches.
  function rigFilterSet(p) {
    const e = rigEvidence(p);
    return Object.keys(RIG_CATEGORIES).filter(c => e.categories[c].status === 'present');
  }
  const rigMatches = (p, category) => rigFilterSet(p).includes(category);
  // Plain-text rig line, as the popup states it. Used by the published fixture.
  function rigLine(p) {
    const e = rigEvidence(p), labels = {tent:'Tents', trailer:'Trailers and caravans', rv:'RV'}, status = {present:'reported', absent:'source says no', conflict:'sources disagree', unrecognized:'value not recognized'};
    return Object.keys(RIG_CATEGORIES).filter(c => e.categories[c].status !== 'unknown').map(c => labels[c] + ': ' + status[e.categories[c].status]).join('; ');
  }
  // A merged record's own amenity observation, kept as member evidence on the retained listing.
  function ownAmenityObservation(q) {
    if (q.osm_amenity_tags) return {source_record_id:q.id, source:'OpenStreetMap contributors', source_url:q.source_url, retrieved_at:q.source_retrieved_at, fields:q.osm_amenity_tags};
    if (q.amenity_record && q.amenities?.length) return {source_record_id:q.id, source:q.amenity_record.source, retrieved_at:q.amenity_record.retrieved_at, fields:{amenities:q.amenities.join(';')}};
    return null;
  }
  function normalizeFeature(feature, options = {}) {
    const ll = getLatLng(feature);
    if (!ll) return null;
    const given = feature.properties || {};
    // Classification ownership (tourism-type-admission candidate). tourism=* classifies only the OSM element that
    // carries it. A record without its own osm_id holds it only because a snapshot merge copied it from an
    // absorbed element (older snapshots, cached offline copies). It is ignored here, at index and browser level.
    const raw = given.tourism != null && given.osm_id == null ? (({tourism, ...rest}) => rest)(given) : given;
    // Wording copied from a different record in a snapshot merge never classifies this one.
    const borrowedWording = typeof raw.description_source_record_id === 'string' && raw.description_source_record_id !== raw.id;
    const name = String(raw.name || raw.Name || raw.title || raw.site_name || raw.location_name || '').trim();
    if (isPlaceholder(name)) return null;
    const sources = [...new Set([...(Array.isArray(raw.sources) ? raw.sources : []), raw.source, raw.provider].filter(Boolean).map(String))];
    const ridb = raw.facility_id != null || sources.some(s => /recreation\.gov|\bridb\b/i.test(s));
    const osm = raw.osm_id != null || raw.tourism === 'camp_site' || raw.tourism === 'caravan_site';
    // Own overnight campsite records (ridb-sites.json). An in-memory re-normalization reuses the attached count.
    // Both Recreation.gov sidecars count the facility's own TypeOfUse=Overnight campsite records.
    const fid = raw.facility_id != null ? String(raw.facility_id) : null;
    const overnightSites = ridb && fid ? Math.max(options.siteDetails?.[fid]?.t || 0, options.amenityDetails?.facilities?.[fid]?.sites || 0, raw._kt_normalized && Number.isInteger(raw.ridb_overnight_sites) ? raw.ridb_overnight_sites : 0) : 0;
    const classification = classifyCampingRecord(borrowedWording ? {...raw, description:''} : raw, name, {osm, ridb, overnightSites});
    if (raw.source === 'recreation.gov' && raw.id === 'ridb:' + fid && !classification.exclusion_reason) {
      if (REVIEWED_CAMPING.has(raw.id) && REVIEWED_RECORDS.has(raw.id+'|'+name+'|'+raw.source_retrieved_at)) {
        classification.camping_classification = 'campsite';
        classification.camping_evidence = 'reviewed_own_facility_record';
        classification.camping_evidence_record_id = raw.id;
      } else if (PENDING_ADMISSION.has(raw.id) || REVIEWED_CAMPING.has(raw.id)) {
        classification.camping_classification = 'published_pending_review';
        classification.camping_evidence = 'previously_published_pending_adjudication';
      }
    }
    // A held inherited restriction blocks admission until identity review. It
    // is not a statement about the kept element's own public-access tags.
    if (classification.exclusion_reason || (raw.access_hold && /^(private|no|military)$/.test(raw.access_hold.value))) return null;
    const legacyRIDB = ridb && !(Number(raw.schema_version) >= 3) && !raw._kt_normalized;
    // Snapshot membership is a loading hint, not evidence of a site's state.
    const p = {...raw, ...classification, name, sources, state: raw.state || raw['addr:state'] || null};
    // Kept so re-normalization (index dedupe, browser state merges) reaches the same classification.
    if (overnightSites > 0) p.ridb_overnight_sites = overnightSites; else delete p.ridb_overnight_sites;
    // The Recreation.gov record's own import type, kept apart from the listing type shown.
    if (ridb && raw.facility_id != null) p.ridb_facility_type = /^recreation\.gov$/i.test(raw.source || '') ? (raw._kt_normalized ? raw.ridb_facility_type : raw.type) : null;
    p.legacy_ids = [...new Set([...(Array.isArray(raw.legacy_ids) ? raw.legacy_ids : []), raw.id].filter(v => v != null && v !== '').map(String))];
    const coordKey = `${ll.lon.toFixed(6)},${ll.lat.toFixed(6)}`;
    if (ridb && raw.facility_id != null) p.id = `ridb:${raw.facility_id}`;
    else if (osm && raw.osm_id != null) {
      const elementType = raw.osm_type || (['node', 'way', 'relation'].includes(raw.type) ? raw.type : 'unknown');
      p.id = `osm:${elementType}:${raw.osm_id}${elementType === 'unknown' ? ':' + coordKey : ''}`;
    } else p.id = raw.id != null && raw.id !== '' ? String(raw.id) : `site:${normalizeName(name)}:${coordKey}`;
    p.fee_evidence_records=mergeFeeEvidence(raw.fee_evidence_records);
    const ownOsmFee = osm && !ridb && !raw._kt_normalized;
    if(ownOsmFee && raw.fee != null){
      const kind=raw.osm_type||(['node','way','relation'].includes(raw.type)?raw.type:null),id=String(raw.osm_id??'');
      const tagText='fee='+String(raw.fee)+(raw['fee:conditional']?'; fee:conditional='+String(raw['fee:conditional']):'');
      p.fee_evidence_records=mergeFeeEvidence(p.fee_evidence_records,[{source:'OpenStreetMap contributors',source_field:'fee'+(raw['fee:conditional']?' / fee:conditional':''),source_record_id:id?'osm:'+(kind||'unknown')+':'+id:null,source_url:kind&&/^\d+$/.test(id)?'https://www.openstreetmap.org/'+kind+'/'+id:null,retrieved_at:raw.fee_checked||raw.source_retrieved_at||null,source_updated_at:raw.osm_timestamp||null,text:tagText}]);
    }
    for (const e of Array.isArray(raw.member_evidence) ? raw.member_evidence : []) {
      if (!e || typeof e.source_record_id !== 'string' || !/^osm:(node|way|relation|unknown):/.test(e.source_record_id) || !e.fields || typeof e.fields !== 'object') continue;
      const text = Object.keys(e.fields).filter(k => /(^|:)(fee|charge)(:|$)/.test(k) || /^access(:|$)/.test(k)).sort().map(k => k + '=' + String(e.fields[k]).slice(0, 2048)).join('; ');
      if (text) p.fee_evidence_records = mergeFeeEvidence(p.fee_evidence_records, [{source:'OpenStreetMap contributors', source_field:'member element tags', classification_use:'not_used', source_record_id:e.source_record_id, source_url:e.source_url, retrieved_at:e.retrieved_at, source_updated_at:e.source_updated_at, text, qualification_text:'Recorded on a merged member element. Not used to classify this record.'}]);
    }
    if (legacyRIDB) p.legacy_inferred = {cost:raw.cost, amenities:raw.amenities, rig_friendly:raw.rig_friendly, road_difficulty:raw.road_difficulty};
    const feeEvidence = raw._kt_normalized || Number(raw.schema_version) >= 3 || !!raw.field_provenance?.cost;
    p.cost = feeEvidence && !legacyRIDB && validNumber(raw.cost) && raw.cost >= 0 ? raw.cost : null;
    p.fee_status = feeEvidence && !legacyRIDB && ['free', 'paid', 'conditional', 'unknown'].includes(raw.fee_status) ? raw.fee_status : 'unknown';
    if (feeEvidence && !legacyRIDB && p.cost !== null && p.fee_status !== 'conditional') p.fee_status = p.cost === 0 ? 'free' : 'paid';
    if (ownOsmFee && /^(no|0|false)$/i.test(String(raw.fee)) && /(?:^|;)\s*(?:yes|true)\s*@/i.test(String(raw['fee:conditional'] || ''))) {p.fee_status = 'conditional'; p.cost = null; p.fee_text = `OSM fee=no; fee:conditional=${String(raw['fee:conditional']).slice(0, 200)}`; p.fee_source = 'OpenStreetMap contributors';}
    else if (ownOsmFee && /^(no|0|false)$/i.test(String(raw.fee))) {p.fee_status = 'free'; p.cost = 0; p.fee_text = p.fee_text || 'OSM tag fee=no'; p.fee_source = p.fee_source || 'OpenStreetMap contributors (community reported)';}
    else if (ownOsmFee && /^(yes|true)$/i.test(String(raw.fee))) {p.fee_status = 'paid'; if (p.cost === 0) p.cost = null;}
    if (ownOsmFee && p.fee_status !== 'unknown') {
      p.fee_source = p.fee_source || 'OpenStreetMap contributors';
      p.fee_source_record_id = p.id;
    } else if (!raw._kt_normalized && p.fee_status !== 'unknown') {
      p.fee_source_record_id = raw.fee_source_record_id || p.id;
      p.fee_source = raw.fee_source || (ridb ? 'Recreation.gov' : sources[0] || p.id.split(':')[0]);
    }
    if (p.access_status !== 'unknown') p.access_source_record_id = raw.access_source_record_id || p.id;
    // State loading normalizes merged records again. A retained source tag cannot
    // resolve an existing disagreement with another source.
    if (p.fee_conflict) {p.fee_status = 'unknown'; p.cost = null; p.fee_text = null;}
    // The Campground default needs the record's own campsite tag (osm is now own-tag only, see raw above).
    p.type = ['established', 'dispersed', 'parking', 'backcountry', 'other', 'lodging'].includes(raw.type) ? raw.type : (osm ? 'established' : 'other');
    if (ridb && !osm && p.camping_classification === 'unverified_camping_record') p.type = 'other';
    // Reservable accommodation keeps its own kind. A fire lookout or cabin is never shown as a campground.
    if (classification.kt_accommodation) p.type = 'lodging';
    else delete p.kt_accommodation;
    // A Recreation.gov record whose own facility type names no camping kind is classified from its own
    // facility name. A description can support existing admission, but never upgrades the type.
    p.type_evidence = null;
    const wording = classification.camping_name_text;
    if (ridb && !osm && p.ridb_facility_type === 'other' && wording && p.camping_classification === 'campsite') {
      const kind = /\b(?:dispersed|primitive|yellow\s+post)\b/i.test(wording) ? 'dispersed' : /\bbackcountry\b/i.test(wording) ? 'backcountry' : 'established';
      p.type = kind;
      p.type_evidence = {kind:'descriptive_wording', source:'Recreation.gov', source_record_id:p.id, field:'FacilityName', value:wording, retrieved_at:evidenceDate(raw.source_retrieved_at)};
    } else if (ridb && raw.facility_id != null && ['established', 'dispersed', 'backcountry'].includes(p.ridb_facility_type)) {
      p.type_evidence = {kind:'structured_classification', source:'Recreation.gov', source_record_id:p.id, field:'FacilityTypeDescription (mapped at import)', value:p.ridb_facility_type, retrieved_at:evidenceDate(raw.source_retrieved_at)};
    }
    if (classification.kt_accommodation) {
      const agency = raw.source === 'Bureau of Land Management';
      p.type_evidence = {kind:'lodging_name_with_overnight_records',source:agency?raw.source:'Recreation.gov',
        source_record_id:agency?'blm-facility:'+fid:p.id,field:agency?'name':'FacilityName',value:name,
        overnight_facility_id:fid,overnight_sites:overnightSites,retrieved_at:evidenceDate(raw.source_retrieved_at)};
    } else if (raw.source === 'Bureau of Land Management' && raw.camping_activity && fid) {
      p.type_evidence = {kind:'agency_layer_membership',source:raw.source,source_record_id:'blm-facility:'+fid,
        field:'BLM layer 8 camping_activity',value:raw.camping_activity,retrieved_at:null};
    }
    // Existing admission and own confirmed overnight camping do not determine the campsite type.
    if (['reviewed_own_facility_record','previously_published_pending_adjudication'].includes(p.camping_evidence)) {
      p.type = 'other';
      p.type_evidence = null;
    }
    delete p.camping_name_text; delete p.camping_intro_text;
    const aliases = {toilets:'toilet', restrooms:'toilet', drinking_water:'water', potable_water:'water', fire_rings:'fire_ring', picnic_tables:'picnic_table', sanitary_dump_station:'dump', waste_disposal:'dump'};
    // Amenity ownership (R8). Tags count only on the listing's own OSM element.
    // A host that merely inherited tourism=* from an absorbed element is not that element.
    const ownOsm = osm && OSM_ELEMENT.test(p.id) && raw.osm_id != null;
    p.amenity_negatives = raw._kt_normalized && Array.isArray(raw.amenity_negatives) ? [...new Set(raw.amenity_negatives.filter(a => typeof a === 'string'))] : [];
    p.amenities = !legacyRIDB && Array.isArray(raw.amenities) ? [...new Set(raw.amenities.filter(a => typeof a === 'string').map(a => aliases[a] || a))] : [];
    // A record's own amenity list, outside OSM tags, keeps its own source attribution.
    p.amenity_record = !ownOsm && !legacyRIDB && p.amenities.length ? {source:(raw._kt_normalized && raw.amenity_record?.source) || sources[0] || p.id.split(':')[0], source_record_id:p.id, retrieved_at:evidenceDate(raw.source_retrieved_at)} : null;
    p.osm_amenity_tags = null;
    // OSM tags retain explicit yes/no values. Missing tags are unknown.
    if (ownOsm) {
      const own = {};
      for (const key of Object.keys(raw).sort()) if (OSM_AMENITY_TAG.test(key) && raw[key] != null && raw[key] !== '') own[key] = String(raw[key]).slice(0, 200);
      if (Object.keys(own).length) p.osm_amenity_tags = own;
      for (const [amenity, names] of Object.entries(OSM_AMENITY_FIELDS)) {
        if (names.some(tag => String(raw[tag]).toLowerCase() === 'yes')) p.amenities.push(amenity);
        if (names.some(tag => String(raw[tag]).toLowerCase() === 'no')) {p.amenity_negatives.push(amenity);p.amenities = p.amenities.filter(a => a !== amenity);}
      }
      p.amenities = [...new Set(p.amenities)];
      p.amenity_negatives = [...new Set(p.amenity_negatives)];
    } else if (!p.amenity_record) {p.amenities = []; p.amenity_negatives = [];}
    // Observations from other merged elements stay attributed to those elements and are never used here.
    p.amenity_members = amenityMembers(raw._kt_normalized ? raw.amenity_members : null, raw.member_evidence, p.id);
    // Rig ownership (2.34.0). tents, caravans and motorhome count only on the listing's own OSM element.
    // A host that inherited tourism=* or a rig tag from an absorbed element is not that element.
    p.osm_rig_tags = null;
    if (ownOsm) {
      const tags = {};
      for (const key of Object.keys(raw).sort()) if (Object.values(RIG_CATEGORIES).includes(key) && raw[key] != null && raw[key] !== '') tags[key] = String(raw[key]).slice(0, 200);
      if (Object.keys(tags).length) p.osm_rig_tags = tags;
      p.rig_friendly = Object.entries(RIG_CATEGORIES).filter(([, key]) => String(raw[key]).toLowerCase() === 'yes').map(([c]) => c);
      p.rig_negatives = Object.entries(RIG_CATEGORIES).filter(([, key]) => String(raw[key]).toLowerCase() === 'no').map(([c]) => c);
      delete p.rig_record;
    } else {
      // A non-OSM record's own rig list (an agency record) keeps its own source attribution.
      p.rig_friendly = !legacyRIDB && Array.isArray(raw.rig_friendly) ? [...new Set(raw.rig_friendly.filter(v => typeof v === 'string').map(v => v === 'RV' ? 'rv' : v))] : [];
      p.rig_negatives = [];
      p.rig_record = p.rig_friendly.length ? {source:(raw._kt_normalized && raw.rig_record?.source) || sources[0] || p.id.split(':')[0], source_record_id:p.id, retrieved_at:evidenceDate(raw.source_retrieved_at)} : null;
    }
    p.rig_members = rigMembers(raw._kt_normalized ? raw.rig_members : null, raw.member_evidence, p.id);
    p.road_difficulty = !legacyRIDB && typeof raw.road_difficulty === 'string' ? raw.road_difficulty : null;
    p.rating = !legacyRIDB && validNumber(raw.rating) && raw.rating >= 0 && raw.rating <= 5 ? raw.rating : null;
    p.reviews_count = p.rating !== null && Number.isInteger(raw.reviews_count) && raw.reviews_count >= 0 ? raw.reviews_count : 0;
    if (ridb && raw.facility_id != null) p.source_url = `https://www.recreation.gov/camping/campgrounds/${encodeURIComponent(raw.facility_id)}`;
    else if (osm && raw.osm_id != null && /^(node|way|relation)$/.test(raw.osm_type || '')) p.source_url = `https://www.openstreetmap.org/${raw.osm_type}/${raw.osm_id}`;
    else p.source_url = raw.source_url || raw.website || raw.url || null;
    // Provenance debt (2.34.0): raw.website and raw.operator can be inherited from an absorbed element in a snapshot.
    // They are kept as-is pending an owner decision. Only a record without its own source link falls back to website.
    p.attributes_unverified = legacyRIDB || !!raw.attributes_unverified;
    // Only validated sidecar metadata survives normalization; source elevation tags are not equivalent.
    p.elevation = raw._kt_normalized ? elevationInfo({...feature,properties:raw}) : null;
    // A serialized normalization flag is not proof that evidence came from the sidecar.
    const amenityEvidence = trustedAmenityAttachments.has(raw.ridb_amenity_evidence) ? raw.ridb_amenity_evidence : null;
    delete p.ridb_amenity_evidence;
    if(amenityEvidence)attachRIDBAmenities({properties:p},amenityEvidence);
    // Forest Service site-record evidence is kept apart from the Recreation.gov amenity evidence above.
    const usfsEvidence = trustedUSFSAttachments.has(raw.usfs_site_evidence) ? raw.usfs_site_evidence : null;
    delete p.usfs_site_evidence;
    if(usfsEvidence)attachUSFSSiteAmenities({properties:p},usfsEvidence);
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
    const distinctOsm = /^osm:(?:node|way|relation|unknown):/.test(q.id) && p.id !== q.id;
    const feeDonor = q.fee_source_record_id || q.id, accessDonor = q.access_source_record_id || q.id;
    const blockedFee = /^osm:(?:node|way|relation|unknown):/.test(feeDonor) && p.id !== feeDonor;
    const blockedAccess = /^osm:(?:node|way|relation|unknown):/.test(accessDonor) && p.id !== accessDonor;
    // Keep tourism attributed to every separate element, including members of the absorbed row.
    const tourismMembers = [...(p.tourism_members || []),...(q.tourism_members || [])];
    for(const e of [...(p.member_evidence || []),...(q.member_evidence || [])]){
      if(e.fields?.tourism && e.source_record_id !== p.id)tourismMembers.push({source_record_id:e.source_record_id,source_url:e.source_url,retrieved_at:e.retrieved_at,tourism:e.fields.tourism});
    }
    if(distinctOsm && q.tourism)tourismMembers.push({source_record_id:q.id,source_url:q.source_url,retrieved_at:q.source_retrieved_at||null,tourism:q.tourism});
    if(tourismMembers.length)p.tourism_members=[...new Map(tourismMembers.map(e=>[e.source_record_id+'|'+e.tourism,e])).values()];
    if (distinctOsm) {
      // Retain the secondary report for review without granting its fee/access
      // to the canonical element merely because names and coordinates matched.
      const records = new Map();
      const list = value => Array.isArray(value) ? value : [];
      for (const r of [...list(p.unverified_osm_matches), ...list(q.unverified_osm_matches), {source_record_id:q.id, fee_status:q.fee_status, cost:q.cost, access:q.access, access_status:q.access_status}]) records.set(JSON.stringify(r),r);
      p.unverified_osm_matches = [...records.values()].slice(0,128);
    }
    if (p.state == null && p.id === q.id && q.state != null) p.state=q.state;
    if(p.forecastStates||q.forecastStates)p.forecastStates=[...new Set([...(p.forecastStates||[]),...(q.forecastStates||[])])];
    p.legacy_ids = [...new Set([...(p.legacy_ids || []), ...(q.legacy_ids || []), q.id])];
    p.sources = [...new Set([...(p.sources || []), ...(q.sources || [])])];
    p.fee_evidence_records=mergeFeeEvidence(p.fee_evidence_records, blockedFee ? (q.fee_evidence_records||[]).map(r=>({...r,classification_use:'not_used',qualification_text:r.qualification_text || 'Recorded on an unverified merged OSM element. Not used to classify this record.'})) : q.fee_evidence_records);
    if (!blockedAccess && p.access_status === 'unknown' && q.access_status !== 'unknown') {p.access=q.access;p.access_status=q.access_status;p.access_label=q.access_label;p.access_source_record_id=q.access_source_record_id||q.id;}
    // Camping classification moves only between exact identities: the same record, or the same Recreation.gov
    // facility id published by an agency (blm-facility:N for ridb:N). A name and distance match is candidate
    // matching only and never classifies or publishes another record. Type never moves with it.
    const exactIdentity = p.id === q.id || (p.facility_id != null && q.facility_id != null && String(p.facility_id) === String(q.facility_id));
    if (exactIdentity && p.camping_classification === 'unverified_camping_record' && q.camping_classification === 'campsite') {p.camping_classification=q.camping_classification;p.camping_evidence=q.camping_evidence;p.camping_evidence_record_id=(q.legacy_ids||[]).find(x=>x!==q.id&&!/^ridb:/.test(x))||q.id;
      // With camping confirmed through an exact identity, the listing shows its own Recreation.gov facility type.
      if(p.type==='other'&&['established','dispersed','backcountry'].includes(p.ridb_facility_type)){p.type=p.ridb_facility_type;p.type_evidence={kind:'structured_classification',source:'Recreation.gov',source_record_id:p.id,field:'FacilityTypeDescription (mapped at import)',value:p.ridb_facility_type,retrieved_at:p.type_evidence?.retrieved_at??null,confirmed_by:p.camping_evidence_record_id};}}
    // Preserve known facts, but do not hide conflicts between sources.
    if (p.fee_conflict || q.fee_conflict) {p.fee_conflict=true; p.fee_status='unknown'; p.cost=null; p.fee_text=null;}
    const adopt = () => {p.fee_status=q.fee_status; p.cost=q.cost; p.fee_source_record_id=q.fee_source_record_id||q.id; for (const k of ['fee_text','fee_source','fee_checked','fee_evidence']) p[k]=q[k] ?? null; p.fee_source=p.fee_source || (q.sources||[])[0] || q.id.split(':')[0];};
    const charged = v => v === 'paid' || v === 'conditional';
    if (!blockedFee && p.fee_status === 'unknown' && q.fee_status !== 'unknown' && !p.fee_conflict) adopt();
    // Agency wording that names conditions refines a bare free or paid record. Free versus paid is a real conflict.
    else if (!blockedFee && q.fee_status === 'conditional' && p.fee_status !== 'conditional' && !p.fee_conflict) adopt();
    else if (p.fee_status !== 'unknown' && q.fee_status !== 'unknown' && p.fee_status !== q.fee_status && !(charged(p.fee_status) && charged(q.fee_status)) && !(p.fee_status === 'conditional' || q.fee_status === 'conditional')) {p.fee_status='unknown'; p.cost=null; p.fee_conflict=true; p.fee_text=null;}
    if (!blockedFee && p.cost === null && q.cost !== null && !p.fee_conflict && p.fee_status === q.fee_status) p.cost=q.cost;
    // Amenity ownership (R8): another record's amenities never become this listing's own.
    // They are kept as attributed member evidence. The same record seen twice (two state files) is identical.
    if (p.id === q.id) {
      p.amenity_negatives = [...new Set([...(p.amenity_negatives || []), ...(q.amenity_negatives || [])])];
      p.amenities = [...new Set([...p.amenities,...q.amenities])].filter(a => !p.amenity_negatives.includes(a));
    } else p.amenity_members = amenityMembers([...(p.amenity_members || []), ...[ownAmenityObservation(q)].filter(Boolean), ...(q.amenity_members || [])], null, p.id);
    // Rig ownership (2.34.0): another record's rig values never become this listing's own.
    if (p.id === q.id) p.rig_friendly = [...new Set([...p.rig_friendly,...q.rig_friendly])];
    else p.rig_members = rigMembers([...(p.rig_members || []), ...[ownRigObservation(q)].filter(Boolean), ...(q.rig_members || [])], null, p.id);
    // Repeated state/source rows never add counts to exact facility summaries.
    if(checkedRIDBAmenities(q.ridb_amenity_evidence)){
      const a=p.ridb_amenity_evidence,b=q.ridb_amenity_evidence;
      if(!checkedRIDBAmenities(a))attachRIDBAmenities(primary,b);
      else if(a.source.sha256===b.source.sha256)attachRIDBAmenities(primary,{version:1,source:a.source,facilities:{...b.facilities,...a.facilities}});
    }
    if(checkedUSFSSiteAmenities(q.usfs_site_evidence)){
      const a=p.usfs_site_evidence,b=q.usfs_site_evidence;
      if(!checkedUSFSSiteAmenities(a))attachUSFSSiteAmenities(primary,b);
      else if(a.source.rows_sha256===b.source.rows_sha256)attachUSFSSiteAmenities(primary,{version:1,source:a.source,facilities:{...b.facilities,...a.facilities}});
    }
    // Provenance debt (2.34.0): website is still filled from another record here. No campsite UI reads it (see data-loader.js).
    if (!p.description && q.description && p.id !== q.id) p.description_source_record_id = q.description_source_record_id || q.id;
    for (const key of ['description','website','source_url','road_difficulty','rating','stay_limit','open_status','season','restrictions']) if (p[key] == null || p[key] === '') p[key]=q[key] ?? p[key];
    return primary;
  }
  // A state's complete snapshot must support camping before another state's
  // previously loaded listings can enrich it. Keep original rows/order here:
  // returning locally merged rows would change cross-state dedupe geometry.
  // Members of snapshot rows whose own record is not a classified campsite. Used across states, since one
  // element can be a member in one state file and a row of its own in another.
  function withheldMembers(features, options = {}) {
    const out=new Set();
    for (const raw of Array.isArray(features)?features:[]) {
      const p=raw?.properties;if(!p||!Array.isArray(p.source_ids)||p.source_ids.length<2)continue;
      const n=normalizeFeature(raw,options);
      if(!n||n.properties.camping_classification!=='campsite')for(const id of p.source_ids)if(id!==p.id&&/^osm:/.test(id))out.add(id);
    }
    return out;
  }
  function publicationCandidates(features, options = {}) {
    const candidates=(Array.isArray(features)?features:[]).map(raw=>({raw,feature:normalizeFeature(raw,options)})).filter(x=>x.feature);
    const published=cleanAndDedupeGeoJSON({features:candidates.map(x=>x.feature)},options).features;
    const admitted=new Set(published.flatMap(f=>[f.properties.id,...(f.properties.legacy_ids||[])]));
    return candidates.filter(x=>admitted.has(x.feature.properties.id)).map(x=>x.raw);
  }
  // Published canonical hosts (data/campsites/identity-hosts.json, derived from search-index.json).
  // hosts maps each canonical id of a multi-record listing to its legacy ids. Listings with one
  // record never merge, so only these ids decide an election. See docs/DETERMINISTIC_IDENTITY.md.
  const ID_TEXT = id => typeof id === 'string' && id.length > 0 && id.length <= 200 && !/[\x00-\x20\x7f]/.test(id);
  function validIdentityHosts(data) {
    if (!data || typeof data !== 'object' || data.version !== 1 || !data.hosts || typeof data.hosts !== 'object' || Array.isArray(data.hosts)) return false;
    if (!Number.isSafeInteger(data.index_sites) || data.index_sites < 1 || typeof data.index_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.index_sha256)) return false;
    const entries = Object.entries(data.hosts), seen = new Set();
    if (entries.length > 200000) return false;
    for (const [id, aliases] of entries) {
      if (!ID_TEXT(id) || !Array.isArray(aliases) || !aliases.length || aliases.length > 128) return false;
      for (const alias of aliases) { if (!ID_TEXT(alias) || alias === id || seen.has(alias) || Object.hasOwn(data.hosts, alias)) return false; seen.add(alias); }
    }
    return true;
  }
  function identityOptions(data) {
    if (!validIdentityHosts(data)) return null;
    const preferredIds = new Set(), previousHosts = new Map();
    for (const [id, aliases] of Object.entries(data.hosts)) { preferredIds.add(id); for (const alias of aliases) previousHosts.set(alias, id); }
    return {preferredIds, previousHosts};
  }
  function cleanAndDedupeGeoJSON(input, options = {}) {
    if (!input || !Array.isArray(input.features)) return {type:'FeatureCollection',features:[]};
    const features=[], ids=new Map(), grid=new Map();
    // Same-name records within 300 m are one place. Agency and Recreation.gov points often sit a few hundred meters apart.
    const cellSize=.003, radius=options.radiusMeters ?? 300;
    for (const raw of input.features) {
      const f=normalizeFeature(raw,options); if (!f) continue;
      const p=f.properties, ll=getLatLng(f), cx=Math.floor(ll.lon/cellSize), cy=Math.floor(ll.lat/cellSize);
      let found=ids.get(p.id);
      // A record that was an alias of a published listing rejoins that listing when it still matches.
      const previousHost=options.previousHosts?.get(p.id);
      if (!found) {
        let first=null;
        for (let x=cx-3; x<=cx+3 && !found; x++) for(let y=cy-1; y<=cy+1 && !found; y++) {
          for (const other of grid.get(`${x},${y}`) || []) {
            const op=other.properties;
            if (p.facility_id && op.facility_id && String(p.facility_id)!==String(op.facility_id)) continue;
            if (normalizeName(op.name) === normalizeName(p.name) && distanceMeters(ll,getLatLng(other))<=radius) {
              if (!previousHost || op.id===previousHost) {found=other;break;}
              if (!first) first=other;
            }
          }
        }
        if (!found) found=first;
      }
      if (found) {
        // A listing ID that is already published stays canonical, with its own point, when a newly
        // separated record merges into the same place. Reviews and saved stops are keyed by that ID.
        const preferred=options.preferredIds;
        if (preferred && preferred.has(p.id) && !preferred.has(found.properties.id)) {
          mergeFeatures(f,found);found.properties=f.properties;found.geometry=f.geometry;
        } else mergeFeatures(found,f);
        ids.set(p.id,found);continue;
      }
      features.push(f);ids.set(p.id,f);
      const key=`${cx},${cy}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(f);
    }
    // The public MVP lists evidence-supported camping locations only. Retain
    // unverified source records solely when an explicit diagnostic caller asks.
    // A published listing keeps its published point when its own record now qualifies where another copy
    // supplied the point before (tourism-type-admission candidate). Coordinates change only by review.
    if (options.publishedPoints) for (const f of features) {const pt=options.publishedPoints.get(f.properties.id);if(pt&&(pt[0]!==f.geometry.coordinates[0]||pt[1]!==f.geometry.coordinates[1]))f.geometry={type:'Point',coordinates:[pt[0],pt[1]]};}
    if (options.includeUnverified) return {type:'FeatureCollection',features};
    // An element absorbed into an unclassified host stays withheld with that host (tourism-type-admission
    // candidate). It never publishes on its own because its host lost a borrowed classification. It needs its
    // own admission and identity review. Elements with their own separate listing are unaffected.
    const withheld=new Set();
    for (const f of features) if (f.properties.camping_classification !== 'campsite') for (const id of f.properties.legacy_ids || []) if (id !== f.properties.id) withheld.add(id);
    // Snapshot membership crosses state files: a host's own row (source_ids) withholds its members everywhere.
    for (const id of options.withheldMembers || []) withheld.add(id);
    // An element that is already its own published listing keeps it (saved links and reviews are keyed by it).
    for (const id of options.preferredIds || []) withheld.delete(id);
    withheld.delete(DON_CARTER_ELEMENT);
    return {type:'FeatureCollection',features:features.filter(f => discoverable(f.properties) && !withheld.has(f.properties.id) && !WITHDRAWN_IDS.has(f.properties.id))};
  }
  const RIDB_AMENITY_URL='https://ridb.recreation.gov/downloads/RIDBFullExport_V1_CSV.zip';
  const RIDB_AMENITY_KEYS=['toilet','drinking_water','shower','dump','picnic_table','fire_fixture','grill','trash_collection','food_locker','tent_pad','grill_or_fire_ring'];
  const RIDB_AMENITY_QUALIFIERS={toilet:['seasonal','accessible'],drinking_water:['peak_season','hand_pump','accessible'],shower:['seasonal','coin','accessible','outdoor'],dump:[],picnic_table:[],fire_fixture:[],grill:['accessible'],trash_collection:[],food_locker:[],tent_pad:[],grill_or_fire_ring:[]};
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const checkedAmenityPayloads=new WeakSet();
  const trustedAmenityAttachments=new WeakSet();
  function checkedRIDBAmenities(data){
    if(object(data)&&checkedAmenityPayloads.has(data))return true;
    if(!validRIDBAmenities(data))return false;
    // Only immutable validated objects can skip repeated catalogue-sized validation.
    for(const r of Object.values(data.facilities)){
      for(const g of Object.values(r.amenities)){Object.freeze(g.qualifiers);Object.freeze(g);}
      Object.freeze(r.amenities);Object.freeze(r);
    }
    Object.freeze(data.source);Object.freeze(data.facilities);Object.freeze(data);
    checkedAmenityPayloads.add(data);return true;
  }
  function ridbFacilityIds(p){
    const ids=new Set();
    for(const id of [p.id,...(Array.isArray(p.legacy_ids)?p.legacy_ids:[])])if(typeof id==='string'&&/^ridb:[1-9][0-9]*$/.test(id))ids.add(id.slice(5));
    return [...ids];
  }
  function validRIDBAmenities(data){
    if(!object(data)||data.version!==1||!object(data.source)||!object(data.facilities))return false;
    const s=data.source,utc=d=>typeof d==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,19)===d.slice(0,19);
    const retrieved=s.basis==='canonical_download'&&utc(s.original_retrieved_at)&&(s.http_last_modified===null||utc(s.http_last_modified));
    const frozen=s.basis==='frozen_public_export_cache'&&s.original_retrieved_at===null&&s.http_last_modified===null;
    if(s.name!=='Recreation.gov RIDB full export'||s.url!==RIDB_AMENITY_URL||typeof s.sha256!=='string'||!/^[a-f0-9]{64}$/.test(s.sha256)||!utc(s.inspected_at)||!(retrieved||frozen)||s.attribute_updated_at!==null||s.archive_entry_timezone!==null||typeof s.archive_entry_time!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(s.archive_entry_time)||!utc(s.archive_entry_time+'Z'))return false;
    if(retrieved&&(Date.parse(s.original_retrieved_at)>Date.parse(s.inspected_at)||(s.http_last_modified!==null&&Date.parse(s.http_last_modified)>Date.parse(s.original_retrieved_at))))return false;
    const entries=Object.entries(data.facilities),count=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000;
    if(entries.length>3000)return false;
    for(const [fid,r] of entries){
      if(!/^[1-9][0-9]*$/.test(fid)||!object(r)||!count(r.sites)||!object(r.amenities)||Object.keys(r.amenities).length>RIDB_AMENITY_KEYS.length)return false;
      for(const [key,g] of Object.entries(r.amenities)){
        if(!RIDB_AMENITY_KEYS.includes(key)||!object(g)||!object(g.qualifiers))return false;
        const ns=['reported','negative','unknown','conflict'].map(k=>g[k]);
        if(!ns.every(count)||ns.reduce((a,b)=>a+b,0)>r.sites)return false;
        for(const [qualifier,n] of Object.entries(g.qualifiers))if(!RIDB_AMENITY_QUALIFIERS[key].includes(qualifier)||!count(n)||n>g.reported)return false;
      }
    }
    return true;
  }
  function attachRIDBAmenities(feature,data){
    const p=feature?.properties;if(!p||!checkedRIDBAmenities(data))return feature;
    const facilities={};
    for(const fid of ridbFacilityIds(p))if(Object.hasOwn(data.facilities,fid))facilities[fid]=data.facilities[fid];
    if(Object.keys(facilities).length){
      const evidence={version:1,source:data.source,facilities};
      checkedRIDBAmenities(evidence);
      trustedAmenityAttachments.add(evidence);
      p.ridb_amenity_evidence=evidence;
    }
    return feature;
  }
  // Forest Service Recreation Site records joined only by an exact Recreation.gov facility ID.
  // The agency's own water and restroom text is kept verbatim. A class exists only when the text is explicit.
  const USFS_SITE_URL='https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0';
  const USFS_SITE_NAME='USDA Forest Service Recreation Site record';
  const USFS_CLASSES={water:['drinking_water','no_drinking_water','no_water','unknown'],toilet:['flush','vault_or_pit','no_toilet','nearby_only','unknown']};
  const USFS_QUALIFIERS={drinking_water:['hand_pump','seasonal'],flush:['accessible'],vault_or_pit:['accessible']};
  const checkedUSFSPayloads=new WeakSet();
  const trustedUSFSAttachments=new WeakSet();
  function deepFreeze(value){
    if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(deepFreeze);}
    return value;
  }
  function checkedUSFSSiteAmenities(data){
    if(object(data)&&checkedUSFSPayloads.has(data))return true;
    if(!validUSFSSiteAmenities(data))return false;
    deepFreeze(data);checkedUSFSPayloads.add(data);return true;
  }
  function validUSFSSiteAmenities(data){
    if(!object(data)||data.version!==1||!object(data.source)||!object(data.facilities))return false;
    const s=data.source,day=d=>typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
    if(s.name!==USFS_SITE_NAME||s.layer_url!==USFS_SITE_URL||s.license!=='CC BY 4.0'||!['saved_download','layer_query'].includes(s.basis)||!day(s.retrieved)||typeof s.rows_sha256!=='string'||!/^[a-f0-9]{64}$/.test(s.rows_sha256))return false;
    const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&v===v.trim()&&v.toLowerCase()!=='null';
    const entries=Object.entries(data.facilities);
    if(entries.length>3000)return false;
    for(const [fid,f] of entries){
      if(!/^[1-9][0-9]*$/.test(fid)||!object(f)||!Array.isArray(f.records)||f.records.length<1||f.records.length>25||!Array.isArray(f.conflicts))return false;
      const classes={water:new Set(),toilet:new Set()};
      for(const r of f.records){
        if(!object(r)||!text(r.cn,40)||!(r.name===null||text(r.name,160))||!(r.type===null||text(r.type,80)))return false;
        if(!(r.updated===null||day(r.updated))||!(r.edw_modified===null||day(r.edw_modified)))return false;
        if(!r.water&&!r.toilet)return false;
        for(const field of ['water','toilet']){
          const item=r[field];if(item===undefined)continue;
          if(!object(item)||!text(item.text,600)||!USFS_CLASSES[field].includes(item.class))return false;
          const allowed=USFS_QUALIFIERS[item.class]||[],q=item.qualifiers;
          if(q!==undefined&&(!Array.isArray(q)||!q.length||new Set(q).size!==q.length||q.some(x=>!allowed.includes(x))))return false;
          if(item.class!=='unknown')classes[field].add(item.class);
        }
        if(r.season!==undefined&&(!object(r.season)||!Object.keys(r.season).length||Object.keys(r.season).some(k=>!['open_season','description'].includes(k)||!text(r.season[k],600))))return false;
      }
      // A disagreement between records must be flagged, so no label is ever shown under it.
      const flagged=new Set(f.conflicts);
      if(flagged.size!==f.conflicts.length||[...flagged].some(x=>!Object.hasOwn(classes,x)))return false;
      for(const field of ['water','toilet'])if((classes[field].size>1)!==flagged.has(field))return false;
    }
    return true;
  }
  function attachUSFSSiteAmenities(feature,data){
    const p=feature?.properties;if(!p||!checkedUSFSSiteAmenities(data))return feature;
    const facilities={};
    for(const fid of ridbFacilityIds(p))if(Object.hasOwn(data.facilities,fid))facilities[fid]=data.facilities[fid];
    if(Object.keys(facilities).length){
      const evidence={version:1,source:data.source,facilities};
      checkedUSFSSiteAmenities(evidence);
      trustedUSFSAttachments.add(evidence);
      p.usfs_site_evidence=evidence;
    }
    return feature;
  }
  // One evidence model drives both the popup and the amenity filters (R8, 2.31.0).
  // Scopes: element (the listing's own OSM element), listing_record (the listing's own source record),
  // site_record (a Forest Service Recreation Site record for this facility) and campsite_records
  // (individual Recreation.gov campsite records; some sites, never every site). Dates are observation
  // dates when the source has one, otherwise null ("date unknown"). A build or rebuild date is never used.
  const FILTER_AMENITIES = ['toilet','water','dump','shower'];
  const RIDB_FILTER_KEYS = {toilet:'toilet', water:'drinking_water', dump:'dump', shower:'shower'};
  const USFS_FILTER = {toilet:{field:'toilet', yes:['flush','vault_or_pit'], no:['no_toilet']}, water:{field:'water', yes:['drinking_water'], no:['no_drinking_water','no_water']}};
  const CAMPGROUND_SCOPES = new Set(['element','listing_record','site_record']);
  // Only a Forest Service record for a campground describes the campground. A swimming site, picnic area,
  // entrance station or cabin under the same Recreation.gov ID is a different site: shown, never filter evidence.
  const USFS_CAMPGROUND_TYPES = new Set(['CAMPGROUND','GROUP CAMPGROUND','HORSE CAMP']);
  const usfsScope = r => USFS_CAMPGROUND_TYPES.has(String(r.type || '').trim().toUpperCase()) ? 'site_record' : 'other_site_record';
  function amenityEvidence(p) {
    const amenities = Object.fromEntries(FILTER_AMENITIES.map(a => [a, {positive:[], negative:[], conflict:[], other:[], elsewhere:[]}]));
    const sources = [];
    if (!p) return {state:'no_source', sources, amenities, members:[]};
    if (p.osm_amenity_tags && OSM_ELEMENT.test(p.id)) {
      const tags = p.osm_amenity_tags, date = evidenceDate(tags.check_date) ? tags.check_date : null;
      const base = {source:'osm', record:p.id, scope:'element', date, retrieved:evidenceDate(p.source_retrieved_at)};
      sources.push({...base, tags});
      for (const a of FILTER_AMENITIES) {
        const value = tags[OSM_AMENITY_FIELDS[a][0]];
        if (value == null) continue;
        const v = String(value).trim().toLowerCase();
        amenities[a][v === 'yes' ? 'positive' : v === 'no' ? 'negative' : 'other'].push({...base, value:String(value)});
      }
    }
    if (p.amenity_record && Array.isArray(p.amenities) && p.amenities.length) {
      const base = {source:'record', label:p.amenity_record.source, record:p.id, scope:'listing_record', date:null, retrieved:p.amenity_record.retrieved_at || null};
      sources.push({...base, values:[...p.amenities]});
      for (const a of p.amenities) if (amenities[a]) amenities[a].positive.push(base);
      for (const a of p.amenity_negatives || []) if (amenities[a]) amenities[a].negative.push(base);
    }
    const ridb = checkedRIDBAmenities(p.ridb_amenity_evidence) ? p.ridb_amenity_evidence : null;
    if (ridb) for (const [fid, rec] of Object.entries(ridb.facilities)) {
      if (!rec.sites) continue;
      const base = {source:'ridb', record:'ridb:'+fid, scope:'campsite_records', date:null, retrieved:ridb.source.original_retrieved_at || null, total:rec.sites};
      sources.push(base);
      for (const a of FILTER_AMENITIES) {
        const g = rec.amenities[RIDB_FILTER_KEYS[a]];
        if (!g) continue;
        if (g.reported) amenities[a].positive.push({...base, count:g.reported});
        if (g.negative) amenities[a].negative.push({...base, count:g.negative});
        if (g.conflict) amenities[a].conflict.push({...base, count:g.conflict});
        if (g.unknown) amenities[a].other.push({...base, count:g.unknown});
      }
    }
    const usfs = checkedUSFSSiteAmenities(p.usfs_site_evidence) ? p.usfs_site_evidence : null;
    if (usfs) for (const [fid, facility] of Object.entries(usfs.facilities)) {
      for (const r of facility.records) sources.push({source:'usfs', record:'ridb:'+fid, scope:usfsScope(r), name:r.name, type:r.type, date:r.updated || null, retrieved:usfs.source.retrieved});
      for (const [a, rule] of Object.entries(USFS_FILTER)) {
        for (const r of facility.records) {
          const item = r[rule.field];
          if (!item) continue;
          const ref = {source:'usfs', record:'ridb:'+fid, scope:usfsScope(r), name:r.name, type:r.type, date:r.updated || null, retrieved:usfs.source.retrieved, value:item.text};
          if (ref.scope === 'other_site_record') { amenities[a].elsewhere.push(ref); continue; }
          // Records for one ID that disagree give no label, so they give no filter evidence either.
          if (facility.conflicts.includes(rule.field)) amenities[a].conflict.push(ref);
          else amenities[a][rule.yes.includes(item.class) ? 'positive' : rule.no.includes(item.class) ? 'negative' : 'other'].push(ref);
        }
      }
    }
    for (const a of FILTER_AMENITIES) {
      const x = amenities[a], wide = list => list.some(e => CAMPGROUND_SCOPES.has(e.scope));
      // A campground-wide statement that disagrees with any other statement is a contradiction.
      // Different Recreation.gov campsite records may differ without contradicting each other.
      const contradicted = x.positive.length && x.negative.length && (wide(x.positive) || wide(x.negative));
      x.status = contradicted || (x.conflict.length && x.conflict.some(e => e.source === 'usfs')) ? 'conflict'
        : x.positive.length ? 'present' : x.negative.length ? 'absent' : x.conflict.length ? 'conflict' : x.other.length ? 'unrecognized' : 'unknown';
    }
    return {state:sources.length ? 'evidence' : 'no_source', sources, amenities, members:Array.isArray(p.amenity_members) ? p.amenity_members : []};
  }
  // Filterable amenities: g at campground scope, s only on individual campsite records.
  function amenityFilterSets(p) {
    const f = p?.amenity_filter;
    if (f && Array.isArray(f.g) && Array.isArray(f.s)) return f;
    const e = amenityEvidence(p), g = [], s = [];
    for (const a of FILTER_AMENITIES) {
      const x = e.amenities[a];
      if (x.status !== 'present') continue;
      if (x.positive.some(r => CAMPGROUND_SCOPES.has(r.scope))) g.push(a);
      if (x.positive.some(r => r.scope === 'campsite_records')) s.push(a);
    }
    return {g, s};
  }
  // A length or hookup filter is matched on one Recreation.gov campsite. Amenity counts are not joined
  // to particular campsites, so campsite-record amenities cannot satisfy an amenity filter alongside it.
  const campsiteRigActive = filters => +filters?.rigLength > 0 || (Array.isArray(filters?.hookups) && filters.hookups.length > 0);
  function amenityMatches(p, wanted, filters = {}) {
    if (!Array.isArray(wanted) || !wanted.length) return true;
    const f = amenityFilterSets(p), rig = campsiteRigActive(filters);
    return wanted.every(a => f.g.includes(a) || (!rig && f.s.includes(a)));
  }
  // Why a listing is or is not included for one amenity filter. Used by the published fixture and tests.
  function amenityFilterReason(p, amenity, filters = {}) {
    const e = amenityEvidence(p), x = e.amenities[amenity];
    if (!x) return {included:false, reason:'not_a_filter_amenity'};
    if (amenityMatches(p, [amenity], filters)) return {included:true, reason:'evidence', sources:[...new Set(x.positive.map(r => r.source + ':' + r.scope))].sort()};
    if (e.state === 'no_source') return {included:false, reason:'no_amenity_source'};
    if (x.status === 'present') return {included:false, reason:'campsite_records_with_rig_filter'};
    return {included:false, reason:{unknown:'no_statement_for_this_amenity', absent:'explicit_negative', conflict:'sources_disagree', unrecognized:'unrecognized_value'}[x.status]};
  }
  // Attach Recreation.gov site-level summaries (RV lengths, hookups) to a campground.
  // An OSM-hosted listing joined to a Recreation.gov facility by an exact ridb: alias keeps that facility's
  // RV-type site count beside its own rig tags, so a disagreement shows as a conflict (2.34.0). It adds no category.
  function attachRigCheck(feature, table) {
    const p = feature && feature.properties;
    if (!p || p.facility_id != null || !table || !p.osm_rig_tags || !OSM_ELEMENT.test(p.id)) return feature;
    for (const fid of ridbFacilityIds(p).sort()) {
      const rec = table[fid];
      if (rec && typeof rec === 'object' && Number.isInteger(rec.t) && rec.t > 0 && Number.isInteger(rec.r)) {p.ridb_rig_check = {fid, t:rec.t, r:rec.r}; break;}
    }
    return feature;
  }
  function attachSiteDetails(feature, table) {
    const p = feature && feature.properties;
    if (p && p.facility_id == null) return attachRigCheck(feature, table);
    if (!p || p.facility_id == null || !table) return feature;
    const rec = table[String(p.facility_id)];
    if (!rec || typeof rec !== 'object') return feature;
    const int = v => Number.isInteger(v) && v >= 0 ? v : 0;
    p.site_count = int(rec.t);
    p.rv_sites = int(rec.r);
    p.rv_max_length = int(rec.L) > 0 ? int(rec.L) : null;
    // One signature = one kind of RV-capable campsite: [length_ft, hookup bits (electric 1, water 2, sewer 4), site count].
    p.rv_sigs = Array.isArray(rec.g) ? rec.g.filter(g => Array.isArray(g) && g.length === 3 && g.every(v => Number.isInteger(v) && v >= 0) && g[1] < 8 && g[2] > 0).map(g => [...g]) : [];
    p.hookups = {electric: int(rec.e), water: int(rec.w), sewer: int(rec.s)};
    if (rec.rs === 1) p.reservable = true;
    // Recreation.gov fee wording fills an unknown fee. It never overrides a known or conflicting fee. Reservability is not fee evidence.
    if (p.fee_status === 'unknown' && !p.fee_conflict && (rec.f === 'free' || rec.f === 'paid' || rec.f === 'conditional')) {
      p.fee_status = rec.f;
      p.cost = rec.f === 'free' ? 0 : (validNumber(rec.c) && rec.c > 0 ? rec.c : null);
      p.fee_evidence = 'Recreation.gov fee description';
      p.fee_source = 'Recreation.gov';
      p.fee_source_record_id = `ridb:${p.facility_id}`;
    }
    if (typeof rec.sl === 'string' && rec.sl.trim()) p.stay_limit = rec.sl.trim().slice(0, 160);
    return feature;
  }
  const HOOKUP_BITS = {electric: 1, water: 2, sewer: 4};
  const hookupMask = hookups => (Array.isArray(hookups) ? hookups : []).reduce((m, h) => m | (HOOKUP_BITS[h] || 0), 0);
  // Count campsites where length and every selected hookup are reported on the same site.
  function matchingSites(p, length = 0, hookups = [], includeUnknownLength = false) {
    if (!p || !Array.isArray(p.rv_sigs)) return 0;
    const mask = hookupMask(hookups);
    return p.rv_sigs.reduce((n, [len, bits, count]) => {
      const fits = !(length > 0) || len >= length || (len === 0 && includeUnknownLength);
      return n + (fits && (bits & mask) === mask ? count : 0);
    }, 0);
  }
  function sitesFitting(p, length, hookups = []) { return matchingSites(p, length, hookups, false); }
  const ELEVATION_SOURCE='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
  const elevationNumber=n=>typeof n==='number'&&Number.isFinite(n)&&n>=-500&&n<=9000;
  const ELEVATION_STATES=new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
  function elevationDate(d){
    // Retrieval is an actual UTC instant, not a local date or a normalized impossible date.
    if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(d))return false;
    const parsed=new Date(d);
    return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,19)===d.slice(0,19);
  }
  const elevationObject=o=>!!o&&typeof o==='object'&&!Array.isArray(o);
  function coordinateKey(coordinates){
    if(!Array.isArray(coordinates)||coordinates.length<2||!coordinates.slice(0,2).every(Number.isFinite)||Math.abs(coordinates[0])>180||Math.abs(coordinates[1])>90)return null;
    const fixed=n=>{const s=n.toFixed(7);return s==='-0.0000000'?'0.0000000':s;};
    return fixed(coordinates[1])+','+fixed(coordinates[0]);
  }
  function validElevationManifest(d){
    return elevationObject(d)&&d.version===1&&/^[a-f0-9]{24}$/.test(d.snapshot_id)&&elevationDate(d.generated_at)&&d.source?.url===ELEVATION_SOURCE&&d.source?.units==='metres'&&d.source?.interpolation==='RSP_BilinearInterpolation'&&elevationObject(d.states)&&Object.keys(d.states).length<=50&&Object.entries(d.states).every(([code,s])=>ELEVATION_STATES.has(code)&&elevationObject(s)&&s.url===`snapshots/${d.snapshot_id}/${code}.json`&&/^[a-f0-9]{64}$/.test(s.sha256)&&Number.isInteger(s.count)&&s.count>=0&&s.count<=100000);
  }
  function validElevationState(d,code,snapshot){
    if(!elevationObject(d)||d.version!==1||d.state!==code||!ELEVATION_STATES.has(code)||!/^[a-f0-9]{24}$/.test(d.snapshot_id)||(snapshot&&d.snapshot_id!==snapshot)||!elevationObject(d.records)||Object.keys(d.records).length>100000)return false;
    return Object.entries(d.records).every(([id,r])=>{
      if(!id||id.length>200||!elevationObject(r)||typeof r.coordinate_key!=='string'||!elevationDate(r.retrieved_at)||r.source?.url!==ELEVATION_SOURCE||r.source?.sample_url!==ELEVATION_SOURCE+'/getSamples'||r.source?.units!=='metres'||r.source?.interpolation!=='RSP_BilinearInterpolation'||r.source?.horizontal_crs!=='EPSG:4326')return false;
      const parts=r.coordinate_key.split(',').map(Number);
      if(parts.length!==2||coordinateKey([parts[1],parts[0]])!==r.coordinate_key)return false;
      if(r.status==='unknown')return r.elevation_m===null;
      return r.status==='known'&&elevationNumber(r.elevation_m)&&coordinateKey([r.sample_coordinates?.lng,r.sample_coordinates?.lat])===r.coordinate_key;
    });
  }
  function elevationInfo(feature){
    const e=feature?.properties?.elevation;
    return elevationObject(e)&&elevationNumber(e.m)&&elevationDate(e.d)&&typeof e.k==='string'&&e.k===coordinateKey(feature.geometry?.coordinates)?{m:e.m,k:e.k,d:e.d}:null;
  }
  function attachElevation(feature,sidecars){
    feature.properties.elevation=null;
    const p=feature.properties,key=coordinateKey(feature.geometry?.coordinates);
    for(const id of [p.id,...(p.legacy_ids||[])])for(const d of sidecars){
      const r=d?.records?.[id];
      if(!r||r.coordinate_key!==key)continue;
      if(r.status==='known'&&elevationNumber(r.elevation_m))p.elevation={m:r.elevation_m,k:key,d:r.retrieved_at};
      return;
    }
  }
  function elevationRange(f={}){
    const present=v=>v!==null&&v!==undefined&&v!=='';
    const min=present(f.elevationMin)?f.elevationMin:null,max=present(f.elevationMax)?f.elevationMax:null;
    return{min,max,active:min!==null||max!==null,valid:(min===null||elevationNumber(min))&&(max===null||elevationNumber(max))&&(min===null||max===null||min<=max)};
  }
  function elevationToMetres(value,unit='ft'){return typeof value==='number'&&Number.isFinite(value)?Math.round((unit==='m'?value:value*.3048)*1e6)/1e6:null;}
  function elevationFromMetres(value,unit='ft'){return typeof value==='number'&&Number.isFinite(value)?Math.round((unit==='m'?value:value/.3048)*1e6)/1e6:null;}
  function elevationText(feature,unit='ft'){
    const e=elevationInfo(feature), i18n=global.KampTrailI18n;
    if(!e)return i18n?.t('Elevation unknown') || 'Elevation unknown';
    const params={height:Math.round(elevationFromMetres(e.m,unit)).toLocaleString(i18n?.locale() || 'en-US'),unit:unit==='m'?'m':'ft',date:e.d.slice(0,10)};
    return i18n?.t('Approx. elevation {height} {unit} · USGS 3DEP · retrieved {date}',params) || `Approx. elevation ${params.height} ${params.unit} · USGS 3DEP · retrieved ${params.date}`;
  }
  function applyFilters(sites, filters = {}) {
    const elevation=elevationRange(filters);
    const forecast=global.KampTrailForecast,forecastActive=filters.forecastMinC!=null||filters.forecastMaxC!=null,forecastNow=forecast?.effectiveNow();
    return sites.filter(site => {
      const p=site.properties;
      if(forecastActive&&(!forecast||!forecast.matches(site,filters,forecastNow)))return false;
      if(elevation.active){const e=elevationInfo(site);if(!elevation.valid||!e||(elevation.min!==null&&e.m<elevation.min)||(elevation.max!==null&&e.m>elevation.max))return false;}
      if (filters.cost && filters.cost !== 'all' && p.fee_status !== filters.cost) return false;
      if (filters.type && filters.type !== 'all' && p.type !== filters.type) return false;
      if (filters.rigSize && filters.rigSize !== 'all' && !rigMatches(p, filters.rigSize)) return false;
      // No UI sets this. The bundled value is an unattributed surface label (paved, gravel, dirt), never visitor approach difficulty.
      if (filters.roadDifficulty && filters.roadDifficulty !== 'all' && p.road_difficulty !== filters.roadDifficulty) return false;
      if (Array.isArray(filters.amenities) && filters.amenities.length && !amenityMatches(p, filters.amenities, filters)) return false;
      if (global.KampTrailDiscovery?.active(filters)) {if(!global.KampTrailDiscovery.matches(p,filters))return false;} else if(+filters.minRating>0)return false;
      // Rig length: a campground matches only if at least one site reports an RV-type length that fits.
      // Rig length and hookups must be satisfied by the same campsite, never by different sites in one campground.
      const rig = +filters.rigLength > 0 ? +filters.rigLength : 0, hooks = Array.isArray(filters.hookups) ? filters.hookups : [];
      if (rig || hooks.length) {
        if (p.rv_sigs && p.rv_sigs.length) { if (!matchingSites(p, rig, hooks, !!filters.rigIncludeUnknown)) return false; }
        else if (hooks.length || !filters.rigIncludeUnknown) return false;
      }
      return true;
    });
  }
  // Refresh health: which sources are current, stale, or failing. Pure, so the About dialog and tests share it.
  function summarizeHealth(h, now = Date.now()) {
    if (!h || h.version !== 1 || !h.sources) return null;
    const DAY = 86400000, limit = (+h.stale_after_days || 45) * DAY, issues = [];
    const day = iso => iso ? String(iso).slice(0, 10) : null;
    const rows = Object.entries(h.sources).filter(([, s]) => !s.retired_by).map(([id, s]) => {
      const scopes = Object.values(s.scopes || {}), n = scopes.length;
      const failed = scopes.filter(x => x.outcome === 'failed').length, skipped = scopes.filter(x => x.outcome === 'skipped').length;
      const stale = scopes.filter(x => !x.last_success || now - Date.parse(x.last_success) > limit).length;
      let status = 'current';
      if (n && failed === n) status = 'failing'; else if (stale) status = 'stale'; else if (failed) status = 'partial';
      const where = n > 1 ? (k => `${k} of ${n} states`) : (() => '');
      let note = '';
      if (status === 'failing') note = 'The last refresh failed. Saved data is shown.';
      else if (stale) note = `Older than ${Math.round(limit / DAY)} days${n > 1 ? ' in ' + where(stale) : ''}.`;
      if (failed && status !== 'failing') note += `${note ? ' ' : ''}Last refresh failed${n > 1 ? ' in ' + where(failed) : ''}. Saved data is shown.`;
      if (skipped) note += `${note ? ' ' : ''}Not refreshed in the last run${n > 1 ? ' in ' + where(skipped) : ''}.`;
      if (id === 'services_extracts' && Array.isArray(s.coverage_states)) note += (note ? ' ' : '')+t('Expanded extracts cover {count} of 50 states. Dates describe source extracts.',{count:s.coverage_states.length});
      if (status !== 'current') issues.push(s.label || id);
      return {id, label: s.label || id, oldest: day(s.oldest_success), newest: day(s.newest_success), status, note};
    });
    const c = (h.run && h.run.counts) || {};
    const runFailed = !!h.run && !c.fresh && (c.failed || 0) > 0;
    return {degraded: runFailed || rows.some(r => r.status === 'failing' || r.status === 'stale'), runFailed, lastRun: h.run ? day(h.run.started) : null, runCounts: c, rows, issues};
  }
  global.DataQuality={USFS_CAMPGROUND_TYPES,RIDB_AMENITY_URL,USFS_SITE_URL,ridbFacilityIds,validRIDBAmenities,attachRIDBAmenities,validUSFSSiteAmenities,attachUSFSSiteAmenities,ELEVATION_SOURCE,coordinateKey,validElevationManifest,validElevationState,elevationInfo,attachElevation,elevationRange,elevationToMetres,elevationFromMetres,elevationText,version:'2.35.0',FILTER_AMENITIES,OSM_AMENITY_TAG,OSM_RIG_TAG,RIG_CATEGORIES,rigEvidence,rigFilterSet,rigMatches,rigLine,attachRigCheck,amenityEvidence,amenityFilterSets,amenityMatches,amenityFilterReason,campsiteRigActive,mergeFeeEvidence,publicationCandidates,withheldMembers,isWithdrawnId,validIdentityHosts,identityOptions,summarizeHealth,attachSiteDetails,sitesFitting,matchingSites,normalizeFeature,cleanAndDedupeGeoJSON,applyFilters,getLatLng,classifyCampingRecord};
  if(typeof module !== 'undefined' && module.exports)module.exports=global.DataQuality;
})(typeof window !== 'undefined' ? window : globalThis);
