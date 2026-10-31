const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const rest=require('../rest-areas.js'),published=JSON.parse(fs.readFileSync('data/rest-areas/TX.json','utf8'));
const clone=()=>structuredClone(published);
const policies=JSON.parse(fs.readFileSync('data/rest-areas/state-policies.json','utf8')),policyNow=Date.parse('2026-11-01T00:00:00Z');
test('all 78 trusted TxDOT locations inherit one dated state policy without changing permission',()=>{
  const d=clone();d.state_policies=policies;assert.equal(new Set(d.records.map(r=>rest.policyFor(r,d,policyNow).policy_id)).size,1);
  for(const r of d.records){const p=rest.policyFor(r,d,policyNow);assert.equal(p.policy_id,'txdot-safety-rest-area-20261030');assert.equal(p.rules.overnight_parking,'unknown');assert.equal(p.rules.sleeping_in_vehicle,'unknown');assert.equal(p.rules.max_stay_hours,24);assert.equal(r.permission,'unknown');}
  assert.match(rest.policyDescription(rest.policyFor(d.records[0],d,policyNow)),/State policy checked 2026-10-30/);
  assert.equal(rest.resolvePolicy(policies,{state:'TX',operator:'private',facility_kind:'safety_rest_area'},policyNow).policy_id,null);
  const mt=rest.resolvePolicy(policies,{state:'MT',operator:'mdt',facility_kind:'rest_area'},policyNow);assert.equal(mt.rules.overnight_parking,'allowed');assert.equal(mt.rules.camping,'prohibited');assert.equal(mt.rules.sleeping_in_vehicle,'unknown');assert.equal(mt.rules.max_stay_hours,12);
});
test('policy expiry, missing evidence and facility conflicts preserve unknowns',()=>{
  const scope={state:'MT',operator:'mdt',facility_kind:'rest_area',facility_id:'test:1'};
  assert.equal(rest.resolvePolicy(null,scope,policyNow).rules.overnight_parking,'unknown');
  assert.equal(rest.resolvePolicy(policies,scope,Date.parse('2027-04-28T23:00:00Z')).rules.overnight_parking,'unknown');
  const p=structuredClone(policies);p.exceptions=[{...scope,sources:p.policies[1].sources,rules:{overnight_parking:'prohibited',max_stay_hours:4}}];
  assert.equal(rest.resolvePolicy(p,scope,policyNow).rules.overnight_parking,'prohibited');assert.equal(rest.resolvePolicy(p,scope,policyNow).rules.max_stay_hours,4);
  p.exceptions[0].rules={camping:'allowed',max_stay_hours:24};const conflict=rest.resolvePolicy(p,scope,policyNow);assert.equal(conflict.rules.camping,'unknown');assert.equal(conflict.rules.max_stay_hours,null);assert.deepEqual(conflict.review_required,['camping','max_stay_hours']);
  const bad=structuredClone(policies);bad.policies[0].sources[0].url='https://evil.example/';assert.throws(()=>rest.validatePolicies(bad,policyNow));
  const duplicate=structuredClone(policies),first=duplicate.policies[0];duplicate.policies.push({...first,id:'duplicate',scope:{operator:first.scope.operator,facility_kind:first.scope.facility_kind,state:first.scope.state}});assert.throws(()=>rest.validatePolicies(duplicate,policyNow));
});
test('official catalogue keeps exact source identities, UTC provenance and unknown permission',()=>{
  const d=rest.validate(clone());assert.equal(d.records.length,78);assert.equal(new Set(d.records.map(r=>r.id)).size,78);assert(d.records.every(r=>r.permission==='unknown'));assert.equal(d.duration_context.maximum_hours,24);assert.equal(d.source.source_updated_at,null);
});
test('parking duration cannot become a permission statement or a fee',()=>{
  const d=clone(),r=d.records[0],f=rest.feature(r,d);assert.match(rest.describe(r,d),/does not establish permission to sleep overnight/);assert.match(rest.describe(r,d),/camping permission remain unknown/);assert.equal(f.properties.type,'spot');assert.equal(f.properties.cost,undefined);assert.equal(f.properties.permission,undefined);assert.equal(f.properties.id,rest.place(r).id);assert.deepEqual(f.geometry.coordinates,rest.place(r).coordinates);
  r.permission='allowed';assert.throws(()=>rest.validate(d),/permission claim/);
});
test('duplicate identity, nonfinite coordinates, malformed dates and hostile source links are rejected',()=>{
  const mutations=[d=>d.records.push(d.records[0]),d=>{d.records[0].coordinates[0]=NaN;},d=>{d.records[0].coordinates=[0,0];},d=>{d.source.retrieved_at='2026-02-30T00:00:00Z';},d=>{d.source.url='https://example.org/';},d=>{d.records[0].source_url='javascript:alert(1)';},d=>{d.duration_context.maximum_hours=48;}];
  for(const mutate of mutations){const d=clone();mutate(d);assert.throws(()=>rest.validate(d));}
});
test('source identity remains distinct from a canonical rounded map spot',()=>{
  const r=published.records[0],p=rest.place(r);assert(p.id.startsWith('spot:'));assert.notEqual(p.id,r.id);assert.equal(rest.place({...r,coordinates:[-97.5623001,30.9001001]}).id,'spot:30.90010,-97.56230');assert(!rest.detail(r.source_url+'?redirect=evil'));
});
test('viewport selection handles the dateline and excludes points outside the requested view',()=>{
  assert(rest.within([-97,31],{west:-100,east:-95,south:30,north:32}));assert(!rest.within([-97,31],{west:-100,east:-95,south:33,north:34}));assert(rest.within([179,50],{west:170,east:-170,south:40,north:60}));assert(!rest.within([0,50],{west:170,east:-170,south:40,north:60}));
});

