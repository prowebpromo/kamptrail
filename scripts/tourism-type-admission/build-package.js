#!/usr/bin/env node
'use strict';
// Builds docs/candidates/tourism-type-admission.{json,csv}. Measures groups A, B and C against an
// unchanged baseline checkout (origin/main) and the candidate checkout. Read-only on data.
//   node scripts/tourism-type-admission/build-package.js --baseline=/unchanged/checkout
const H=require('./harness'),V=require('./variants'),fs=require('fs'),path=require('path');
const arg=n=>process.argv.slice(2).find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const root=path.resolve(__dirname,'../..'),baseRoot=path.resolve(arg('baseline')||'');
if(!arg('baseline')||baseRoot===root)throw new Error('Use --baseline=/unchanged/checkout');
const BI=H.inputs(baseRoot),NI=H.inputs(root),bfile=path.join(baseRoot,'data-quality.js'),nfile=path.join(root,'data-quality.js');
const LINES={
  A_default:{file:'data-quality.js',line:151,rule:"p.type defaults to 'established' when osm is true; osm is true for any record with tourism=camp_site|caravan_site (L105), including a Recreation.gov row that inherited tourism in a snapshot merge"},
  A_admission:{file:'data-quality.js',line:30,rule:"explicitlyCamping from tourism=camp_site|caravan_site (L30) gives camping_classification 'campsite' and evidence osm_campsite_tag, so cleanAndDedupeGeoJSON (L309) publishes it"},
  A_inherit:{file:'scripts/merge_campsite_data.js',line:213,rule:'mergeProperties spreads ...secondary under ...primary, so tourism=* of an absorbed OSM element lands on the Recreation.gov host (only fee, charge, access and amenity keys are guarded, L22-23, L246-249)'},
  B:{file:'scripts/merge_campsite_data.js',line:223,rule:"type falls back to secondary.type when the primary has no listed type. The audit placed this in data-quality.js near L223. The lending happens in the snapshot merge"},
  C:{file:'data-quality.js',line:230,rule:"mergeFeatures promotes an unverified_camping_record to campsite when a merged record is a campsite, and copies its type when the host type is 'other'"},
  L182:{file:'data-loader.js',line:182,rule:'mergeLoaded calls cleanAndDedupeGeoJSON without preferredIds or previousHosts'}
};
const NEW_LINES={A_default:{file:'data-quality.js',line:153},B:{file:'scripts/merge_campsite_data.js',line:246}};
// Own source rows.
const own=new Map();
for(const n of fs.readdirSync(path.join(baseRoot,'data/opencampingmap')).filter(n=>/^[A-Z]{2}\.geojson$/.test(n)))for(const f of H.read(path.join(baseRoot,'data/opencampingmap',n)).features){const p=f.properties;if(p.osm_id!=null&&p.osm_type)own.set(`osm:${p.osm_type}:${p.osm_id}`,p);}
for(const n of fs.readdirSync(BI.dir).filter(n=>/^[A-Z]{2}(?:\(1\))?\.geojson$/.test(n)))for(const f of H.read(path.join(BI.dir,n)).features){const p=f.properties;if(p.facility_id!=null&&!own.has('ridb:'+p.facility_id))own.set('ridb:'+p.facility_id,p);}
for(const {geojson} of BI.collections)for(const f of geojson.features){const p=f.properties;if(/^(usfs|blm)/.test(String(p.id))&&!own.has(p.id))own.set(p.id,p);}
const rows=new Map();for(const {state,geojson} of BI.collections)for(const f of geojson.features){const id=f.properties.id;if(!rows.has(id))rows.set(id,[]);rows.get(id).push({state,p:f.properties});}
// Inherited tourism and lent type rows in the baseline snapshots.
const inh=new Map(),lent=new Map();
for(const [id,list] of rows)for(const {state,p} of list){if((p.source_ids||[]).length<2)continue;const o=own.get(id);if(!o)continue;const mem=p.source_ids.filter(m=>m!==id);
  if(p.tourism!=null&&String(o.tourism??'')!==String(p.tourism))inh.set(id,{state,value:p.tourism,member:mem.find(m=>own.get(m)&&String(own.get(m).tourism)===String(p.tourism))||null});
  if(p.type!=null&&String(o.type??'')!==String(p.type)){const m=mem.find(m=>own.get(m)&&String(own.get(m).type)===String(p.type));if(m)lent.set(id,{state,value:p.type,own:o.type??null,member:m});}}
