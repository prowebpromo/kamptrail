'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const bootstrap=require('../analytics-bootstrap.js');
const consent=require('../consent-controls.js');
const RELEASE={enabled:true,loadGoogleTag:true,automaticCollectionReviewed:true};
const BOB='/resources/interstate-rest-areas/';
class Bus{
  constructor(){this.listeners=new Map();}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type,event={}){for(const fn of this.listeners.get(type)||[])fn(event);}
}
class Element extends Bus{
  constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.attributes={};this.textContent='';this.hidden=false;}
  appendChild(node){this.children.push(node);node.parent=this;if(node.tagName==='SCRIPT')this.ownerDocument.requests.push(node);return node;}
  setAttribute(key,value){this.attributes[key]=String(value);}
  focus(){this.ownerDocument.activeElement=this;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
}
function fixture({href='https://kamptrail.com/?mode=rest-areas&email=private@example.com#site=secret',release,grant=false,maxAgeMs=1000,loggedIn=false,legacy=false,existingGoogleScript=false}={}){
  let clock=2000000000000,nextTimer=0,sequence=0;const timers=new Map(),data=new Map(),jar=new Map([['_ga','legacy'],['_ga_LEGACY','legacy-stream'],['ktbeta','owned'],['ktbeta_VQE0H1DNKL','owned-stream'],['ktbetaOther','unrelated']]);
  const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  if(grant)data.set(consent.STORAGE_KEY,JSON.stringify({version:2,choice:'granted',savedAt:clock,expiresAt:clock+maxAgeMs}));
  data.set('kt_saved_stops','private stop');data.set('kt_safety_accepted','yes');
  const win=new Bus(),doc=new Bus();win.location=new URL(href);win.localStorage=storage;doc.defaultView=win;doc.requests=[];doc.cookieWrites=[];
  Object.defineProperty(doc,'cookie',{get:()=>[...jar].map(([key,value])=>key+'='+value).join('; '),set:value=>{doc.cookieWrites.push(value);const key=value.split('=')[0];if(value.includes('Max-Age=0'))jar.delete(key);}});
  const classes=new Set(loggedIn?['logged-in']:[]);doc.body={classList:{contains:name=>classes.has(name)}};
  doc.createElement=tag=>new Element(tag,doc);doc.querySelectorAll=selector=>selector.startsWith('script[')&&existingGoogleScript?[new Element('script',doc)]:[];doc.head=new Element('head',doc);
  const container=new Element('div',doc),legacyCalls=[],legacyLayer=[{legacy:true}],legacyGtag=(...args)=>legacyCalls.push(args);
  if(legacy){win.gtag=legacyGtag;win.dataLayer=legacyLayer;}
  const api=bootstrap.mount({window:win,document:doc,container,release,consent:{storage,maxAgeMs,now:()=>clock,schedule:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,at:clock+delay});return id;},cancel:id=>timers.delete(id)}});
  function nodes(parent=container){return [parent,...parent.children.flatMap(node=>nodes(node))];}
  function click(label){const node=nodes().find(node=>node.tagName==='BUTTON'&&node.textContent===label);assert.ok(node,label);node.emit('click');}
  function metric(event='kt_marker_viewed',detail={}){win.emit('kamptrail:metric',{detail:{event,sequence:++sequence,...detail}});}
  function commands(){return (win[bootstrap.QUEUE]||[]).map(args=>Array.from(args));}
  function untouched(){assert.equal(win.gtag,legacy?legacyGtag:undefined);assert.equal(win.dataLayer,legacy?legacyLayer:undefined);assert.deepEqual(legacyLayer,[{legacy:true}]);assert.deepEqual(legacyCalls,[]);}
  return {api,win,doc,container,classes,jar,data,storage,timers,click,metric,commands,untouched,advance(ms,run=true){clock+=ms;if(run)for(const [id,timer]of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}}};
}
function events(f){return f.commands().filter(command=>command[0]==='event');}
function config(f){return f.commands().filter(command=>command[0]==='config');}
function ready(f){f.doc.requests.at(-1).onload();assert.equal(f.api.getStatus().measuring,true);}

