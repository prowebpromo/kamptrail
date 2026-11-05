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
  return Object.freeze({version:'2.46.4',mount,VERSION,STORAGE_KEY,MAX_AGE_MS});
});
