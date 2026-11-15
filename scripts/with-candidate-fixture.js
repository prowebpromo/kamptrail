'use strict';
// npm test runs against freshly rebuilt candidate data, leaving the source checkpoint intact.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
(async()=>{
  const source=path.resolve(__dirname,'..');
  let temporary=null,root=source;
  try{
    if(!fs.existsSync(path.join(source,'.tourism-test-fixture.json'))){
      temporary=fs.mkdtempSync(path.join(os.tmpdir(),'kamptrail-tourism-test-'));
      root=await require('./tourism-type-admission/test-fixture.js').prepare(temporary);
    }
    const result=spawnSync(process.execPath,process.argv.slice(2),{cwd:root,stdio:'inherit',env:process.env});
    if(result.error)throw result.error;
    process.exitCode=result.status??1;
  }finally{
    if(temporary){
      const resolved=fs.realpathSync(temporary),tempRoot=fs.realpathSync(os.tmpdir());
      if(path.dirname(resolved)!==tempRoot||!path.basename(resolved).startsWith('kamptrail-tourism-test-'))throw new Error('Unexpected temporary fixture cleanup path');
      fs.rmSync(resolved,{recursive:true,force:true});
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