// Catalogues. Trace L230 promotions.
const tracePatch=s=>{const a="if (p.camping_classification === 'unverified_camping_record' && q.camping_classification === 'campsite') {";if(!s.includes(a))throw new Error('trace anchor');return s.replace(a,a+"__trace({p:p.id,q:q.id,q_ev:q.camping_evidence,q_type:q.type,p_type:p.type});");};
const promo={};const tr=k=>r=>{promo[k]=promo[k]||new Map();if(!promo[k].has(r.p))promo[k].set(r.p,r);};
const load=(file,v,k)=>H.loadDQ(file,{patch:s=>V[v](k?tracePatch(s):s),trace:k?tr(k):null});
const cat={};
cat.base=H.catalogue(load(bfile,'base','base'),BI).features;
cat.A=H.catalogue(load(bfile,'A','A'),BI).features;
cat.AC=H.catalogue(load(bfile,'AC'),BI).features;
cat.C=H.catalogue(load(bfile,'C'),BI).features;
cat.cand=H.catalogue(load(nfile,'base'),NI).features;
const M={};for(const k in cat)M[k]=new Map(cat[k].map(f=>[f.properties.id,f]));
const resolver=fs_=>{const m=new Map();for(const f of fs_)m.set(f.properties.id,f.properties.id);for(const f of fs_)for(const a of f.properties.legacy_ids||[])if(!m.has(a))m.set(a,f.properties.id);return m;};
const RES={};for(const k in cat)RES[k]=resolver(cat[k]);
const idx=new Map(BI.idx.map(s=>[s.id,s])),nidx=new Map(NI.idx.map(s=>[s.id,s]));
// Browser runtime identity (data-loader.js L182): each state loaded alone, and all 50 in alphabetical order.
const DQb=load(bfile,'base'),DQn=load(nfile,'base');
const singleState=new Map(),singleStateN=new Map();
for(const c of BI.collections)singleState.set(c.state,resolver(H.catalogue(DQb,BI,{browser:true,statesOrder:[c]}).features));
for(const c of NI.collections)singleStateN.set(c.state,resolver(H.catalogue(DQn,NI,{browser:true,statesOrder:[c]}).features));
const allStates=resolver(H.catalogue(DQb,BI,{browser:true}).features),allStatesN=resolver(H.catalogue(DQn,NI,{browser:true}).features);
// Catalogue-wide scope of the L182 identity gap.
const scope={listings:idx.size,all_states_loaded:{canonical_differs:0,unresolvable:0,examples:[]},single_state_loads:{listing_state_pairs:0,canonical_differs:0,unresolvable:0,listings_affected:0,examples:[]}};
{const aff=new Set();for(const [id,s] of idx){const ids=[id,...s.legacy_ids];const b=allStates.get(id);if(b===undefined)scope.all_states_loaded.unresolvable++;else if(b!==id){scope.all_states_loaded.canonical_differs++;if(scope.all_states_loaded.examples.length<12)scope.all_states_loaded.examples.push({index_id:id,browser_id:b});}
  for(const st of s.states){scope.single_state_loads.listing_state_pairs++;const r=singleState.get(st).get(id);if(r===undefined)scope.single_state_loads.unresolvable++;else if(r!==id){scope.single_state_loads.canonical_differs++;aff.add(id);if(scope.single_state_loads.examples.length<12)scope.single_state_loads.examples.push({index_id:id,state:st,browser_id:r});}}}
 scope.single_state_loads.listings_affected=aff.size;}
