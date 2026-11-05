/* BoB integration for its reviewed, existing Site Kit Google tag owner.
 * No second loader or queue. No global set/consent command. No legacy ID changes.
 * Publication remains off by default. Review existing tag automatic/default
 * fields and await actual library readiness before allowing this adapter.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('../../consent-analytics.js'),require('../../consent-controls.js'));
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
      if(configured){win['ga-disable-'+MEASUREMENT_ID]=true;clearDedicatedCookies();}
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
          // A nondefault group prevents unrelated unscoped legacy events from
          // automatically routing to this beta destination after configuration.
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
