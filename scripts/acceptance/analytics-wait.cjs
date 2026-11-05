'use strict';
const assert=require('node:assert/strict');
(async()=>{
 const expected=process.env.EXPECTED_SHA;
 assert.match(expected||'',/^[a-f0-9]{40}$/,'Pin EXPECTED_SHA to the authorized production merge before launching');
 const end=Date.now()+28*60*1000;
 while(Date.now()<end){
  try{const response=await fetch('https://kamptrail.com/release.json?n='+Date.now(),{cache:'no-store'});const body=await response.json();if(response.ok&&body.source_commit===expected){console.log(JSON.stringify({source:expected,result:'authorized deployment live'}));return;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,30000));
 }
 throw Error('Authorized source was not observed before timeout');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
