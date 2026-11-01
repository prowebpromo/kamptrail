#!/usr/bin/env node
'use strict';
// Tourism-type-admission candidate check. Compares this checkout with an unchanged baseline checkout.
// Every delta must be listed in docs/candidates/tourism-type-admission.json "proposal" (listing type) or be
// the matching snapshot "type" field on the two group B rows. Anything else fails (exit code 1).
// It also rebuilds the search index in memory and requires it to equal the committed file byte for byte.
//   node scripts/verify-tourism-type-admission.js --baseline=/unchanged/checkout [--report=out.json]
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const args=process.argv.slice(2),arg=n=>args.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
if(!arg('baseline'))throw new Error('Use --baseline=/unchanged/checkout [--report=out.json]');
const root=path.resolve(__dirname,'..'),baseline=path.resolve(arg('baseline'));
if(root===baseline)throw new Error('Baseline must be a separate unchanged checkout');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const pkg=read(path.join(root,'docs/candidates/tourism-type-admission.json'));
const proposal=new Map(pkg.proposal.map(r=>[r.id,r]));
const B_ROWS=new Map(pkg.records.filter(r=>r.groups.includes('B')).flatMap(r=>r.borrowed_evidence.filter(b=>b.field==='type').map(b=>[b.on_row,{state:b.state,from:b.value,to:null}])));
const unexpected=[],deltas=[];const fail=(kind,id,d={})=>unexpected.push({kind,id,...d});
// 1. Inputs unchanged.
for(const sub of ['data/opencampingmap','data/campsites','data/campsites/agency'])for(const n of fs.readdirSync(path.join(root,sub)).filter(n=>/^[A-Z]{2}(?:\(1\)|_campendium|_ioverlander)?\.geojson$/.test(n))){const rel=sub+'/'+n;if(sha(path.join(root,rel))!==sha(path.join(baseline,rel)))fail('raw_input_changed',rel);}
for(const rel of ['ridb-sites.json','ridb-amenities.json','usfs-site-amenities.json','coordinate-index.json','index.json','agency/index.json'].map(x=>'data/campsites/'+x))if(sha(path.join(root,rel))!==sha(path.join(baseline,rel)))fail('unchanged_file_changed',rel);
// 2. Snapshots: only the group B rows' type may change, from the lent value to null.
const states=fs.readdirSync(path.join(root,'data/campsites')).filter(n=>/^[A-Z]{2}_merged\.geojson$/.test(n)).map(n=>n.slice(0,2)).sort();
if(states.length!==50)fail('state_count','snapshots',{count:states.length});
for(const st of states){const rel=`data/campsites/${st}_merged.geojson`;if(sha(path.join(root,rel))===sha(path.join(baseline,rel)))continue;
  const a=read(path.join(root,rel)),b=read(path.join(baseline,rel));
  if(JSON.stringify({...a,features:0})!==JSON.stringify({...b,features:0}))fail('snapshot_header',st);
  if(a.features.length!==b.features.length){fail('snapshot_row_count',st);continue;}
  b.features.forEach((fb,i)=>{const fa=a.features[i],pb=fb.properties,pa=fa.properties;
    if(JSON.stringify(fa.geometry)!==JSON.stringify(fb.geometry)||pa.id!==pb.id)return fail('snapshot_identity_or_geometry',pb.id,{state:st});
    const keys=[...new Set([...Object.keys(pa),...Object.keys(pb)])].filter(k=>JSON.stringify(pa[k])!==JSON.stringify(pb[k]));
    for(const k of keys){const exp=B_ROWS.get(pb.id);
      if(k==='type'&&exp&&exp.state===st&&pb.type===exp.from&&pa.type===exp.to)deltas.push({where:'snapshot',state:st,id:pb.id,field:'type',from:pb.type,to:pa.type});
      else fail('snapshot_field',pb.id,{state:st,key:k,before:pb[k],after:pa[k]});}
  });}
for(const [id,e] of B_ROWS)if(!deltas.some(d=>d.where==='snapshot'&&d.id===id))fail('proposed_snapshot_delta_missing',id,e);
// 3. Index: only m.t of proposed listings may change. IDs, order, aliases, coordinates, states, fees and all else identical.
const ia=read(path.join(root,'data/campsites/search-index.json')),ib=read(path.join(baseline,'data/campsites/search-index.json'));
if(JSON.stringify({...ia,sites:0})!==JSON.stringify({...ib,sites:0}))fail('index_header','search-index.json');
if(ia.sites.length!==ib.sites.length)fail('index_count','search-index.json',{before:ib.sites.length,after:ia.sites.length});
ib.sites.forEach((b,i)=>{const a=ia.sites[i];if(!a||a.id!==b.id)return fail('index_order_or_id',b.id,{after:a?.id});
  const strip=s=>JSON.stringify({...s,m:{...s.m,t:null}});if(strip(a)!==strip(b))fail('index_non_type_field',b.id);
  if(a.m.t!==b.m.t){const p=proposal.get(b.id);if(p&&p.from===b.m.t&&p.to===a.m.t)deltas.push({where:'index',id:b.id,field:'type',from:b.m.t,to:a.m.t,groups:p.groups});else fail('index_type_not_proposed',b.id,{before:b.m.t,after:a.m.t});}});
