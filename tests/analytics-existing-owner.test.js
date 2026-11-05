'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const integration=require('../integrations/bob/analytics-existing-owner.js'),consent=require('../consent-controls.js');
const RELEASE={enabled:true,existingOwnerReviewed:true,automaticCollectionReviewed:true},PATH='/resources/interstate-rest-areas/';
class Bus{constructor(){this.listeners=new Map();}addEventListener(t,f){if(!this.listeners.has(t))this.listeners.set(t,new Set());this.listeners.get(t).add(f);}removeEventListener(t,f){this.listeners.get(t)?.delete(f);}emit(t,e={}){for(const f of this.listeners.get(t)||[])f(e);}}
class Element extends Bus{constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.attributes={};}appendChild(n){this.children.push(n);n.parent=this;return n;}setAttribute(k,v){this.attributes[k]=String(v);}focus(){}remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}}
function setup({release=RELEASE,href='https://boondockorbust.com'+PATH+'?email=private@example.com#saved-stop',ready=true,oldGrant=false,savedGrant=false,loggedIn=false,requestReady=false}={}){
  const win=new Bus(),doc=new Bus(),data=new Map(),calls=[],jar=new Map([['_ga','legacy'],['_ga_895FCE9MJX','legacy-stream'],['ktbeta','beta'],['ktbeta_VQE0H1DNKL','beta-stream']]);
  const clock=2000000000000;
  if(oldGrant)data.set('kt_optional_analytics_choice_v1',JSON.stringify({version:1,choice:'granted',savedAt:clock,expiresAt:clock+1000}));
  if(savedGrant)data.set(consent.STORAGE_KEY,JSON.stringify({version:consent.VERSION,choice:'granted',savedAt:clock,expiresAt:clock+1000}));
  win.location=new URL(href);win.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  doc.defaultView=win;doc.body={classList:{contains:n=>loggedIn&&n==='logged-in'}};doc.createElement=tag=>{assert.notEqual(tag,'script');return new Element(tag,doc);};doc.querySelectorAll=()=>[];
  Object.defineProperty(doc,'cookie',{get:()=>[...jar].map(([k,v])=>k+'='+v).join('; '),set:v=>{if(v.includes('Max-Age=0'))jar.delete(v.split('=')[0]);}});
  win.dataLayer=['legacy queue'];win.gtag=(...args)=>calls.push(args);const legacy=win.gtag,layer=win.dataLayer,container=new Element('div',doc);
  let readinessRequests=0,readyCallback=null;
  const api=integration.mount({window:win,document:doc,container,release,owner:{gtag:win.gtag,isReady:()=>ready,requestReady:requestReady?(callback)=>{readinessRequests++;readyCallback=callback;}:undefined},consent:{now:()=>clock,maxAgeMs:1000,schedule:()=>1,cancel(){}}});
  function nodes(p=container){return [p,...p.children.flatMap(nodes)];}
  function click(name){const node=nodes().find(n=>n.tagName==='BUTTON'&&n.textContent===name);assert.ok(node);node.emit('click');}
  let sequence=0;function metric(){win.emit('kamptrail:metric',{detail:{event:'kt_marker_viewed',sequence:++sequence,mode:'rest-areas',source:'other',email:'private',lat:42,lng:-73}});}
  return{api,win,doc,data,calls,jar,click,metric,setReady(value){ready=value;},readinessRequests:()=>readinessRequests,completeReadiness(){ready=true;readyCallback();},unchanged(){assert.equal(win.gtag,legacy);assert.equal(win.dataLayer,layer);assert.deepEqual(layer,['legacy queue']);assert.ok(calls.every(c=>c[0]==='config'||c[0]==='event'));}};
}
test('fresh version refuses previously saved off-era grant, with no Google commands or legacy mutation',()=>{
  const f=setup({oldGrant:true});assert.equal(consent.VERSION,2);assert.equal(consent.STORAGE_KEY,'kt_optional_analytics_choice_v2');assert.equal(f.api.getStatus().analyticsConsent,false);assert.deepEqual(f.calls,[]);f.metric();assert.deepEqual(f.calls,[]);f.unchanged();
});
test('all gates default off, each independent gate blocks configuration after a fresh grant',()=>{
  for(const release of [undefined,...Object.keys(RELEASE).map(k=>({...RELEASE,[k]:false}))]){
    const f=setup({release:release??{}});f.click('Allow optional analytics');assert.equal(f.api.getStatus().measuring,false);assert.deepEqual(f.calls,[]);f.unchanged();
  }
});
test('ready existing owner configures only beta destination and nondefault group, with safe parameters',()=>{
  const f=setup();f.click('Allow optional analytics');assert.equal(f.api.getStatus().measuring,true);
  assert.equal(f.calls[0][0],'config');assert.equal(f.calls[0][1],integration.MEASUREMENT_ID);assert.deepEqual(f.calls[0][2],{page_location:'https://boondockorbust.com'+PATH,page_referrer:'',page_title:'Boondock or Bust',groups:'kamptrail_beta',send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,cookie_prefix:'ktbeta',cookie_domain:'none',cookie_expires:5184000,cookie_update:false});
  assert.equal(f.calls[1][1],'kt_measurement_started');assert.equal(f.calls[1][2].send_to,integration.MEASUREMENT_ID);assert.equal(JSON.stringify(f.calls).includes('private@example.com'),false);assert.equal(JSON.stringify(f.calls).includes('saved-stop'),false);f.api.refresh();assert.equal(f.calls.length,2);f.unchanged();
});
test('unready library does not queue hits or config; later readiness starts at a fresh boundary',()=>{
  const f=setup({ready:false});f.click('Allow optional analytics');f.metric();assert.deepEqual(f.calls,[]);f.setReady(true);f.api.refresh();assert.deepEqual(f.calls.map(c=>c[0]),['config','event']);assert.equal(f.calls[1][1],'kt_measurement_started');f.unchanged();
});
test('revocation disables beta ID and clears its cookies while preserving legacy cookies and owner',()=>{
  const f=setup();f.click('Allow optional analytics');const before=f.calls.length;f.click('Revoke and clear choice');assert.equal(f.api.getStatus().measuring,false);assert.equal(f.win['ga-disable-'+integration.MEASUREMENT_ID],true);assert.equal(f.jar.has('ktbeta'),false);assert.equal(f.jar.has('ktbeta_VQE0H1DNKL'),false);assert.equal(f.jar.get('_ga'),'legacy');assert.equal(f.jar.get('_ga_895FCE9MJX'),'legacy-stream');f.metric();assert.equal(f.calls.length,before);f.unchanged();
});
test('app, staging, unapproved articles and logged-in pages cannot use the BoB existing-owner path',()=>{
  for(const input of [{href:'https://kamptrail.com/'},{href:'https://staging.boondockorbust.com'+PATH},{href:'https://boondockorbust.com/about/'},{href:'https://boondockorbust.com'+PATH+'?preview=true'},{loggedIn:true}]){const f=setup(input);f.click('Allow optional analytics');assert.deepEqual(f.calls,[]);assert.equal(f.api.getStatus().measuring,false);f.unchanged();}
});
test('release withdrawal and loss of actual readiness stop beta without global consent commands',()=>{
  for(const revoke of [f=>f.api.configure({enabled:false}),f=>{f.setReady(false);f.api.refresh();}]){const f=setup();f.click('Allow optional analytics');const before=f.calls.length;revoke(f);f.metric();assert.equal(f.calls.length,before);assert.equal(f.win['ga-disable-'+integration.MEASUREMENT_ID],true);f.unchanged();}
});
test('asynchronous owner readiness is requested once only after a fresh grant and emits no old event',()=>{
  const f=setup({ready:false,requestReady:true});assert.equal(f.readinessRequests(),0);f.metric();f.click('Allow optional analytics');assert.equal(f.readinessRequests(),1);f.api.refresh();assert.equal(f.readinessRequests(),1);assert.deepEqual(f.calls,[]);f.completeReadiness();assert.deepEqual(f.calls.map(c=>c[0]),['config','event']);assert.equal(f.calls[1][1],'kt_measurement_started');f.unchanged();
});
test('a late readiness callback after revocation cannot configure or send beta data',()=>{
  const f=setup({ready:false,requestReady:true});f.click('Allow optional analytics');f.click('Revoke and clear choice');f.completeReadiness();assert.deepEqual(f.calls,[]);assert.equal(f.api.getStatus().measuring,false);f.unchanged();
});