test('dynamic facility rules are not contradicted by a hard-coded unknown paragraph',()=>{
  const d=clone(),r=d.records[0];d.state_policies=structuredClone(policies);
  const scope={facility_id:r.id,state:'TX',operator:'txdot',facility_kind:'safety_rest_area',sources:d.state_policies.policies[0].sources};
  d.state_policies.exceptions=[{...scope,rules:{overnight_parking:'allowed'}}];
  let description=rest.describe(r,d,policyNow);assert.match(description,/overnight parking Allowed/);assert.doesNotMatch(description,/Overnight permission.*unknown/);assert.match(description,/sleeping in a vehicle Unknown/);
  d.state_policies.exceptions[0].rules.overnight_parking='prohibited';description=rest.describe(r,d,policyNow);assert.match(description,/overnight parking Prohibited/);assert.doesNotMatch(description,/Overnight permission.*unknown/);
  delete d.state_policies.exceptions;assert.match(rest.describe(r,d,policyNow),/overnight parking Unknown/);
});


test('five additional exact policy scopes preserve unknown durations, sleeping and other operators',()=>{
  const additions=[['FL','florida_turnpike','turnpike_service_plaza','prohibited','unknown'],['ID','itd','safety_rest_area','unknown','prohibited'],['OH','odot','rest_area_or_roadside_park','unknown','prohibited'],['OR','odot','safety_rest_area','unknown','prohibited'],['VA','vdot','rest_area','prohibited','prohibited']];
  assert.equal(policies.policies.length,15);
  for(const[state,operator,facility_kind,parking,camping]of additions){
    const scope={state,operator,facility_kind},p=rest.resolvePolicy(policies,scope,policyNow);
    assert.equal(p.rules.overnight_parking,parking);assert.equal(p.rules.camping,camping);assert.equal(p.rules.sleeping_in_vehicle,'unknown');assert.equal(p.rules.max_stay_hours,null);assert.equal(p.current_opening,'unknown');assert.ok(p.sources.length);
    assert.equal(rest.resolvePolicy(policies,{...scope,operator:'unmatched_agency'},policyNow).policy_id,null);assert.equal(rest.resolvePolicy(policies,{...scope,facility_kind:'unmatched_class'},policyNow).policy_id,null);
    assert.equal(rest.resolvePolicy(policies,scope,Date.parse('2027-04-29T00:00:00Z')).policy_id,null);
  }
  for(const[state,operator]of [['NE','ndot'],['GA','gdot']])assert.equal(rest.resolvePolicy(policies,{state,operator,facility_kind:'safety_rest_area'},policyNow).policy_id,null);
});
test('eight location-only scopes keep every permission unknown',()=>{
  for(const[state,operator,facility_kind]of [['CA','caltrans','safety_roadside_rest_area'],['IA','iowa_dot','rest_area'],['IN','indot','rest_area_or_welcome_center'],['KS','kdot','rest_area'],['MI','mdot','rest_area_or_welcome_center'],['NV','ndot','rest_area'],['SD','sddot','rest_area'],['WA','wsdot','safety_rest_area']]){
    const p=rest.resolvePolicy(policies,{state,operator,facility_kind},policyNow);
    assert.ok(p.policy_id);assert.deepEqual([p.rules.overnight_parking,p.rules.sleeping_in_vehicle,p.rules.camping],['unknown','unknown','unknown']);assert.equal(p.rules.max_stay_hours,null);assert.deepEqual(p.rules.conditions,[]);
  }
});
test('new policy sources accept the audited URL and reject other pages or parameters on that publisher',()=>{
  for(let i=2;i<policies.policies.length;i++)for(const suffix of ['?download=1','#fragment','/unreviewed']){
    const bad=structuredClone(policies);bad.policies[i].sources[0].url+=suffix;assert.throws(()=>rest.validatePolicies(bad,policyNow));
  }
});

