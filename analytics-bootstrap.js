/* Reviewed integration candidate. Every release/loader/review switch defaults OFF.
 * Google supports one data layer per page. Existing gtag/dataLayer or Google
 * scripts block this loader. Never run it beside BoB's existing integration.
 * Leave loadGoogleTag OFF until the sole-owner integration, automatic
 * collection, real payloads and cross-domain joins have been reviewed.
 * Revocation stops this ID and future wrapper calls. Executed Google code cannot
 * be unloaded, and an already transmitted request cannot be recalled.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./consent-analytics.js'),require('./consent-controls.js'));
  else if(!root.KampTrailAnalyticsBootstrap)root.KampTrailAnalyticsBootstrap=factory(root.KampTrailAnalyticsPreparation,root.KampTrailConsentControls);
})(typeof globalThis==='object'?globalThis:this,function(preparation,controlsModule){
  'use strict';
  const MEASUREMENT_ID='G-VQE0H1DNKL',QUEUE='ktBetaAnalyticsQueue',COOKIE_PREFIX='ktbeta';
  const DEFAULT_RELEASE=Object.freeze({enabled:false,loadGoogleTag:false,automaticCollectionReviewed:false});
  const DENIED=Object.freeze({analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
  const mounts=new WeakMap();
  function mount(options={}){
    const doc=options.document||options.container?.ownerDocument,win=options.window||doc?.defaultView;
    if(!win||!doc||!options.container)throw new TypeError('A window, document and consent container are required.');
    if(mounts.has(win))return mounts.get(win);
    if(typeof preparation?.createAdapter!=='function'||typeof preparation?.pageContext!=='function'||typeof controlsModule?.mount!=='function')throw new Error('Reviewed consent modules are required.');
    const adapter=preparation.createAdapter({window:win,document:doc});
    if(typeof adapter.isEligible!=='function'||typeof adapter.measurementStarted!=='function')throw new Error('The adapter must expose its eligibility gate and measurement boundary.');
    let release={...DEFAULT_RELEASE},controls=null,consent=false,destroyed=false,syncing=false;
    let queue=null,script=null,loading=false,ready=false,measuring=false,configured=false,failed=false,ownerConflict=false,generation=0;
    function applyRelease(input={}){
      for(const key of Object.keys(DEFAULT_RELEASE))if(Object.hasOwn(input,key)){
        if(typeof input[key]!=='boolean')throw new TypeError(key+' must be boolean.');
      }
      release={...release,...Object.fromEntries(Object.keys(DEFAULT_RELEASE).filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]]))};
    }
    applyRelease(options.release);
    function ownershipIsClear(){
      if(ownerConflict)return false;
      const foreignScript=Array.from(doc.querySelectorAll('script[src*="googletagmanager.com/"],script[src*="google-analytics.com/"]')).some(node=>node!==script);
      if('gtag' in win||'dataLayer' in win||foreignScript)ownerConflict=true;
      return !ownerConflict;
    }
    function livePermission(){return !destroyed&&release.enabled&&release.loadGoogleTag&&release.automaticCollectionReviewed&&consent&&controls?.getStatus().analyticsConsent===true&&adapter.isEligible()&&ownershipIsClear();}
    function gtag(){if(queue)queue.push(arguments);}
    function clearDedicatedCookies(){
      // This reserved prefix belongs only to the candidate property. Do not clear
      // legacy _ga cookies, app storage, safety acceptance or location choices.
      let names=[];try{names=doc.cookie.split(';').map(item=>item.trim().split('=')[0]).filter(name=>/^ktbeta(?:_|$)/.test(name));}catch{return;}
      const host=win.location?.hostname||new URL(win.location.href).hostname;
      const domains=[null,host,'.'+host];
      for(const name of names)for(const domain of domains)try{doc.cookie=name+'=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/'+(domain?'; Domain='+domain:'')+'; SameSite=Lax; Secure';}catch{/* Denial still applies if cookie clearing is blocked. */}
    }
    function pause(){
      adapter.configure({enabled:false});
      if(queue){
        win['ga-disable-'+MEASUREMENT_ID]=true;
        if(measuring||loading)gtag('consent','update',{...DENIED});
        clearDedicatedCookies();
      }
      measuring=false;
      if(loading){generation++;script?.remove();script=null;loading=false;ready=false;}
    }
    function safeFields(){
      const page=preparation.pageContext(win.location.href);
      return page&&{page_location:page.url,page_referrer:'',page_title:page.site==='app'?'KampTrail':'Boondock or Bust'};
    }
    function activate(){
      if(!ready||!livePermission()){pause();return;}
      const fields=safeFields();if(!fields){pause();return;}
      win['ga-disable-'+MEASUREMENT_ID]=false;
      // Safe automatic fields precede config. No raw query, hash, referrer, title,
      // ad signals, personalized ads or automatic page_view are passed here.
      gtag('set',{...fields,allow_google_signals:false,allow_ad_personalization_signals:false});
      gtag('consent','update',{...DENIED,analytics_storage:'granted'});
      if(!configured){
        gtag('config',MEASUREMENT_ID,{...fields,send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,cookie_prefix:COOKIE_PREFIX,cookie_domain:'none',cookie_expires:5184000,cookie_update:false});
        configured=true;
      }
      if(!measuring){
        measuring=true;adapter.configure({enabled:true});
        // This records the current measurement boundary, never a prior landing.
        adapter.measurementStarted();
      }
    }
    function load(){
      // Refuse an occupied queue. Never adopt an unrelated Google integration.
      if(!queue){
        if(Object.hasOwn(win,QUEUE)){failed=true;return;}
        queue=[];win[QUEUE]=queue;win['ga-disable-'+MEASUREMENT_ID]=true;
        gtag('consent','default',{...DENIED});
        gtag('set',{...safeFields(),allow_google_signals:false,allow_ad_personalization_signals:false});
        gtag('js',new Date());
      }
      loading=true;const attempt=++generation;
      script=doc.createElement('script');script.async=true;script.referrerPolicy='no-referrer';
      script.src='https://www.googletagmanager.com/gtag/js?id='+MEASUREMENT_ID+'&l='+QUEUE;
      script.onload=()=>{
        if(attempt!==generation||destroyed)return;
        loading=false;ready=true;
        // No grant/config/event is queued while the network loader is pending.
        sync();
      };
      script.onerror=()=>{
        if(attempt!==generation||destroyed)return;
        failed=true;pause();
      };
      try{(doc.head||doc.documentElement).appendChild(script);}catch{failed=true;pause();}
    }
    function sync(){
      if(syncing)return;syncing=true;
      try{
        if(!livePermission()){pause();return;}
        if(failed)return;
        if(ready)activate();else if(!loading)load();
      }finally{syncing=false;}
    }
    function permissionForTransport(){
      const allowed=ready&&measuring&&livePermission();
      if(!allowed)pause();return allowed;
    }
    adapter.configure({enabled:false,transport:preparation.createGa4Transport({gtag,measurementId:MEASUREMENT_ID,isPermitted:permissionForTransport,isTagReady:()=>ready,automaticCollectionReviewed:true})});
    // The proxy applies denials synchronously before storage mutation. The real
    // controls retain responsibility for expiry, cross-tab state and UI text.
    const consentAdapter={setConsent(value){consent=value;adapter.setConsent(value);sync();}};
    controls=controlsModule.mount({...options.consent,container:options.container,document:doc,window:win,adapter:consentAdapter,onChange(){sync();}});
    function onResume(){sync();}
    win.addEventListener('popstate',onResume);win.addEventListener('pageshow',onResume);win.addEventListener('focus',onResume);doc.addEventListener('visibilitychange',onResume);
    const api=Object.freeze({
      adapter,controls,
      configure(input={}){if(destroyed)throw new Error('Bootstrap was destroyed.');applyRelease(input);sync();return api;},
      refresh(){controls.refresh();sync();return api;},
      getStatus(){if(!destroyed)sync();return Object.freeze({release:Object.freeze({...release}),eligible:adapter.isEligible(),analyticsConsent:consent,loading,ready,measuring,failed,ownerConflict,destroyed});},
      destroy(){if(destroyed)return;destroyed=true;pause();controls.destroy();adapter.destroy();win.removeEventListener('popstate',onResume);win.removeEventListener('pageshow',onResume);win.removeEventListener('focus',onResume);doc.removeEventListener('visibilitychange',onResume);mounts.delete(win);}
    });
    mounts.set(win,api);sync();return api;
  }
  return Object.freeze({version:'2.46.3',mount,DEFAULT_RELEASE,MEASUREMENT_ID,QUEUE,COOKIE_PREFIX});
});
