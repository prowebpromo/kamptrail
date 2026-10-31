const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default,fs=require('node:fs'),path=require('node:path');
test.use({serviceWorkers:'block'});
const read=n=>fs.readFileSync(path.resolve(__dirname,'../../'+n),'utf8'),script=read('route-clearance.js'),validator=read('clearances.js'),css=read('app.css'),data=JSON.parse(read('data/clearances/RI.json')),item=data.records[0],point=item.geometry.type==='Point'?item.geometry.coordinates:item.geometry.coordinates[0];
item.tags['maxheight:conditional']='3 m @ (wet)';const raw=JSON.stringify(data);
async function fixture(page,{far=false,delay}={}){await page.route('**/clearance-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Height evidence</title></head><body><main><button id="open">Open mapped heights</button></main></body></html>'}));await page.route('**/data/clearances/RI.json',async r=>{if(delay)await delay();await r.fulfill({contentType:'application/json',body:raw}).catch(()=>{});});await page.goto('/clearance-fixture');await page.addStyleTag({content:css});await page.addScriptTag({content:validator});await page.addScriptTag({content:script});await page.evaluate(({far,point})=>{const coords=far?[[-72,40],[-71.99,40]]:[point,[point[0]+.00001,point[1]]];document.querySelector('#open').onclick=()=>KampTrailRouteClearance.open({geometry:{type:'LineString',coordinates:coords}});},{far,point});await page.locator('#open').click();}
test('raw tags, dated OSM link, named dialog and scoped accessibility',async({page})=>{await fixture(page);const d=page.getByRole('dialog',{name:'Mapped height tags near route'});await expect(d).toContainText('maxheight: '+item.tags.maxheight);await expect(d).toContainText('maxheight:conditional: 3 m @ (wet)');await expect(d).toContainText('2026-10-28');await expect(d.getByRole('link',{name:new RegExp('View OSM '+item.osm_type+' '+item.osm_id)})).toHaveAttribute('href',`https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}`);expect((await new AxeBuilder({page}).include('#kt-route-clearance').analyze()).violations).toEqual([]);});
test('no nearby result remains unknown, not clear',async({page})=>{await fixture(page,{far:true});const d=page.getByRole('dialog',{name:'Mapped height tags near route'});await expect(d).toContainText('0 mapped feature(s)');await expect(d).toContainText('No match does not mean a route is clear');});
test('delayed results are discarded after itinerary changes',async({page})=>{let release,requested;const pending=new Promise(r=>requested=r);await fixture(page,{delay:()=>{requested();return new Promise(r=>release=r);}});await pending;await page.evaluate(()=>window.dispatchEvent(new Event('kamptrail:tripchanged')));release();const d=page.getByRole('dialog',{name:'Mapped height tags near route'});await expect(d).toContainText('itinerary changed');await expect(d.getByText('maxheight:',{exact:false})).toHaveCount(0);});
test('dialog text follows the selected language and stays English by default',async({page})=>{
  await page.route('**/clearance-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="fr"><head><title>Hauteurs</title></head><body><main><button id="open">Ouvrir</button></main></body></html>'}));
  await page.route('**/data/clearances/RI.json',r=>r.fulfill({contentType:'application/json',body:raw}));
  await page.goto('/clearance-fixture');await page.evaluate(()=>localStorage.setItem('kt_language','fr'));
  for(const f of ['locale-fr.js','locale.js'])await page.addScriptTag({content:read(f)});
  await page.addStyleTag({content:css});await page.addScriptTag({content:validator});await page.addScriptTag({content:script});
  await page.evaluate(()=>{document.querySelector('#open').onclick=()=>KampTrailRouteClearance.open({geometry:{type:'LineString',coordinates:[[-72,40],[-71.99,40]]}});});
  await page.locator('#open').click();
  const d=page.getByRole('dialog',{name:'Étiquettes de hauteur cartographiées près de l’itinéraire'});
  await expect(d.getByRole('button',{name:'Fermer',exact:true})).toBeVisible();
  await expect(d).toContainText('L’absence de correspondance ne signifie pas que l’itinéraire est sans obstacle.');
  await expect(d).not.toContainText('Searches optional Rhode Island');
});