for(const [id] of proposal)if(!deltas.some(d=>d.where==='index'&&d.id===id))fail('proposed_index_delta_missing',id);
// 4. Saved links: every id and alias resolves to the same listing as before.
const resolve=s=>{const m=new Map();for(const x of s)for(const id of [x.id,...(x.legacy_ids||[])])if(!m.has(id))m.set(id,x.id);return m;};
const rb=resolve(ib.sites),ra=resolve(ia.sites);let checked=0;for(const [id,h] of rb){checked++;if(ra.get(id)!==h)fail('saved_link_resolution',id,{before:h,after:ra.get(id)});}
// 5. Published catalogue in both checkouts: fee, access, admission, classification and holds unchanged.
const DQa=require(path.join(root,'data-quality.js'));
function loadIsolated(file){const vm=require('node:vm'),c={module:{exports:{}},URL,Date,Set,Map,WeakSet,JSON,Math,Number,String,Object,Array,console};c.globalThis=c;vm.runInNewContext(fs.readFileSync(file,'utf8'),c,{filename:file});return c.module.exports;}
const DQb=loadIsolated(path.join(baseline,'data-quality.js'));
let holds={before:0,after:0};
for(const st of states){const a=read(path.join(root,`data/campsites/${st}_merged.geojson`)).features,b=read(path.join(baseline,`data/campsites/${st}_merged.geojson`)).features;
  const ag=path.join(root,'data/campsites/agency',st+'.geojson');const extra=fs.existsSync(ag)?read(ag).features:[];
  a.forEach((f,i)=>{if(f.properties.access_hold)holds.after++;if(b[i].properties.access_hold)holds.before++;});
  const pa=new Set(DQa.publicationCandidates([...a,...extra],{state:st}).map(f=>f.properties.id)),pb=new Set(DQb.publicationCandidates([...b,...extra],{state:st}).map(f=>f.properties.id));
  for(const id of pa)if(!pb.has(id))fail('newly_admitted',id,{state:st});for(const id of pb)if(!pa.has(id))fail('newly_excluded',id,{state:st});
  for(const [i,f] of a.entries()){const n1=DQa.normalizeFeature(f,{state:st}),n0=DQb.normalizeFeature(b[i],{state:st});if(!!n0!==!!n1){fail('row_admission',f.properties.id,{state:st});continue;}if(!n0)continue;
    for(const k of ['id','fee_status','cost','access','access_status','camping_classification','camping_evidence','exclusion_reason','legacy_ids'])if(JSON.stringify(n0.properties[k])!==JSON.stringify(n1.properties[k]))fail('row_field',f.properties.id,{state:st,key:k});}}
if(holds.before!==holds.after)fail('access_holds',`${holds.before}->${holds.after}`);
// 6. Determinism: rebuilding the index from committed snapshots gives the committed bytes.
const {buildFromDirectory,coordinateIndex}=require('./build-search-index');
const rebuilt=JSON.stringify(buildFromDirectory(path.join(root,'data/campsites')))+'\n';
if(rebuilt!==fs.readFileSync(path.join(root,'data/campsites/search-index.json'),'utf8'))fail('index_not_reproducible','search-index.json');
if(JSON.stringify(coordinateIndex(ia.sites))+'\n'!==fs.readFileSync(path.join(root,'data/campsites/coordinate-index.json'),'utf8'))fail('coordinate_index','coordinate-index.json');
const report={baseline_commit:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:baseline,encoding:'utf8'}).trim(),
  output_hashes:Object.fromEntries([...states.map(s=>`data/campsites/${s}_merged.geojson`),'data/campsites/search-index.json','data/campsites/coordinate-index.json'].map(r=>[r,sha(path.join(root,r))])),
  saved_links_checked:checked,access_holds:holds,proposal_size:proposal.size,delta_count:deltas.length,deltas,unexpected_delta_count:unexpected.length,unexpected_deltas:unexpected.slice(0,200)};
report.output_digest=crypto.createHash('sha256').update(JSON.stringify(report.output_hashes)).digest('hex');
if(arg('report'))fs.writeFileSync(path.resolve(arg('report')),JSON.stringify(report,null,1)+'\n');
console.log(JSON.stringify({output_digest:report.output_digest,search_index_sha256:report.output_hashes['data/campsites/search-index.json'],saved_links_checked:checked,access_holds:holds,proposal:proposal.size,deltas:deltas.length,by_kind:deltas.reduce((a,d)=>(a[d.where+':'+d.from+'->'+d.to]=(a[d.where+':'+d.from+'->'+d.to]||0)+1,a),{}),unexpected_delta_count:unexpected.length,first_unexpected:unexpected.slice(0,10)},null,1));
if(unexpected.length)process.exitCode=1;
