#!/usr/bin/env node
'use strict';
// Builds the revision 2 record ledger: docs/candidates/tourism-type-admission.{json,csv}.
// Compares the baseline catalogue (unchanged origin/main checkout) with this candidate's committed data and code.
// Every listing that changes, and every listing in groups A, B, C, the website-linked set and the three OSM
// elements, gets one deduplicated record. Read-only on data.
//   node scripts/tourism-type-admission/build-ledger.js --baseline=/unchanged/checkout [--reconcile=reconcile.json]
const H=require('./harness'),E=require('./evidence'),fs=require('fs'),path=require('path');
const arg=n=>process.argv.slice(2).find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const root=path.resolve(__dirname,'../..'),baseRoot=path.resolve(arg('baseline')||'');
if(!arg('baseline')||baseRoot===root)throw new Error('Use --baseline=/unchanged/checkout');
const BI=H.inputs(baseRoot),NI=H.inputs(root);
const DQb=H.loadDQ(path.join(baseRoot,'data-quality.js')),DQn=H.loadDQ(path.join(root,'data-quality.js'));
const L=E.load(baseRoot),DQref=require(path.join(root,'data-quality.js'));
const read=H.read;
// Baseline groups from the revision 1 measurement (same baseline, same definitions).
const v1=read(path.join(root,'scripts/tourism-type-admission/ledger-v1-groups.json'));
const web=read(path.join(root,'scripts/tourism-type-admission/website-links.json'));
const rec=arg('reconcile')?read(path.resolve(arg('reconcile'))):null;
// Catalogues and identities.
const base=H.catalogue(DQb,BI).features,cand=H.catalogue(DQn,NI).features;
const B=new Map(base.map(f=>[f.properties.id,f])),N=new Map(cand.map(f=>[f.properties.id,f]));
const resolver=fs_=>{const m=new Map();for(const f of fs_)m.set(f.properties.id,f.properties.id);for(const f of fs_)for(const a of f.properties.legacy_ids||[])if(!m.has(a))m.set(a,f.properties.id);return m;};
const RB=resolver(base),RN=resolver(cand);
const bidx=new Map(BI.idx.map(s=>[s.id,s])),nidx=new Map(NI.idx.map(s=>[s.id,s]));
// Withdrawn records keep a resolvable legacy page through data/campsites/withdrawn.json.
const wfile=path.join(NI.dir,'withdrawn.json'),withdrawn=fs.existsSync(wfile)?new Map(read(wfile).listings.map(w=>[w.id,w])):new Map();
// Browser runtime identity (data-loader.js L182), candidate data: all states alphabetical, reversed, and own states in every order.
const ord=(DQ,I,order)=>resolver(H.catalogue(DQ,I,{browser:true,statesOrder:order}).features);
const brAll=ord(DQn,NI,NI.collections),brRev=ord(DQn,NI,[...NI.collections].reverse());
const byState=new Map(NI.collections.map(c=>[c.state,c])),cache=new Map();
const perms=a=>a.length<=1?[a]:a.flatMap((x,i)=>perms([...a.slice(0,i),...a.slice(i+1)]).map(p=>[x,...p]));
const orders=(states,id)=>{const o={};for(const p of perms(states)){const k=p.join('>');if(!cache.has(k))cache.set(k,ord(DQn,NI,p.map(s=>byState.get(s))));o[k]=cache.get(k).get(id)??null;}return o;};
// Per snapshot row admission (normalizeFeature returns a record or null), baseline code and data versus candidate.
const rowAdmission=new Map();
{const sd=BI.details,ad=BI.ridb,DQo=DQb,DQc=DQn;
 BI.collections.forEach((c,ci)=>{const nc=NI.collections[ci];c.geojson.features.forEach((f,i)=>{const g=nc.geojson.features[i];if(!g||g.properties.id!==f.properties.id)return;
   const a=!!DQo.normalizeFeature(f,{state:c.state}),b=!!DQc.normalizeFeature(g,{state:c.state,siteDetails:sd,amenityDetails:ad});
   if(a!==b){const l=rowAdmission.get(f.properties.id)||[];l.push({state:c.state,from:a?'admitted':'rejected',to:b?'admitted':'rejected'});rowAdmission.set(f.properties.id,l);}});});}
