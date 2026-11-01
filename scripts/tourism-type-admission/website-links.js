'use strict';
// Recreation.gov hosts whose absorbed OSM element's own website names a Recreation.gov facility id.
const fs=require('fs'),path=require('path');const root=process.argv[2]||path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const osm=new Map();for(const n of fs.readdirSync(path.join(root,'data/opencampingmap')).filter(n=>/^[A-Z]{2}\.geojson$/.test(n)))for(const f of read(path.join(root,'data/opencampingmap',n)).features){const p=f.properties;if(p.osm_id!=null)osm.set(`osm:${p.osm_type}:${p.osm_id}`,p);}
const idx=read(path.join(root,'data/campsites/search-index.json')).sites,pub=new Map();for(const s of idx){pub.set(s.id,s.id);for(const a of s.legacy_ids)if(!pub.has(a))pub.set(a,s.id);}
// Exact identity: the URL path or facilityId parameter names a Recreation.gov facility id. parkId (legacy
// reservation park number) and slug-only URLs are a different numbering or no id, so they are not exact.
const RG=/recreation\.gov\/(?:camping\/(?:campgrounds|gateways|poi)\/(\d{3,9})\b|[^\s"]*?[?&]facilityId=(\d{3,9})\b)/ig;
const out=[];
for(const n of fs.readdirSync(path.join(root,'data/campsites')).filter(n=>/^[A-Z]{2}_merged\.geojson$/.test(n)))for(const f of read(path.join(root,'data/campsites',n)).features){const p=f.properties;if(!/^ridb:/.test(p.id))continue;
  for(const m of (p.source_ids||[]).filter(x=>/^osm:/.test(x))){const e=osm.get(m);if(!e)continue;const urls=Object.entries(e).filter(([k])=>/^(website|url|contact:website|reservation:website|website:\w+)$/.test(k)).map(([k,v])=>[k,String(v)]);
    for(const [k,v] of urls){if(!/recreation\.gov/i.test(v))continue;const ids=[...v.matchAll(RG)].map(x=>x[1]||x[2]);const parkIds=[...v.matchAll(/[?&]parkId=(\d+)/ig)].map(x=>x[1]);out.push({state:n.slice(0,2),host:p.id,host_published_as:pub.get(p.id)||null,member:m,field:k,value:v,facility_ids_in_url:ids,legacy_park_ids:parkIds,basis:ids.includes(p.id.slice(5))?'exact_facility_id_in_member_website':ids.length?'different_facility_id':parkIds.length?'legacy_park_id_only':'no_facility_id',exact:ids.includes(p.id.slice(5)),host_tourism:p.tourism??null,member_tourism:e.tourism??null});}}}
const dedup=[...new Map(out.map(r=>[r.host+'|'+r.member,r])).values()];
console.log(JSON.stringify({rows:dedup.length,hosts:new Set(dedup.map(r=>r.host)).size,exact:dedup.filter(r=>r.exact).length,other_id:dedup.filter(r=>!r.exact&&r.facility_ids_in_url.length).length,no_id:dedup.filter(r=>!r.facility_ids_in_url.length).length}));
fs.writeFileSync(process.argv[3]||'/dev/stdout',JSON.stringify(dedup,null,1));
