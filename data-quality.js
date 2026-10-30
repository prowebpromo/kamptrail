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
  function classifyCampingRecord(raw, name, {osm = false, ridb = false} = {}) {
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
    let exclusion_reason = null;
    if (['private', 'no', 'military'].includes(access)) exclusion_reason = `access_${access}`;
    else if (/^(yes|true|1)$/i.test(String(raw.disused || raw.abandoned || '')) || raw['disused:tourism'] || raw['abandoned:tourism'] || String(raw.camping).toLowerCase() === 'no' || /\b(?:camping (?:is )?(?:not (?:allowed|permitted)|prohibited)|no overnight camping)\b/i.test(intro)) exclusion_reason = 'camping_not_operating_or_prohibited';
    // An explicit campsite tag is stronger evidence than a facility's ambiguous name.
    // Do not infer public access from private ownership, a business name, or a fee.
    else if (!explicitlyCamping && !campingName) {
      if (/\b(?:ranger\s+(?:district|station)|(?:naval|air\s*force|military)\s+(?:air\s+)?(?:base|station)|(?:district|administrative|forest|ranger|supervisor(?:s)?)\s+office|visitor\s+(?:center|centre)|information\s+(?:center|centre)|contact\s+station|headquarters)\b/i.test(name)) exclusion_reason = 'administrative_facility';
      else if (/\b(?:day[ -]?use|picnic|pavilions?|shelters?|boat\s+(?:launch|ramp)|launch\s+ramp)\b/i.test(name)) exclusion_reason = 'day_use_facility';
      else if (/\b(?:cabins?|lodges?|lookouts?|guard\s+stations?|hotels?|motels?|chalets?|yurts?|huts?)\b/i.test(name)) exclusion_reason = 'lodging_or_lookout';
    }
    return {
      access: access || null, access_status, access_label, exclusion_reason,
      camping_evidence: agencyCamping ? 'agency_camping_activity' : explicitlyCamping ? 'osm_campsite_tag' : campingName ? 'camping_facility_name' : campingIntro ? 'source_intro_camping' : ridb ? 'ridb_activity_listing' : 'source_listing',
      camping_classification: explicitlyCamping || campingName || campingIntro ? 'campsite' : 'unverified_camping_record'
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
      if(typeof raw.classification_text==='string'&&raw.classification_text.length<=65536)r.classification_text=raw.classification_text;
      if(typeof raw.qualification_text==='string'&&raw.qualification_text.length<=65536)r.qualification_text=raw.qualification_text;
      const key=JSON.stringify([r.source,r.source_field,r.source_record_id,r.text]),old=records.get(key);
      if(!old||Date.parse(r.retrieved_at)>Date.parse(old.retrieved_at)||(!old.retrieved_at&&r.retrieved_at))records.set(key,r);
    }
    return [...records.values()].sort((a,b)=>(Date.parse(b.retrieved_at)||0)-(Date.parse(a.retrieved_at)||0)).slice(0,24);
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
    const classification = classifyCampingRecord(raw, name, {osm, ridb});
    if (classification.exclusion_reason) return null;
    const legacyRIDB = ridb && !(Number(raw.schema_version) >= 3) && !raw._kt_normalized;
    // Snapshot membership is a loading hint, not evidence of a site's state.
    const p = {...raw, ...classification, name, sources, state: raw.state || raw['addr:state'] || null};
    p.legacy_ids = [...new Set([...(Array.isArray(raw.legacy_ids) ? raw.legacy_ids : []), raw.id].filter(v => v != null && v !== '').map(String))];
    const coordKey = `${ll.lon.toFixed(6)},${ll.lat.toFixed(6)}`;
    if (ridb && raw.facility_id != null) p.id = `ridb:${raw.facility_id}`;
    else if (osm && raw.osm_id != null) {
      const elementType = raw.osm_type || (['node', 'way', 'relation'].includes(raw.type) ? raw.type : 'unknown');
      p.id = `osm:${elementType}:${raw.osm_id}${elementType === 'unknown' ? ':' + coordKey : ''}`;
    } else p.id = raw.id != null && raw.id !== '' ? String(raw.id) : `site:${normalizeName(name)}:${coordKey}`;
    p.fee_evidence_records=mergeFeeEvidence(raw.fee_evidence_records);
    if(osm&&!raw._kt_normalized&&/^(?:no|0|false|yes|true)$/i.test(String(raw.fee))){
      const kind=raw.osm_type||(['node','way','relation'].includes(raw.type)?raw.type:null),id=String(raw.osm_id??'');
      const tagText='fee='+String(raw.fee)+(raw['fee:conditional']?'; fee:conditional='+String(raw['fee:conditional']):'');
      p.fee_evidence_records=mergeFeeEvidence(p.fee_evidence_records,[{source:'OpenStreetMap contributors',source_field:'fee'+(raw['fee:conditional']?' / fee:conditional':''),source_record_id:id?'osm:'+(kind||'unknown')+':'+id:null,source_url:kind&&/^\d+$/.test(id)?'https://www.openstreetmap.org/'+kind+'/'+id:null,retrieved_at:raw.fee_checked||null,source_updated_at:raw.osm_timestamp||null,text:tagText}]);
    }
    if (legacyRIDB) p.legacy_inferred = {cost:raw.cost, amenities:raw.amenities, rig_friendly:raw.rig_friendly, road_difficulty:raw.road_difficulty};
    const feeEvidence = raw._kt_normalized || Number(raw.schema_version) >= 3 || !!raw.field_provenance?.cost;
    p.cost = feeEvidence && !legacyRIDB && validNumber(raw.cost) && raw.cost >= 0 ? raw.cost : null;
    p.fee_status = feeEvidence && !legacyRIDB && ['free', 'paid', 'conditional', 'unknown'].includes(raw.fee_status) ? raw.fee_status : 'unknown';
    if (feeEvidence && !legacyRIDB && p.cost !== null && p.fee_status !== 'conditional') p.fee_status = p.cost === 0 ? 'free' : 'paid';
    if (osm && !raw._kt_normalized && /^(no|0|false)$/i.test(String(raw.fee)) && raw['fee:conditional']) {p.fee_status = 'conditional'; p.cost = null; p.fee_text = `OSM fee=no; fee:conditional=${String(raw['fee:conditional']).slice(0, 200)}`; p.fee_source = 'OpenStreetMap contributors';}
    else if (osm && !raw._kt_normalized && /^(no|0|false)$/i.test(String(raw.fee))) {p.fee_status = 'free'; p.cost = 0; p.fee_text = p.fee_text || 'OSM tag fee=no'; p.fee_source = p.fee_source || 'OpenStreetMap contributors (community reported)';}
    else if (osm && !raw._kt_normalized && /^(yes|true)$/i.test(String(raw.fee))) {p.fee_status = 'paid'; if (p.cost === 0) p.cost = null;}
    // State loading normalizes merged records again. A retained source tag cannot
    // resolve an existing disagreement with another source.
    if (p.fee_conflict) {p.fee_status = 'unknown'; p.cost = null; p.fee_text = null;}
    p.type = ['established', 'dispersed', 'parking', 'backcountry', 'other'].includes(raw.type) ? raw.type : (osm ? 'established' : 'other');
    if (ridb && !osm && p.camping_classification === 'unverified_camping_record') p.type = 'other';
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
    // Only validated sidecar metadata survives normalization; source elevation tags are not equivalent.
    p.elevation = raw._kt_normalized ? elevationInfo({...feature,properties:raw}) : null;
    const amenityEvidence = raw._kt_normalized && checkedRIDBAmenities(raw.ridb_amenity_evidence) ? raw.ridb_amenity_evidence : null;
    delete p.ridb_amenity_evidence;
    if(amenityEvidence)attachRIDBAmenities({properties:p},amenityEvidence);
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
    if (p.state == null && p.id === q.id && q.state != null) p.state=q.state;
    if(p.forecastStates||q.forecastStates)p.forecastStates=[...new Set([...(p.forecastStates||[]),...(q.forecastStates||[])])];
    p.legacy_ids = [...new Set([...(p.legacy_ids || []), ...(q.legacy_ids || []), q.id])];
    p.sources = [...new Set([...(p.sources || []), ...(q.sources || [])])];
    p.fee_evidence_records=mergeFeeEvidence(p.fee_evidence_records,q.fee_evidence_records);
    if (p.access_status === 'unknown' && q.access_status !== 'unknown') {p.access=q.access;p.access_status=q.access_status;p.access_label=q.access_label;}
    if (p.camping_classification === 'unverified_camping_record' && q.camping_classification === 'campsite') {p.camping_classification=q.camping_classification;p.camping_evidence=q.camping_evidence;if(p.type==='other')p.type=q.type;}
    // Preserve known facts, but do not hide conflicts between sources.
    if (p.fee_conflict || q.fee_conflict) {p.fee_conflict=true; p.fee_status='unknown'; p.cost=null; p.fee_text=null;}
    const adopt = () => {p.fee_status=q.fee_status; p.cost=q.cost; for (const k of ['fee_text','fee_source','fee_checked','fee_evidence']) p[k]=q[k] ?? null;};
    const charged = v => v === 'paid' || v === 'conditional';
    if (p.fee_status === 'unknown' && q.fee_status !== 'unknown' && !p.fee_conflict) adopt();
    // Agency wording that names conditions refines a bare free or paid record. Free versus paid is a real conflict.
    else if (q.fee_status === 'conditional' && p.fee_status !== 'conditional' && !p.fee_conflict) adopt();
    else if (p.fee_status !== 'unknown' && q.fee_status !== 'unknown' && p.fee_status !== q.fee_status && !(charged(p.fee_status) && charged(q.fee_status)) && !(p.fee_status === 'conditional' || q.fee_status === 'conditional')) {p.fee_status='unknown'; p.cost=null; p.fee_conflict=true; p.fee_text=null;}
    if (p.cost === null && q.cost !== null && !p.fee_conflict && p.fee_status === q.fee_status) p.cost=q.cost;
    p.amenity_negatives = [...new Set([...(p.amenity_negatives || []), ...(q.amenity_negatives || [])])];
    p.amenities = [...new Set([...p.amenities,...q.amenities])].filter(a => !p.amenity_negatives.includes(a));
    p.rig_friendly = [...new Set([...p.rig_friendly,...q.rig_friendly])];
    // Repeated state/source rows never add counts to exact facility summaries.
    if(checkedRIDBAmenities(q.ridb_amenity_evidence)){
      const a=p.ridb_amenity_evidence,b=q.ridb_amenity_evidence;
      if(!checkedRIDBAmenities(a))attachRIDBAmenities(primary,b);
      else if(a.source.sha256===b.source.sha256)attachRIDBAmenities(primary,{version:1,source:a.source,facilities:{...b.facilities,...a.facilities}});
    }
    for (const key of ['description','website','source_url','road_difficulty','rating','stay_limit','open_status','season','restrictions','camping_activity']) if (p[key] == null || p[key] === '') p[key]=q[key] ?? p[key];
    return primary;
  }
  // A state's complete snapshot must support camping before another state's
  // previously loaded listings can enrich it. Keep original rows/order here:
  // returning locally merged rows would change cross-state dedupe geometry.
  function publicationCandidates(features, options = {}) {
    const candidates=(Array.isArray(features)?features:[]).map(raw=>({raw,feature:normalizeFeature(raw,options)})).filter(x=>x.feature);
    const published=cleanAndDedupeGeoJSON({features:candidates.map(x=>x.feature)},options).features;
    const admitted=new Set(published.flatMap(f=>[f.properties.id,...(f.properties.legacy_ids||[])]));
    return candidates.filter(x=>admitted.has(x.feature.properties.id)).map(x=>x.raw);
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
      if (!found) {
        for (let x=cx-3; x<=cx+3 && !found; x++) for(let y=cy-1; y<=cy+1 && !found; y++) {
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
    // The public MVP lists evidence-supported camping locations only. Retain
    // unverified source records solely when an explicit diagnostic caller asks.
    return {type:'FeatureCollection',features: options.includeUnverified ? features : features.filter(f => f.properties.camping_classification === 'campsite')};
  }
  const RIDB_AMENITY_URL='https://ridb.recreation.gov/downloads/RIDBFullExport_V1_CSV.zip';
  const RIDB_AMENITY_KEYS=['toilet','drinking_water','shower','dump','picnic_table'];
  const RIDB_AMENITY_QUALIFIERS={toilet:['seasonal','accessible'],drinking_water:['peak_season','hand_pump','accessible'],shower:['seasonal','coin','accessible','outdoor'],dump:[],picnic_table:[]};
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const checkedAmenityPayloads=new WeakSet();
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
      if(!/^[1-9][0-9]*$/.test(fid)||!object(r)||!count(r.sites)||!object(r.amenities)||Object.keys(r.amenities).length>5)return false;
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
    if(Object.keys(facilities).length)p.ridb_amenity_evidence={version:1,source:data.source,facilities};
    return feature;
  }
  // Attach Recreation.gov site-level summaries (RV lengths, hookups) to a campground.
  function attachSiteDetails(feature, table) {
    const p = feature && feature.properties;
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
    const e=elevationInfo(feature);return e?`Approx. elevation ${Math.round(elevationFromMetres(e.m,unit)).toLocaleString('en-US')} ${unit==='m'?'m':'ft'} · USGS 3DEP · retrieved ${e.d.slice(0,10)}`:'Elevation unknown';
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
      if (filters.rigSize && filters.rigSize !== 'all' && !p.rig_friendly.includes(filters.rigSize)) return false;
      if (filters.roadDifficulty && filters.roadDifficulty !== 'all' && p.road_difficulty !== filters.roadDifficulty) return false;
      if (Array.isArray(filters.amenities) && !filters.amenities.every(a => p.amenities.includes(a))) return false;
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
    const rows = Object.entries(h.sources).map(([id, s]) => {
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
      if (status !== 'current') issues.push(s.label || id);
      return {id, label: s.label || id, oldest: day(s.oldest_success), newest: day(s.newest_success), status, note};
    });
    const c = (h.run && h.run.counts) || {};
    const runFailed = !!h.run && !c.fresh && (c.failed || 0) > 0;
    return {degraded: runFailed || rows.some(r => r.status === 'failing' || r.status === 'stale'), runFailed, lastRun: h.run ? day(h.run.started) : null, runCounts: c, rows, issues};
  }
  global.DataQuality={RIDB_AMENITY_URL,ridbFacilityIds,validRIDBAmenities,attachRIDBAmenities,ELEVATION_SOURCE,coordinateKey,validElevationManifest,validElevationState,elevationInfo,attachElevation,elevationRange,elevationToMetres,elevationFromMetres,elevationText,version:'2.17.0',mergeFeeEvidence,publicationCandidates,summarizeHealth,attachSiteDetails,sitesFitting,matchingSites,normalizeFeature,cleanAndDedupeGeoJSON,applyFilters,getLatLng,classifyCampingRecord};
  if(typeof module !== 'undefined' && module.exports)module.exports=global.DataQuality;
})(typeof window !== 'undefined' ? window : globalThis);
