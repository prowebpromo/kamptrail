'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAdapter,createGa4Transport}=require('../consent-analytics.js');
const ARTICLE='/resources/walmart-overnight-rv-parking-policy-by-state-2026/';
const REST='/resources/interstate-rest-areas/';
class Bus{
  constructor(){this.listeners=new Map();}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type,event){for(const fn of this.listeners.get(type)||[])fn(event);}
}
function scaffold(url='https://kamptrail.com/'){
  const window=new Bus(),document=new Bus(),sent=[],observers=[];
  window.location={href:url};window.document=document;
  Object.defineProperty(window,'dataLayer',{get(){throw new Error('Must not read dataLayer');},set(){throw new Error('Must not write dataLayer');}});
  Object.defineProperty(window,'KampTrailBeta',{get(){throw new Error('Must not inspect reporter/backlog');}});
  document.anchors=[];document.querySelectorAll=()=>document.anchors;document.body={classList:new Set()};document.body.classList.contains=name=>document.body.classList.has(name);
  document.createElement=()=>{throw new Error('No script or node creation permitted');};
  class Observer{
    constructor(callback,options){this.callback=callback;this.options=options;this.targets=new Set();this.disconnected=false;observers.push(this);}
    observe(target){this.targets.add(target);}
    unobserve(target){this.targets.delete(target);}
    disconnect(){this.disconnected=true;this.targets.clear();}
    emit(target,ratio,isIntersecting=true){this.callback([{target,intersectionRatio:ratio,isIntersecting}]);}
  }
  const env={window,document,IntersectionObserver:Observer},adapter=createAdapter(env);
  function metric(sequence,event='kt_search_performed',extra={}){const detail={event,sequence,session_id:'12345678-1234-1234-1234-123456789012',mode:'free-camping',source:'boondockorbust',article_path:ARTICLE,...extra};window.emit('kamptrail:metric',{detail});return detail;}
  function enable(){adapter.configure({enabled:true,transport:(event,params)=>sent.push({event,params})});adapter.setConsent(true);}
  function anchor(mode='overnight-parking',destination='https://kamptrail.com/'){
    const item={dataset:{kamptrailMode:mode},href:destination+'?mode='+encodeURIComponent(mode)+'&near=1'};item.closest=()=>item;document.anchors.push(item);return item;
  }
  function click(target){const event={target,preventDefault(){throw new Error('Adapter must not intercept navigation');}};document.emit('click',event);return event;}
  return {window,document,env,adapter,sent,observers,metric,enable,anchor,click};
}

test('disabled default and unknown consent perform no transport, script or dataLayer work',()=>{
  const f=scaffold();assert.deepEqual(f.adapter.getStatus(),{enabled:false,analyticsConsent:false,permitted:false,destroyed:false});
  f.metric(1);f.adapter.configure({transport:()=>assert.fail('No transport before enable and consent')});f.adapter.setConsent(true);f.metric(2);f.adapter.setConsent(false);f.adapter.configure({enabled:true});f.metric(3);assert.equal(f.sent.length,0);assert.equal(f.observers.length,0);
});

test('only live events after enable and grant are sent, with no replay on grant or regrant',()=>{
  const f=scaffold();const old=f.metric(1);f.adapter.configure({enabled:true,transport:(event,params)=>f.sent.push({event,params})});f.metric(2);f.adapter.setConsent(true);assert.equal(f.sent.length,0);
  f.window.emit('kamptrail:metric',{detail:old});f.metric(2);assert.equal(f.sent.length,0);f.metric(3);assert.equal(f.sent.length,1);
  f.adapter.setConsent(false);f.metric(4);f.adapter.setConsent(true);assert.equal(f.sent.length,1);f.metric(5);assert.equal(f.sent.length,2);
  f.adapter.configure({enabled:false});f.metric(6);f.adapter.configure({enabled:true});assert.equal(f.sent.length,2);f.metric(7);assert.equal(f.sent.length,3);
});

test('metric payload is rebuilt from allowlists and contains no raw URL, token or submitted text',()=>{
  const secret='privacy-canary-private@example.test',coords='38.123456,-109.654321';
  const f=scaffold('https://kamptrail.com/?email='+encodeURIComponent(secret)+'&ref='+encodeURIComponent('https://boondockorbust.com/?email='+secret)+'#spot='+coords);f.enable();
  f.metric(1,'kt_stop_saved',{page_location:'https://elsewhere.test/?secret='+secret,page_referrer:secret,page_title:secret,landing_path:'/private/'+secret,query:secret,search_text:secret,email:secret,coordinates:coords,listing_id:'ridb:secret-listing',place_kind:'service_or_rest_area'});
  assert.deepEqual(f.sent[0],{event:'kt_stop_saved',params:{page_location:'https://kamptrail.com/',page_referrer:'',page_title:'KampTrail',kt_mode:'free-camping',kt_source:'boondockorbust',kt_article_path:ARTICLE,kt_place_kind:'service_or_rest_area'}});
  const serialized=JSON.stringify(f.sent);for(const value of [secret,coords,'ridb:secret-listing','12345678-1234','session_id','sequence','landing_path','search_text'])assert.equal(serialized.includes(value),false,value);
  assert.equal(Object.isFrozen(f.sent[0].params),true);
});

