<?php
/* KampTrail beta analytics: Site Kit remains sole Google tag loader.
 * Only published Walmart/rest-area articles and the privacy page.
 * Activation payload: install only after matching privacy notice is live. */
add_action('wp_footer', function () {
    if (is_admin() || is_user_logged_in() || is_preview() || !is_singular() || !in_array((int) get_queried_object_id(), [68886, 58675, 3], true)) {
        return;
    }
    echo <<<'KT_BETA_ANALYTICS_20261105'
<details id="kt-beta-analytics-settings" style="max-width:880px;margin:24px auto;padding:16px;border:1px solid #b8cbb7;border-radius:8px;background:#f2f7ee;color:#183729"><summary style="cursor:pointer;font-weight:700;min-height:44px;line-height:44px">Optional KampTrail analytics</summary><p><a href="https://boondockorbust.com/privacy-policy/">Privacy policy</a></p><div id="kt-analytics-choice"></div></details>
<script id="kt-beta-analytics-owner">
/* Prepared adapter only. No tag loader, dataLayer writer or default transport. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else if(!root.KampTrailAnalyticsPreparation)root.KampTrailAnalyticsPreparation=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const APP='https://kamptrail.com',BOB='https://boondockorbust.com';
  const MODES=new Set(['map','overnight-parking','rest-areas','dump-stations','free-camping','blm']);
  const KINDS=new Set(['campsite','service_or_rest_area','other_stop']);
  const SOURCES=new Set(['boondockorbust','pwa','other']);
  const APP_EVENTS=new Set(['kt_measurement_started','kt_landing','kt_open_in_kamptrail','kt_search_performed','kt_marker_viewed','kt_stop_saved','kt_return_session','kt_install_opened','kt_pwa_installed','kt_tester_opened','kt_feedback_submitted']);
  const CTA_EVENTS=new Set(['kt_launch_viewed','kt_launch_clicked','kt_measurement_started']);
  const ARTICLES=new Map([
    ['/resources/walmart-overnight-rv-parking-policy-by-state-2026/','overnight-parking'],
    ['/resources/interstate-rest-areas/','rest-areas'],
    ['/boondocking-guide/are-you-breaking-the-new-blm-camping-rules/','blm'],
    ['/boondocking-guide/ltva-camping-your-guide-to-extended-stays-on-public-lands/','blm'],
    ['/boondocking-guide/free-rv-parking-is-disappearing-fast-where-you-can-still-stay-overnight-in-2026/','overnight-parking'],
    ['/boondocking-guide/the-best-apps-for-finding-free-campsites/','free-camping'],
    ['/resources/quick-guide-to-finding-rv-dump-stations-while-on-the-road/','dump-stations'],
    ['/boondocking-guide/how-to-find-free-dispersed-camping-sites-using-google-maps/','free-camping'],
    ['/rv-camping-tips/quick-guide-to-overnight-rv-parking-at-truck-stops/','overnight-parking']
  ]);
  const instances=new WeakMap();

  function pageContext(value){
    let url;try{url=new URL(value);}catch{return null;}
    if(url.username||url.password||![APP,BOB].includes(url.origin))return null;
    for(const key of url.searchParams.keys()){
      if(/preview|draft|admin|customiz|elementor/i.test(key)||['p','page_id','post','post_id','action','__stage_build'].includes(key.toLowerCase()))return null;
    }
    if(url.origin===APP&&!['/','/index.html'].includes(url.pathname))return null;
    if(url.origin===BOB&&!ARTICLES.has(url.pathname))return null;
    return {site:url.origin===APP?'app':'bob',path:url.pathname,url:url.origin+url.pathname};
  }

  function parameters(page,detail){
    const article=ARTICLES.has(detail.article_path)?detail.article_path:'';
    let source=SOURCES.has(detail.source)?detail.source:'other';
    if(source==='boondockorbust'&&!article)source='other';
    const safe={page_location:page.url,page_referrer:'',page_title:page.site==='app'?'KampTrail':'Boondock or Bust',kt_mode:MODES.has(detail.mode)?detail.mode:'map',kt_source:source};
    if(article)safe.kt_article_path=article;
    if(KINDS.has(detail.place_kind))safe.kt_place_kind=detail.place_kind;
    return Object.freeze(safe);
  }

  function createAdapter(environment){
    const win=environment?.window||environment,doc=environment?.document||win?.document;
    if(!win?.addEventListener||!doc?.addEventListener)throw new TypeError('A window and document are required.');
    if(instances.has(win))return instances.get(win);
    const IO=environment?.IntersectionObserver||win.IntersectionObserver;
    let enabled=false,consent=false,transport=null,observer=null,observerGeneration=0,destroyed=false,sequence=0;
    const viewed=new WeakSet(),clicks=new WeakSet(),received=new WeakSet();
    function context(){const page=pageContext(win.location?.href);if(page?.site==='bob'&&['logged-in','admin-bar'].some(name=>doc.body?.classList?.contains(name)))return null;return page;}
    function permitted(){return !destroyed&&enabled&&consent&&typeof transport==='function'&&!!context();}
    function send(event,detail){
      if(!permitted())return false;
      const page=context();
      if(!(page.site==='app'?APP_EVENTS:CTA_EVENTS).has(event))return false;
      const safe=parameters(page,detail);
      try{transport(event,safe);}catch{/* No queue or retry. Product controls must keep working. */}
      return true;
    }
    function onMetric(message){
      const detail=message?.detail;
      if(!detail||typeof detail!=='object'||received.has(detail))return;
      received.add(detail);
      // Observe the sequence even while denied. No old event is backfilled later.
      if(!Number.isSafeInteger(detail.sequence)||detail.sequence<=sequence)return;
      sequence=detail.sequence;
      if(context()?.site!=='app'||!APP_EVENTS.has(detail.event))return;
      send(detail.event,detail);
    }
    function cta(anchor){
      const page=context();if(page?.site!=='bob')return null;
      const mode=anchor?.dataset?.kamptrailMode;if(!MODES.has(mode)||mode==='map')return null;
      if(ARTICLES.get(page.path)!==mode)return null;
      let url;try{url=new URL(anchor.href,page.url);}catch{return null;}
      if(pageContext(url.href)?.site!=='app'||/^#(?:site|spot)=/i.test(url.hash))return null;
      if(url.searchParams.get('mode')!==mode)return null;
      return {mode,article_path:page.path,source:'boondockorbust'};
    }
    function onClick(message){
      if(!message||typeof message!=='object'||clicks.has(message))return;
      clicks.add(message);
      const anchor=message.target?.closest?.('a[data-kamptrail-mode]'),detail=cta(anchor);
      if(detail)send('kt_launch_clicked',detail);
    }
    function refresh(){
      const generation=++observerGeneration;
      observer?.disconnect();observer=null;
      if(!permitted()||context()?.site!=='bob'||typeof IO!=='function')return;
      observer=new IO(entries=>{
        if(generation!==observerGeneration||!permitted())return;
        for(const entry of entries){
          if(entry.isIntersecting!==true||!Number.isFinite(entry.intersectionRatio)||entry.intersectionRatio<0.5||viewed.has(entry.target))continue;
          const detail=cta(entry.target);
          if(detail&&send('kt_launch_viewed',detail)){viewed.add(entry.target);observer?.unobserve(entry.target);}
        }
      },{threshold:0.5});
      for(const anchor of doc.querySelectorAll('a[data-kamptrail-mode]'))if(!viewed.has(anchor)&&cta(anchor))observer.observe(anchor);
    }
    const api=Object.freeze({
      configure(options={}){
        if(destroyed)throw new Error('Adapter was destroyed.');
        if(Object.hasOwn(options,'enabled')&&typeof options.enabled!=='boolean')throw new TypeError('enabled must be boolean.');
        if(Object.hasOwn(options,'transport')&&options.transport!==null&&typeof options.transport!=='function')throw new TypeError('transport must be a function or null.');
        if(Object.hasOwn(options,'enabled'))enabled=options.enabled;
        if(Object.hasOwn(options,'transport'))transport=options.transport;
        refresh();return api;
      },
      setConsent(granted){
        if(destroyed)throw new Error('Adapter was destroyed.');
        if(typeof granted!=='boolean')throw new TypeError('Consent must be an explicit boolean.');
        consent=granted;refresh();return api;
      },
      isEligible:()=>!!context()&&!destroyed,
      measurementStarted(){
        const page=context();if(!page)return false;
        if(page.site==='bob')return send('kt_measurement_started',{mode:ARTICLES.get(page.path),source:'boondockorbust',article_path:page.path});
        const url=new URL(win.location.href);let article='';
        for(const value of [url.searchParams.get('ref'),doc.referrer]){const referred=pageContext(value);if(referred?.site==='bob'){article=referred.path;break;}}
        const shared=/^#(?:site|spot)=/i.test(url.hash);
        const mode=shared?'map':win.KampTrailBeta?.entry?.mode||url.searchParams.get('mode')||'map';
        return send('kt_measurement_started',{mode,source:article?'boondockorbust':url.searchParams.get('source')==='pwa'?'pwa':'other',article_path:article});
      },
      getStatus:()=>Object.freeze({enabled,analyticsConsent:consent,permitted:permitted(),destroyed}),
      refresh,
      destroy(){if(destroyed)return;destroyed=true;consent=false;enabled=false;transport=null;observerGeneration++;observer?.disconnect();observer=null;win.removeEventListener('kamptrail:metric',onMetric);doc.removeEventListener('click',onClick);instances.delete(win);}
    });
    win.addEventListener('kamptrail:metric',onMetric);
    doc.addEventListener('click',onClick);
    instances.set(win,api);return api;
  }

  // Optional bridge to an ALREADY loaded and independently reviewed Google tag.
  // This does not configure the tag, disable its other collection or load scripts.
  function createGa4Transport(options={}){
    const {gtag,measurementId,isPermitted,isTagReady,automaticCollectionReviewed}=options;
    if(automaticCollectionReviewed!==true)throw new Error('Review the tag automatic fields and Enhanced Measurement first.');
    if(typeof gtag!=='function'||typeof isPermitted!=='function'||typeof isTagReady!=='function'||!/^G-[A-Z0-9]+$/.test(measurementId||''))throw new TypeError('Explicit tag, measurement ID, permission and readiness checks are required.');
    return function(event,input){
      if(!isPermitted()||!isTagReady())return;
      const page=pageContext(input?.page_location);
      if(!page||page.url!==input.page_location||!(page.site==='app'?APP_EVENTS:CTA_EVENTS).has(event))return;
      // Rebuild the allowlist even if someone calls this transport directly.
      const safe=parameters(page,{mode:input.kt_mode,source:input.kt_source,article_path:input.kt_article_path,place_kind:input.kt_place_kind});
      gtag('event',event,{...safe,send_to:measurementId});
    };
  }
  return Object.freeze({version:'2.46.2',createAdapter,createGa4Transport,pageContext});
});

