'use strict';
// Patch variants of data-quality.js used only for measurement.
const rep=(s,a,b)=>{if(!s.includes(a))throw new Error('patch anchor missing: '+a.slice(0,60));return s.replace(a,b);};
const A_ANCHOR="    const raw = feature.properties || {};\n    const name = String(raw.name";
module.exports={
  base:s=>s,
  // A: blanket guard. A Recreation.gov host never carries tourism=* in its own record (0 of 4,495 raw rows),
  // so tourism on a facility row without its own osm_id came from an absorbed element.
  A:s=>rep(s,A_ANCHOR,"    const raw0 = feature.properties || {};\n    const raw = raw0.facility_id != null && raw0.osm_id == null && raw0.tourism != null ? (({tourism, ...rest}) => rest)(raw0) : raw0;\n    const name = String(raw.name"),
  // C: no index-level promotion of an unverified record by a merged campsite record.
  C:s=>rep(s,"if (p.camping_classification === 'unverified_camping_record' && q.camping_classification === 'campsite') {","if (false) {"),
};
module.exports.AC=s=>module.exports.C(module.exports.A(s));