test('unsupported names and enum values cannot become analytics fields',()=>{
  const f=scaffold();f.enable();f.metric(1,'kt_private_email_event');assert.equal(f.sent.length,0);
  f.metric(2,'kt_marker_viewed',{mode:'email-secret',source:'invented',article_path:'/resources/private-555-123-4567/',place_kind:'38.123,-109.987'});
  assert.deepEqual(f.sent[0].params,{page_location:'https://kamptrail.com/',page_referrer:'',page_title:'KampTrail',kt_mode:'map',kt_source:'other'});
  f.metric(3,'kt_search_performed',{source:'boondockorbust',article_path:'/made-up/'});assert.equal(f.sent[1].params.kt_source,'other');assert.equal('kt_article_path' in f.sent[1].params,false);
});

test('only exact HTTPS production hosts and approved public page paths are eligible',()=>{
  for(const url of ['http://kamptrail.com/','https://www.kamptrail.com/','https://kamptrail.com.evil.test/','https://beta.kamptrail.com/','https://lightslategrey-emu-717044.hostingersite.com/','http://localhost:8807/','https://kamptrail.com:8443/','https://user@kamptrail.com/','https://kamptrail.com/private/','https://boondockorbust.com/wp-admin/post.php','https://boondockorbust.com/unapproved-article/']){
    const f=scaffold(url);f.enable();f.metric(1);assert.equal(f.sent.length,0,url);assert.equal(f.adapter.getStatus().permitted,false,url);
  }
  const f=scaffold('https://kamptrail.com/index.html');f.enable();f.metric(1);assert.equal(f.sent[0].params.page_location,'https://kamptrail.com/index.html');
});

test('preview, draft and staging query markers are excluded and the environment is rechecked per send',()=>{
  for(const query of ['preview=true','preview_id=73675','preview_nonce=abc','draft=1','p=73675','post=73675','action=edit','elementor-preview=1','customize_changeset_uuid=abc','__stage_build=abc','PREVIEW=false']){
    const f=scaffold('https://kamptrail.com/?'+query);f.enable();f.metric(1);assert.equal(f.sent.length,0,query);
    const b=scaffold('https://boondockorbust.com'+ARTICLE+'?'+query);const a=b.anchor();b.enable();b.click(a);assert.equal(b.sent.length,0,query);
  }
  const f=scaffold();f.enable();f.metric(1);f.window.location.href='https://kamptrail.com/?preview=true';f.metric(2);assert.equal(f.sent.length,1);
});

test('initialization and live delivery are idempotent, and malformed or repeated sequences are dropped',()=>{
  const f=scaffold();assert.equal(createAdapter(f.env),f.adapter);f.enable();const detail=f.metric(1);f.window.emit('kamptrail:metric',{detail});f.metric(1);f.metric(-1);f.metric(NaN);f.metric('2');assert.equal(f.sent.length,1);f.metric(2);assert.equal(f.sent.length,2);
  f.adapter.destroy();f.adapter.destroy();f.metric(3);assert.equal(f.sent.length,2);assert.equal(f.adapter.getStatus().permitted,false);assert.throws(()=>f.adapter.configure({enabled:true}));
});

test('configuration requires explicit booleans and a callable transport',()=>{
  const f=scaffold();assert.throws(()=>f.adapter.configure({enabled:'true'}));assert.throws(()=>f.adapter.setConsent('granted'));assert.throws(()=>f.adapter.configure({transport:{}}));f.adapter.configure({enabled:true,transport:null});f.adapter.setConsent(true);assert.equal(f.adapter.getStatus().permitted,false);
});

test('BoB view recording requires at least half visibility and is deduplicated per element',()=>{
  const f=scaffold('https://boondockorbust.com'+ARTICLE);const a=f.anchor();assert.equal(f.observers.length,0);f.enable();const observer=f.observers.at(-1);assert.equal(observer.options.threshold,0.5);
  observer.emit(a,0.49);observer.emit(a,0.9,false);observer.emit(a,NaN);observer.emit(a,'0.9');assert.equal(f.sent.length,0);observer.emit(a,0.5);observer.emit(a,0.8);assert.equal(f.sent.length,1);assert.equal(observer.targets.has(a),false);
  assert.deepEqual(f.sent[0],{event:'kt_launch_viewed',params:{page_location:'https://boondockorbust.com'+ARTICLE,page_referrer:'',page_title:'Boondock or Bust',kt_mode:'overnight-parking',kt_source:'boondockorbust',kt_article_path:ARTICLE}});
  f.adapter.setConsent(false);observer.emit(a,1);f.adapter.setConsent(true);assert.equal(f.observers.at(-1).targets.has(a),false);assert.equal(f.sent.length,1);
});