/* Isolated consent-choice controls. No tracker, network, dataLayer or adapter enablement. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else if(!root.KampTrailConsentControls)root.KampTrailConsentControls=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const VERSION=2,STORAGE_KEY='kt_optional_analytics_choice_v2',MAX_AGE_MS=180*24*60*60*1000;
  const mounts=new WeakMap();let nextId=0;
  const panelStyle='border:1px solid #b8cbb7;border-radius:10px;background:#f2f7ee;color:#183729;padding:20px;margin:20px 0;line-height:1.5;';
  const buttonStyle='flex:1 1 180px;box-sizing:border-box;min-height:48px;border:2px solid #183729;border-radius:6px;padding:12px 16px;background:#fff;color:#183729;font:inherit;font-weight:700;cursor:pointer;';

  function mount(options={}){
    const container=options.container,doc=options.document||container?.ownerDocument,win=options.window||doc?.defaultView;
    if(!container?.appendChild||!doc?.createElement||!win?.addEventListener)throw new TypeError('A container, document and window are required.');
    if(mounts.has(container))return mounts.get(container);
    const adapter=options.adapter;
    if(typeof adapter?.setConsent!=='function')throw new TypeError('An adapter with setConsent is required.');
    const now=options.now||Date.now,schedule=options.schedule||win.setTimeout.bind(win),cancel=options.cancel||win.clearTimeout.bind(win);
    const maxAgeMs=options.maxAgeMs??MAX_AGE_MS,key=options.storageKey??STORAGE_KEY;
    if(!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1||typeof key!=='string'||!key)throw new TypeError('A positive integer maxAgeMs and nonempty storageKey are required.');
    let record=null,memoryOnly=false,clearFailed=false,destroyed=false,timer=null,storage;
    try{storage=Object.hasOwn(options,'storage')?options.storage:win.localStorage;if(!storage?.getItem||!storage?.setItem||!storage?.removeItem)throw new Error('Storage unavailable');}catch{storage=null;memoryOnly=true;}
    function element(tag,text){const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
    const section=element('section'),id='kt-consent-controls-'+(++nextId),heading=element('h2','Optional analytics choice');
    section.id=id;section.setAttribute('role','region');section.setAttribute('aria-labelledby',id+'-title');section.setAttribute('style',panelStyle);heading.id=id+'-title';heading.setAttribute('style','font-size:22px;line-height:1.3;margin:0 0 12px;');
    const intro=element('p',options.introText||'Optional usage measurement is currently off. You can save a choice here. Declining does not affect the map or your saved stops.');
    const separation=element('p','Your analytics choice is separate from safety terms and location permission.');
    const duration=element('p','Your choice lasts up to '+(maxAgeMs/(24*60*60*1000))+' days in this browser. You can change or clear it sooner.');
    const status=element('p');status.id=id+'-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
    const notice=element('p');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');notice.setAttribute('style','font-weight:700;');
    const choices=element('div');choices.setAttribute('role','group');choices.setAttribute('aria-label','Optional analytics choice');choices.setAttribute('style','display:flex;flex-wrap:wrap;gap:12px;');
    function button(text,action){const node=element('button',text);node.type='button';node.setAttribute('style',buttonStyle);node.addEventListener('click',action);return node;}
    const allow=button('Allow optional analytics',()=>choose('granted')),decline=button('Decline',()=>choose('denied'));
    choices.appendChild(allow);choices.appendChild(decline);
    const changes=element('div');changes.setAttribute('style','display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;');
    const change=button('Change choice',()=>allow.focus()),revoke=button('Revoke and clear choice',clear);
    changes.appendChild(change);changes.appendChild(revoke);
    for(const node of [heading,intro,separation,duration,status,choices,changes,notice])section.appendChild(node);
    container.appendChild(section);

    function snapshot(){return Object.freeze({version:VERSION,choice:record?.choice||'unknown',analyticsConsent:record?.choice==='granted',expiresAt:record?.expiresAt??null,maxAgeMs,persistence:memoryOnly?'memory':'local',clearFailed,destroyed});}
    function render(){
      const choice=record?.choice;
      status.textContent=choice==='granted'?'Your saved choice: allow optional analytics.':choice==='denied'?'Your saved choice: decline optional analytics.':'You have not saved a choice.';
      if(memoryOnly)status.textContent=status.textContent.replace('saved choice','choice for this page');
      notice.hidden=!memoryOnly;
      notice.textContent=memoryOnly?'Browser storage is unavailable. Your current choice applies only to this page and is lost on reload.'+(clearFailed?' A previously saved choice may remain and return on reload. Other open pages may still use it. Clear this site’s browser data to remove it.':''):'';
    }
    function publish(){render();try{options.onChange?.(snapshot());}catch{/* A status consumer must not break consent controls. */}}
    function removeSaved(){
      if(!storage){memoryOnly=true;return;}
      try{storage.removeItem(key);memoryOnly=false;clearFailed=false;}catch{memoryOnly=true;clearFailed=true;}
    }
    function disarm(){if(timer!==null){cancel(timer);timer=null;}}
    function arm(){
      disarm();if(!record||destroyed)return;
      const delay=Math.max(0,Math.min(record.expiresAt-now(),2147483647));
      timer=schedule(()=>{timer=null;if(!expire())arm();},delay);
    }
    function expire(){
      if(destroyed||!record||now()<record.expiresAt)return false;
      adapter.setConsent(false);record=null;disarm();removeSaved();publish();return true;
    }
    function parse(raw){
      if(raw===null)return null;
      try{
        const value=JSON.parse(raw),time=now();
        if(!value||value.version!==VERSION||!['granted','denied'].includes(value.choice)||!Number.isSafeInteger(value.savedAt)||value.savedAt<0||!Number.isSafeInteger(value.expiresAt)||value.expiresAt!==value.savedAt+maxAgeMs||time<value.savedAt||time>=value.expiresAt)return null;
        return {version:VERSION,choice:value.choice,savedAt:value.savedAt,expiresAt:value.expiresAt};
      }catch{return null;}
    }
    function restore(){
      // Deny first, before any storage read or cleanup operation.
      adapter.setConsent(false);record=null;disarm();
      let raw=null;
      try{if(!storage)throw new Error('Storage unavailable');raw=storage.getItem(key);memoryOnly=false;clearFailed=false;}catch{memoryOnly=true;publish();return;}
      record=parse(raw);
      if(raw!==null&&!record)removeSaved();
      if(record?.choice==='granted')adapter.setConsent(true);
      arm();publish();
    }
    function choose(choice){
      if(destroyed)return;
      if(choice!=='granted')adapter.setConsent(false);
      const savedAt=now();record={version:VERSION,choice,savedAt,expiresAt:savedAt+maxAgeMs};clearFailed=false;
      try{if(!storage)throw new Error('Storage unavailable');storage.setItem(key,JSON.stringify(record));memoryOnly=false;}catch{removeSaved();memoryOnly=true;}
      if(choice==='granted')adapter.setConsent(true);
      arm();publish();
    }
    function clear(){
      if(destroyed)return;
      adapter.setConsent(false);record=null;disarm();removeSaved();publish();
    }
    function onStorage(event){if(destroyed||(event.key!==key&&event.key!==null)||(event.storageArea&&event.storageArea!==storage))return;restore();}
    function onResume(){expire();}
    win.addEventListener('storage',onStorage);win.addEventListener('focus',onResume);win.addEventListener('pageshow',onResume);doc.addEventListener('visibilitychange',onResume);
    const api=Object.freeze({
      getStatus(){expire();return snapshot();},
      refresh(){if(!destroyed)expire();return snapshot();},
      clear,
      focus(){allow.focus();},
      destroy(){if(destroyed)return;adapter.setConsent(false);record=null;destroyed=true;disarm();win.removeEventListener('storage',onStorage);win.removeEventListener('focus',onResume);win.removeEventListener('pageshow',onResume);doc.removeEventListener('visibilitychange',onResume);section.remove();mounts.delete(container);}
    });
    mounts.set(container,api);restore();return api;
  }
  return Object.freeze({version:'2.46.2',mount,VERSION,STORAGE_KEY,MAX_AGE_MS});
});

