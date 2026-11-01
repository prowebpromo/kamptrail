#!/usr/bin/env node
'use strict';
// Tourism-type-admission candidate check (revision 2). Compares this checkout with an unchanged baseline checkout.
// Every listing difference must be a change listed in docs/candidates/tourism-type-admission.json (records[].changes,
// each flagged separate_review). Snapshot rows may only lose inherited tourism to attributed member evidence, drop a
// lent type, or mark a copied description. Anything else fails (exit code 1). It also rebuilds the search index in
// memory and requires the committed bytes, and checks withdrawn.json, saved-link resolution and access holds.
//   node scripts/verify-tourism-type-admission.js --baseline=/unchanged/checkout [--report=out.json]
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const args=process.argv.slice(2),arg=n=>args.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
if(!arg('baseline'))throw new Error('Use --baseline=/unchanged/checkout [--report=out.json]');
const root=path.resolve(__dirname,'..'),baseline=path.resolve(arg('baseline'));
if(root===baseline)throw new Error('Baseline must be a separate unchanged checkout');
const H=require('./tourism-type-admission/harness');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const ledger=read(path.join(root,'docs/candidates/tourism-type-admission.json'));
if(ledger.version!==2)throw new Error('Ledger version 2 required');
const L=new Map(ledger.records.map(r=>[r.canonical_id,r]));
const unexpected=[],deltas=[];const fail=(kind,id,d={})=>unexpected.push({kind,id,...d});
if(L.size!==ledger.records.length)fail('ledger_duplicate_records','ledger');
for(const r of ledger.records)for(const c of r.changes)if(c.separate_review!==true)fail('change_not_flagged_for_review',r.canonical_id,{field:c.field});
// 1. Inputs unchanged.
for(const sub of ['data/opencampingmap','data/campsites','data/campsites/agency'])for(const n of fs.readdirSync(path.join(root,sub)).filter(n=>/^[A-Z]{2}(?:\(1\)|_campendium|_ioverlander)?\.geojson$/.test(n))){const rel=sub+'/'+n;if(sha(path.join(root,rel))!==sha(path.join(baseline,rel)))fail('raw_input_changed',rel);}
for(const rel of ['ridb-sites.json','ridb-amenities.json','usfs-site-amenities.json','index.json','agency/index.json'].map(x=>'data/campsites/'+x))if(sha(path.join(root,rel))!==sha(path.join(baseline,rel)))fail('unchanged_file_changed',rel);
// 2. Snapshots: the allowed row edits only.
const states=fs.readdirSync(path.join(root,'data/campsites')).filter(n=>/^[A-Z]{2}_merged\.geojson$/.test(n)).map(n=>n.slice(0,2)).sort();
if(states.length!==50)fail('state_count','snapshots',{count:states.length});
const snap={tourism_moved:0,type_dropped:0,description_marked:0,rows_changed:0,states_changed:[]};
for(const st of states){const rel=`data/campsites/${st}_merged.geojson`;if(sha(path.join(root,rel))===sha(path.join(baseline,rel)))continue;snap.states_changed.push(st);
  const a=read(path.join(root,rel)),b=read(path.join(baseline,rel));
  if(JSON.stringify({...a,features:0})!==JSON.stringify({...b,features:0}))fail('snapshot_header',st);
  if(a.features.length!==b.features.length){fail('snapshot_row_count',st);continue;}
  b.features.forEach((fb,i)=>{const fa=a.features[i],pb=fb.properties,pa=fa.properties;
    if(JSON.stringify(fa.geometry)!==JSON.stringify(fb.geometry)||pa.id!==pb.id)return fail('snapshot_identity_or_geometry',pb.id,{state:st});
    const keys=[...new Set([...Object.keys(pa),...Object.keys(pb)])].filter(k=>JSON.stringify(pa[k])!==JSON.stringify(pb[k]));
    if(keys.length)snap.rows_changed++;
    for(const k of keys){
      if(k==='tourism'&&pa.tourism===undefined&&(pb.source_ids||[]).length>1){
        const m=(pa.member_evidence||[]).find(e=>e.fields?.tourism===pb.tourism&&(pb.source_ids||[]).includes(e.source_record_id));
        if(m){snap.tourism_moved++;continue;}
        fail('tourism_removed_without_member_evidence',pb.id,{state:st});continue;}
      if(k==='member_evidence'){const bm=new Map((pb.member_evidence||[]).map(e=>[e.source_record_id,e]));
        for(const e of pa.member_evidence||[]){const o=bm.get(e.source_record_id);const extra=Object.keys(e.fields).filter(f=>!o||JSON.stringify(o.fields[f])!==JSON.stringify(e.fields[f]));
          if(extra.some(f=>f!=='tourism'))fail('member_evidence_changed',pb.id,{state:st,member:e.source_record_id,fields:extra});
          if(o&&JSON.stringify({...o,fields:0})!==JSON.stringify({...e,fields:0}))fail('member_evidence_meta_changed',pb.id,{state:st});}
        for(const id of bm.keys())if(!(pa.member_evidence||[]).some(e=>e.source_record_id===id))fail('member_evidence_lost',pb.id,{state:st});continue;}
      if(k==='type'&&pa.type===null&&pb.type!=null){snap.type_dropped++;continue;}
      if(k==='description_source_record_id'&&pb[k]===undefined&&(pb.source_ids||[]).includes(pa[k])&&pa[k]!==pb.id){snap.description_marked++;continue;}
      fail('snapshot_field',pb.id,{state:st,key:k,before:pb[k],after:pa[k]});}
    for(const e of pa.member_evidence||[])if(e.fields?.tourism!=null){const own=e.source_record_id;if(!(pa.source_ids||[]).includes(own))fail('member_not_a_member',pb.id,{state:st,member:own});}
    if(pa.tourism!=null&&pa.osm_id==null&&(pa.source_ids||[]).length>1)fail('inherited_tourism_retained',pb.id,{state:st});
  });}
