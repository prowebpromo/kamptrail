const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const crypto=require('node:crypto');
const {mockServices}=require('./helpers/services-fixture');
test.use({serviceWorkers:'block'});
const ATTR='Contains information from OpenStreetMap, © OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0.';
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
const ft=(f,i=0)=>Math.round((f*12+i)*25.4);
function candidate(id,coords,over={}){
  const c={id:`osm:way:${id}`,osm_type:'way',osm_id:String(id),osm_version:3,edited_at:'2026-09-01T00:00:00Z',state:'CO',geometry:{type:'LineString',coordinates:coords},tags:{maxheight:`13'6"`},context:{name:'Test underpass <img src=x>',highway:'secondary'},restriction_on:'way',structure:[],
    metres:{maxheight:4.1148},inches:{maxheight:162},parse:{maxheight:'numeric'},status:'numeric_only',comparable:true,min_inches:162,min_metres:4.1148,plausibility:'ok',reasons:[],applies_to:'road_below',applies_to_evidence:['way_is_tunnel'],...over};
  if(!c.comparable){delete c.min_inches;delete c.min_metres;}return c;
}
const low=candidate(111,[[-105.0,40.0],[-104.998,40.0]]);
const suspect=candidate(222,[[-105.0,40.002],[-104.998,40.002]],{status:'suspect',comparable:false,plausibility:'suspect',reasons:['bare_number_likely_feet'],tags:{maxheight:'13'},metres:{maxheight:13},inches:{maxheight:511.81},context:{name:'Suspect bridge',highway:'residential'}});
function dataset(list){
  const xs=list.flatMap(c=>c.geometry.coordinates),bbox=[Math.min(...xs.map(p=>p[0])),Math.min(...xs.map(p=>p[1])),Math.max(...xs.map(p=>p[0])),Math.max(...xs.map(p=>p[1]))];
  const tile=Buffer.from(JSON.stringify({version:3,schema:'kamptrail-clearances-3',kind:'clearance_candidates',license:'ODbL-1.0',attribution:ATTR,tile:{z:12,x:853,y:1551,part:1,parts:1},bbox,candidates:list}));
  const manifest={version:3,schema:'kamptrail-clearances-3',kind:'clearance_candidates_manifest',license:'ODbL-1.0',copyright_url:'https://www.openstreetmap.org/copyright',attribution:ATTR,states_protected:{RI:{status:'protected'}},
    sources:{CO:{extract_timestamp:'2026-10-30T21:24:51Z',retrieved_at:'2026-10-31T21:44:17Z'}},tiles:[{path:'tiles/12-853-1551.json',z:12,x:853,y:1551,part:1,parts:1,bbox,bytes:tile.length,records:list.length,sha256:crypto.createHash('sha256').update(tile).digest('hex')}]};
  return {tile,manifest};
}
const profile=heightMm=>({format:'kamptrail-rig-profile',schemaVersion:1,id:'50c56c9d-7bbc-4d5e-8d4b-84049e903313',name:'Test rig',createdAt:'2026-10-30T12:00:00.000Z',updatedAt:'2026-10-30T12:00:00.000Z',displayUnits:{length:'ft',weight:'lb'},rig:{category:'all',travelLengthMm:null,campsiteFitLengthMm:null,heightMm,widthMm:null,weightKg:null},campsite:{cost:'all',type:'all',amenities:[],hookups:[],includeUnknownLength:false}});
async function setup(page,context,{rig=ft(13,6),zoom=15,tamper=false,reports=[]}={}){
  const calls={manifest:0,tiles:0,reports:0,ri:0},errors=[];page.on('request',r=>{if(r.url().includes('/data/clearances/RI.json'))calls.ri++;});page.on('pageerror',e=>errors.push(e.message));
  await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));
  const {tile,manifest}=dataset([low,suspect]);
  await page.route('**/data/clearances/index.json',r=>{calls.manifest++;return r.fulfill({contentType:'application/json',body:JSON.stringify(manifest)});});
  await page.route('**/data/clearances/tiles/*.json',r=>{calls.tiles++;const b=Buffer.from(tile);if(tamper)b[b.length-3]^=1;return r.fulfill({contentType:'application/json',body:b});});
  await page.route('**/api/clearance-reports.php*',r=>{calls.reports++;return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,version:1,source:'moderated_visitor_reports',reports,truncated:false})});});
  const json=(r,d)=>r.fulfill({contentType:'application/json',body:JSON.stringify(d)});
  await page.route('**/data/campsites/index.json',r=>json(r,{states:[],total_sites:0}));
  await page.route('**/data/campsites/agency/index.json',r=>json(r,{version:1,states:[]}));
  await page.route('**/data/campsites/ridb-sites.json',r=>json(r,{version:1,facilities:{}}));
  // Seed once per tab, so a reload keeps the profile the test changed.
  await page.addInitScript(({zoom,p})=>{if(sessionStorage.getItem('kt-test-seeded'))return;sessionStorage.setItem('kt-test-seeded','1');localStorage.setItem('kt_last_position',JSON.stringify({lat:40.001,lng:-104.999,zoom}));if(p)localStorage.setItem('kt_rig_profile_v1',JSON.stringify(p));},{zoom,p:rig?profile(rig):null});
  await page.goto('/');await page.waitForFunction(()=>window.KampTrailClearances&&window.map);return {calls,errors};
}
async function show(page){
  await page.getByRole('button',{name:'Map layers',exact:true}).press('Enter');
  const box=page.getByLabel('Clearance candidates (OpenStreetMap)',{exact:true});if(!await box.isChecked()){await box.focus();await box.press('Space');}await expect(box).toBeChecked();
  await page.locator('#map').click({position:{x:2,y:40}});
}
async function openCandidate(page,id){const control=page.locator('.kt-clearance-control');await control.getByLabel('Clearance candidate in view').selectOption(id);await control.getByRole('button',{name:'Open selected candidate'}).click();const popup=page.locator('.kt-clearance-popup');await expect(popup).toBeVisible();return popup;}
for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
  test(`${viewport.name}: opt-in national layer, equal rig height is a conflict, suspect stays uncompared, ODbL credit shown`,async({page,context})=>{
    await page.setViewportSize(viewport);const {calls,errors}=await setup(page,context);
    expect(calls.manifest+calls.tiles).toBe(0);await show(page);
    const control=page.locator('.kt-clearance-control');
    await expect(control).toContainText('2 clearance candidates in view: 1 conflict with your rig height, 1 need checking or unknown');
    await expect(control).toContainText('Unmapped hazards are unknown');await expect(control).not.toContainText('Rhode Island');expect(calls.ri).toBe(0);// RI.json is read only for views that touch RI
    await expect(control.locator('.kt-odbl')).toContainText('Open Database Licence');
    await expect(control.getByRole('link',{name:'OpenStreetMap copyright and licence'})).toHaveAttribute('href','https://www.openstreetmap.org/copyright');
    await expect(page.locator('.leaflet-control-attribution')).toContainText('© OpenStreetMap contributors, ODbL');
    expect(await control.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
    let popup=await openCandidate(page,'osm:way:111');
    await expect(popup).toContainText('Test underpass <img src=x>');await expect(popup.locator('img')).toHaveCount(0);
    await expect(popup.locator('.kt-clearance-verdict')).toContainText(`Conflict: tagged clearance 13'6" equals your rig height 13'6". Equal is not clear.`);
    await expect(popup).toContainText('Map view only: not matched to any route');await expect(popup).toContainText('2026-10-30T21:24:51Z');
    await expect(popup.locator('.kt-odbl')).toContainText('Open Database Licence');
    await expect(popup.getByRole('link',{name:'OpenStreetMap source object'})).toHaveAttribute('href','https://www.openstreetmap.org/way/111');
    expect((await new AxeBuilder({page}).include('.kt-clearance-popup').analyze()).violations).toEqual([]);
    await page.getByRole('button',{name:'Close popup',exact:true}).click();
    popup=await openCandidate(page,'osm:way:222');
    await expect(popup).toContainText('Value needs checking');await expect(popup.locator('.kt-clearance-verdict')).toContainText('Not compared with your rig height');
    await expect(popup).toContainText('bare_number_likely_feet');
    await page.getByRole('button',{name:'Close popup',exact:true}).click();
    expect((await new AxeBuilder({page}).include('.kt-clearance-control').analyze()).violations).toEqual([]);
    expect(errors).toEqual([]);
  });
}
// Codex review: the visible layer, the selector and the counts stay in sync while a popup is open.
const ourLayers=page=>page.evaluate(()=>{let n=0;map.eachLayer(l=>{if(typeof l.ktClearanceId==='string')n++;});return n;});
for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
  test(`${viewport.name}: zooming below 10 with a popup open closes it and clears markers, selector and counts together`,async({page,context})=>{
    await page.setViewportSize(viewport);const {calls,errors}=await setup(page,context);await show(page);const control=page.locator('.kt-clearance-control');
    await expect(control).toContainText('2 clearance candidates in view');expect(await ourLayers(page)).toBe(2);
    await openCandidate(page,'osm:way:111');
    await page.evaluate(()=>map.setZoom(8,{animate:false}));
    await expect(page.locator('.kt-clearance-popup')).toHaveCount(0);
    await expect(control).toContainText('Zoom to level 10 or closer');await expect.poll(()=>ourLayers(page)).toBe(0);
    await expect(control.getByLabel('Clearance candidate in view').locator('option')).toHaveCount(0);await expect(control.getByRole('button',{name:'Open selected candidate'})).toBeDisabled();
    const tilesBefore=calls.tiles;await page.evaluate(()=>map.setZoom(15,{animate:false}));await expect(control).toContainText('2 clearance candidates in view');expect(await ourLayers(page)).toBe(2);expect(calls.tiles).toBeGreaterThanOrEqual(tilesBefore);
    expect(errors).toEqual([]);
  });
  test(`${viewport.name}: changing rig height with a popup open keeps that record's popup and updates its verdict and the counts`,async({page,context})=>{
    await page.setViewportSize(viewport);const {errors}=await setup(page,context);await show(page);const control=page.locator('.kt-clearance-control');
    await expect(control).toContainText('1 conflict with your rig height');
    const popup=await openCandidate(page,'osm:way:111');await expect(popup.locator('.kt-clearance-verdict')).toContainText('Equal is not clear');
    await page.getByRole('button',{name:'Open rig profile',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Rig profile',exact:true});await expect(dialog).toBeVisible();
    await page.locator('#kt-rig-heightMm').fill('13');await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.locator('#kt-rig-status')).toContainText('Saved on this device');
    await page.getByRole('button',{name:'Close rig profile',exact:true}).click();
    await expect(popup).toBeVisible();await expect(popup.locator('.kt-clearance-verdict')).toContainText(`is higher than your rig height 13'0" by 6"`);
    await expect.poll(()=>control.locator('[role=status]').textContent()).toContain('0 conflict with your rig height');
    expect(await ourLayers(page)).toBe(2);await expect(control.getByLabel('Clearance candidate in view')).toHaveValue('osm:way:111');
    expect(errors).toEqual([]);
  });
}
test('rig comparison below and above, and without a saved rig height',async({page,context})=>{
  await setup(page,context,{rig:ft(14)});await show(page);
  let popup=await openCandidate(page,'osm:way:111');await expect(popup.locator('.kt-clearance-verdict')).toContainText(`Conflict: tagged clearance 13'6" is lower than your rig height 14'0" by 6"`);
  await page.getByRole('button',{name:'Close popup',exact:true}).click();
  await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('kt_rig_profile_v1'));p.rig.heightMm=Math.round(13*12*25.4);localStorage.setItem('kt_rig_profile_v1',JSON.stringify(p));});
  await page.reload();await page.waitForFunction(()=>window.KampTrailClearances);await show(page);
  popup=await openCandidate(page,'osm:way:111');await expect(popup.locator('.kt-clearance-verdict')).toContainText(`is higher than your rig height 13'0" by 6"`);await expect(popup).toContainText('does not establish passage');
  await page.getByRole('button',{name:'Close popup',exact:true}).click();
  await page.evaluate(()=>localStorage.removeItem('kt_rig_profile_v1'));await page.reload();await page.waitForFunction(()=>window.KampTrailClearances);await show(page);
  popup=await openCandidate(page,'osm:way:111');await expect(popup.locator('.kt-clearance-verdict')).toContainText('Save a travel height in your rig profile to compare');
});
test('below zoom 10 nothing is requested; integrity failure shows nothing and says the area is unknown',async({page,context})=>{
  const {calls}=await setup(page,context,{zoom:8});await show(page);const control=page.locator('.kt-clearance-control');
  await expect(control).toContainText('Zoom to level 10 or closer');expect(calls.manifest+calls.tiles+calls.reports).toBe(0);
  await page.evaluate(()=>map.setView([40.001,-104.999],12));await expect(control).toContainText('2 clearance candidates in view');expect(calls.tiles).toBe(1);
  const page2=await context.newPage();const s2=await setup(page2,context,{tamper:true});await show(page2);
  await expect(page2.locator('.kt-clearance-control')).toContainText('1 data tiles failed their integrity check and are not shown; that area is unknown');
  await expect(page2.locator('.kt-clearance-control')).toContainText('0 clearance candidates in view');expect(s2.calls.tiles).toBe(1);
});
test('moderated visitor reports display separately and the report form posts to the moderation queue',async({page,context})=>{
  const reports=[{id:7,lat:40.0015,lng:-104.9985,posted:`12'9"`,hundredths:15300,observed_on:'2026-10-20',published_at:'2026-10-21T10:00:00Z',direction:'one_direction',osm_ref:'osm:way:111'}];
  await setup(page,context,{reports});let sent=null;
  await page.route('**/api/submit.php',r=>{sent=r.request().postDataJSON();return r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,token:'a'.repeat(32),status:'received'})});});
  await show(page);const control=page.locator('.kt-clearance-control');await expect(control).toContainText('1 visitor reports');
  const popup=await openCandidate(page,'report:7');await expect(popup).toContainText(`Posted value: 12'9". Seen 2026-10-20; published 2026-10-21.`);await expect(popup).toContainText('Not compared with your rig height');
  await page.getByRole('button',{name:'Close popup',exact:true}).click();
  await page.waitForTimeout(3100);// the shared spam control requires time on the form
  await control.getByRole('button',{name:'Report a posted clearance'}).click();const d=page.getByRole('dialog',{name:'Report a posted clearance'});
  await d.getByLabel('Posted clearance on the sign').fill('12 ft');await d.getByRole('button',{name:'Send for moderation'}).click();await expect(d).toContainText(`Enter the posted height as 13'6" or 4.1 m.`);expect(sent).toBe(null);
  await d.getByLabel('Posted clearance on the sign').fill(`12'9"`);await d.getByLabel('Date you saw it').fill('2026-10-20');await d.getByLabel('Applies to').selectOption('one_direction');
  await d.getByLabel('Where is the sign and what is it on?').fill('Rail bridge over Main St, northbound.');await d.getByLabel('I saw this sign myself',{exact:false}).check();
  expect((await new AxeBuilder({page}).include('#kt-clearance-report').analyze()).violations).toEqual([]);
  await page.evaluate(()=>{const n=Date.now;Date.now=()=>n()+5000;});
  await d.getByRole('button',{name:'Send for moderation'}).click();await expect(d).toContainText('A moderator will review it');
  expect(sent.kind).toBe('clearance');expect(sent.clearance).toEqual({posted:`12'9"`,observed_on:'2026-10-20',direction:'one_direction',osm_ref:null});expect(sent.firsthand).toBe(true);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('kt_reports_v1'))[0].kind)).toBe('clearance');
});
const riPilot=require('../../data/clearances/RI.json');
for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
  test(`${viewport.name}: Rhode Island keeps its pilot records, and is unknown only when RI.json is missing or invalid`,async({page,context})=>{
    test.setTimeout(120000);
    // Each scenario is a fresh page in the same browser context, so Cache Storage carries over as it does between visits.
    async function open(p,state){
      await p.setViewportSize(viewport);
      await p.route('**/data/clearances/RI.json',r=>{state.calls++;if(state.mode==='missing')return r.fulfill({status:404,body:'missing'});const d=structuredClone(riPilot);if(state.mode==='invalid')d.source.sha256='bad';return r.fulfill({contentType:'application/json',body:JSON.stringify(d)});});
      const out=await setup(p,context,{zoom:12});await p.evaluate(()=>map.setView([41.8240,-71.4128],13));await show(p);return {...out,control:p.locator('.kt-clearance-control')};
    }
    const fresh=async mode=>{const p=await context.newPage(),state={mode,calls:0};return {p,state,...await open(p,state)};};
    const a={p:page,state:{mode:'valid',calls:0}};Object.assign(a,await open(page,a.state));
    await expect(a.control).toContainText(/Rhode Island: [1-9]\d* pilot records with raw tags only \(extract 2026-10-28\); not compared/);
    await expect(a.control).not.toContainText('Saved snapshot');await expect(a.control).not.toContainText('Not in this dataset');expect(a.state.calls).toBe(1);
    const first=await a.control.getByLabel('Clearance candidate in view').locator('option').first().getAttribute('value');
    const popup=await openCandidate(page,first);await expect(popup).toContainText('Rhode Island pilot record');await expect(popup.locator('.kt-clearance-verdict')).toContainText('Not compared with your rig height');
    await expect(popup).toContainText(riPilot.source.extract_timestamp);await expect(popup.locator('.kt-odbl')).toContainText('Open Database Licence');
    await page.getByRole('button',{name:'Close popup',exact:true}).click();
    // As in 2.34.0: a failed refresh keeps the validated copy, labelled as a saved snapshot.
    a.state.mode='missing';await a.control.getByRole('button',{name:'Retry clearance data'}).click();
    await expect(a.control).toContainText(/Saved snapshot\. Rhode Island: [1-9]\d* pilot records/);expect(a.state.calls).toBe(2);
    // A new visit with a missing or invalid file uses the validated saved copy.
    for(const mode of ['missing','invalid']){const b=await fresh(mode);await expect(b.control).toContainText(/Saved snapshot\. Rhode Island: [1-9]\d* pilot records/);expect(b.errors).toEqual([]);await b.p.close();}
    // With no valid saved copy, Rhode Island is unknown.
    await page.evaluate(async()=>{for(const k of await caches.keys())if(k.endsWith(':clearance-v1'))await caches.delete(k);});
    for(const mode of ['missing','invalid']){const c=await fresh(mode);await expect(c.control).toContainText('Rhode Island pilot data is missing or failed validation; Rhode Island is unknown.');await expect(c.control).not.toContainText('pilot records with raw tags');expect(c.errors).toEqual([]);await c.p.close();}
    expect(a.errors).toEqual([]);
  });
}
test.describe('RI offline copy with the service worker in control',()=>{
  test.use({serviceWorkers:'allow'});
  for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
    test(`${viewport.name}: an offline RI view uses the saved, validated RI.json with its original dates and a saved-snapshot label`,async({page,context})=>{
      test.setTimeout(120000);await page.setViewportSize(viewport);const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));
      await page.addInitScript(()=>{if(sessionStorage.getItem('kt-ri-seeded'))return;sessionStorage.setItem('kt-ri-seeded','1');localStorage.setItem('kt_last_position',JSON.stringify({lat:41.824,lng:-71.4128,zoom:13}));});
      await page.goto('/');await page.waitForFunction(()=>window.KampTrailClearances&&window.map);
      await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});
      await show(page);const control=page.locator('.kt-clearance-control');
      await expect(control).toContainText(/Rhode Island: [1-9]\d* pilot records with raw tags only \(extract 2026-10-28\); not compared/);await expect(control).not.toContainText('Saved snapshot');
      await expect.poll(()=>page.evaluate(async()=>{const k=(await caches.keys()).find(n=>n.endsWith(':clearance-v1'));return !!k&&!!(await (await caches.open(k)).match(new URL('data/clearances/RI.json',location.href).href));})).toBe(true);
      await context.setOffline(true);await page.reload();await page.waitForFunction(()=>window.KampTrailClearances&&window.map);
      expect(await page.evaluate(()=>!!navigator.serviceWorker.controller&&!navigator.onLine)).toBe(true);
      await show(page);
      await expect(control).toContainText(/Saved snapshot\. Rhode Island: [1-9]\d* pilot records with raw tags only \(extract 2026-10-28\); not compared/);
      await expect(control).toContainText('National clearance data unavailable; outside Rhode Island this view is unknown.');
      const first=await control.getByLabel('Clearance candidate in view').locator('option').first().getAttribute('value');
      const popup=await openCandidate(page,first);await expect(popup).toContainText('Saved snapshot. OpenStreetMap extract 2026-10-28T21:21:02Z; downloaded 2026-10-30T16:30:30Z.');await expect(popup).toContainText('Rhode Island pilot record');
      await page.getByRole('button',{name:'Close popup',exact:true}).click();
      // A tampered saved copy fails validation on read and RI becomes unknown.
      await page.evaluate(async()=>{const k=(await caches.keys()).find(n=>n.endsWith(':clearance-v1')),c=await caches.open(k),u=new URL('data/clearances/RI.json',location.href).href,d=await (await c.match(u)).json();d.source.sha256='bad';await c.put(u,new Response(JSON.stringify(d),{headers:{'content-type':'application/json'}}));});
      await page.reload();await page.waitForFunction(()=>window.KampTrailClearances&&window.map);await show(page);
      await expect(control).toContainText('Rhode Island pilot data is missing or failed validation; Rhode Island is unknown.');
      await context.setOffline(false);expect(errors).toEqual([]);
    });
  }
});