/* BoB integration for its reviewed, existing Site Kit Google tag owner.
 * No second loader or queue. No global set/consent command. No legacy ID changes.
 * Publication remains off by default. Review existing tag automatic/default
 * fields and await actual library readiness before allowing this adapter.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./consent-analytics.js'),require('./consent-controls.js'));
  else if(!root.KampTrailAnalyticsExistingOwner)root.KampTrailAnalyticsExistingOwner=factory(root.KampTrailAnalyticsPreparation,root.KampTrailConsentControls);
})(typeof globalThis==='object'?globalThis:this,function(preparation,controlsModule){
  'use strict';
  const MEASUREMENT_ID='G-VQE0H1DNKL',COOKIE_PREFIX='ktbeta',GROUP='kamptrail_beta';
  const DEFAULT_RELEASE=Object.freeze({enabled:false,existingOwnerReviewed:false,automaticCollectionReviewed:false});
  const mounts=new WeakMap();
  function mount(options={}){
    const doc=options.document||options.container?.ownerDocument,win=options.window||doc?.defaultView;
    if(!win||!doc||!options.container)throw new TypeError('A window, document and consent container are required.');
    if(mounts.has(win))return mounts.get(win);
    const owner=options.owner;
    if(typeof owner?.gtag!=='function'||typeof owner?.isReady!=='function')throw new TypeError('The reviewed existing Google owner and explicit readiness check are required.');
    const adapter=preparation.createAdapter({window:win,document:doc});
    let release={...DEFAULT_RELEASE},controls=null,consent=false,configured=false,measuring=false,destroyed=false,syncing=false,readinessRequested=false,failed=false;
    function applyRelease(input={}){
      for(const key of Object.keys(DEFAULT_RELEASE))if(Object.hasOwn(input,key)){
        if(typeof input[key]!=='boolean')throw new TypeError(key+' must be boolean.');
        release[key]=input[key];
      }
    }
    applyRelease(options.release);
    function safeFields(){
      const page=preparation.pageContext(win.location.href);
      return page?.site==='bob'?{page_location:page.url,page_referrer:'',page_title:'Boondock or Bust'}:null;
    }
    function consentPermission(){
      return !destroyed&&!failed&&release.enabled&&release.existingOwnerReviewed&&release.automaticCollectionReviewed&&consent&&controls?.getStatus().analyticsConsent===true&&adapter.isEligible()&&!!safeFields();
    }
    function livePermission(){return consentPermission()&&owner.isReady()===true;}
    function clearDedicatedCookies(){
      let names=[];try{names=doc.cookie.split(';').map(item=>item.trim().split('=')[0]).filter(name=>/^ktbeta(?:_|$)/.test(name));}catch{return;}
      const host=win.location?.hostname||new URL(win.location.href).hostname;
      for(const name of names)for(const domain of [null,host,'.'+host])try{doc.cookie=name+'=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/'+(domain?'; Domain='+domain:'')+'; SameSite=Lax; Secure';}catch{/* Current-page denial still applies. */}
    }
    function pause(){
      adapter.configure({enabled:false});
      if(configured||(controls&&!consent)){win['ga-disable-'+MEASUREMENT_ID]=true;clearDedicatedCookies();}
      measuring=false;
    }
    function sync(){
      if(syncing)return;syncing=true;
      try{
        if(!consentPermission()){pause();return;}
        if(owner.isReady()!==true){
          if(!readinessRequested&&typeof owner.requestReady==='function'){
            readinessRequested=true;
            // Only ask the existing owner after a fresh beta grant. The hook
            // reports readiness only; no old ID is read into beta parameters.
            owner.requestReady(()=>sync());
          }
          if(owner.isReady()!==true){pause();return;}
        }
        win['ga-disable-'+MEASUREMENT_ID]=false;
        if(!configured){
          // Config is scoped to the beta destination, not global defaults.
          // Custom groups do not isolate unscoped legacy events. Every existing
          // custom emitter must explicitly route to its own legacy destination;
          // verify this with actual Google SDK payloads before activating beta.
          owner.gtag('config',MEASUREMENT_ID,{...safeFields(),groups:GROUP,send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,cookie_prefix:COOKIE_PREFIX,cookie_domain:'none',cookie_expires:5184000,cookie_update:false});
          configured=true;
        }
        if(!measuring){measuring=true;adapter.configure({enabled:true});adapter.measurementStarted();}
      }catch{failed=true;win['ga-disable-'+MEASUREMENT_ID]=true;pause();clearDedicatedCookies();}finally{syncing=false;}
    }
    function permissionForTransport(){const allowed=measuring&&livePermission();if(!allowed)pause();return allowed;}
    adapter.configure({enabled:false,transport:preparation.createGa4Transport({gtag:(...args)=>owner.gtag(...args),measurementId:MEASUREMENT_ID,isPermitted:permissionForTransport,isTagReady:()=>owner.isReady()===true,automaticCollectionReviewed:true})});
    controls=controlsModule.mount({...options.consent,container:options.container,document:doc,window:win,adapter:{setConsent(value){consent=value;adapter.setConsent(value);sync();}},onChange(){sync();}});
    function onResume(){sync();}
    win.addEventListener('pageshow',onResume);win.addEventListener('focus',onResume);doc.addEventListener('visibilitychange',onResume);
    const api=Object.freeze({
      adapter,controls,
      configure(input={}){if(destroyed)throw new Error('Existing-owner integration was destroyed.');applyRelease(input);sync();return api;},
      refresh(){controls.refresh();sync();return api;},
      getStatus(){if(!destroyed)sync();return Object.freeze({release:Object.freeze({...release}),eligible:adapter.isEligible()&&!!safeFields(),analyticsConsent:consent,configured,measuring,failed,destroyed});},
      destroy(){if(destroyed)return;destroyed=true;pause();controls.destroy();adapter.destroy();win.removeEventListener('pageshow',onResume);win.removeEventListener('focus',onResume);doc.removeEventListener('visibilitychange',onResume);mounts.delete(win);}
    });
    mounts.set(win,api);sync();return api;
  }
  return Object.freeze({mount,DEFAULT_RELEASE,MEASUREMENT_ID,COOKIE_PREFIX,GROUP});
});