test('default release stays off even after grant, with no Google globals, queue, loader or legacy mutation',()=>{
  const f=fixture();assert.deepEqual(f.api.getStatus().release,bootstrap.DEFAULT_RELEASE);f.metric('kt_landing');f.click('Allow optional analytics');f.metric();assert.equal(f.api.getStatus().analyticsConsent,true);
  assert.equal(f.doc.requests.length,0);assert.equal(Object.hasOwn(f.win,bootstrap.QUEUE),false);assert.equal(Object.hasOwn(f.win,'ga-disable-'+bootstrap.MEASUREMENT_ID),false);f.untouched();
});
test('every release, loader and review switch is explicit and live consent is required',()=>{
  for(const key of Object.keys(RELEASE)){
    const release={...RELEASE,[key]:false},f=fixture({release,grant:true});assert.equal(f.doc.requests.length,0,key);assert.equal(Object.hasOwn(f.win,bootstrap.QUEUE),false,key);f.untouched();
  }
  const f=fixture({release:RELEASE});f.metric();assert.equal(f.doc.requests.length,0);f.click('Decline');assert.equal(f.doc.requests.length,0);assert.throws(()=>f.api.configure({enabled:'true'}),/boolean/);
});
test('late grant loads a dedicated denied queue and defers grant, config and events until loader readiness',()=>{
  const f=fixture({release:RELEASE});f.metric('kt_landing');f.click('Allow optional analytics');f.metric('kt_search_performed');
  assert.equal(f.doc.requests.length,1);assert.equal(f.doc.requests[0].src,'https://www.googletagmanager.com/gtag/js?id=G-VQE0H1DNKL&l=ktBetaAnalyticsQueue');
  assert.equal(f.commands()[0][0],'consent');assert.equal(f.commands()[0][1],'default');assert.deepEqual(f.commands()[0][2],{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
  assert.equal(f.commands().some(cmd=>cmd[0]==='consent'&&cmd[2].analytics_storage==='granted'),false);assert.deepEqual(config(f),[]);assert.deepEqual(events(f),[]);
  ready(f);assert.deepEqual(events(f).map(cmd=>cmd[1]),['kt_measurement_started']);
  f.metric('kt_marker_viewed',{mode:'rest-areas',source:'other',place_kind:'service_or_rest_area',email:'private',lat:42,lng:-73});
  assert.deepEqual(events(f).map(cmd=>cmd[1]),['kt_measurement_started','kt_marker_viewed']);assert.deepEqual(events(f)[1][2],{page_location:'https://kamptrail.com/',page_referrer:'',page_title:'KampTrail',kt_mode:'rest-areas',kt_source:'other',kt_place_kind:'service_or_rest_area',send_to:bootstrap.MEASUREMENT_ID});f.untouched();
});
test('a valid restored grant starts only now, sanitizes automatic fields before config and disables advertising',()=>{
  const f=fixture({release:RELEASE,grant:true});assert.equal(f.doc.requests.length,1);assert.equal(config(f).length,0);ready(f);
  const commands=f.commands(),configuration=config(f)[0][2],index=commands.findIndex(cmd=>cmd[0]==='config');
  assert.ok(commands.slice(0,index).some(cmd=>cmd[0]==='set'&&cmd[1].page_location==='https://kamptrail.com/'&&cmd[1].page_referrer===''));
  assert.equal(configuration.send_page_view,false);assert.equal(configuration.allow_google_signals,false);assert.equal(configuration.allow_ad_personalization_signals,false);assert.equal(configuration.cookie_prefix,'ktbeta');assert.equal(configuration.cookie_domain,'none');assert.equal(configuration.page_title,'KampTrail');
  assert.equal(JSON.stringify(commands).includes('private@example.com'),false);assert.equal(JSON.stringify(commands).includes('site=secret'),false);assert.deepEqual(events(f).map(cmd=>cmd[1]),['kt_measurement_started']);
  const grant=commands.findLast(cmd=>cmd[0]==='consent'&&cmd[1]==='update')[2];assert.equal(grant.analytics_storage,'granted');for(const key of ['ad_storage','ad_user_data','ad_personalization'])assert.equal(grant[key],'denied');f.untouched();
});
test('revocation during loading defeats stale onload, and a later grant cannot inherit the old readiness',()=>{
  const f=fixture({release:RELEASE});f.click('Allow optional analytics');const old=f.doc.requests[0];f.click('Revoke and clear choice');
  assert.equal(f.win['ga-disable-'+bootstrap.MEASUREMENT_ID],true);old.onload();assert.equal(f.api.getStatus().ready,false);assert.deepEqual(config(f),[]);assert.deepEqual(events(f),[]);
  f.click('Allow optional analytics');assert.equal(f.doc.requests.length,2);old.onload();assert.equal(f.api.getStatus().ready,false);assert.equal(config(f).length,0);ready(f);assert.deepEqual(events(f).map(cmd=>cmd[1]),['kt_measurement_started']);f.untouched();
});
test('revocation denies and disables only this property, clears only its reserved cookies and keeps app data',()=>{
  const f=fixture({release:RELEASE,grant:true});ready(f);f.metric();const before=events(f).length;f.click('Decline');f.metric();
  assert.equal(f.api.getStatus().measuring,false);assert.equal(f.win['ga-disable-'+bootstrap.MEASUREMENT_ID],true);assert.equal(events(f).length,before);assert.equal(f.commands().findLast(cmd=>cmd[0]==='consent')[2].analytics_storage,'denied');
  assert.equal(f.jar.has('ktbeta'),false);assert.equal(f.jar.has('ktbeta_VQE0H1DNKL'),false);assert.equal(f.jar.get('_ga'),'legacy');assert.equal(f.jar.get('_ga_LEGACY'),'legacy-stream');assert.equal(f.jar.get('ktbetaOther'),'unrelated');assert.ok(f.doc.cookieWrites.every(value=>/^ktbeta(?:_|=)/.test(value)));
  assert.equal(f.data.get('kt_saved_stops'),'private stop');assert.equal(f.data.get('kt_safety_accepted'),'yes');f.untouched();
  f.click('Allow optional analytics');assert.equal(f.doc.requests.length,1);assert.equal(config(f).length,1);assert.deepEqual(events(f).map(cmd=>cmd[1]),['kt_measurement_started','kt_marker_viewed','kt_measurement_started']);
});
test('expiry stops measurement by timer and also at event-time when the timer was delayed',()=>{
  for(const run of [true,false]){
    const f=fixture({release:RELEASE,grant:true});ready(f);const before=events(f).length;f.advance(1000,run);f.metric();assert.equal(events(f).length,before);assert.equal(f.win['ga-disable-'+bootstrap.MEASUREMENT_ID],true);assert.equal(f.api.getStatus().analyticsConsent,false);f.untouched();
  }
});
test('cross-tab decline, clear and invalid records deny synchronously using current storage',()=>{
  for(const raw of [null,'invalid',JSON.stringify({version:2,choice:'denied',savedAt:2000000000000,expiresAt:2000000001000})]){
    const f=fixture({release:RELEASE,grant:true});ready(f);if(raw===null)f.storage.removeItem(consent.STORAGE_KEY);else f.storage.setItem(consent.STORAGE_KEY,raw);
    const before=events(f).length;f.win.emit('storage',{key:consent.STORAGE_KEY,storageArea:f.storage,newValue:'untrusted grant'});assert.equal(f.win['ga-disable-'+bootstrap.MEASUREMENT_ID],true);f.metric();assert.equal(events(f).length,before);assert.equal(f.api.getStatus().measuring,false);f.untouched();
  }
});
test('staging, unapproved pages, previews, credentials and logged-in BoB never initialize Google',()=>{
  for(const href of ['https://staging.kamptrail.com/','http://kamptrail.com/','https://www.kamptrail.com/','https://kamptrail.com/testing/','https://kamptrail.com/?preview=true','https://kamptrail.com/?__stage_build=x','https://user:secret@kamptrail.com/','https://boondockorbust.com/','https://boondockorbust.com'+BOB+'?p=3']){
    const f=fixture({href,release:RELEASE,grant:true});assert.equal(f.doc.requests.length,0,href);assert.equal(Object.hasOwn(f.win,bootstrap.QUEUE),false,href);f.untouched();
  }
  const f=fixture({href:'https://boondockorbust.com'+BOB,release:RELEASE,grant:true,loggedIn:true});assert.equal(f.doc.requests.length,0);f.untouched();
});
test('sole-owner approved BoB candidate boundary uses article context',()=>{
  const f=fixture({href:'https://boondockorbust.com'+BOB+'?email=private#secret',release:RELEASE,grant:true});ready(f);
  const boundary=events(f)[0];assert.equal(boundary[1],'kt_measurement_started');assert.equal(boundary[2].page_location,'https://boondockorbust.com'+BOB);assert.equal(boundary[2].page_referrer,'');assert.equal(boundary[2].kt_article_path,BOB);assert.equal(boundary[2].kt_mode,'rest-areas');assert.equal(boundary[2].kt_source,'boondockorbust');f.untouched();
  f.classes.add('logged-in');f.api.refresh();assert.equal(f.api.getStatus().measuring,false);assert.equal(f.win['ga-disable-'+bootstrap.MEASUREMENT_ID],true);f.untouched();
});
test('emergency release off switch denies immediately, and loader failures do not silently retry',()=>{
  const f=fixture({release:RELEASE,grant:true});ready(f);const before=events(f).length;f.api.configure({enabled:false});f.metric();assert.equal(f.win['ga-disable-'+bootstrap.MEASUREMENT_ID],true);assert.equal(events(f).length,before);assert.equal(f.api.getStatus().measuring,false);
  const error=fixture({release:RELEASE,grant:true});error.doc.requests[0].onerror();error.api.refresh();assert.equal(error.api.getStatus().failed,true);assert.equal(error.doc.requests.length,1);assert.equal(config(error).length,0);assert.equal(events(error).length,0);error.untouched();
});
test('occupied dedicated queue fails closed, and destroy invalidates a pending loader',()=>{
  const f=fixture({release:RELEASE});const occupied=[];f.win[bootstrap.QUEUE]=occupied;f.click('Allow optional analytics');assert.equal(f.api.getStatus().failed,true);assert.equal(f.win[bootstrap.QUEUE],occupied);assert.equal(f.doc.requests.length,0);f.untouched();
  const active=fixture({release:RELEASE,grant:true}),old=active.doc.requests[0];active.api.destroy();old.onload();assert.equal(events(active).length,0);assert.equal(config(active).length,0);assert.equal(active.win['ga-disable-'+bootstrap.MEASUREMENT_ID],true);assert.equal(active.api.getStatus().destroyed,true);assert.throws(()=>active.api.configure(RELEASE),/destroyed/);active.untouched();
});

test('revocation disables measurement before a failing storage removal and does not resume the saved grant',()=>{
  const f=fixture({release:RELEASE,grant:true});ready(f);const before=events(f).length;
  f.storage.removeItem=()=>{assert.equal(f.win['ga-disable-'+bootstrap.MEASUREMENT_ID],true);assert.equal(f.api.adapter.getStatus().enabled,false);throw new Error('Blocked');};
  f.click('Revoke and clear choice');f.metric();assert.equal(events(f).length,before);assert.equal(f.api.getStatus().measuring,false);assert.equal(f.api.controls.getStatus().clearFailed,true);assert.equal(JSON.parse(f.data.get(consent.STORAGE_KEY)).choice,'granted');f.untouched();
});

test('an existing BoB gtag/dataLayer or Google script blocks a second analytics owner without mutation',()=>{
  for(const setup of [{legacy:true},{existingGoogleScript:true}]){
    const f=fixture({href:'https://boondockorbust.com'+BOB,release:RELEASE,grant:true,...setup});
    assert.equal(f.api.getStatus().ownerConflict,true);assert.equal(f.api.getStatus().measuring,false);assert.equal(f.doc.requests.length,0);assert.equal(Object.hasOwn(f.win,bootstrap.QUEUE),false);assert.equal(Object.hasOwn(f.win,'ga-disable-'+bootstrap.MEASUREMENT_ID),false);f.metric();f.api.refresh();f.untouched();
  }
});

 test('off-era version-one grant cannot activate the current fresh consent version',()=>{const f=fixture({release:RELEASE});f.storage.setItem('kt_optional_analytics_choice_v1',JSON.stringify({version:1,choice:'granted',savedAt:2000000000000,expiresAt:2000000001000}));f.api.refresh();assert.equal(f.api.getStatus().analyticsConsent,false);assert.equal(f.doc.requests.length,0);});
