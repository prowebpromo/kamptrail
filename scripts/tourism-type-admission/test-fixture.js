'use strict';
// Prepare a complete, disposable candidate checkout from retained inputs only.
// No Git/network access, production writes, policy changes or approved-data commits.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const source=path.resolve(__dirname,'../..');
const lf=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
// Git may expand line endings on Windows. Restore repository text bytes in
// copied JSON only; builders still validate the original retained checksums.
function normalizeJSON(directory){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())normalizeJSON(file);
    else if(entry.isFile()&&/\.(?:geojson|json)$/.test(entry.name)){
      const text=fs.readFileSync(file,'utf8'),normalized=text.replace(/\r\n/g,'\n');
      if(text!==normalized)fs.writeFileSync(file,normalized);
    }
  }
}

async function prepare(parent){
  const pinned=path.join(source,'tests/fixtures/tourism-baseline');
  const provenance=JSON.parse(fs.readFileSync(path.join(pinned,'provenance.json'),'utf8'));
  const classifier=lf(path.join(pinned,'data-quality.js'));
  if(sha(classifier)!==provenance.classifier_sha256_lf)throw new Error('Frozen baseline classifier digest changed');
  if(sha(lf(path.join(source,'data/campsites/search-index.json')))!==provenance.index_sha256_lf)throw new Error('Released index seed changed: review the pinned test baseline before regenerating');
  parent=path.resolve(parent);
  if(parent===source||parent.startsWith(source+path.sep))throw new Error('Candidate fixture must be outside the source checkout');
  fs.mkdirSync(parent,{recursive:true});
  const candidate=path.join(parent,'candidate'),baseline=path.join(parent,'baseline');
  if(fs.existsSync(candidate)||fs.existsSync(baseline))throw new Error('Use a fresh fixture output directory');
  const ignored=new Set(['.git','node_modules','dist','test-results','playwright-report','__pycache__']);
  fs.cpSync(source,candidate,{recursive:true,filter:p=>!path.relative(source,p).split(path.sep).some(part=>ignored.has(part))});
  normalizeJSON(candidate);
  const dependencies=path.join(source,'node_modules');
  if(fs.existsSync(dependencies))fs.symlinkSync(dependencies,path.join(candidate,'node_modules'),'junction');
  fs.mkdirSync(path.join(baseline,'data'),{recursive:true});
  fs.cpSync(path.join(source,'data/campsites'),path.join(baseline,'data/campsites'),{recursive:true,filter:p=>path.basename(p)!=='elevation'});
  fs.cpSync(path.join(source,'data/opencampingmap'),path.join(baseline,'data/opencampingmap'),{recursive:true});
  normalizeJSON(baseline);
  fs.writeFileSync(path.join(baseline,'data-quality.js'),classifier);
  const dir=path.join(candidate,'data/campsites');
  const {CampsiteMerger,loadStateSources,saveMergedData}=require(path.join(candidate,'scripts/merge_campsite_data.js'));
  const snapshots=fs.readdirSync(dir).filter(n=>/^[A-Z]{2}_merged\.geojson$/.test(n)).sort();
  if(snapshots.length!==50)throw new Error('Expected 50 retained state snapshots');
  console.log('Preparing isolated tourism candidate from 50 retained states (offline).');
  for(const name of snapshots){
    const merger=new CampsiteMerger(),log=console.log;
    console.log=()=>{};
    try{
      const {datasets}=await loadStateSources(name.slice(0,2),merger,{campsitesDir:dir,osmDir:path.join(candidate,'data/opencampingmap')});
      await saveMergedData(path.join(dir,name),await merger.mergeDatasets(datasets));
    }finally{console.log=log;}
    console.log('Replayed '+name.slice(0,2));
  }
  return verifyPreparedCandidate(candidate,baseline,provenance);
}

function verifyPreparedCandidate(candidate,baseline,provenance){
  const dir=path.join(candidate,'data/campsites');
  const snapshots=fs.readdirSync(dir).filter(n=>/^[A-Z]{2}_merged\.geojson$/.test(n)).sort();
  const run=(script,args=[])=>{
    console.log('Candidate check: '+script);
    try{return execFileSync(process.execPath,[path.join(candidate,'scripts',script),...args],{cwd:candidate,encoding:'utf8',maxBuffer:16*1024*1024});}
    catch(error){if(error.stdout)console.error(error.stdout);if(error.stderr)console.error(error.stderr);throw error;}
  };
  run('build-search-index.js');
  const baseArgs=['--baseline='+baseline,'--baseline-commit='+provenance.commit];
  run('tourism-type-admission/build-ledger.js',baseArgs);
  run('tourism-type-admission/owner-decisions.js',baseArgs);
  const previous=JSON.parse(fs.readFileSync(path.join(baseline,'data/campsites/search-index.json'),'utf8'));
  const next=JSON.parse(fs.readFileSync(path.join(dir,'search-index.json'),'utf8'));
  const withdrawn=JSON.parse(fs.readFileSync(path.join(dir,'withdrawn.json'),'utf8'));
  const continuity=require(path.join(candidate,'scripts/check-id-continuity.js')).check(previous,next,withdrawn);
  if(continuity.lost.length||continuity.moved.length||continuity.conflicts.length)throw new Error('Candidate changed published id resolution');
  // This verifier independently rebuilds from the released identity seed and
  // requires exact bytes, all listed deltas, attribution and unchanged access holds.
  run('verify-tourism-type-admission.js',[...baseArgs,'--report='+path.join(candidate,'tourism-verification.json')]);
  const ledger=JSON.parse(fs.readFileSync(path.join(candidate,'docs/candidates/tourism-type-admission.json'),'utf8'));
  const manifest={version:1,baseline:provenance,listing_count:next.sites.length,ledger_records:ledger.records.length,continuity,
    hashes:Object.fromEntries([...snapshots,'search-index.json','coordinate-index.json','identity-hosts.json','withdrawn.json'].map(n=>[n,sha(fs.readFileSync(path.join(dir,n)))]))};
  fs.writeFileSync(path.join(candidate,'.tourism-test-fixture.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(`Isolated candidate ready: ${next.sites.length} listings, ${ledger.records.length} review records, ${continuity.previous_ids} saved ids preserved.`);
  return candidate;
}

if(require.main===module){
  const output=process.argv.slice(2).find(a=>a.startsWith('--output='))?.slice(9);
  if(!output)throw new Error('Use --output=/fresh/directory outside the source checkout');
  prepare(output).then(root=>console.log(root)).catch(e=>{console.error(e);process.exitCode=1;});
}
module.exports={prepare,normalizeJSON,verifyPreparedCandidate};