test('BoB clicks remain usable without consent and only production targets count after grant',()=>{
  const f=scaffold('https://boondockorbust.com'+REST+'?utm_source=review');const good=f.anchor('rest-areas'),stage=f.anchor('rest-areas','https://lightslategrey-emu-717044.hostingersite.com/'),wrong=f.anchor('blm');wrong.href='https://kamptrail.com/?mode=free-camping';
  const original=good.href;f.click(good);assert.equal(f.sent.length,0);f.enable();f.click(stage);f.click(wrong);assert.equal(f.sent.length,0);const click=f.click(good);f.document.emit('click',click);assert.equal(f.sent.length,1);assert.equal(good.href,original);assert.equal(f.sent[0].params.kt_article_path,REST);assert.equal(f.sent[0].params.page_location,'https://boondockorbust.com'+REST);
  f.adapter.setConsent(false);f.click(good);assert.equal(f.sent.length,1);
});

test('a delayed observer callback cannot send after consent withdrawal',()=>{
  const f=scaffold('https://boondockorbust.com'+ARTICLE),a=f.anchor();f.enable();const observer=f.observers.at(-1);f.adapter.setConsent(false);assert.equal(observer.disconnected,true);observer.emit(a,1);assert.equal(f.sent.length,0);f.adapter.setConsent(true);observer.emit(a,1);assert.equal(f.sent.length,0);f.observers.at(-1).emit(a,0.5);assert.equal(f.sent.length,1);
});

test('logged-in WordPress sessions are excluded and body-class changes are checked live',()=>{
  for(const name of ['logged-in','admin-bar']){
    const f=scaffold('https://boondockorbust.com'+ARTICLE),a=f.anchor();f.document.body.classList.add(name);f.enable();f.click(a);assert.equal(f.observers.length,0);assert.equal(f.sent.length,0);assert.equal(f.adapter.getStatus().permitted,false);
  }
  const f=scaffold('https://boondockorbust.com'+ARTICLE),a=f.anchor();f.enable();const observer=f.observers.at(-1);f.document.body.classList.add('logged-in');f.click(a);observer.emit(a,1);assert.equal(f.sent.length,0);
});

test('BoB article, dataset and destination mode must agree without overriding share targets',()=>{
  for(const suffix of ['#site=ridb%3A1','#spot=38.123,-109.456','&preview=true','&action=edit','&draft=1','&__stage_build=abc']){
    const f=scaffold('https://boondockorbust.com'+ARTICLE),a=f.anchor();a.href+=suffix;f.enable();f.click(a);assert.equal(f.sent.length,0,suffix);assert.equal(f.observers.at(-1)?.targets.has(a)||false,false,suffix);
  }
  const f=scaffold('https://boondockorbust.com'+ARTICLE),wrong=f.anchor('free-camping');f.enable();f.click(wrong);assert.equal(f.sent.length,0);const right=f.anchor();f.adapter.refresh();f.click(right);assert.equal(f.sent.length,1);
});

test('transport errors cause no retries, queues or disruption to product events',()=>{
  const f=scaffold();let calls=0;f.adapter.configure({enabled:true,transport(){calls++;throw new Error('Unavailable');}});f.adapter.setConsent(true);assert.doesNotThrow(()=>f.metric(1));f.adapter.setConsent(false);f.adapter.setConsent(true);assert.equal(calls,1);f.metric(2);assert.equal(calls,2);
});

test('optional GA4 wrapper requires reviewed automatic collection and live permission/readiness',()=>{
  const calls=[];let permitted=false,ready=false;const options={gtag:(...args)=>calls.push(args),measurementId:'G-895FCE9MJX',isPermitted:()=>permitted,isTagReady:()=>ready};
  assert.throws(()=>createGa4Transport(options));assert.throws(()=>createGa4Transport({...options,automaticCollectionReviewed:true,isTagReady:undefined}));
  const send=createGa4Transport({...options,automaticCollectionReviewed:true});const safe={page_location:'https://kamptrail.com/',kt_mode:'blm',kt_source:'other',email:'secret@example.test',session_id:'do-not-send',page_referrer:'https://elsewhere.test/?email=secret'};
  send('kt_search_performed',safe);permitted=true;send('kt_search_performed',safe);assert.equal(calls.length,0);ready=true;send('kt_search_performed',safe);assert.equal(calls.length,1);
  assert.deepEqual(calls[0],['event','kt_search_performed',{page_location:'https://kamptrail.com/',page_referrer:'',page_title:'KampTrail',kt_mode:'blm',kt_source:'other',send_to:'G-895FCE9MJX'}]);
  permitted=false;send('kt_search_performed',safe);assert.equal(calls.length,1);
});

test('optional GA4 wrapper rejects raw query/fragment URLs, staging and unknown event names',()=>{
  const calls=[],send=createGa4Transport({gtag:(...args)=>calls.push(args),measurementId:'G-TEST',isPermitted:()=>true,isTagReady:()=>true,automaticCollectionReviewed:true});
  for(const page_location of ['https://kamptrail.com/?email=secret','https://kamptrail.com/#spot=38,-109','https://lightslategrey-emu-717044.hostingersite.com/','https://boondockorbust.com/wp-admin/'])send('kt_search_performed',{page_location});
  send('private_event',{page_location:'https://kamptrail.com/'});assert.equal(calls.length,0);
});
