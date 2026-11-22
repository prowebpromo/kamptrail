const {chromium} = require('playwright');
(async () => {
  const assert = require('node:assert/strict');
  const expectedSnapshot = process.env.EXPECTED_SNAPSHOT;
  assert.match(expectedSnapshot,/^[a-f0-9]{24}$/);
  let indexResponse, index;
  for(let attempt=0;attempt<2;attempt++){
    indexResponse = await fetch('https://kamptrail.com/api/forecast.php?kind=index',{cache:'no-store'});
    index = await indexResponse.json();
    if(indexResponse.status===200 && index.manifest?.snapshot_id===expectedSnapshot) break;
    if(attempt===1 || ![200,503].includes(indexResponse.status)) break;
    const wait=Number(indexResponse.headers.get('retry-after')||900);
    if(!Number.isFinite(wait) || wait<1 || wait>900) break;
    console.log('Waiting for normal forecast cache refresh; first public status',indexResponse.status);
    await new Promise(resolve=>setTimeout(resolve,(wait+2)*1000));
  }
  console.log('READER',JSON.stringify({status:indexResponse.status,ok:index.ok,error:index.error,generated:index.manifest?.generated_at,expires:index.manifest?.expires_at,serverNow:index.server_now,snapshot:index.manifest?.snapshot_id}));
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
    assert.equal(indexResponse.status, 200);
    assert.equal(index.ok, true);
    assert.equal(index.manifest.snapshot_id, expectedSnapshot);
    assert.ok(Date.parse(index.manifest.expires_at) > Date.parse(index.server_now));
    assert.equal(visitor.ready, true);
    assert.ok(visitor.states.includes('NY'));
    assert.equal(visitor.error, '');
    const catalog=await (await fetch('https://kamptrail.com/data/campsites/coordinate-index.json')).json();
    for(const slot of ['current-a.json','current-b.json']){
      const r=await fetch('https://github.com/prowebpromo/kamptrail/releases/download/forecast-data-v1/'+slot,{headers:{'Cache-Control':'no-cache','User-Agent':'KampTrail forecast status check'}});
      if(!r.ok){console.log('POINTER',JSON.stringify({slot,status:r.status}));continue;}
      const m=await r.json(),now=Date.now();
      console.log('POINTER',JSON.stringify({slot,status:r.status,snapshot:m.snapshot_id,generated:m.generated_at,expires:m.expires_at,ageMinutes:Math.round((now-Date.parse(m.generated_at))/60000),fresh:now<Date.parse(m.expires_at),currentCatalogue:m.catalogue_sha256===catalog.sha256}));
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
