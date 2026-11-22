const {chromium} = require('playwright');
(async () => {
  const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    const seen=[];
    page.on('response', async response => {
      const u=new URL(response.url());
      if(u.origin!=='https://kamptrail.com' || u.pathname!=='/api/forecast.php') return;
      const summary={kind:u.searchParams.get('kind'),status:response.status()};
      if(summary.kind==='index') {
        try {
          const value=await response.json(), m=value.manifest || {};
          Object.assign(summary,{code:value.error,notice:value.message,snapshot:m.snapshot_id,serverNow:value.server_now,generated:m.generated_at,expires:m.expires_at});
        }catch{summary.format='not JSON';}
      }
      seen.push(summary);
    });
    await page.goto('https://kamptrail.com/#explore',{waitUntil:'domcontentloaded',timeout:90000});
    await page.waitForFunction(()=>typeof window.KampTrailForecast?.ensureStates==='function');
    const visitor=await page.evaluate(async()=>{
      await KampTrailForecast.ensureStates(['NY']);
      return {message:KampTrailForecast.statusText(),...KampTrailForecast.status()};
    });
    console.log('VISITOR',JSON.stringify(visitor));
    console.log('PUBLIC_READER',JSON.stringify(seen));
    const catalog=await (await fetch('https://kamptrail.com/data/campsites/coordinate-index.json')).json();
    for(const slot of ['current-a.json','current-b.json']){
      const r=await fetch('https://github.com/prowebpromo/kamptrail/releases/download/forecast-data-v1/'+slot,{headers:{'Cache-Control':'no-cache','User-Agent':'KampTrail forecast status check'}});
      if(!r.ok){console.log('POINTER',JSON.stringify({slot,status:r.status}));continue;}
      const m=await r.json(),now=Date.now();
      console.log('POINTER',JSON.stringify({slot,status:r.status,snapshot:m.snapshot_id,generated:m.generated_at,expires:m.expires_at,ageMinutes:Math.round((now-Date.parse(m.generated_at))/60000),fresh:now<Date.parse(m.expires_at),currentCatalogue:m.catalogue_sha256===catalog.sha256}));
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
