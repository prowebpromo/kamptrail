const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default,crypto=require('node:crypto');
test.use({serviceWorkers:'block'});
const ATTR='Contains information from OpenStreetMap, © OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0.';
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
const ft=(f,i=0)=>Math.round((f*12+i)*25.4);
function candidate(id,coords,over={}){
  const c={id:`osm:way:${id}`,osm_type:'way',osm_id:String(id),osm_version:2,edited_at:'2026-09-01T00:00:00Z',state:'CO',geometry:{type:'LineString',coordinates:coords},tags:{maxheight:`13'6"`},context:{name:'Road '+id,highway:'secondary'},restriction_on:'way',structure:[],
    metres:{maxheight:4.1148},inches:{maxheight:162},parse:{maxheight:'numeric'},status:'numeric_only',comparable:true,min_inches:162,min_metres:4.1148,plausibility:'ok',reasons:[],applies_to:'way_itself',applies_to_evidence:['tag_on_highway_way','highway=secondary'],...over};
  if(!c.comparable){delete c.min_inches;delete c.min_metres;}return c;
}
// Route: three points along y=40; a tagged way on it, a parallel way 45 m north, and the second leg's tile fails integrity.
const onRoad=candidate(500,[[-104.999,40],[-104.997,40]]),parallel=candidate(900,[[-104.999,40.0004],[-104.997,40.0004]]),later=candidate(700,[[-104.985,40],[-104.983,40]]);
function files(){
  const out=new Map(),tiles=[];
  for(const [x,list,corrupt] of [[10,[onRoad,parallel],false],[11,[later],true]]){
    const xs=list.flatMap(c=>c.geometry.coordinates),bbox=[Math.min(...xs.map(p=>p[0])),Math.min(...xs.map(p=>p[1])),Math.max(...xs.map(p=>p[0])),Math.max(...xs.map(p=>p[1]))];
    const raw=Buffer.from(JSON.stringify({version:3,schema:'kamptrail-clearances-3',kind:'clearance_candidates',license:'ODbL-1.0',attribution:ATTR,tile:{z:12,x,y:1,part:1,parts:1},bbox,candidates:list}));
    tiles.push({path:`tiles/12-${x}-1.json`,z:12,x,y:1,part:1,parts:1,bbox,bytes:raw.length,records:list.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')});
    const served=Buffer.from(raw);if(corrupt)served[served.length-3]^=1;out.set(`12-${x}-1.json`,served);
  }
  return {tiles:out,manifest:{version:3,schema:'kamptrail-clearances-3',kind:'clearance_candidates_manifest',license:'ODbL-1.0',copyright_url:'https://www.openstreetmap.org/copyright',attribution:ATTR,tiles,states_protected:{RI:{status:'protected'}},sources:{CO:{extract_timestamp:'2026-10-30T21:24:51Z',retrieved_at:'2026-10-31T21:44:17Z'}}}};
}
const route=osm=>({distance:2000,duration:120,calculated_at:'2026-10-31T12:00:00Z',geometry:{type:'LineString',coordinates:[[-105,40],[-104.99,40],[-104.98,40]]},legs:[{distance:2000,duration:120}],leg_ends:[2],...(osm?{osm}:{})});
const profile={format:'kamptrail-rig-profile',schemaVersion:1,id:'50c56c9d-7bbc-4d5e-8d4b-84049e903313',name:'Test rig',createdAt:'2026-10-30T12:00:00.000Z',updatedAt:'2026-10-30T12:00:00.000Z',displayUnits:{length:'ft',weight:'lb'},rig:{category:'all',travelLengthMm:null,campsiteFitLengthMm:null,heightMm:ft(13,6),widthMm:null,weightKg:null},campsite:{cost:'all',type:'all',amenities:[],hookups:[],includeUnknownLength:false}};
const stop=(id,lng,lat)=>({type:'Feature',geometry:{type:'Point',coordinates:[lng,lat]},properties:{id,name:id,type:'spot',fee_status:'unknown'}});
async function setup(page,context,{osm=null,delay=null}={}){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));
  const {tiles,manifest}=files();
  await page.route('**/data/clearances/index.json',async r=>{if(delay)await delay();await r.fulfill({contentType:'application/json',body:JSON.stringify(manifest)}).catch(()=>{});});
  await page.route('**/data/clearances/tiles/*.json',r=>r.fulfill({contentType:'application/json',body:tiles.get(r.request().url().split('/').pop())}));
  await context.route('**/api/route.php',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,route:route(osm)})}));
  await page.addInitScript(({p,stops})=>{localStorage.setItem('kt_last_position',JSON.stringify({lat:40,lng:-104.99,zoom:12}));localStorage.setItem('kt_rig_profile_v1',JSON.stringify(p));localStorage.setItem('kt_trip',JSON.stringify(stops.map(feature=>({id:feature.properties.id,feature,note:'',arrive:'',depart:''}))));},{p:profile,stops:[stop('Start',-105,40),stop('End',-104.98,40)]});
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.KampTrailRouteClearance&&window.KampTrailTrip);
  await page.getByRole('button',{name:'Open saved stops',exact:true}).click();await page.getByRole('button',{name:'Calculate road route',exact:true}).click();
  await expect(page.locator('#kt-trip-summary')).toContainText('driving');await page.getByRole('button',{name:'Clearance candidates along route',exact:true}).click();
  return {errors,dialog:page.getByRole('dialog',{name:'Clearance candidates along route'})};
}
for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
  test(`${viewport.name}: a route without OSM identity shows nearby candidates as unresolved and missing segments, never clear`,async({page,context})=>{
    await page.setViewportSize(viewport);const {dialog,errors}=await setup(page,context);
    await expect(dialog.getByRole('status')).toContainText('On the driven road: 0 (0 conflict with your rig height, 0 need checking or unknown). Nearby, road unresolved: 2.');
    await expect(dialog.getByRole('status')).toContainText('This is not a clear-route result');
    await expect(dialog).toContainText('This route has no OSM road identity, so no candidate can be tied to the driven road');
    const unresolved=dialog.locator('.kt-route-clearance-unresolved');await expect(unresolved.locator('article')).toHaveCount(2);await expect(unresolved).toContainText('Road association: unresolved (route_has_no_way_ids)');
    await expect(unresolved).toContainText('Not counted against this route');
    await expect(dialog.locator('.kt-route-clearance-resolved')).toContainText('None identified. This does not mean the road is clear.');
    await expect(dialog.locator('.kt-route-clearance-missing')).toContainText('Segments 1 to 2');await expect(dialog.locator('.kt-route-clearance-missing')).toContainText('data failed its integrity check');
    await expect(dialog.locator('.kt-odbl')).toContainText('Open Database Licence');await expect(dialog.getByRole('link',{name:'OpenStreetMap copyright and licence'})).toHaveAttribute('href','https://www.openstreetmap.org/copyright');
    expect(await dialog.evaluate(e=>e.getBoundingClientRect().right<=innerWidth&&e.scrollWidth<=e.clientWidth+1)).toBe(true);
    expect((await new AxeBuilder({page}).include('#kt-route-clearance').analyze()).violations).toEqual([]);expect(errors).toEqual([]);
  });
}
test('a route carrying OSM way ids resolves the driven road: equal height is a route conflict, the parallel road is not',async({page,context})=>{
  const {dialog}=await setup(page,context,{osm:{way_ids:['500','501']}});
  await expect(dialog.getByRole('status')).toContainText('On the driven road: 1 (1 conflict with your rig height');
  const resolved=dialog.locator('.kt-route-clearance-resolved');await expect(resolved).toContainText('Road 500');await expect(resolved).toContainText('Equal is not clear');await expect(resolved).toContainText('nearby_route_segment_way_id_equals_candidate_way');
  await expect(dialog.locator('.kt-route-clearance-other')).toContainText('Road 900');await expect(dialog.locator('.kt-route-clearance-other')).toContainText('on a different road');
  await expect(dialog.locator('.kt-route-clearance-missing')).toContainText('data failed its integrity check');
});
test('changing the rig profile or itinerary discards a pending result',async({page,context})=>{
  let release,requested;const pending=new Promise(r=>requested=r);
  const {dialog}=await setup(page,context,{delay:()=>{requested();return new Promise(r=>release=r);}});await pending;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kamptrail:rigprofilechanged',{detail:{}})));release();
  await expect(dialog).toContainText('The route, itinerary or rig height changed');await expect(dialog.locator('article')).toHaveCount(0);
});
