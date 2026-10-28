'use strict';
// Publish built files only. Keep the preceding release as the Git parent for rollback.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const root=process.cwd(),out=path.resolve(process.argv[2]||'dist/kamptrail');
const branch='refs/heads/hostinger';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'kamptrail-release-'));
const env={...process.env,GIT_INDEX_FILE:path.join(scratch,'index'),
  GIT_AUTHOR_NAME:'github-actions[bot]',GIT_AUTHOR_EMAIL:'41898282+github-actions[bot]@users.noreply.github.com',
  GIT_COMMITTER_NAME:'github-actions[bot]',GIT_COMMITTER_EMAIL:'41898282+github-actions[bot]@users.noreply.github.com'};
function git(args){return execFileSync('git',args,{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
try{
  for(const file of ['index.html','service-worker.js','data/campsites/index.json','data/campsites/agency/index.json']){
    if(!fs.statSync(path.join(out,file)).isFile())throw new Error(`Missing release dependency: ${file}`);
  }
  for(const file of ['.git','.env','package.json','scripts','.github']){
    if(fs.existsSync(path.join(out,file)))throw new Error(`Source or secret file in release: ${file}`);
  }
  const source=git(['rev-parse','HEAD']);
  fs.writeFileSync(path.join(out,'release.json'),JSON.stringify({source_commit:source})+'\n');
  const remote=spawnSync('git',['ls-remote','--exit-code','origin',branch],{cwd:root,env,encoding:'utf8'});
  if(![0,2].includes(remote.status))throw new Error('Unable to inspect the previous release; publication stopped');
  let parent;
  if(remote.status===0){git(['fetch','--no-tags','origin',branch]);parent=git(['rev-parse','FETCH_HEAD']);}
  git(['read-tree','--empty']);
  git([`--work-tree=${out}`,'add','--all','--force']);
  const tree=git(['write-tree']);
  if(parent&&tree===git(['rev-parse',`${parent}^{tree}`])){
    console.log(`Release unchanged: ${parent}`);
  }else{
    const commit=git(['commit-tree',tree,...(parent?['-p',parent]:[]),'-m',`Deploy KampTrail from ${source}`]);
    git(['push','origin',`${commit}:${branch}`]);
    console.log(`Published release ${commit} from ${source}`);
  }
}catch(error){console.error(error.message);process.exitCode=1;}
finally{fs.rmSync(scratch,{recursive:true,force:true});}
