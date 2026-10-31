#!/usr/bin/env node
'use strict';
// Compare an isolated repair checkout against its unchanged baseline. Optional
// --remerge rebuilds every saved state from retained raw sources, without fetches.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {CampsiteMerger,loadStateSources,saveMergedData}=require('./merge_campsite_data');
const DQ=require('../data-quality');
const {buildFromDirectory,coordinateIndex}=require('./build-search-index');
const args=process.argv.slice(2),baselineArg=args.find(a=>a.startsWith('--baseline=')),reportArg=args.find(a=>a.startsWith('--report='));
if(!baselineArg||!reportArg)throw new Error('Use --baseline=/unchanged/checkout --report=/path/report.json [--remerge]');
const root=path.resolve(__dirname,'..'),baseline=path.resolve(baselineArg.slice(11)),out=path.resolve(reportArg.slice(9));
if(root===baseline)throw new Error('Baseline must be a separate unchanged checkout');
const dir=path.join(root,'data/campsites'),bdir=path.join(baseline,'data/campsites');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files=fs.readdirSync(dir).filter(n=>/^[A-Z]{2}_merged\.geojson$/.test(n)).sort();assert.equal(files.length,50);
const feeCensus=sites=>sites.reduce((a,s)=>(a[s.m.f]++,a),{total:sites.length,free:0,conditional:0,paid:0,unknown:0});
function fullCatalogue(directory,quality){
 const details=read(path.join(directory,'ridb-sites.json')).facilities,input=[];
 for(const file of files){const state=file.slice(0,2),features=read(path.join(directory,file)).features,agency=path.join(directory,'agency',state+'.geojson');
  if(fs.existsSync(agency))features.push(...read(agency).features);
  for(const raw of quality.publicationCandidates(features,{state})){const f=quality.normalizeFeature(raw,{state});quality.attachSiteDetails(f,details);input.push(f);}
 }
 return quality.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:input}).features;
}
(async()=>{
 const sourceHashes={};
 for(const sub of ['data/opencampingmap','data/campsites'])for(const file of fs.readdirSync(path.join(root,sub)).filter(n=>/^[A-Z]{2}(?:\(1\)|_campendium|_ioverlander)?\.geojson$/.test(n)).sort()){
  const rel=sub+'/'+file;sourceHashes[rel]=hash(path.join(root,rel));assert.equal(sourceHashes[rel],hash(path.join(baseline,rel)),'Raw input changed: '+rel);
 }
 if(args.includes('--remerge'))for(const file of files){
  const state=file.slice(0,2),m=new CampsiteMerger(),log=console.log;console.log=()=>{};
  try{const {datasets}=await loadStateSources(state,m,{campsitesDir:dir,osmDir:path.join(root,'data/opencampingmap')});assert.ok(datasets.length);await saveMergedData(path.join(dir,file),await m.mergeDatasets(datasets));}
  finally{console.log=log;}
  console.log('Replayed '+state);
 }
 const before=read(path.join(bdir,'search-index.json')),after=buildFromDirectory(dir),B=new Map(before.sites.map(s=>[s.id,s])),A=new Map(after.sites.map(s=>[s.id,s]));
 assert.equal(A.size,B.size,'Listing count');assert.deepEqual([...A.keys()].sort(),[...B.keys()].sort(),'Canonical identities');
 for(const [id,s]of A){const b=B.get(id);assert.deepEqual([s.lat,s.lng,s.states],[b.lat,b.lng,b.states],id+' coordinates/states');assert.deepEqual([...s.legacy_ids].sort(),[...b.legacy_ids].sort(),id+' aliases');}
 const feeChanges=[...A].filter(([id,s])=>s.m.f!==B.get(id).m.f).map(([id,s])=>({id,name:s.name,before:B.get(id).m.f,after:s.m.f}));
 const accessChanges=[],holds=[],members=new Set();let evidenceRows=0,maxMembers=0;
 const oldDQ=require(path.join(baseline,'data-quality.js'));
 for(const file of files){const state=file.slice(0,2),b=read(path.join(bdir,file)).features,a=read(path.join(dir,file)).features;assert.equal(a.length,b.length,state+' snapshot count');const bm=new Map(b.map(f=>[f.properties.id,f]));
  for(const f of a){const p=f.properties,g=bm.get(p.id);assert.ok(g,p.id);assert.deepEqual(f.geometry,g.geometry,p.id+' snapshot coordinates');assert.deepEqual(p.source_ids,g.properties.source_ids,p.id+' snapshot membership');assert.ok(!p._kt_normalized,'Normalized snapshot persisted');
   const own=p.member_evidence||[];assert.equal(new Set(own.map(e=>e.source_record_id)).size,own.length);maxMembers=Math.max(maxMembers,own.length);evidenceRows+=own.length>0?1:0;if(own.length)members.add(p.id);
   for(const e of own){assert.ok((p.source_ids||[]).includes(e.source_record_id),p.id+' donor is not a member');assert.ok(!e.retrieved_at||Number.isFinite(Date.parse(e.retrieved_at)));}
   if(p.access_hold)holds.push({state,id:p.id,...p.access_hold});
   const n0=oldDQ.normalizeFeature(g),n1=DQ.normalizeFeature(f),v0=n0?.properties.access_status||'rejected',v1=n1?.properties.access_status||'rejected';
   assert.equal(!!n0,!!n1,p.id+' admission');if(v0!==v1)accessChanges.push({state,id:p.id,before:v0,after:v1});
  }
 }
 const catalogue=fullCatalogue(dir,DQ);assert.equal(catalogue.length,A.size);
 const unattributedFees=catalogue.filter(f=>f.properties.fee_status!=='unknown'&&(!f.properties.fee_source_record_id||!f.properties.fee_source)).map(f=>f.properties.id);
 const unattributedAccess=catalogue.filter(f=>f.properties.access_status!=='unknown'&&!f.properties.access_source_record_id).map(f=>f.properties.id);
 assert.deepEqual(unattributedFees,[],'Known fee missing source identity/name');assert.deepEqual(unattributedAccess,[],'Known access missing source identity');
 assert.deepEqual(coordinateIndex(after.sites),read(path.join(bdir,'coordinate-index.json')),'Weather coordinate catalogue');
 const report={baseline_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:baseline,encoding:'utf8'}).trim(),source_hashes:sourceHashes,
  assertions:{all_50_states_checked:true,raw_inputs_unchanged:true,listing_count_unchanged:true,canonical_ids_unchanged:true,coordinates_and_state_partitions_unchanged:true,aliases_unchanged:true,snapshot_counts_and_membership_unchanged:true,record_admission_unchanged:true,coordinate_catalogue_unchanged:true,known_fee_and_access_attributed:true,no_normalized_snapshots:true},
  census_before:feeCensus(before.sites),census_after:feeCensus(after.sites),counts:{fee_changes:feeChanges.length,access_changes:accessChanges.length,held_exclusions:holds.length,snapshot_rows_with_member_evidence:evidenceRows,unique_records_with_member_evidence:members.size,max_members_per_snapshot:maxMembers},
  fee_change_types:feeChanges.reduce((a,r)=>(a[r.before+'->'+r.after]=(a[r.before+'->'+r.after]||0)+1,a),{}),fee_changes:feeChanges,access_changes:accessChanges,access_holds:holds};
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({assertions:report.assertions,census_after:report.census_after,counts:report.counts,fee_change_types:report.fee_change_types},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
