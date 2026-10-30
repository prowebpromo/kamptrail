/* Publish the reviewed state-policy source once; location records stay unchanged. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),rest=require('../rest-areas.js');
const root=path.resolve(__dirname,'..'),source=path.join(root,'scripts/fixtures/rest_area_state_policies.json'),destination=path.join(root,'data/rest-areas/state-policies.json');
if(fs.realpathSync(source)!==source)throw new Error('Policy source must not follow symlinks');
const raw=fs.readFileSync(source);if(raw.length>64*1024)throw new Error('State policies exceed release bound');
const bundle=rest.validatePolicies(JSON.parse(raw));
const published={version:bundle.version,policies:bundle.policies,exceptions:bundle.exceptions||[]};
const parent=path.dirname(destination);fs.mkdirSync(parent,{recursive:true});
if(fs.realpathSync(parent)!==parent||(fs.existsSync(destination)&&fs.realpathSync(destination)!==destination))throw new Error('Policy destination must not follow symlinks');
const temporary=path.join(parent,'.state-policy-'+crypto.randomUUID());
try{
  fs.writeFileSync(temporary,JSON.stringify(published)+'\n',{flag:'wx'});
  if(fs.realpathSync(parent)!==parent)throw new Error('Policy parent changed while building');
  fs.renameSync(temporary,destination);
}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
console.log(`Published ${published.policies.length} state rest-area policies; location records unchanged.`);
