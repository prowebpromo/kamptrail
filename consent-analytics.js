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
  return Object.freeze({version:'2.46.7',createAdapter,createGa4Transport,pageContext});
});
