#!/usr/bin/env node
'use strict';
// Applies the owner decisions of 2026-11-01 to the 72 reviewed facilities and records the result.
// Reads the committed RIDB evidence (observed), the baseline catalogue (current labels on main), this checkout's
// candidate catalogue (proposed labels) and the reviewer recommendations. Writes
// docs/tourism/owner-decisions-2026-11-01.json and prints Markdown tables for the candidate document.
// Fails when the build does not match a decision. Read-only on data.
//   node scripts/tourism-type-admission/owner-decisions.js --baseline=/unchanged/main/checkout [--markdown=out.md]
const H=require('./harness'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const arg=n=>process.argv.slice(2).find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const root=path.resolve(__dirname,'../..'),baseRoot=path.resolve(arg('baseline')||'');
if(!arg('baseline')||baseRoot===root)throw new Error('Use --baseline=/unchanged/main/checkout');
const rel='docs/tourism/ridb-facility-evidence-2026-11-01.json';
const evidenceBytes=fs.readFileSync(path.join(root,rel));
const evidence=JSON.parse(evidenceBytes),request=H.read(path.join(root,'docs/tourism/ridb-evidence-request-2026-11-01.json'));
const review=H.read(path.join(root,'docs/tourism/fresh-evidence-review-2026-11-01.json')).records;
const independent=H.read(path.join(root,'docs/candidates/tourism-independent-source-review.json')).records;
const base=new Map(H.catalogue(H.loadDQ(path.join(baseRoot,'data-quality.js')),H.inputs(baseRoot)).features.map(f=>[f.properties.id,f]));
const cand=new Map(H.catalogue(H.loadDQ(path.join(root,'data-quality.js')),H.inputs(root)).features.map(f=>[f.properties.id,f]));
const problems=[];
const metres=(a,b)=>{const r=Math.PI/180,x=Math.sin((b[1]-a[1])*r/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin((b[0]-a[0])*r/2)**2;return 2*6371000*Math.asin(Math.sqrt(x));};
const nameKind=n=>/\b(?:dispersed|primitive|yellow\s+post)\b/i.test(n)?'dispersed':/\bbackcountry\b/i.test(n)?'backcountry':'established';
const LABEL={established:'Campground',dispersed:'Dispersed',backcountry:'Backcountry',parking:'Overnight parking',lodging:'Lodging',other:'Other'};
const rows=[];
for(const [group,ids] of Object.entries(request.groups))for(const id of ids){
  const e=evidence.facilities[id.slice(5)],b=base.get(id),n=cand.get(id);
  const f=e?.fields||{},c=e?.campsites||{};
  // Observed: copied from the evidence file. Derived: computed here.
  const observed={status:e?.status??'missing',facility_type_description:f.FacilityTypeDescription??null,last_updated:f.LastUpdatedDate??null,retrieved_at:e?.retrieved_at??null,
    facility_name:f.FacilityName??null,enabled:f.Enabled??null,reservable:f.Reservable??null,point:f.FacilityLongitude!=null?[f.FacilityLongitude,f.FacilityLatitude]:null,
    campsites_overnight:c.overnight??null,campsites_total:c.total??null,by_type_of_use:c.by_type_of_use||{},by_campsite_type:c.by_campsite_type||{}};
  const empty=observed.status!=='ok'||!observed.facility_name||!observed.facility_type_description||!observed.point;
  const own=b?.properties.name??n?.properties.name??null,pt=(b||n)?.geometry.coordinates;
  const distance=observed.point&&pt?Math.round(metres(pt,observed.point)*10)/10:null;
  const identity=!empty&&String(f.FacilityID)===id.slice(5)&&observed.enabled===true&&observed.facility_name===own&&distance!=null&&distance<=1;
  const cabins=Object.keys(observed.by_campsite_type).length>0&&Object.keys(observed.by_campsite_type).every(k=>/^CABIN\b/.test(k));
  const current=b?b.properties.type:null,proposed=n?n.properties.type:null;
  let decision,action,expect;
  if(empty||!identity){decision='pending_record_empty_or_contradictory';action='unchanged, decision pending';expect=current;}
  else if(group==='withdrawal_9'){decision='keep_discoverable_pending_withdrawal_review';action='stays listed, pending-review notice, label held';expect=current;}
  else if(group==='downgrade_22'||group==='downgrade_4'){decision='deferred_label_held';action='label held, review pending';expect=current;}
  else if(group==='upgrade_27'){const k=nameKind(observed.facility_name);
    if(current==='other'){decision='approved_upgrade';action=`Other → ${LABEL[k]}`;expect=k;}else{decision='failed_check_unchanged';action='unchanged';expect=current;}}
  else if(group==='lodging_10'){const r=independent[id]?.evidence_result||'';
    if(r.startsWith('lodging_supported')&&cabins&&observed.campsites_overnight>0){decision='approved_lodging';action=`${LABEL[current]} → Lodging`;expect='lodging';}
    else if(/^(reject|hold)_lodging$/.test(r)){decision='approved_lodging_rejection';action=`stays ${LABEL[current]}`;expect=current;}
    else{decision='pending_record_empty_or_contradictory';action='unchanged, decision pending';expect=current;}}
  if(!n)problems.push({id,problem:'not published in the candidate'});
  else if(proposed!==expect)problems.push({id,problem:'type',expected:expect,actual:proposed});
  if(n&&group==='withdrawal_9'&&n.properties.camping_evidence!=='proposed_withdrawal_pending_review')problems.push({id,problem:'pending withdrawal notice missing'});
  if(n&&(group==='withdrawal_9'||group.startsWith('downgrade'))&&n.properties.type_evidence?.kind!=='held_published_label')problems.push({id,problem:'held label not recorded'});
  if(id==='ridb:233178'&&n?.properties.own_closure_notice?.status!=='temporarily closed')problems.push({id,problem:'closure notice lost'});
  if(id==='ridb:252494'&&!(n?.properties.kt_accommodation==='cabins'&&n?.properties.ridb_overnight_sites>1))problems.push({id,problem:'multi-cabin record not distinguished'});
  const r=review[id];
  rows.push({id,group,name:own,observed,derived:{record_empty:empty,identity_confirmed:identity,point_distance_m:distance,name_kind:group==='upgrade_27'?nameKind(observed.facility_name||''):undefined,cabin_records_only:group==='lodging_10'?cabins:undefined},
    current:{label:current,classification:b?.properties.camping_classification??null,evidence:b?.properties.camping_evidence??null},
    candidate:{label:proposed,classification:n?.properties.camping_classification??null,evidence:n?.properties.camping_evidence??null,type_evidence:n?.properties.type_evidence?.kind??null,
      closure_notice:n?.properties.own_closure_notice??null,accommodation:n?.properties.kt_accommodation??null,overnight_records:n?.properties.ridb_overnight_sites??null},
    decision,action,reason:r?.reason||independent[id]?.evidence_note||null,recommendation:r?{action:r.recommendation,label:r.recommended_label}:null});
}
const count=k=>rows.reduce((a,r)=>(a[r[k]]=(a[r[k]]||0)+1,a),{});
const out={version:1,decided:'2026-11-01 08:16 and 08:18 (owner)',evidence:{file:rel,sha256:crypto.createHash('sha256').update(evidenceBytes).digest('hex'),run:'https://github.com/prowebpromo/kamptrail/actions/runs/41350953975',retrieved_at:evidence.retrieved_at},
  baseline_commit:require('child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:baseRoot,encoding:'utf8'}).trim(),
  observed_fields:'observed.* copied from the evidence file; derived.*, decision and action computed by this script; current.* from the baseline catalogue; candidate.* from this build',
  by_decision:count('decision'),problems,records:rows};
fs.writeFileSync(path.join(root,'docs/tourism/owner-decisions-2026-11-01.json'),JSON.stringify(out,null,1)+'\n');
// Markdown tables, one per group.
const cell=v=>String(v??'').replace(/\|/g,'\\|');
const sites=o=>o.campsites_total?`${o.campsites_overnight}/${o.campsites_total} overnight (${Object.entries(o.by_campsite_type).map(([k,v])=>`${k} ${v}`).join(', ')})`:'none';
const md=[];
for(const g of Object.keys(request.groups)){
  md.push(`#### ${g}\n`,'| ID | Name | Raw type | LastUpdatedDate | retrieved_at | Campsite records | Current label | Build | Recommendation | Reason |','| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for(const r of rows.filter(x=>x.group===g))md.push('| '+[r.id,r.name,r.observed.facility_type_description,r.observed.last_updated,r.observed.retrieved_at,sites(r.observed),LABEL[r.current.label],r.action,r.recommendation?`${r.recommendation.action.replace(/_/g,' ')}${r.recommendation.label?' ('+LABEL[r.recommendation.label]+')':''}`:'',r.reason].map(cell).join(' | ')+' |');
  md.push('');
}
if(arg('markdown'))fs.writeFileSync(path.resolve(arg('markdown')),md.join('\n'));
console.log(JSON.stringify({by_decision:out.by_decision,problems},null,1));
if(problems.length)process.exitCode=1;