// Fields compared per listing. Every difference becomes a listed change.
const FIELDS=['type','camping_classification','fee_status','cost','access','access_status','name'];
const listing=f=>f&&{type:f.properties.type,camping_classification:f.properties.camping_classification,camping_evidence:f.properties.camping_evidence,fee_status:f.properties.fee_status,cost:f.properties.cost,access:f.properties.access,access_status:f.properties.access_status,name:f.properties.name,coordinates:f.geometry.coordinates,legacy_ids:[...(f.properties.legacy_ids||[])].filter(x=>x!==f.properties.id).sort()};
const all=new Set([...v1.affected,...web.map(w=>w.host_published_as).filter(Boolean),...v1.surfaced]);
for(const id of rowAdmission.keys())all.add(id);
for(const [id,f] of B){const n=N.get(id);if(!n){all.add(id);continue;}const a=listing(f),b=listing(n);if(JSON.stringify(a)!==JSON.stringify(b))all.add(id);}
for(const id of N.keys())if(!B.has(id))all.add(id);
const groupsOf=id=>[v1.A.includes(id)&&'A',v1.B.includes(id)&&'B',v1.C.includes(id)&&'C',web.some(w=>w.host_published_as===id)&&'W',v1.surfaced.includes(id)&&'OSM3'].filter(Boolean);
const records=[];
for(const id of [...all].sort()){
  const b=B.get(id),n=N.get(id),bf=listing(b),nf=listing(n),bi=bidx.get(id),ni=nidx.get(id);
  const fid=(n||b)?.properties.facility_id!=null?String((n||b).properties.facility_id):(/^ridb:/.test(id)?id.slice(5):null);
  const ev=fid?E.evidenceFor(L,fid,DQref):null;
  const changes=[];
  if(b&&!n){const w=withdrawn.get(id);changes.push({field:'publication',from:'published',to:'withdrawn from campsite discovery',legacy_page:w?`#site=${id} resolves through data/campsites/withdrawn.json`:null,reason:w?.reason||null,separate_review:true});}
  if(!b&&n)changes.push({field:'publication',from:'not published',to:'published',separate_review:true});
  if(b&&n){for(const k of FIELDS)if(JSON.stringify(bf[k])!==JSON.stringify(nf[k]))changes.push({field:k,from:bf[k],to:nf[k],separate_review:true});
    if(JSON.stringify(bf.coordinates)!==JSON.stringify(nf.coordinates))changes.push({field:'coordinates',from:bf.coordinates,to:nf.coordinates,separate_review:true});
    const lost=bf.legacy_ids.filter(x=>!nf.legacy_ids.includes(x)),gained=nf.legacy_ids.filter(x=>!bf.legacy_ids.includes(x));
    if(lost.length||gained.length)changes.push({field:'legacy_ids',removed:lost,added:gained,resolves_now_to:Object.fromEntries(lost.map(x=>[x,RN.get(x)??(withdrawn.has(x)?'withdrawn.json':null)])),separate_review:true});
    if(bf.camping_evidence!==nf.camping_evidence)changes.push({field:'camping_evidence',from:bf.camping_evidence,to:nf.camping_evidence,separate_review:true});}
  if(!b&&!n){ // Not a listing on either side (an absorbed element that stays absorbed).
    const host=RN.get(id)??null,hb=RB.get(id)??null;
    records.push({canonical_id:id,name:null,states:[],groups:groupsOf(id),own_source_evidence:{note:'absorbed element, not a listing before or after'},borrowed_evidence:[],website_identity:null,
      identity_basis:{kind:'alias',record_id:host},current:{status:hb?`alias of ${hb}`:'not published',type:null},proposed:{status:host?`alias of ${host}`:(withdrawn.has(id)||[...withdrawn.values()].some(w=>w.legacy_ids.includes(id))?'withheld with its withdrawn host':'not published'),type:null},
      changes:[...(hb!==host?[{field:'alias_host',from:hb,to:host,separate_review:true}]:[]),...(rowAdmission.get(id)||[]).map(r=>({field:'row_admission',state:r.state,from:r.from,to:r.to,separate_review:true}))],
      identity:{index_id_before:hb,index_id_after:host,legacy_ids_before:[],legacy_ids_after:[],browser_all_states:brAll.get(id)??null,browser_reverse:brRev.get(id)??null,browser_own_states_every_order:{},depends_on_load_order:(brAll.get(id)??null)!==(brRev.get(id)??null),depends_on_deterministic_identity_package:(brAll.get(id)??null)!==(brRev.get(id)??null),saved_link_resolves_after:!!host||withdrawn.has(id)||[...withdrawn.values()].some(w=>w.legacy_ids.includes(id)),resolves_via:host?'index':([...withdrawn.values()].find(w=>w.legacy_ids.includes(id))?.id?'withdrawn.json entry of '+[...withdrawn.values()].find(w=>w.legacy_ids.includes(id)).id:null)},
      contributions:{published_reviews:0,published_observations:0,published_photos:0}});
    continue;
  }
  for(const r of rowAdmission.get(id)||[])changes.push({field:'row_admission',state:r.state,from:r.from,to:r.to,note:'snapshot row normalization (own-record classification). The listing outcome is in the other changes.',separate_review:true});
  const p=(n||b).properties;
  const st=ni?.states||bi?.states||[];
  const lo=st.length>1?orders(st,id):{};
  const browserVals=[brAll.get(id)??null,brRev.get(id)??null,...Object.values(lo)];
  const savedAfter=n?(RN.get(id)===id&&(bi?.legacy_ids||[]).every(a=>RN.get(a)===id||withdrawn.has(a))):withdrawn.has(id)||RN.has(id);
  const typeEv=n?.properties.type_evidence||null;
  records.push({canonical_id:id,name:p.name,states:st,groups:groupsOf(id),
    own_source_evidence:ev?{facility_id:fid,structured_classification:ev.structured,overnight_campsite_records:ev.overnight,overnight_none:ev.overnight_none||null,descriptive_wording:ev.descriptive,accommodation:ev.accommodation}:{note:'not a Recreation.gov facility'},
    borrowed_evidence:v1.borrowed[id]||[],
    website_identity:web.find(w=>w.host_published_as===id||w.host===id)||null,
    identity_basis:n?.properties.camping_evidence_record_id?{kind:'exact_identity',record_id:n.properties.camping_evidence_record_id,rule:'same Recreation.gov facility id (data-quality.js mergeFeatures)'}:{kind:'own_record',record_id:id},
    current:{status:b?'published':'not published',type:bf?.type??null,camping_evidence:bf?.camping_evidence??null},
    proposed:{status:n?'published':(withdrawn.has(id)?'withdrawn (legacy page kept)':'not published'),type:nf?.type??null,camping_evidence:nf?.camping_evidence??null,type_evidence:typeEv,camping_evidence_record_id:n?.properties.camping_evidence_record_id||null},
    changes,
    identity:{index_id_before:bi?id:(RB.get(id)??null),index_id_after:ni?id:(RN.get(id)??null),legacy_ids_before:bi?.legacy_ids||[],legacy_ids_after:ni?.legacy_ids||[],
      browser_all_states:brAll.get(id)??null,browser_reverse:brRev.get(id)??null,browser_own_states_every_order:lo,
      depends_on_load_order:new Set(browserVals).size>1,depends_on_deterministic_identity_package:new Set(browserVals).size>1||browserVals.some(v=>v!==null&&v!==id),
      saved_link_resolves_after:savedAfter},
    contributions:{published_reviews:0,published_observations:0,published_photos:0,checked:'production api/community-discovery.php 2026-10-31 (0 published sitewide)',not_inspected:['pending and rejected community reviews','pending photos','api/submit.php corrections and reports','permission observations','external bookmarks and shared #site links']}});
}
// Group counts and overlaps.
const sets={A:new Set(v1.A),B:new Set(v1.B),C:new Set(v1.C),W:new Set(web.map(w=>w.host_published_as).filter(Boolean))};
const inter=(...s)=>[...s[0]].filter(x=>s.slice(1).every(t=>t.has(x))).length;
const venn={A:sets.A.size,B:sets.B.size,C:sets.C.size,W:sets.W.size,'A∩B':inter(sets.A,sets.B),'A∩C':inter(sets.A,sets.C),'A∩W':inter(sets.A,sets.W),'B∩C':inter(sets.B,sets.C),'B∩W':inter(sets.B,sets.W),'C∩W':inter(sets.C,sets.W),'A∩B∩C':inter(sets.A,sets.B,sets.C),'A∪B∪C∪W':new Set([...sets.A,...sets.B,...sets.C,...sets.W]).size,records:records.length};
const changeKinds={};for(const r of records)for(const c of r.changes){const k=c.field+(c.from!==undefined?':'+JSON.stringify(c.from)+'->'+JSON.stringify(c.to):'');changeKinds[k]=(changeKinds[k]||0)+1;}
const typeBy={};for(const r of records){const e=r.proposed.type_evidence?.kind||(r.proposed.camping_evidence==='ridb_facility_type_overnight_sites'?'structured_classification+overnight_campsite_records':null);if(r.proposed.status!=='published')continue;const k=(r.proposed.type)+' via '+(r.proposed.camping_evidence||'?');typeBy[k]=(typeBy[k]||0)+1;}
const out={version:2,candidate:'tourism-type-admission',baseline_commit:require('child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:baseRoot,encoding:'utf8'}).trim(),
  listings_before:B.size,listings_after:N.size,venn,change_kinds:changeKinds,proposed_by_evidence:typeBy,
  structured_facility_type:{available_offline:false,detail:'scripts/fetch_recreation_gov_data.py L114-122 maps RIDB FacilityTypeDescription to type (established, dispersed, backcountry, other) and drops the raw value. No raw RIDB facility export is retained. ridb-sites.json and ridb-amenities.json come from the RIDB full export but keep only campsite records (TypeOfUse=Overnight) per FacilityID.',
    missing:['raw FacilityTypeDescription per facility','FacilityTypeDescription source date (the RIDB LastUpdatedDate per facility)'],
    proposal:'Add facility_type_description and facility_last_updated to the properties written by scripts/fetch_recreation_gov_data.py (convert_to_geojson), or read Facilities.csv in scripts/build_ridb_sites.py and add an ft field per facility to ridb-sites.json. Not downloaded here.'},
  count_reconciliation:rec,records};
fs.writeFileSync(path.join(root,'docs/candidates/tourism-type-admission.json'),JSON.stringify(out,null,1)+'\n');
const q=v=>{const s=v==null?'':typeof v==='string'?v:JSON.stringify(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
const cols=['canonical_id','name','states','groups','own_structured','own_overnight_records','own_wording','accommodation','borrowed','website_identity','identity_basis','current_status','proposed_status','current_type','proposed_type','proposed_type_evidence','changes','legacy_ids_before','legacy_ids_after','browser_all_states','depends_on_load_order','depends_on_deterministic_identity_package','saved_link_resolves_after'];
const csv=[cols.join(',')].concat(records.map(r=>{const o=r.own_source_evidence;return [r.canonical_id,r.name,r.states.join(' '),r.groups.join(' '),
  (o.structured_classification||[]).map(s=>`${s.record_id} ${s.field}=${s.value}`).join('; '),(o.overnight_campsite_records||[]).map(s=>`${s.file} ${s.value}`).join('; '),(o.descriptive_wording||[]).map(s=>`${s.field}: ${s.value}`).join('; '),o.accommodation?.term||'',
  r.borrowed_evidence.map(b=>`${b.field}=${b.value} from ${b.member_id}`).join('; '),r.website_identity?`${r.website_identity.member} ${r.website_identity.basis}`:'',`${r.identity_basis.kind} ${r.identity_basis.record_id}`,
  r.current.status,r.proposed.status,r.current.type,r.proposed.type,r.proposed.type_evidence?`${r.proposed.type_evidence.kind} ${r.proposed.type_evidence.field}=${r.proposed.type_evidence.value}`:(r.proposed.camping_evidence||''),
  r.changes.map(c=>c.field+(c.from!==undefined?`:${c.from}->${c.to}`:'')).join('; '),r.identity.legacy_ids_before.join(' '),r.identity.legacy_ids_after.join(' '),r.identity.browser_all_states,r.identity.depends_on_load_order,r.identity.depends_on_deterministic_identity_package,r.identity.saved_link_resolves_after].map(q).join(',');}));
fs.writeFileSync(path.join(root,'docs/candidates/tourism-type-admission.csv'),csv.join('\n')+'\n');
console.log(JSON.stringify({listings_before:B.size,listings_after:N.size,venn,change_kinds:changeKinds,proposed_by_evidence:typeBy,load_order_dependent:records.filter(r=>r.identity.depends_on_load_order).map(r=>r.canonical_id),unresolved:records.filter(r=>!r.identity.saved_link_resolves_after).map(r=>r.canonical_id)},null,1));