test('privacy-page revoke clears prior beta cookies even though that page cannot configure measurement',()=>{
  const f=setup({href:'https://boondockorbust.com/privacy-policy/',savedGrant:true});
  assert.equal(f.api.getStatus().configured,false);assert.equal(f.api.getStatus().analyticsConsent,true);
  assert.deepEqual(f.calls,[]);assert.equal(f.jar.get('ktbeta'),'beta');
  f.click('Revoke and clear choice');
  assert.equal(f.api.getStatus().analyticsConsent,false);assert.equal(f.api.getStatus().measuring,false);
  assert.equal(f.jar.has('ktbeta'),false);assert.equal(f.jar.has('ktbeta_VQE0H1DNKL'),false);
  assert.equal(f.jar.get('_ga'),'legacy');assert.equal(f.jar.get('_ga_895FCE9MJX'),'legacy-stream');
  assert.equal(f.data.has(consent.STORAGE_KEY),false);assert.deepEqual(f.calls,[]);f.unchanged();
});
test('eligible article restores a valid grant without clearing its existing beta or legacy identity cookies',()=>{
  const f=setup({savedGrant:true});
  assert.equal(f.api.getStatus().analyticsConsent,true);assert.equal(f.api.getStatus().measuring,true);
  assert.equal(f.jar.get('ktbeta'),'beta');assert.equal(f.jar.get('ktbeta_VQE0H1DNKL'),'beta-stream');
  assert.equal(f.jar.get('_ga'),'legacy');assert.equal(f.jar.get('_ga_895FCE9MJX'),'legacy-stream');
  assert.deepEqual(f.calls.map(c=>c[0]),['config','event']);f.unchanged();
});