// Group membership.
const ids=f=>[f.properties.id,...(f.properties.legacy_ids||[])];
const A=new Set(cat.base.filter(f=>ids(f).some(x=>inh.has(x))).map(f=>f.properties.id));
const B=new Set(cat.base.filter(f=>ids(f).some(x=>lent.has(x))).map(f=>f.properties.id));
const Cnow=new Set([...(promo.base||new Map()).keys()].filter(id=>M.base.has(id)));
const CafterA=new Set([...M.base.keys()].filter(id=>M.A.has(id)&&!M.AC.has(id)));
const C=new Set([...Cnow,...CafterA]);
const Aguard={removed:[...M.base.keys()].filter(id=>!M.A.has(id)),surfaced:[...M.A.keys()].filter(id=>!M.base.has(id)),type:[],alias:[]};
for(const [id,f] of M.base){const a=M.A.get(id);if(!a)continue;if(a.properties.type!==f.properties.type)Aguard.type.push(id);if(JSON.stringify(a.properties.legacy_ids)!==JSON.stringify(f.properties.legacy_ids))Aguard.alias.push(id);}
const Aout=new Set([...Aguard.removed,...Aguard.type,...Aguard.alias]);
const surfacedFrom=new Map(Aguard.surfaced.map(s=>[s,RES.base.get(s)]));
// Records: every listing whose outcome a group rule decides, plus all of B and C.
const affected=new Set([...Aout,...B,...C,...[...M.base.keys()].filter(id=>M.cand.get(id)?.properties.type!==M.base.get(id).properties.type)]);
const contributionsChecked={source:'https://kamptrail.com/api/community-discovery.php (production, read 2026-10-31)',published_reviews_sitewide:0,note:'Production reports 0 published community reviews, so 0 observations and 0 published photos (photos join to reviews by review_id). Pending or rejected submissions and api/submit.php corrections are not exposed publicly and were not checked. No local database with contributions exists in the repo (tests/api.test.js creates a throwaway SQLite database).'};
const rec=[];
for(const id of [...affected].sort()){
  const f=M.base.get(id),p=f.properties,s=idx.get(id),cand=M.cand.get(id),cp=cand?.properties;
  const groups=[A.has(id)&&'A',B.has(id)&&'B',C.has(id)&&'C'].filter(Boolean);
  const snap=[...new Set(ids(f))].flatMap(x=>(rows.get(x)||[]).map(r=>({state:r.state,row_id:x,source_ids:r.p.source_ids||[x],tourism:r.p.tourism??null,type:r.p.type??null,access_hold:r.p.access_hold||null})));
  const absorbed=[...new Set([...snap.flatMap(r=>r.source_ids),...(s?.legacy_ids||[])])].filter(x=>x!==id).sort();
  const o=own.get(id)||{};
  const ownEv={record_id:id,source:id.split(':')[0],name:o.name??null,own_type:o.type??null,own_tourism:o.tourism??null,own_camping_activity:o.camping_activity??null,
    own_classification:DQb.classifyCampingRecord({...o,tourism:id.startsWith('ridb:')?undefined:o.tourism},String(o.name||'')).camping_classification};
  const borrowed=[];
  for(const x of ids(f)){if(inh.has(x))borrowed.push({field:'tourism',value:inh.get(x).value,on_row:x,member_id:inh.get(x).member,state:inh.get(x).state});if(lent.has(x))borrowed.push({field:'type',value:lent.get(x).value,on_row:x,member_id:lent.get(x).member,state:lent.get(x).state});}
  const pr=promo.base?.get(id)||promo.A?.get(id);
  if(pr)borrowed.push({field:'camping_classification',value:'campsite ('+pr.q_ev+')',member_id:pr.q,member_type:pr.q_type,same_facility_id:pr.q.split(':').pop()===id.split(':').pop(),applies:Cnow.has(id)?'now':'only after group A guard'});
  const rules=[];
  if(A.has(id)){rules.push(LINES.A_inherit);if(Aguard.type.includes(id)||(cp&&cp.type!==p.type&&!B.has(id)))rules.push(LINES.A_default);if(Aguard.removed.includes(id))rules.push(LINES.A_admission);}
  if(B.has(id))rules.push(LINES.B);if(C.has(id))rules.push(LINES.C);
  const bAll=allStates.get(id)??null,bOwn=Object.fromEntries((s?.states||[]).map(st=>[st,singleState.get(st).get(id)??null]));
  const nAll=allStatesN.get(id)??null,nOwn=Object.fromEntries((nidx.get(id)?.states||[]).map(st=>[st,singleStateN.get(st).get(id)??null]));
  const proposedType=cp?cp.type:null,implemented=!!cp&&cp.type!==p.type;
  let action,questions=[];
  if(B.has(id)){action=`Implemented: type ${p.type} -> ${proposedType}. The own Recreation.gov record says ${o.type}. The lent type came from ${lent.get(id)?.member||borrowed.find(b=>b.field==='type')?.member_id}. Publication unchanged: own facility name is camping evidence.`;}
  else if(Aguard.removed.includes(id)){action=implemented?`Implemented: type ${p.type} -> ${proposedType} (own record type 'other'). Publication kept unchanged: the only campsite tag is borrowed, but removing it would unpublish the listing. Owner decides.`:`Unchanged. Own record type '${o.type}'. The only campsite tag is borrowed. A blanket guard would unpublish it. Owner decides.`;
    questions.push('Unpublish, keep, or admit on the Recreation.gov listing itself? Its only campsite tag is borrowed from '+(borrowed.find(b=>b.field==='tourism')?.member_id||'?')+'.');
    const sf=[...surfacedFrom].find(([,h])=>h===id);if(sf)questions.push(`If unpublished, absorbed element ${sf[0]} would publish under its own id. Keep it as a legacy_id of ${id}, or publish it separately with ${id} as its legacy_id?`);
    if(/lookout/i.test(p.name))questions.push('Name says lookout (lodging). Is this an overnight camping listing at all?');}
  else if(Aguard.type.includes(id)){action=`Implemented: type ${p.type} -> ${proposedType}. Own Recreation.gov type is '${o.type}'. 'Campground' came only from the inherited tourism tag. Publication unchanged.`;}
  else if(Aguard.alias.includes(id)){action='Unchanged. The blanket guard would drop alias '+(p.legacy_ids.filter(x=>!(M.A.get(id)?.properties.legacy_ids||[]).includes(x)).join(', '))+' because its host stops matching. Narrow fix keeps the alias.';questions.push('None if the narrow fix is accepted. A blanket guard would need these aliases carried forward.');}
  else if(C.has(id)){action='Unchanged. Published only because of the L230 promotion by '+(pr?.q||'?')+(pr&&pr.q.split(':').pop()===id.split(':').pop()?' (same facility id: exact identity).':' (name and 300 m match).');
    questions.push(Cnow.has(id)?'Accept the agency record as camping evidence for this listing, or require it on the listing\'s own record?':'Currently published on a borrowed tourism tag. Under the blanket A guard it would depend on this promotion instead.');
    if(pr&&pr.p_type==='other')questions.push(`Type '${p.type}' is copied from ${pr.q} (L230). Keep, or show the own type 'other'?`);}
  else action='Unchanged.';
  rec.push({canonical_id:id,name:p.name,states:s?.states||[],groups,absorbed_source_ids:absorbed,
    own_evidence:ownEv,borrowed_evidence:borrowed,
    current:{type:p.type,status:'published',camping_evidence:p.camping_evidence},
    proposed:{type:proposedType,status:cand?'published':'unpublished',implemented},
    blanket_guard_outcome:{status:M.A.has(id)?'published':'unpublished',type:M.A.get(id)?.properties.type??null,aliases:M.A.get(id)?.properties.legacy_ids??null},
    rules,
    identity:{index_id:id,legacy_ids:s?.legacy_ids||[],candidate_index_id:nidx.has(id)?id:null,candidate_legacy_ids:nidx.get(id)?.legacy_ids||null,
      browser_runtime_all_states:bAll,browser_runtime_own_state:bOwn,candidate_browser_all_states:nAll,candidate_browser_own_state:nOwn,
      saved_link_resolves_index:RES.cand.get(id)===id&&(s?.legacy_ids||[]).every(a=>RES.cand.get(a)===id),
      saved_link_resolves_browser:[nAll,...Object.values(nOwn)].every(v=>v!==null),
      browser_matches_index:[nAll,...Object.values(nOwn)].every(v=>v===id)},
    contributions:{published_reviews:0,published_observations:0,published_photos:0,keyed_by:'community_reviews.campsite_id (= listing id), photos via review_id',checked:'production public endpoint; pending submissions not checked'},
    recommended_action:action,open_questions:questions});
}
// Venn over the published listings in each group.
const inter=(...s)=>[...s[0]].filter(x=>s.slice(1).every(t=>t.has(x)));
const venn={A_inherited_tourism:A.size,A_outcome_changes:Aout.size,B_lent_type:B.size,C_promoted:C.size,C_promoted_now:Cnow.size,C_promoted_only_after_A_guard:CafterA.size,
  'A∩B':inter(A,B).length,'A∩C':inter(A,C).length,'B∩C':inter(B,C).length,'A∩B∩C':inter(A,B,C).length,
  'A only':[...A].filter(x=>!B.has(x)&&!C.has(x)).length,'B only':[...B].filter(x=>!A.has(x)&&!C.has(x)).length,'C only':[...C].filter(x=>!A.has(x)&&!B.has(x)).length,
  'A∪B∪C':new Set([...A,...B,...C]).size,'A_outcome∩C':inter(Aout,C).length,'A_outcome∪B∪C':new Set([...Aout,...B,...C]).size,records_in_table:rec.length,
  A_inter_C_ids:inter(A,C)};
