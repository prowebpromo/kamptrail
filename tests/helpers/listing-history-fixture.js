'use strict';
const {createHash,webcrypto}=require('node:crypto');
const history={version:1,listings:[]},raw=JSON.stringify(history)+'\n';
const hash=createHash('sha256').update(raw).digest('hex');
// Existing source-focused fixtures explicitly model a bound, empty historical registry.
function withEmptyHistory(fetcher){
 const sourceHashes={};
 // Source-focused fixtures derive their immutable bytes lazily without making extra source requests.
 const jsonResponse=data=>({ok:true,status:200,json:async()=>data,text:async()=>JSON.stringify(data),clone:()=>jsonResponse(data)});
 return async(url,options)=>{
 if(String(url)==='data/campsites/withdrawn.json')return new Response(raw);
 const response=await fetcher(url,options);
 if(response.ok&&String(url).endsWith('.geojson')){const text=typeof response.text==='function'?await response.text():JSON.stringify(await response.json());sourceHashes[String(url)]=createHash('sha256').update(text).digest('hex');return new Response(text);}
 if(response.ok&&['data/campsites/index.json','data/campsites/search-index.json','data/campsites/identity-hosts.json'].includes(String(url))){
  const data=await response.json();return jsonResponse({...((String(url)==='data/campsites/index.json')?{states:[],total_sites:0}:{}),...data,history_sha256:hash,source_sha256:sourceHashes});
 }
 // Some older fixtures omitted the state metadata while testing independent agency failures.
 if(String(url)==='data/campsites/index.json')return jsonResponse({states:[],total_sites:0,history_sha256:hash,source_sha256:sourceHashes});
 return response;
};}
module.exports={withEmptyHistory,webcrypto,history,raw,hash};
