const {test,expect}=require('@playwright/test');
// Owner decisions of 2026-11-01 (08:16 and 20:24 ET) for the tourism admission candidate (docs/TOURISM_TYPE_ADMISSION_CANDIDATE.md).
// Run against a rebuilt candidate catalogue. In English the popup prints the raw type value (pre-existing on main). Each case opens the real app at #site=<id>, by canonical and legacy id.
const CASES=[
  {id:'ridb:247835',via:['ridb:247835','osm:way:941066426'],name:'Daisy State Park',type:'established',has:['under review for removal from campsite search','label published before this review']},
  {id:'ridb:244404',via:['usfs:18814'],name:'Wakeley Lake Area',type:'dispersed',has:['under review for removal from campsite search']},
  {id:'ridb:255262',via:['ridb:255262'],name:'Wolf Flats Recreation Area',type:'dispersed',not:['under review','label published before this review']},
  {id:'ridb:243218',via:['usfs:30157'],name:'Coleman Lake Recreation Area',type:'established',has:['Camping and this camping type are described in this facility’s own Recreation.gov record.'],not:['label published before this review','type is unverified']},
  {id:'ridb:249902',via:['usfs:74043'],name:'Wolf Gap Recreation Area',type:'established',has:['label published before this review','Its camping type is unverified.']},
  {id:'ridb:240871',via:['usfs:34671'],name:'Enduro Camp',type:'other',has:['This previously listed location is under review.'],not:['label published before this review']},
  {id:'ridb:249627',via:['ridb:249627'],name:'Joe Elliot Yellow Post Sites',type:'dispersed',not:['label published before this review']},
  {id:'ridb:262796',via:['ridb:262796'],name:'Horse Mountain Primitive Camp',type:'other',not:['under review']},
  {id:'ridb:257133',via:['ridb:257133'],name:'Rock Castle Camping Area',type:'established',not:['under review']},
  {id:'ridb:252494',via:['blm-facility:252494'],name:'White Mountains National Recreation Area - Alaska Cabins',type:'lodging',has:['covers 15 cabins','does not locate a particular cabin']},
  {id:'ridb:233178',via:['ridb:233178','usfs:80125'],name:'SHAW HOUSE',type:'lodging',has:['Agency reports: temporarily closed.','Notice dated 2026-09-10.'],not:['Status (agency):','covers']},
  {id:'ridb:234149',via:['ridb:234149'],name:'PICKETT BUTTE LOOKOUT',type:'lodging',not:['covers']},
  {id:'ridb:255240',via:['blm-facility:255240'],name:'Pink House Recreation Site',type:'established',not:['under review']},
  {id:'ridb:234745',via:['ridb:234745'],name:'DESOLATION GRAY CANYONS SCREEN CABINS',type:'established',not:['covers']},
  {id:'ridb:10007101',via:['ridb:10007101'],name:'Large Vehicle Campground',type:'established',not:['under review','label published before']},
  {id:'ridb:10134443',via:['usfs:83462'],name:'Muchwater Dispersed Campground and Recreation Area',type:'dispersed',not:['under review']}
];
for(const [label,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  test.describe(`tourism review popups (${label})`,()=>{
    test.use({serviceWorkers:'block',viewport,isMobile:label==='mobile',hasTouch:label==='mobile'});
    test.setTimeout(900000);
    test('each reviewed listing opens by canonical and legacy id with its decided type and notices',async({browser})=>{
      // A fresh page per case keeps the loaded catalogue small, as a visitor opening one shared link would have it.
      for(const c of CASES){
      const context=await browser.newContext({serviceWorkers:'block',viewport,isMobile:label==='mobile',hasTouch:label==='mobile'}),page=await context.newPage();
      await page.route('**/api/community-discovery.php*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,version:1,revision:'1',checked_at:new Date().toISOString(),next_after:null,sites:{}})}));
      await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:-10,lng:-140,zoom:9})));
      await page.goto('/');
      await page.waitForFunction(()=>window.KampTrailData?.getIdentityStatus?.().hosts==='published');
      for(const id of c.via){
        await page.evaluate(id=>{location.hash='';location.hash='site='+encodeURIComponent(id);},id);
        await expect.poll(()=>page.evaluate(()=>document.querySelector('.leaflet-popup-content h2')?.textContent||''),{timeout:60000,message:id}).toBe(c.name);
        const text=await page.evaluate(()=>document.querySelector('.leaflet-popup-content').textContent.replace(/\s+/g,' '));
        expect(text,id).toContain('Type: '+c.type);
        for(const s of c.has||[])expect(text,id).toContain(s);
        for(const s of c.not||[])expect(text,id).not.toContain(s);
        expect(await page.evaluate(()=>location.hash),id).toBe('#site='+encodeURIComponent(id));
        expect(await page.evaluate(id=>KampTrailData.getCampsiteById(id)?.properties.id,id),id).toBe(c.id);
        // The popup fits the viewport (no horizontal overflow on mobile).
        const box=await page.locator('.leaflet-popup-content-wrapper').boundingBox();
        expect(box.width,id).toBeLessThanOrEqual(viewport.width);
        await page.evaluate(()=>window.map?.closePopup?.());
      }
      await context.close();
      }
    });
  });
}
