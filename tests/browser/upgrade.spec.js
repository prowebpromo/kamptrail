const {test,expect}=require('@playwright/test');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'../..');

test('an existing stale worker upgrades automatically without asking the visitor to clear caches',async({page})=>{
  let legacy=true;
  const oldWorker=`self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open('kt-v18-safe');await c.addAll(['data-loader.js','data-quality.js','filters.js','trip-planner.js']);await self.skipWaiting()})()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(new URL(e.request.url).origin!==self.location.origin)return;if(e.request.url.endsWith('.js')&&!e.request.url.endsWith('service-worker.js'))e.respondWith(caches.open('kt-v18-safe').then(async c=>(await c.match(e.request))||fetch(e.request)))})`;
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname==='/legacy'){res.setHeader('Content-Type','text/html');res.end('<script>navigator.serviceWorker.register("/service-worker.js")</script>');return;}
      if(pathname==='/service-worker.js'&&legacy){res.setHeader('Content-Type','application/javascript');res.setHeader('Cache-Control','no-store');res.end(oldWorker);return;}
      if(legacy&&['/data-loader.js','/data-quality.js','/filters.js','/trip-planner.js'].includes(pathname)){res.setHeader('Content-Type','application/javascript');res.setHeader('Cache-Control','public, max-age=86400');res.end('/* previously cached module */');return;}
      const file=path.join(root,pathname==='/'?'index.html':pathname);
      const ext=path.extname(file);res.setHeader('Content-Type',ext==='.js'?'application/javascript':ext==='.html'?'text/html':ext==='.css'?'text/css':ext==='.json'||ext==='.geojson'?'application/json':'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(await fs.readFile(file));
    }catch{res.statusCode=404;res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
  try{
    await page.route(/^https:\/\//,r=>r.abort());
    await page.goto(url+'/legacy');
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});
    expect(await page.evaluate(()=>caches.has('kt-v18-safe'))).toBe(true);
    legacy=false;let navigations=0;page.on('framenavigated',f=>{if(f===page.mainFrame())navigations++;});
    await page.goto(url+'/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.KampTrailData?.version==='2.2.1'&&KampTrailData.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading);
    expect(navigations).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#trip')).toContainText('Saved stops');
    await expect(page.locator('#result-summary')).not.toContainText('Updating');
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
