'use strict';
// Exact-record display corrections. This cannot set fees, access, rig suitability,
// source classifications or identities, and cannot withdraw a listing.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function validate(data){
  if(data?.version!==1||!data.records||typeof data.records!=='object'||Array.isArray(data.records))throw Error('Invalid record overrides');
  const allowed=new Set(['name','coordinate_key','state','scope','note','source_url','source_field','evidence','checked_at','review_status']);
  for(const [id,r] of Object.entries(data.records)){
    if(!/^(?:osm:(?:node|way|relation):[1-9]\d*|blm-area:[1-9]\d*)$/.test(id)||!r||Object.keys(r).some(k=>!allowed.has(k)))throw Error('Unsafe override '+id);
    if(typeof r.name!=='string'||!r.name.trim()||!/^[-\d.]+,[-\d.]+$/.test(r.coordinate_key)||!r.source_field||!r.evidence||!/^\d{4}-\d{2}-\d{2}$/.test(r.checked_at))throw Error('Missing override identity/evidence '+id);
    const u=new URL(r.source_url);if(u.protocol!=='https:'||u.username||u.password)throw Error('Invalid evidence URL');
    if(r.state&&!/^[A-Z]{2}$/.test(r.state)||r.scope&&r.scope!=='management_area')throw Error('Invalid display correction');
    if(!['source_verified','discovery_withdrawal_requires_independent_review'].includes(r.review_status))throw Error('Missing review state');
  }return data;
}
function render(data){const version=require('../package.json').version;return "/* Generated from data/record-overrides.json. Do not edit this copy. */\n(function(g){const VERSION = '"+version+"';g.KampTrailRecordOverridesVersion=VERSION;const data="+JSON.stringify(validate(data)).replaceAll('<','\\u003c')+";g.KampTrailRecordOverrides=data;if(typeof module!=='undefined'&&module.exports)module.exports=data;})(typeof window!=='undefined'?window:globalThis);\n";}
function build(){const out=render(JSON.parse(fs.readFileSync(path.join(root,'data/record-overrides.json'),'utf8')));fs.writeFileSync(path.join(root,'record-overrides.js'),out);return out;}
if(require.main===module)build();module.exports={validate,render,build};
