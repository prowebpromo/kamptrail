/* Supplement for a direct run made before the raw Cache Storage response check was added.
   Usage: node verify-charset.cjs <capture-dir> <archived-original-result.json> */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [capture,file]=process.argv.slice(2),first=JSON.parse(fs.readFileSync(file));
const manifest=JSON.parse(fs.readFileSync(path.join(capture,'manifest.json')));
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const verified=[],unknownErrors=[];
for(const line of first.errors){
  const m=line.match(/^Error: direct response diverges: (\/\S+) ([a-f0-9]{64})$/);
  if(!m||!manifest[m[1]]){unknownErrors.push(line);continue;}
  const rec=manifest[m[1]],raw=fs.readFileSync(path.join(capture,rec.file));
  if(digest(raw)!==rec.sha256)throw Error('SHA mismatch for independent capture '+m[1]);
  const inspectorHash=digest(Buffer.from(new TextDecoder('windows-1252').decode(raw)));
  if(m[2]!==inspectorHash){unknownErrors.push(line);continue;}
  verified.push({path:m[1],rawSha:rec.sha256,inspectorSha:m[2]});
}
const exact=new Set(first.directVerifiedResponses),transcoded=new Set(verified.map(row=>row.path));
const stillMissing=first.directMissing.filter(name=>!exact.has(name)&&!transcoded.has(name));
const pass=first.final && first.steps.length===50 && first.final.rows===33370 && !Object.values(first.final.errors).some(Boolean) && !first.missingRequests.length && !unknownErrors.length && !stillMissing.length;
console.log(JSON.stringify({source:file,transport:'direct-browser-https',totalStates:first.steps.length,final:first.final,filters:first.filters,rawMatchInInspector:exact.size,identicalAfterKnownInspectorTranscoding:verified.length,unknownErrors,stillMissing,verified,pass},null,2));
process.exitCode=pass?0:1;