const proposal=rec.filter(r=>r.proposed.implemented).map(r=>({id:r.canonical_id,field:'type',from:r.current.type,to:r.proposed.type,groups:r.groups}));
const out={version:1,candidate:'tourism-type-admission',baseline_commit:require('child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:baseRoot,encoding:'utf8'}).trim(),
  blanket_guard:{removed:Aguard.removed.length,surfaced:Aguard.surfaced.map(s=>({id:s,currently_alias_of:surfacedFrom.get(s)})),type_shifts:Aguard.type.length,type_shift_kinds:Aguard.type.reduce((a,id)=>{const k=M.base.get(id).properties.type+'->'+M.A.get(id).properties.type;a[k]=(a[k]||0)+1;return a;},{}),aliases_lost:Aguard.alias.length},
  venn,proposal,contributions_checked:contributionsChecked,identity_gap_L182:scope,records:rec};
fs.writeFileSync(path.join(root,'docs/candidates/tourism-type-admission.json'),JSON.stringify(out,null,1)+'\n');
const q=v=>{const s=v==null?'':typeof v==='string'?v:JSON.stringify(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
const cols=['canonical_id','name','states','groups','absorbed_source_ids','own_type','own_tourism','own_classification','borrowed','current_type','proposed_type','current_status','proposed_status','implemented','blanket_guard_status','blanket_guard_type','rules','index_id','legacy_ids','browser_all_states','browser_own_state','saved_link_resolves_index','saved_link_resolves_browser','browser_matches_index','published_reviews','published_photos','recommended_action','open_questions'];
const csv=[cols.join(',')].concat(rec.map(r=>[r.canonical_id,r.name,r.states.join(' '),r.groups.join(' '),r.absorbed_source_ids.join(' '),r.own_evidence.own_type,r.own_evidence.own_tourism,r.own_evidence.own_classification,r.borrowed_evidence.map(b=>`${b.field}=${b.value} from ${b.member_id}`).join('; '),r.current.type,r.proposed.type,r.current.status,r.proposed.status,r.proposed.implemented,r.blanket_guard_outcome.status,r.blanket_guard_outcome.type,r.rules.map(x=>x.file+':'+x.line).join(' '),r.identity.index_id,r.identity.legacy_ids.join(' '),r.identity.candidate_browser_all_states,Object.entries(r.identity.candidate_browser_own_state).map(([k,v])=>k+'='+v).join(' '),r.identity.saved_link_resolves_index,r.identity.saved_link_resolves_browser,r.identity.browser_matches_index,0,0,r.recommended_action,r.open_questions.join(' | ')].map(q).join(',')));
fs.writeFileSync(path.join(root,'docs/candidates/tourism-type-admission.csv'),csv.join('\n')+'\n');
console.log(JSON.stringify({venn,blanket_guard:out.blanket_guard,proposal:proposal.length,proposal_kinds:proposal.reduce((a,r)=>(a[r.from+'->'+r.to]=(a[r.from+'->'+r.to]||0)+1,a),{}),identity_gap_L182:{...scope,all_states_loaded:{...scope.all_states_loaded,examples:undefined},single_state_loads:{...scope.single_state_loads,examples:undefined}},records_browser_mismatch:rec.filter(r=>!r.identity.browser_matches_index).length,records_unresolved:rec.filter(r=>!r.identity.saved_link_resolves_index||!r.identity.saved_link_resolves_browser).length},null,1));