test.describe('RI saved label after the connection drops, without a reload',()=>{
  for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
    test(`${viewport.name}: the same tab relabels the RI copy as a saved snapshot when it goes offline`,async({page,context})=>{
      await page.setViewportSize(viewport);
      await page.route('**/data/clearances/RI.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(riPilot)}));
      const {errors}=await setup(page,context,{zoom:12});await page.evaluate(()=>map.setView([41.8240,-71.4128],13));await show(page);const control=page.locator('.kt-clearance-control');
      await expect(control).toContainText(/Rhode Island: [1-9]\d* pilot records/);await expect(control).not.toContainText('Saved snapshot');
      const first=await control.getByLabel('Clearance candidate in view').locator('option').first().getAttribute('value');
      let popup=await openCandidate(page,first);await expect(popup).not.toContainText('Saved snapshot');await page.getByRole('button',{name:'Close popup',exact:true}).click();
      await context.setOffline(true);
      await expect(control).toContainText(/Saved snapshot\. Rhode Island: [1-9]\d* pilot records/);
      popup=await openCandidate(page,first);await expect(popup).toContainText('Saved snapshot. OpenStreetMap extract '+riPilot.source.extract_timestamp);
      await page.getByRole('button',{name:'Close popup',exact:true}).click();
      // A further redraw offline keeps the label: the store, not only the screen, holds the saved status.
      await control.getByRole('button',{name:'Retry clearance data'}).click();await expect(control).not.toContainText('Loading clearance candidates');await expect(control).toContainText(/Saved snapshot\. Rhode Island: [1-9]\d* pilot records/);
      await context.setOffline(false);await expect(control).not.toContainText('Saved snapshot');expect(errors).toEqual([]);
    });
  }
});
