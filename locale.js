/* English-first UI runtime. Optional catalogues load only when selected. */
(function(global){
  'use strict';
  const STORAGE_KEY='kt_language', supported=['en','es','fr'];
  const FR_VERSION = '2.46.5';
  let language='en';
  try{const saved=global.localStorage?.getItem(STORAGE_KEY);if(supported.includes(saved))language=saved;}catch{}
  const pack=code=>{const value=global[code==='es'?'KampTrailI18nEs':'KampTrailI18nFr'];return value?.version===FR_VERSION&&value.messages&&typeof value.messages==='object'?value.messages:null;};
  const catalogue=()=>language==='en'?null:pack(language)||{};
  const pending={};
  function ensure(code){
    if(code==='en'||pack(code))return Promise.resolve();
    if(!supported.includes(code)||!global.document)return Promise.reject(Error('catalogue'));
    if(pending[code])return pending[code];
    pending[code]=new Promise((resolve,reject)=>{
      const script=global.document.createElement('script');script.src='locale-'+code+'.js?v='+FR_VERSION;script.async=true;
      script.onload=async()=>{
        if(!pack(code)){reject(Error('catalogue'));return;}
        // Also retain the selected pack when selection happens before the first worker controls the page.
        try{if(global.caches){const scope=new URL('./',global.location.href).href;const cache=await global.caches.open('kamptrail:'+scope+':locales-v1');const response=await fetch(script.src);if(response.ok)await cache.put(script.src,response);}}catch{}
        resolve();
      };
      script.onerror=()=>{delete pending[code];script.remove();reject(Error('catalogue'));};
      global.document.head.append(script);
    });
    return pending[code];
  }

  function t(key, params = {}) {
    const messages = catalogue(), message = messages && Object.hasOwn(messages, key) ? messages[key] : String(key);
    return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (token, name) => Object.hasOwn(params, name) ? String(params[name]) : token);
  }
  const labels = {
    fee:{free:'Reported free',conditional:'Free with conditions',paid:'Paid',unknown:'Fee unknown'},
    type:{established:'Campground',dispersed:'Dispersed',backcountry:'Backcountry',parking:'Overnight parking',other:'Other / unspecified',spot:'This spot',service:'Services',imported:'Imported point'},
    amenity:{toilet:'Toilets',water:'Drinking water',dump:'Dump station',shower:'Showers',fire_ring:'Fire ring',picnic_table:'Picnic table'},
    rig:{tent:'Tents',trailer:'Trailers and caravans',rv:'RV'},
    hookup:{electric:'Electric',water:'Water',sewer:'Sewer'},
    evidenceFreshness:{current:'Current',historical:'Historical',expired:'Expired',superseded:'Superseded',stale:'Stale',future:'Future',unknown:'Unknown'},
    sourceStatement:{allowed:'Allowed',conditional:'Conditional',prohibited:'Prohibited',conflict:'Conflict',unknown:'Unknown'},
    reportStatus:{pending:'pending',published:'published',rejected:'rejected',deleted:'deleted',flagged:'flagged'}
  };
  function label(kind, value) {return language !== 'en' && Object.hasOwn(labels,kind) && Object.hasOwn(labels[kind],value) ? t(labels[kind][value]) : String(value ?? '');}
  // True only when the selected catalogue is present, so a missing French file is reported instead of silently showing English.
  const catalogueReady = () => language === 'en' || !!pack(language);
  // The language actually shown. A missing French catalogue shows English, so lang and number/date formats follow English too.
  const shown = () => catalogueReady() ? language : 'en';
  const locale = () => shown() === 'es' ? 'es-US' : shown() === 'fr' ? 'fr-CA' : 'en-US';
  function number(value, options) { return new Intl.NumberFormat(locale(), options).format(value); }
  function date(value, options = {}) {
    if (!value) return t('Unknown');
    const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value), parsed = new Date(dayOnly ? value + 'T00:00:00Z' : value);
    if (!Number.isFinite(parsed.getTime()) || dayOnly && parsed.toISOString().slice(0,10) !== value) return String(value);
    return new Intl.DateTimeFormat(locale(), dayOnly ? {...options, timeZone:'UTC'} : options).format(parsed);
  }
  function setLanguage(next) {
    if (!supported.includes(next)) return false;
    try { if (!global.localStorage?.setItem) return false; global.localStorage.setItem(STORAGE_KEY, next); } catch { return false; }
    language = next;
    if (global.document) global.document.documentElement.lang = next;
    return true;
  }
  let shellApplied = false;
  function apply(root = global.document) {
    if (!root) return;
    if (root === global.document) shellApplied = true;
    for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
    for (const attr of ['aria-label', 'placeholder', 'title', 'alt']) for (const node of root.querySelectorAll('[data-i18n-' + attr + ']')) node.setAttribute(attr, t(node.getAttribute('data-i18n-' + attr)));
  }
  global.KampTrailI18n = {version:'2.46.5', t, label, number, date, locale, get language(){return language;}, supported:[...supported], catalogueReady, setLanguage, apply};
  function notice(message){
    const help=global.document?.getElementById('kt-language-help');
    if(help){help.removeAttribute?.('data-i18n');help.textContent=message;help.setAttribute('role','status');help.setAttribute('aria-live','polite');}
    global.showToast?.(message,'error');
  }
  async function initialize(){
    if(language!=='en'){
      try{await ensure(language);}catch{language='en';notice('This language is not saved on this device. Reconnect to load it. English remains available.');}
    }
    apply();
    if(!global.document)return;
    global.document.documentElement.lang=shown();
    const scope=global.document.getElementById('kt-language-scope');if(scope)scope.hidden=language==='en';
    const choice=global.document.getElementById('kt-language');
    if(choice){choice.value=language;choice.addEventListener('change',async()=>{
      const next=choice.value;if(next===language)return;choice.disabled=true;
      try{
        await ensure(next);
        if(!setLanguage(next))throw Error('storage');
        global.location.reload();
      }catch(error){choice.value=language;notice(error.message==='storage'?t('Language preference could not be saved. Allow browser storage, then try again.'):'This language is not saved on this device. Reconnect to load it. Your current language is unchanged.');}
      finally{choice.disabled=false;}
    });}
  }
  let ready=Promise.resolve();
  if(global.document){
    global.document.documentElement.lang=shown();
    ready=new Promise(resolve=>{const run=()=>initialize().finally(resolve);if(!['interactive','complete'].includes(global.document.readyState))global.document.addEventListener('DOMContentLoaded',run,{once:true});else run();});
  }
  global.KampTrailI18n.ready=ready;
  global.KampTrailI18n.ensureLanguage=ensure;
})(typeof window !== 'undefined' ? window : globalThis);