// 3. Index rows: every difference must be a listed change.
const ia=read(path.join(root,'data/campsites/search-index.json')),ib=read(path.join(baseline,'data/campsites/search-index.json'));
if(JSON.stringify({...ia,sites:0})!==JSON.stringify({...ib,sites:0}))fail('index_header','search-index.json');
const A=new Map(ia.sites.map(s=>[s.id,s])),B=new Map(ib.sites.map(s=>[s.id,s]));
const listed=(id,field,from,to)=>{const r=L.get(id);return !!r&&r.changes.some(c=>c.field===field&&(from===undefined||JSON.stringify(c.from)===JSON.stringify(from))&&(to===undefined||JSON.stringify(c.to)===JSON.stringify(to)));};
for(const [id,b] of B){const a=A.get(id);
  if(!a){if(listed(id,'publication','published'))deltas.push({id,field:'publication',to:'withdrawn'});else fail('index_listing_removed_not_listed',id);continue;}
  if(a.m.t!==b.m.t){if(listed(id,'type',b.m.t,a.m.t))deltas.push({id,field:'type',from:b.m.t,to:a.m.t});else fail('index_type_not_listed',id,{before:b.m.t,after:a.m.t});}
  if(JSON.stringify([a.lat,a.lng])!==JSON.stringify([b.lat,b.lng])){if(listed(id,'coordinates'))deltas.push({id,field:'coordinates'});else fail('index_coordinates_not_listed',id);}
  if(JSON.stringify([...a.legacy_ids].sort())!==JSON.stringify([...b.legacy_ids].sort())){if(listed(id,'legacy_ids'))deltas.push({id,field:'legacy_ids'});else fail('index_aliases_not_listed',id);}
  if(a.m.f!==b.m.f){if(listed(id,'fee_status',b.m.f,a.m.f))deltas.push({id,field:'fee_status'});else fail('index_fee_not_listed',id,{before:b.m.f,after:a.m.f});}
  if(a.name!==b.name)fail('index_name_changed',id);
  if(JSON.stringify(a.states)!==JSON.stringify(b.states)&&!listed(id,'legacy_ids'))fail('index_states_not_listed',id);
  const rest=s=>JSON.stringify({...s,m:{...s.m,t:0,f:0,a:0,s:0},lat:0,lng:0,legacy_ids:0,states:0});
  if(rest(a)!==rest(b))fail('index_other_field',id);
  const amen=s=>JSON.stringify([s.m.a||[],s.m.s||[]]);if(amen(a)!==amen(b)&&!listed(id,'publication'))deltas.push({id,field:'amenity_filter_metadata (follows the listing kept)'});}