/* Install below the reviewed Site Kit tag only on approved public CTA pages.
 * Activation is OFF until both disclosure and actual payload review are done.
 * This integrates the beta destination into the existing owner, never a second
 * Google loader. Existing BoB reporting and its privacy controls remain separate.
 */
(function(win){
  'use strict';
  const doc=win.document,container=doc.getElementById('kt-analytics-choice');
  if(!container||!win.KampTrailAnalyticsExistingOwner||typeof win.gtag!=='function'||!Array.isArray(win.dataLayer))return;
  const existingGtag=win.gtag;let ready=false;
  win.KampTrailAnalytics=win.KampTrailAnalyticsExistingOwner.mount({
    container,
    release:{enabled:true,existingOwnerReviewed:true,automaticCollectionReviewed:true},
    owner:{
      gtag:(...args)=>existingGtag(...args),
      isReady:()=>ready&&win.gtag===existingGtag,
      requestReady(callback){
        // Google invokes get callbacks after its library processes the queue.
        // Deliberately accept no callback argument: never retain or forward the
        // existing BoB client identifier into the separate beta destination.
        existingGtag('get','G-895FCE9MJX','client_id',()=>{ready=true;callback();});
      }
    },
    consent:{introText:'You can allow Google Analytics to measure how these KampTrail links and the map are used. This optional beta measurement records the article path, map mode and actions such as opening a marker or saving a stop. It does not send your search text, precise location, trip notes, saved-stop identifiers or feedback text. Declining does not affect the article, map or saved stops. Your choice here applies to optional KampTrail beta measurement on Boondock or Bust. KampTrail asks separately. Google receives technical connection information when analytics is allowed. Analytics cookies last up to 60 days. Other Boondock or Bust services are covered by its privacy policy.'}
  });
})(window);

</script>
KT_BETA_ANALYTICS_20261105;
}, 99);