// ---- Official locations beyond Texas ----
const index=JSON.parse(fs.readFileSync('data/rest-areas/index.json','utf8'));
const region=code=>Object.assign(structuredClone(JSON.parse(fs.readFileSync(`data/rest-areas/${code}.json`,'utf8'))),{state_policies:policies});
test('every published region validates against its exact publisher and inherits only its own scoped policy',()=>{
  rest.validateIndex(index);assert.ok(index.regions.some(x=>x.region==='TX'));
  for(const {region:code} of index.regions){
    const d=region(code),g=rest.REGIONS[code];rest.validate(d);
    assert.equal(d.records.length,index.regions.find(x=>x.region===code).records);
    for(const r of d.records){
      assert.equal(r.permission,'unknown');assert.equal(r.state,code);
      const p=rest.policyFor(r,d,policyNow),expected=policies.policies.find(x=>x.scope.state===code&&x.scope.operator===g.operator&&x.scope.facility_kind===g.facility_kind);
      assert.equal(p.policy_id,expected?expected.id:null);
      for(const a of ['overnight_parking','sleeping_in_vehicle','camping'])assert.equal(p.rules[a],expected?expected.rules[a]:'unknown');
    }
    if(code!=='TX'){const text=rest.describe(d.records[0],d,policyNow);assert.match(text,/does not establish permission to park or sleep overnight/);assert.match(text,new RegExp(g.publisher));}
  }
});
test('region manifest and catalogues reject unreviewed regions, borrowed scopes and permission claims',()=>{
  for(const bad of [{version:1,regions:[{region:'ZZ',file:'ZZ.json'}]},{version:1,regions:[{region:'TX',file:'../x.json'}]},{version:1,regions:[{region:'TX',file:'TX.json'},{region:'TX',file:'TX.json'}]},{version:1,regions:[]}])assert.throws(()=>rest.validateIndex(bad));
  const other=index.regions.find(x=>x.region!=='TX');if(!other)return;const code=other.region;
  const mutations=[d=>{d.operator='txdot';},d=>{d.facility_kind='rest_area_x';},d=>{d.source.url='https://example.com/rest';},d=>{d.records[0].permission='allowed';},d=>{d.records[0].state='TX';},d=>{d.records[0].source_url='https://evil.example/';},d=>{d.records[0].coordinates=[-97.5,30.9];},d=>{d.records.push(d.records[0]);},d=>{d.records[0].source_updated_at='2026-02-30T00:00:00Z';},d=>{d.duration_context={maximum_hours:24};}];
  for(const m of mutations){const d=region(code);m(d);assert.throws(()=>rest.validate(d));}
});
test('a saved rest-area stop keeps its coordinate identity in every region',()=>{
  for(const {region:code} of index.regions){const d=region(code),r=d.records[0],f=rest.feature(r,d);assert.equal(f.properties.id,rest.place(r).id);assert.match(f.properties.id,/^spot:-?\d+\.\d{5},-?\d+\.\d{5}$/);assert.equal(f.properties.source,rest.REGIONS[code].publisher);}
  const tx=region('TX');assert.equal(rest.feature(tx.records[0],tx).properties.source,'Texas Department of Transportation');
});