for(const [id] of A)if(!B.has(id)){if(listed(id,'publication','not published','published'))deltas.push({id,field:'publication',to:'published'});else fail('index_listing_added_not_listed',id);}
for(const r of ledger.records)for(const c of r.changes){
  if(c.field==='publication'&&c.to!=='published'&&A.has(r.canonical_id))fail('ledger_withdrawal_not_applied',r.canonical_id);
  if(c.field==='publication'&&c.to==='published'&&!A.has(r.canonical_id))fail('ledger_publication_not_applied',r.canonical_id);
  if(c.field==='type'&&A.has(r.canonical_id)&&A.get(r.canonical_id).m.t!==c.to)fail('ledger_type_not_applied',r.canonical_id);}
// 4. Withdrawn listings and saved links: every baseline id and alias resolves to a live listing or a withdrawn entry.
const W=fs.existsSync(path.join(root,'data/campsites/withdrawn.json'))?read(path.join(root,'data/campsites/withdrawn.json')):{version:1,listings:[]};
const wIds=new Map();for(const w of W.listings)for(const k of [w.id,...w.legacy_ids])wIds.set(k,w.id);
const resolve=s=>{const m=new Map();for(const x of s)m.set(x.id,x.id);for(const x of s)for(const a of x.legacy_ids||[])if(!m.has(a))m.set(a,x.id);return m;};
const rb=resolve(ib.sites),ra=resolve(ia.sites);let checked=0;const moved=[];
for(const [id,h] of rb){checked++;const now=ra.get(id);
  if(now===h)continue;
  if(now===undefined&&wIds.has(id)){if(!listed(h,'publication')&&!listed(h,'legacy_ids'))fail('withdrawn_not_in_ledger',id);continue;}
  if(now!==undefined&&(listed(h,'legacy_ids')||listed(h,'publication')||listed(now,'publication'))){moved.push({id,before:h,after:now});continue;}
  fail('saved_link_resolution',id,{before:h,after:now??null});}
for(const w of W.listings){if(A.has(w.id))fail('withdrawn_still_published',w.id);if(!B.has(w.id))fail('withdrawn_was_not_published',w.id);if(!listed(w.id,'publication'))fail('withdrawn_not_in_ledger',w.id);}
// 5. Access holds and per-row access, fees and coordinates in the normalized catalogue.
const holds={before:0,after:0};
for(const st of states){read(path.join(baseline,`data/campsites/${st}_merged.geojson`)).features.forEach(f=>{if(f.properties.access_hold)holds.before++;});read(path.join(root,`data/campsites/${st}_merged.geojson`)).features.forEach(f=>{if(f.properties.access_hold)holds.after++;});}
if(holds.before!==holds.after)fail('access_holds',`${holds.before}->${holds.after}`);
const cat=(dir,file)=>H.catalogue(H.loadDQ(file),H.inputs(dir)).features;
const CB=new Map(cat(baseline,path.join(baseline,'data-quality.js')).map(f=>[f.properties.id,f])),CN=new Map(cat(root,path.join(root,'data-quality.js')).map(f=>[f.properties.id,f]));
for(const [id,b] of CB){const n=CN.get(id);if(!n)continue;
  for(const k of ['fee_status','cost','access','access_status','access_source_record_id','fee_source_record_id'])if(JSON.stringify(b.properties[k])!==JSON.stringify(n.properties[k])&&!listed(id,k))fail('catalogue_field_not_listed',id,{key:k,before:b.properties[k],after:n.properties[k]});
  if(b.properties.camping_classification!==n.properties.camping_classification&&!listed(id,'camping_classification'))fail('classification_not_listed',id);
  if(JSON.stringify(b.geometry)!==JSON.stringify(n.geometry)&&!listed(id,'coordinates'))fail('catalogue_coordinates_not_listed',id);}
