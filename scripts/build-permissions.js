#!/usr/bin/env node
'use strict';
// Compile an exact-identity catalogue and locally reviewed evidence. Never fetch a submitted URL.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Services=require('../services.js');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const check=(ok,msg)=>{if(!ok)throw new Error('Permissions: '+msg);};
const coordinates=c=>Array.isArray(c)&&c.length===2&&c.every(Number.isFinite)&&Math.abs(c[0])<=180&&Math.abs(c[1])<=90;
function coordinate5(x){const n=Math.sign(x)*Math.floor(Math.abs(x)*1e5+0.5)/1e5;return(n===0?0:n).toFixed(5);}
function spotId(c){check(coordinates(c),'invalid coordinates');return `spot:${coordinate5(c[1])},${coordinate5(c[0])}`;}
function placeKey(p){return p.kind==='spot'?p.id:`${p.kind}:${p.id}`;}
function validPlace(p){return p&&['campsite','service','spot'].includes(p.kind)&&typeof p.id==='string'&&p.id.length>0&&p.id.length<=160&&!/[\x00-\x20\x7f]/.test(p.id)&&typeof p.name==='string'&&Buffer.byteLength(p.name)<=240&&coordinates(p.coordinates)&&(p.kind!=='spot'||p.id===spotId(p.coordinates));}
function utc(s){return typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s.replace('Z','.000Z');}
function day(s){return s===null||typeof s==='string'&&/^\d{4}-\d\d-\d\d$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
function validateEvidence(wrapper,places,now=Date.now()){
 check(wrapper?.version===1&&Array.isArray(wrapper.records)&&wrapper.records.length<=10000,'invalid official wrapper');
 const byId=new Map();
 for(const r of wrapper.records){
  check(r&&typeof r.id==='string'&&/^[a-z0-9][a-z0-9-]{0,119}$/.test(r.id)&&!byId.has(r.id),'duplicate/invalid evidence id');
  check(validPlace(r.place)&&['overnight_occupancy','unoccupied_vehicle_parking'].includes(r.activity)&&['allowed','conditional','prohibited'].includes(r.statement),'invalid scope');
  const known=places.get(placeKey(r.place));check(known&&known.coordinates.every((x,i)=>x===r.place.coordinates[i])&&known.name===r.place.name,'evidence identity not in actual catalogue');
  check(typeof r.issuer==='string'&&r.issuer.length>0&&r.issuer.length<=200&&typeof r.source_url==='string'&&/^https:\/\/www\.blm\.gov\/visit\/[a-z0-9-]+$/.test(r.source_url),'unapproved official source');
  check(typeof r.quote==='string'&&r.quote.length>0&&r.quote.length<=1000&&r.sha256===hash(r.quote),'excerpt checksum');
  check(Array.isArray(r.conditions)&&r.conditions.length<=20&&r.conditions.every(x=>typeof x==='string'&&x.length<=600),'conditions');
  check(day(r.effective_from)&&day(r.effective_until)&&(!r.effective_from||!r.effective_until||r.effective_from<=r.effective_until),'effective dates');
  check(utc(r.retrieved_at)&&utc(r.reviewed_at)&&utc(r.review_after)&&Date.parse(r.retrieved_at)<=Date.parse(r.reviewed_at)&&Date.parse(r.reviewed_at)<=now+300000&&Date.parse(r.review_after)>Date.parse(r.reviewed_at),'review chronology');
  check(Array.isArray(r.supersedes)&&new Set(r.supersedes).size===r.supersedes.length&&r.supersedes.every(x=>typeof x==='string'&&x!==r.id),'supersession');
  byId.set(r.id,r);
 }
 for(const r of wrapper.records)for(const id of r.supersedes){const old=byId.get(id);check(old&&placeKey(old.place)===placeKey(r.place)&&old.activity===r.activity&&Date.parse(old.reviewed_at)<=Date.parse(r.reviewed_at),'invalid supersession target');}
 const visiting=new Set(),done=new Set();function walk(id){check(!visiting.has(id),'supersession cycle');if(done.has(id))return;visiting.add(id);byId.get(id).supersedes.forEach(walk);visiting.delete(id);done.add(id);}for(const id of byId.keys())walk(id);
 return wrapper;
}
function build(root){
 const search=JSON.parse(fs.readFileSync(path.join(root,'data/campsites/search-index.json'),'utf8'));
 check(search.version===1&&Array.isArray(search.sites)&&search.sites.length>0,'missing campsite search index');
 const places=new Map();function add(p){check(validPlace(p),'invalid catalogue place');const key=placeKey(p);check(!places.has(key),'duplicate catalogue identity');places.set(key,p);}
 for(const r of search.sites)add({kind:'campsite',id:r.id,name:r.name,coordinates:[r.lng,r.lat]});
 const serviceRoot=path.join(root,'data/services'),manifest=Services.validateManifest(JSON.parse(fs.readFileSync(path.join(serviceRoot,'index.json'),'utf8')));
 for(const entry of manifest.shards){const raw=fs.readFileSync(path.join(serviceRoot,entry.url));check(raw.length===entry.bytes&&hash(raw)===entry.sha256,'service shard integrity');const shard=Services.validateShard(JSON.parse(raw),entry,manifest);for(const r of shard.items)add({kind:'service',id:r.id,name:r.name,coordinates:r.coordinates});}
 const official=validateEvidence(JSON.parse(fs.readFileSync(path.join(root,'data/permissions/official.json'),'utf8')),places);
 const buckets=Array.from({length:256},()=>({version:1,places:{}}));
 for(const [key,p]of [...places].sort(([a],[b])=>a.localeCompare(b)))buckets[parseInt(hash(key).slice(0,2),16)].places[key]=p;
 const output=path.join(root,'api/_data/permissions');fs.mkdirSync(output,{recursive:true});
 for(let i=0;i<256;i++){const file=path.join(output,i.toString(16).padStart(2,'0')+'.json');fs.writeFileSync(file+'.tmp',JSON.stringify(buckets[i])+'\n');fs.renameSync(file+'.tmp',file);}
 fs.writeFileSync(path.join(output,'official.json.tmp'),JSON.stringify(official)+'\n');fs.renameSync(path.join(output,'official.json.tmp'),path.join(output,'official.json'));
 fs.writeFileSync(path.join(output,'.htaccess'),'Require all denied\n');
 return{places:places.size,evidence:official.records.length};
}
if(require.main===module){try{console.log(JSON.stringify(build(path.resolve(__dirname,'..'))));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={build,validateEvidence,coordinate5,spotId,placeKey,validPlace,hash};
