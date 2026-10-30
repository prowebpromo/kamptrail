const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
test.use({serviceWorkers:'block'});
const id='abcdefghijk',token='d'.repeat(64);
async function setup(page,context,{spanish=false,publication=true,slow=false}={}){
 const external=[],sent=[];let checks=0,release;
 await context.route(/^https:\/\//,r=>{
  if(new URL(r.request().url()).hostname.includes('youtube')){external.push(r.request().url());return r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture player</title></head><body><main><h1>Fixture player</h1></main></body></html>'});}
  return r.abort();
 });
 const review={id:1,campsite_id:'qa:video',campsite_name:'Original visitor place',display_name:'Original Name',rating:4,body:'Original visitor words <script>alert(1)</script>',visited_on:'2026-10-01',created_at:'2026-10-02',status:'published',observations:{noise:'quiet',scores:{quietness:4}},photos:[],video:{provider:'youtube',id,url:'https://www.youtube.com/watch?v='+id}};
 await page.route('**/api/community.php*',async r=>{
  const req=r.request();
  if(req.method()==='POST'){sent.push(req.postData());return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,id:1,token,status:'pending'})});}
  if(new URL(req.url()).searchParams.has('review_id')){
   checks++;if(slow)await new Promise(resolve=>{release=resolve;});
   return r.fulfill({status:publication?200:404,contentType:'application/json',body:JSON.stringify(publication?{ok:true,review_id:1,video:review.video}:{ok:false})});
  }
  const out=req.headers().authorization?{ok:true,review}:{ok:true,count:1,average:4,reviews:[review],next_before:null,scores_available:true,seasonal_scores:{}};
  return r.fulfill({contentType:'application/json',body:JSON.stringify(out)});
 });
 await page.addInitScript(({spanish,token})=>{localStorage.setItem('kt_language',spanish?'es':'en');localStorage.setItem('kt_reviews_v1',JSON.stringify([{name:'Original visitor place',token}]));},{spanish,token});
 await page.goto('/');
 const open=()=>page.evaluate(()=>KampTrailCommunity.open({properties:{id:'qa:video',name:'Original visitor place'}}));await open();
 return{external,sent,checks:()=>checks,release:()=>release?.(),open};
}
test('tap checks publication before loading YouTube; closing or leaving the review destroys the player',async({page,context})=>{
 await page.setViewportSize({width:390,height:844});const state=await setup(page,context),dialog=page.locator('#kt-community');
 await expect(dialog).toContainText('Posted and recorded dates are unknown');await expect(dialog).toContainText('Original visitor words <script>alert(1)</script>');await expect(dialog.locator('script')).toHaveCount(0);
 await expect(dialog.locator('iframe')).toHaveCount(0);await expect(dialog.locator('img')).toHaveCount(0);expect(state.external).toEqual([]);expect(state.checks()).toBe(0);
 await dialog.getByRole('button',{name:'Play video',exact:true}).click();const frame=dialog.locator('iframe');await expect(frame).toHaveAttribute('src','https://www.youtube-nocookie.com/embed/'+id+'?autoplay=1');expect(state.checks()).toBe(1);await expect(frame).toHaveAttribute('title','Visitor video on YouTube');expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 expect((await new AxeBuilder({page}).include('#kt-community').analyze()).violations).toEqual([]);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('.kt-video-player')).toHaveCount(0);
 await state.open();await dialog.getByRole('button',{name:'Play video',exact:true}).click();await expect(frame).toHaveCount(1);await dialog.getByRole('button',{name:'Report review',exact:true}).click();await expect(page.locator('.kt-video-player')).toHaveCount(0);
});
test('unpublished or offline checks never start a third-party player',async({page,context})=>{
 const state=await setup(page,context,{publication:false}),dialog=page.locator('#kt-community');await dialog.getByRole('button',{name:'Play video',exact:true}).click();await expect(dialog).toContainText('Video could not be verified');await expect(dialog.locator('iframe')).toHaveCount(0);expect(state.external).toEqual([]);
 await context.setOffline(true);await dialog.getByRole('button',{name:'Play video',exact:true}).click();await expect(dialog.locator('iframe')).toHaveCount(0);expect(state.external).toEqual([]);
});
test('a publication response arriving after navigation cannot create an orphan player',async({page,context})=>{
 const state=await setup(page,context,{slow:true}),dialog=page.locator('#kt-community');await dialog.getByRole('button',{name:'Play video',exact:true}).click();await expect.poll(state.checks).toBe(1);await dialog.getByRole('button',{name:'Write a review',exact:true}).click();state.release();await expect(dialog).toContainText('Your experience');await expect(dialog.locator('iframe')).toHaveCount(0);expect(state.external).toEqual([]);
});
test('Spanish edit UI preserves visitor words and explicitly removes a saved video',async({page,context})=>{
 const state=await setup(page,context,{spanish:true}),dialog=page.locator('#kt-community');await expect(dialog).toContainText('Video de un visitante');await expect(dialog).toContainText('Original visitor words');await expect(dialog.getByRole('button',{name:'Reproducir video',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Mis reseñas',exact:true}).click();await dialog.locator('li button').click();await dialog.getByRole('button',{name:'Editar reseña',exact:true}).click();const input=dialog.getByLabel('Video de YouTube (opcional)',{exact:true});await expect(input).toHaveValue(id);await expect(dialog.getByLabel('Tu experiencia',{exact:true})).toHaveValue('Original visitor words <script>alert(1)</script>');await dialog.getByRole('button',{name:'Quitar el video adjunto',exact:true}).click();await expect(input).toHaveValue('');
 await dialog.getByLabel(/Esta es mi experiencia/).check();await dialog.getByRole('button',{name:'Guardar y reenviar',exact:true}).click();await expect(dialog).toContainText('pendientes de moderación');expect(state.sent[0]).toContain('name="youtube_video"\r\n\r\n\r\n');expect(state.sent[0]).toContain('Original visitor words');expect(state.sent[0]).toContain('"quietness":4');expect(state.external).toEqual([]);
});