if(CN.size!==A.size)fail('catalogue_differs_from_index','catalogue',{catalogue:CN.size,index:A.size});
// 6. Determinism: the committed index rebuilds byte for byte.
// The build seeds identity from the released index (baseline), exactly as scripts/tourism-type-admission/rebuild.sh does.
const {buildFromDirectory,coordinateIndex}=require('./build-search-index');
const seedDir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'tta-seed-'));
for(const n of fs.readdirSync(path.join(root,'data/campsites')))if(/^[A-Z]{2}_merged\.geojson$|^(ridb-sites|ridb-amenities|usfs-site-amenities)\.json$/.test(n))fs.symlinkSync(path.join(root,'data/campsites',n),path.join(seedDir,n));
fs.symlinkSync(path.join(root,'data/campsites/agency'),path.join(seedDir,'agency'));
if(fs.existsSync(path.join(root,'data/campsites/elevation')))fs.symlinkSync(path.join(root,'data/campsites/elevation'),path.join(seedDir,'elevation'));
fs.copyFileSync(path.join(baseline,'data/campsites/search-index.json'),path.join(seedDir,'search-index.json'));
const rebuilt=JSON.stringify(buildFromDirectory(seedDir))+'\n';
fs.rmSync(seedDir,{recursive:true,force:true});
if(rebuilt!==fs.readFileSync(path.join(root,'data/campsites/search-index.json'),'utf8'))fail('index_not_reproducible','search-index.json');
if(JSON.stringify(coordinateIndex(ia.sites))+'\n'!==fs.readFileSync(path.join(root,'data/campsites/coordinate-index.json'),'utf8'))fail('coordinate_index','coordinate-index.json');
const report={baseline_commit:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:baseline,encoding:'utf8'}).trim(),
  output_hashes:Object.fromEntries([...states.map(s=>`data/campsites/${s}_merged.geojson`),'data/campsites/search-index.json','data/campsites/coordinate-index.json','data/campsites/withdrawn.json'].filter(r=>fs.existsSync(path.join(root,r))).map(r=>[r,sha(path.join(root,r))])),
  snapshot:snap,saved_links_checked:checked,saved_links_moving_host:moved,withdrawn:W.listings.length,access_holds:holds,ledger_records:L.size,delta_count:deltas.length,deltas,unexpected_delta_count:unexpected.length,unexpected_deltas:unexpected.slice(0,200)};
report.output_digest=crypto.createHash('sha256').update(JSON.stringify(report.output_hashes)).digest('hex');
if(arg('report'))fs.writeFileSync(path.resolve(arg('report')),JSON.stringify(report,null,1)+'\n');
const kinds=deltas.reduce((a,d)=>{const k=d.field+(d.from!==undefined?':'+d.from+'->'+d.to:d.to?':'+d.to:'');a[k]=(a[k]||0)+1;return a;},{});
console.log(JSON.stringify({output_digest:report.output_digest,search_index_sha256:report.output_hashes['data/campsites/search-index.json'],snapshot:snap,saved_links_checked:checked,saved_links_moving_host:moved.length,withdrawn:W.listings.length,access_holds:holds,ledger_records:L.size,deltas:deltas.length,by_kind:kinds,unexpected_delta_count:unexpected.length,first_unexpected:unexpected.slice(0,12)},null,1));
if(unexpected.length)process.exitCode=1;
