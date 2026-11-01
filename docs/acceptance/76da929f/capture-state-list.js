const {chromium}=require('/home/claude/kamptrail/node_modules/playwright');
(async()=>{const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const p=await (await b.newContext({serviceWorkers:'block'})).newPage();
const t0=new Date().toISOString();await p.goto('https://kamptrail.com/?n='+Date.now());await p.waitForFunction(()=>window.KampTrailData&&KampTrailData.getStateBounds);
const r=await p.evaluate(()=>({version:KampTrailData.version,states:Object.keys(KampTrailData.getStateBounds())}));
const rel=await (await fetch('https://kamptrail.com/release.json?n='+Date.now())).json();
console.log(JSON.stringify({captured_at_utc:t0,release:rel,...r}));await b.close();})();
