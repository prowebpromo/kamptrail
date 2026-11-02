'use strict';
// Own-source evidence per Recreation.gov facility id, from retained offline files only. Read-only.
const fs=require('fs'),path=require('path');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function load(root){
  const dir=path.join(root,'data/campsites');
  const ridbRows=new Map();
  for(const n of fs.readdirSync(dir).filter(n=>/^[A-Z]{2}(?:\(1\))?\.geojson$/.test(n)).sort())for(const f of read(path.join(dir,n)).features){const p=f.properties;if(p.facility_id!=null&&!ridbRows.has(String(p.facility_id)))ridbRows.set(String(p.facility_id),{file:'data/campsites/'+n,p,ll:f.geometry.coordinates});}
  const sitesDoc=read(path.join(dir,'ridb-sites.json')),amenDoc=read(path.join(dir,'ridb-amenities.json')),usfsDoc=read(path.join(dir,'usfs-site-amenities.json'));
  const blm=new Map();
  for(const n of fs.readdirSync(path.join(dir,'agency')).filter(n=>/\.geojson$/.test(n)))for(const f of read(path.join(dir,'agency',n)).features){const p=f.properties;if(/^blm-facility:/.test(p.id))blm.set(String(p.facility_id),{file:'data/campsites/agency/'+n,p,ll:f.geometry.coordinates});}
  return {ridbRows,sitesDoc,amenDoc,usfsDoc,blm};
}
const CAMP_TYPES=['CAMPGROUND','GROUP CAMPGROUND','HORSE CAMP'];
const LODGING=/\b(?:cabins?|lodges?|lookouts?|guard\s+stations?|hotels?|motels?|chalets?|yurts?|huts?|house|cottage|bunkhouse|ranch house|residence)\b/i;
const CAMP_NAME=/\b(?:campgrounds?|campsites?|camping|(?:rv|recreational vehicle|trailer)\s+(?:parks?|sites?|camp)|(?:group|horse|equestrian|primitive|tent|backcountry|boat|hunter|transfer|forest)\s*camps?(?:\s+sites?)?|horsecamp|yellow post sites?|group sites?|camp)\b/i;
function evidenceFor(E,fid,DQ){
  const row=E.ridbRows.get(fid),s=E.sitesDoc.facilities[fid],a=E.amenDoc.facilities[fid],u=E.usfsDoc.facilities[fid],b=E.blm.get(fid);
  const out={facility_id:fid,structured:[],overnight:[],descriptive:[],accommodation:null};
  if(row){
    const p=row.p;
    out.structured.push({kind:'structured_classification',source:'Recreation.gov RIDB API (facilities?activity=9)',record_id:'ridb:'+fid,field:'type (derived from FacilityTypeDescription by scripts/fetch_recreation_gov_data.py L114-122; raw value not retained)',value:p.type,
      meaning:p.type==='established'?'FacilityTypeDescription contained campground or campsite':p.type==='other'?'FacilityTypeDescription was blank or named no campground, campsite, dispersed, primitive or backcountry':p.type,source_date:p.source_retrieved_at||null,file:row.file,supports_campground:p.type==='established'});
    const c=DQ.classifyCampingRecord(p,String(p.name||''),{ridb:true});
    if(CAMP_NAME.test(String(p.name||'')))out.descriptive.push({kind:'descriptive_wording',source:'Recreation.gov RIDB',record_id:'ridb:'+fid,field:'FacilityName',value:p.name,source_date:p.source_retrieved_at||null,supports_campground:!LODGING.test(String(p.name))});
    if(c.camping_evidence==='source_intro_camping'){const intro=String(p.description||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().replace(/^overview\s*/i,'').split(/(?<=[.!?])\s+/)[0].slice(0,300);out.descriptive.push({kind:'descriptive_wording',source:'Recreation.gov RIDB',record_id:'ridb:'+fid,field:'FacilityDescription (first sentence)',value:intro,source_date:p.source_retrieved_at||null,supports_campground:false});}
    out.own_classifier={exclusion_reason:c.exclusion_reason,camping_evidence:c.camping_evidence,camping_classification:c.camping_classification};
    const m=String(p.name||'').match(LODGING);if(m)out.accommodation={source:'Recreation.gov RIDB',field:'FacilityName',value:p.name,term:m[0].toLowerCase()};
    out.name=p.name;out.state=p.state;out.coordinates=row.ll;
  }
  if(s&&s.t>0)out.overnight.push({kind:'overnight_campsite_records',source:E.sitesDoc.source.name||'Recreation.gov RIDB full export',file:'data/campsites/ridb-sites.json',record_id:'ridb:'+fid,field:'t (Campsites TypeOfUse=Overnight)',value:s.t,rv_type_sites:s.r,longest_rv_ft:s.L||null,source_sha256:E.amenDoc.source.sha256,source_date:E.amenDoc.source.original_retrieved_at,supports_campground:s.r>0});
  else if(s)out.overnight_none={file:'data/campsites/ridb-sites.json',t:s.t};
  if(a&&a.sites>0&&!(s&&s.t>0))out.overnight.push({kind:'overnight_campsite_records',source:E.amenDoc.source.name,file:'data/campsites/ridb-amenities.json',record_id:'ridb:'+fid,field:'sites (overnight records)',value:a.sites,source_sha256:E.amenDoc.source.sha256,source_date:E.amenDoc.source.original_retrieved_at,supports_campground:false});
  if(u)for(const r of u.records)out.structured.push({kind:'structured_classification',source:E.usfsDoc.source.name,file:'data/campsites/usfs-site-amenities.json',record_id:'usfs-site:'+r.cn,join:'rec1stop_id = '+fid+' (exact)',field:'site_type',value:r.type,site_name:r.name,source_date:r.updated||r.edw_modified||E.usfsDoc.source.retrieved,supports_campground:CAMP_TYPES.includes(String(r.type||'').toUpperCase())});
  if(b){const ev=(b.p.fee_evidence_records||[])[0];out.structured.push({kind:'structured_classification',source:'Bureau of Land Management, BLM_Natl_Recreation_Sites_Facilities layer 8 (RIDB Facilities Camping)',file:b.file,record_id:b.p.id,join:'FacilityID = '+fid+' (exact)',field:'layer membership (camping_activity)',value:b.p.camping_activity,source_date:ev?.source_updated_at||b.p.fee_checked||null,retrieved:b.p.fee_checked||null,supports_campground:false,supports_camping:true,note:'Layer 8 lists camping facilities. Its FacilityTypeDescription is read by the fetcher but not retained, so it does not give a campground type.'});}
  return out;
}
module.exports={load,evidenceFor,CAMP_TYPES,LODGING};
