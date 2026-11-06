const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function boot({ua='',platform='',touch=0,standalone=false,betaState=null,betaFirst=false}={}){
 const nodes=[],events={},media={matches:standalone,addEventListener:(k,fn)=>events.media=fn};
 function node(tag){const n={tag,children:[],attrs:{},dataset:{},textContent:'',hidden:false,disabled:false,open:false,setAttribute(k,v){this.attrs[k]=v;if(k==='data-i18n')this.dataset.i18n=v;},append(...a){this.children.push(...a);},addEventListener(k,fn){this[k]=fn;},showModal(){this.open=true;},close(){this.open=false;this.closeListener?.();},focus(){this.focused=true;}};n.addEventListener=(k,fn)=>{n[k==='close'?'closeListener':k]=fn;};nodes.push(n);return n;}
 const trigger=node('button'),guide=node('button');const body=node('body');const stored=new Map(betaState?[['kt_beta_use_v1',JSON.stringify(betaState)]]:[]);const c={KampTrailSafety:{request:async()=>true},navigator:{userAgent:ua,platform,maxTouchPoints:touch,standalone},document:{referrer:'',addEventListener(){},createElement:node,getElementById:id=>id==='install-kamptrail'?trigger:null,querySelectorAll:selector=>selector==='[data-install-open]'?[guide]:[],body,activeElement:trigger},location:{search:'',pathname:'/',hash:''},URL,URLSearchParams,crypto:require('node:crypto'),CustomEvent:class{constructor(type){this.type=type;}},localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},sessionStorage:{getItem:()=>null,setItem(){}},matchMedia:()=>media,addEventListener(k,fn){const old=events[k];events[k]=old?event=>{old(event);fn(event);}:fn;},dispatchEvent:event=>events[event.type]?.(event)};c.window=c;const loadBeta=()=>vm.runInNewContext(fs.readFileSync('beta.js','utf8'),c);if(betaFirst)loadBeta();vm.runInNewContext(fs.readFileSync('install.js','utf8'),c);
 const text=()=>nodes.map(n=>n.textContent).join(' '),action=()=>nodes.find(n=>n.textContent==='Install now');return{c,events,nodes,trigger,guide,loadBeta,text,action,open:()=>trigger.click(),dialog:()=>nodes.find(n=>n.tag==='dialog')};
}
test('native prompt is only used after explicit action, once; dismissal preserves fallback',async()=>{
 const w=boot();let calls=0,prevented=false;w.events.beforeinstallprompt({preventDefault(){prevented=true;},async prompt(){calls++;},userChoice:Promise.resolve({outcome:'dismissed'})});assert.equal(calls,0);assert.equal(prevented,true);await w.open();assert.equal(calls,0);assert.equal(w.action().hidden,false);await w.action().onclick();assert.equal(calls,1);assert.equal(w.action().hidden,true);assert.match(w.text(),/Installation dismissed/);await w.action().onclick();assert.equal(calls,1);w.dialog().close();assert.equal(w.trigger.focused,true);
});
test('rejected prompt falls back; a new event makes install available again',async()=>{const w=boot();await w.open();w.events.beforeinstallprompt({preventDefault(){},prompt:()=>Promise.reject(Error('unsupported'))});await w.action().onclick();assert.match(w.text(),/unavailable right now/);w.events.beforeinstallprompt({preventDefault(){},prompt:async()=>{},userChoice:Promise.resolve({outcome:'accepted'})});assert.equal(w.action().hidden,false);await w.action().onclick();assert.match(w.text(),/accepted the request/);assert.equal(w.trigger.textContent,'Install KampTrail');});
test('installation and standalone state prevent further prompts',async()=>{const w=boot({standalone:true});await w.open();assert.equal(w.trigger.textContent,'KampTrail app');assert.equal(w.action().hidden,true);const b=boot();await b.open();b.events.appinstalled();assert.equal(b.trigger.textContent,'KampTrail installed');assert.equal(b.action().hidden,true);assert.match(b.text(),/Installation complete/);});
test('device fallback selects iOS including desktop-mode iPad, Android, Mac and desktop',async()=>{for(const [options,expected]of [[{ua:'iPhone Safari'},/In Safari, open Share/],[{ua:'Safari',platform:'MacIntel',touch:5},/In Safari, open Share/],[{ua:'Android Chrome'},/three-dot menu/],[{ua:'Safari',platform:'MacIntel'},/macOS 14/],[{ua:'Firefox',platform:'Win32'},/In Chrome, use/]]){const w=boot(options);await w.open();const paragraphs=w.dialog().children.filter(n=>n.tag==='p');assert.match(paragraphs[1].textContent,expected);assert.equal(w.action().hidden,true);assert.equal(w.dialog().attrs['aria-labelledby'],'kt-install-title');}});
test('new install module is in the release, shell, page and runtime handshake',()=>{for(const p of ['service-worker.js','scripts/build-release.js','index.html'])assert.ok(fs.readFileSync(p,'utf8').includes('install.js'));assert.ok(fs.readFileSync('app.js','utf8').includes('window.KampTrailInstall'));assert.ok(!fs.readFileSync('service-worker.js','utf8').includes("const VERSION = 'kt-v74'"));});

test('shell translation preserves standalone and installed labels after module initialization',()=>{
 const w=boot({standalone:true});w.c.document.documentElement={};w.c.document.querySelectorAll=selector=>selector==='[data-i18n]'?[w.trigger]:[];
 vm.runInNewContext(fs.readFileSync('locale.js','utf8'),w.c);w.c.KampTrailI18n.apply();assert.equal(w.trigger.textContent,'KampTrail app');
 const b=boot();b.c.document.documentElement={};b.c.document.querySelectorAll=selector=>selector==='[data-i18n]'?[b.trigger]:[];vm.runInNewContext(fs.readFileSync('locale.js','utf8'),b.c);b.events.appinstalled();b.c.KampTrailI18n.apply();assert.equal(b.trigger.textContent,'KampTrail installed');
});

test('safety cancellation leaves native prompt untouched and missing gate fails closed',async()=>{const w=boot();let calls=0;w.events.beforeinstallprompt({preventDefault(){},prompt:async()=>{calls++;},userChoice:Promise.resolve({outcome:'accepted'})});w.c.KampTrailSafety.request=async()=>false;await w.open();assert.equal(w.dialog(),undefined);assert.equal(calls,0);delete w.c.KampTrailSafety;await w.open();assert.equal(w.dialog(),undefined);w.c.KampTrailSafety={request:async()=>true};await w.open();assert.equal(calls,0);await w.action().onclick();assert.equal(calls,1);});


test('fresh toolbar stays hidden through native availability and reveals only after qualifying use',()=>{
 for(const betaFirst of [false,true]){
  const w=boot({betaFirst});if(!betaFirst)w.loadBeta();assert.equal(w.trigger.hidden,true);
  w.events.beforeinstallprompt({preventDefault(){}});assert.equal(w.trigger.hidden,true);
  w.c.KampTrailBeta.search();w.c.KampTrailBeta.search();assert.equal(w.trigger.hidden,true);
  w.c.KampTrailBeta.search();assert.equal(w.trigger.hidden,false);
  w.events.appinstalled();assert.equal(w.trigger.hidden,true);
  w.events.media({matches:false});assert.equal(w.trigger.hidden,true);
 }
});
test('campsite saves unlock the toolbar while service and imported saves do not',()=>{
 const w=boot({betaFirst:true});
 for(const type of ['service','spot','imported'])w.c.KampTrailBeta.saveStop({properties:{id:type,type}});
 assert.equal(w.trigger.hidden,true);
 w.c.KampTrailBeta.saveStop({properties:{id:'camp',type:'established'}});assert.equal(w.trigger.hidden,false);
});
test('returning eligibility still waits for activity in this document in either module load order',()=>{
 for(const betaFirst of [false,true])for(const state of [{visits:3},{searches:3},{saves:1}]){
  const w=boot({betaFirst,betaState:{visits:1,searches:0,saves:0,last:Date.now(),...state}});if(!betaFirst)w.loadBeta();
  assert.equal(w.trigger.hidden,true);w.c.KampTrailBeta.viewPlace({properties:{id:'camp'}});assert.equal(w.trigger.hidden,false);
 }
 const w=boot({betaFirst:true,betaState:{visits:3,last:Date.now()}});w.c.KampTrailBeta.viewPlace({properties:{id:'camp'}});
 // Install can load after beta already has qualifying activity.
 vm.runInNewContext(fs.readFileSync('install.js','utf8'),w.c);assert.equal(w.trigger.hidden,false);
});
test('remembered installation and standalone keep an eligible toolbar hidden in either load order',()=>{
 for(const betaFirst of [false,true])for(const standalone of [false,true]){
  const w=boot({betaFirst,standalone,betaState:{visits:3,installed:!standalone,last:Date.now()}});if(!betaFirst)w.loadBeta();
  w.c.KampTrailBeta.search();w.events.beforeinstallprompt({preventDefault(){}});assert.equal(w.trigger.hidden,true);
 }
});
test('the voluntary lower-page install guide remains usable before engagement eligibility',async()=>{
 const w=boot({betaFirst:true});assert.equal(w.trigger.hidden,true);assert.equal(w.guide.hidden,false);
 await w.guide.click();assert.equal(w.dialog().open,true);assert.equal(w.trigger.hidden,true);assert.equal(w.action().hidden,true);
});
