/* Portable local rig profile. Dimensions are reference data, never routing restrictions. */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.KampTrailRigProfile=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';
  const t=(key,params={})=>root.KampTrailI18n?.t(key,params)??String(key).replace(/\{([a-zA-Z0-9_]+)\}/g,(token,name)=>Object.hasOwn(params,name)?String(params[name]):token);
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const KEY='kt_rig_profile_v1', MAX_BYTES=32768;
  const DIMENSIONS={travelLengthMm:100000,campsiteFitLengthMm:24384,heightMm:10000,widthMm:10000,weightKg:200000};
  const COST=['all','free','conditional','paid','unknown'],TYPE=['all','established','dispersed','backcountry','parking','other'];
  const AMENITIES=['toilet','water','dump','shower'],HOOKUPS=['electric','water','sewer'];
  const clone=o=>JSON.parse(JSON.stringify(o));
  function fail(message){throw new Error(t(message));}
  function object(o,keys,label){
    if(!o||typeof o!=='object'||Array.isArray(o)||![Object.prototype,null].includes(Object.getPrototypeOf(o)))fail(t('{field} must be an object.',{field:t(label)}));
    if(Object.keys(o).length!==keys.length||Object.keys(o).some(k=>!keys.includes(k)))fail(t('{field} has missing or unsupported fields.',{field:t(label)}));
  }
  function choice(v,values,label){if(!values.includes(v))fail(t('Unsupported {field}.',{field:t(label)}));}
  function list(v,values,label){if(!Array.isArray(v)||v.length>values.length||new Set(v).size!==v.length||v.some(x=>!values.includes(x)))fail(t('Invalid {field}.',{field:t(label)}));}
  function validate(p){
    object(p,['format','schemaVersion','id','name','createdAt','updatedAt','displayUnits','rig','campsite'],'Profile');
    if(p.format!=='kamptrail-rig-profile'||p.schemaVersion!==1)fail('Unsupported profile format or schema version.');
    if(typeof p.id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.id))fail('Invalid profile ID.');
    if(typeof p.name!=='string'||p.name.trim()!==p.name||!p.name.length||p.name.length>80||/[\u0000-\u001f\u007f]/.test(p.name))fail('Use a profile name of 1–80 characters.');
    for(const k of ['createdAt','updatedAt'])if(typeof p[k]!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p[k])||!Number.isFinite(Date.parse(p[k]))||new Date(p[k]).toISOString()!==p[k])fail('Invalid UTC timestamp.');
    if(p.updatedAt<p.createdAt)fail('Updated time precedes creation time.');
    object(p.displayUnits,['length','weight'],'Display units');choice(p.displayUnits.length,['ft','m'],'length unit');choice(p.displayUnits.weight,['lb','kg'],'weight unit');
    object(p.rig,['category',...Object.keys(DIMENSIONS)],'Rig');choice(p.rig.category,['all','tent','trailer'],'source rig category');
    for(const[k,max]of Object.entries(DIMENSIONS))if(p.rig[k]!==null&&(!Number.isSafeInteger(p.rig[k])||p.rig[k]<=0||p.rig[k]>max))fail(t('{field} must be a positive whole canonical unit, within {max}, or null.',{field:t(labels[k]),max}));
    object(p.campsite,['cost','type','amenities','hookups','includeUnknownLength'],'Campsite preferences');choice(p.campsite.cost,COST,'fee preference');choice(p.campsite.type,TYPE,'campsite type');list(p.campsite.amenities,AMENITIES,'amenities');list(p.campsite.hookups,HOOKUPS,'hookups');
    if(typeof p.campsite.includeUnknownLength!=='boolean')fail('Unknown-length preference must be true or false.');
    return clone(p);
  }
  function parse(text){
    if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BYTES)fail('Choose a JSON profile no larger than 32 KiB.');
    let p;try{p=JSON.parse(text);}catch{fail('The file is not valid JSON.');}return validate(p);
  }
  function uuid(){
    if(root.crypto?.randomUUID)return root.crypto.randomUUID();
    const a=new Uint8Array(16);if(!root.crypto?.getRandomValues)fail('Secure profile IDs are unavailable in this browser.');root.crypto.getRandomValues(a);a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;return Array.from(a,(n,i)=>([4,6,8,10].includes(i)?'-':'')+n.toString(16).padStart(2,'0')).join('');
  }
  function create(){const now=new Date().toISOString();return {format:'kamptrail-rig-profile',schemaVersion:1,id:uuid(),name:t('My rig'),createdAt:now,updatedAt:now,displayUnits:{length:'ft',weight:'lb'},rig:{category:'all',travelLengthMm:null,campsiteFitLengthMm:null,heightMm:null,widthMm:null,weightKg:null},campsite:{cost:'all',type:'all',amenities:[],hookups:[],includeUnknownLength:false}};}
  function factor(field,unit){return field==='weightKg'?(unit==='lb'?0.45359237:1):(unit==='ft'?304.8:1000);}
  function fromCanonical(value,field,unit){return value===null?'':String(Number((value/factor(field,unit)).toFixed(9)));}
  function toCanonical(value,field,unit){
    if(!Object.hasOwn(DIMENSIONS,field))fail('Unknown measurement.');
    choice(unit,field==='weightKg'?['kg','lb']:['m','ft'],'measurement unit');
    if(value==='')return null;
    const n=typeof value==='number'?value:Number(value);
    if((typeof value!=='number'&&typeof value!=='string')||!Number.isFinite(n)||n<=0||n*factor(field,unit)>DIMENSIONS[field]+0.000001)fail('Enter a positive measurement within the stated limit, or leave it blank.');
    const canonical=Math.round(n*factor(field,unit));if(canonical<1)fail('Measurement is smaller than one canonical unit.');return canonical;
  }
  function toFilters(profile){
    try{const p=validate(profile);return {cost:p.campsite.cost,type:p.campsite.type,rigSize:p.rig.category,amenities:[...p.campsite.amenities],hookups:[...p.campsite.hookups],rigLength:p.rig.campsiteFitLengthMm===null?0:p.rig.campsiteFitLengthMm/304.8,rigIncludeUnknown:p.campsite.includeUnknownLength};}catch{return null;}
  }
  function createStore(storage){
    let profile=null,sessionOnly=false,notice='';
    try{const raw=storage?.getItem(KEY);if(raw)profile=parse(raw);if(!storage)sessionOnly=true;}catch(e){sessionOnly=true;notice=t("Saved profile could not be read. This session can still use and export a profile.");}
    return {
      get:()=>profile?clone(profile):null,
      status:()=>({sessionOnly,notice}),
      save(candidate,options={}){
        const next=validate(candidate);
        if(!sessionOnly&&!options.sessionOnly){try{storage.setItem(KEY,JSON.stringify(next));}catch{notice=t("Could not save on this device. Your previous profile is unchanged. Export this draft or choose Use session only.");return {ok:false,error:notice};}}
        if(options.sessionOnly)sessionOnly=true;profile=next;notice=sessionOnly?t("Session only: export a copy to keep this profile."):t("Saved on this device.");return {ok:true,sessionOnly};
      },
      remove(){if(!sessionOnly){try{storage.removeItem(KEY);}catch{return {ok:false,error:t("Could not delete the saved profile. Your profile is unchanged.")};}}profile=null;notice=sessionOnly?t('Profile removed from this session. A previously saved device copy may remain.'):t('Profile removed from this session and device.');return {ok:true};},
      export:()=>profile?JSON.stringify(profile,null,2):null
    };
  }
  let store,dialog,form,draft,preview=null,pending=null,linked=false,opener=null,initialized=false,importGeneration=0;
  const $=s=>dialog.querySelector(s);
  function status(text){if(dialog)$('#kt-rig-status').textContent=t(text);}
  function updateLink(reason){
    const text=linked?t('Profile matching is on: {name}.',{name:store.get().name}):t('Profile matching is off.')+(reason?' '+t(reason):'');
    const n=root.document?.getElementById('kt-rig-filter-status');if(n)n.textContent=text;
    if(dialog){$('#kt-rig-linked').textContent=text;$('#kt-rig-use').checked=linked;$('#kt-rig-use').disabled=!store.get();}
    root.dispatchEvent?.(new CustomEvent('kamptrail:rigprofilechanged',{detail:{linked,hasProfile:!!store.get()}}));
  }
  function unlink(reason=''){linked=false;updateLink(reason);}
  function init(){
    if(initialized)return;initialized=true;
    let storage;try{storage=root.localStorage;}catch{}
    store=createStore(storage);
    root.addEventListener?.('kamptrail:filterschanged',e=>{
      if(!linked)return;
      if(e.detail?.origin==='reset'){unlink('Filters were reset; your saved profile is retained.');return;}
      if(e.detail?.origin==='profile')return;
      const desired=toFilters(store.get()),current=root.KampTrailFilters?.getFilters();
      if(!desired||!current||Object.keys(desired).some(k=>JSON.stringify(desired[k])!==JSON.stringify(current[k])))unlink('A campsite preference was changed manually.');
    });
    updateLink();
  }
  const enumLabel=(kind,value)=>value==='all'?t(kind==='fee'?'All fees':kind==='type'?'All types':'Any / unspecified'):root.KampTrailI18n?.label(kind,value)??value;
  const labels={travelLengthMm:'Travel combination length',campsiteFitLengthMm:'Campsite fit length',heightMm:'Travel height',widthMm:'Travel width',weightKg:'Travel weight'};
  const option=(v,l=v)=>'<option value="'+v+'">'+esc(t(l))+'</option>';
  function build(){
    dialog=root.document.createElement('dialog');dialog.id='kt-rig-dialog';dialog.className='kt-rig-dialog';dialog.setAttribute('aria-labelledby','kt-rig-title');
    dialog.innerHTML=`<form id="kt-rig-form" class="kt-rig-form" novalidate><div class="kt-rig-header"><h2 id="kt-rig-title">${esc(t("Rig profile"))}</h2><button type="button" id="kt-rig-close" class="btn" aria-label="${esc(t('Close rig profile'))}">${esc(t("Close"))}</button></div>
      <p>${esc(t("Keep one named profile on this device, or export it to move between devices. Import and export are local; profile dimensions are never sent to the server."))}</p>
      <label for="kt-rig-name">${esc(t("Profile name"))}</label><input id="kt-rig-name" maxlength="80" required autocomplete="off">
      <div class="kt-rig-grid"><label>${esc(t("Length display units"))}<select id="kt-rig-length-unit">${option('ft','Feet (ft)')}${option('m','Meters (m)')}</select></label><label>${esc(t("Weight display units"))}<select id="kt-rig-weight-unit">${option('lb','Pounds (lb)')}${option('kg','Kilograms (kg)')}</select></label></div>
      <fieldset><legend>${esc(t("Measurements"))}</legend><div class="kt-rig-grid">${Object.keys(DIMENSIONS).map(k=>`<label for="kt-rig-${k}">${esc(t(labels[k]))} <span data-unit="${k}"></span><input id="kt-rig-${k}" data-dimension="${k}" type="number" step="any" min="0" inputmode="decimal" aria-describedby="kt-rig-measure-help"></label>`).join('')}</div>
      <p id="kt-rig-measure-help">${esc(t("Campsite fit length is the space you need at a site (maximum 80 ft / 24.384 m). Travel combination length includes your tow vehicle and trailer; it is separate. Height, width, travel length and weight are reference only. These values do not create RV-safe routes or verify bridges, road access, clearance, grades or legal limits. Leave unknown measurements blank. Maximum reference values: travel length 100 m, height and width 10 m, weight 200,000 kg."))}</p></fieldset>
      <fieldset><legend>${esc(t("Campsite matching preferences"))}</legend><label>${esc(t("Source says it allows"))}<select id="kt-rig-category">${option('all','Any / unspecified')}${option('tent','Tents')}${option('trailer','Trailers and caravans')}</select></label>
      <p>${esc(t("Only source-supported tent and trailer categories are available. Motorhome class, van or truck-camper suitability cannot be inferred from these categories."))}</p>
      <div class="kt-rig-grid"><label>${esc(t("Reported fee"))}<select id="kt-rig-cost">${COST.map((v,i)=>option(v,['All fees','Free','Free with conditions','Paid','Unknown'][i])).join('')}</select></label><label>${esc(t("Campsite type"))}<select id="kt-rig-type">${TYPE.map((v,i)=>option(v,['All types','Campground','Dispersed','Backcountry','Overnight parking','Other / unspecified'][i])).join('')}</select></label></div>
      <fieldset><legend>${esc(t("Hookups reported"))}</legend>${HOOKUPS.map(v=>`<label class="kt-inline"><input name="rig-hookups" type="checkbox" value="${v}"> ${esc(t(v[0].toUpperCase()+v.slice(1)))}</label>`).join('')}</fieldset>
      <fieldset><legend>${esc(t("Amenities reported"))}</legend>${AMENITIES.map((v,i)=>`<label class="kt-inline"><input name="rig-amenities" type="checkbox" value="${v}"> ${esc(t(['Toilets','Drinking water','Dump station','Showers'][i]))}</label>`).join('')}</fieldset>
      <label class="kt-inline"><input id="kt-rig-unknown" type="checkbox"> ${esc(t("Include listings with no documented RV length"))}</label><p>${esc(t("Length and all selected hookups must be reported at the same campsite. Unknown length does not prove a fit. Verify the exact site with the operator."))}</p></fieldset>
      <p id="kt-rig-status" role="status" aria-live="polite"></p><p id="kt-rig-error" role="alert"></p>
      <div class="kt-rig-actions"><button class="btn" type="submit">${esc(t("Save profile"))}</button><button class="btn" type="button" id="kt-rig-session" hidden>${esc(t("Use session only"))}</button><button class="btn" type="button" id="kt-rig-reset">${esc(t("Reset draft"))}</button><button class="btn" type="button" id="kt-rig-export">${esc(t("Export profile"))}</button></div>
      <fieldset><legend>${esc(t("Apply saved profile"))}</legend><label class="kt-inline"><input id="kt-rig-use" type="checkbox"> ${esc(t("Use profile for campsite matching"))}</label><p id="kt-rig-linked" role="status"></p><p>${esc(t("Applying replaces the campsite preferences above in the current map filters. Other filters stay in place. Route discovery uses these same filters when “Use current map filters” is enabled. Editing a matching filter or resetting filters turns the link off and keeps your saved profile."))}</p></fieldset>
      <fieldset><legend>${esc(t("Import a portable profile"))}</legend><label for="kt-rig-import">${esc(t("Choose JSON file (maximum 32 KiB)"))}</label><input id="kt-rig-import" type="file" accept="application/json,.json"><div id="kt-rig-preview" hidden><h3>${esc(t("Import preview"))}</h3><pre id="kt-rig-preview-text"></pre><button class="btn" type="button" id="kt-rig-replace">${esc(t("Replace profile with preview"))}</button><button class="btn" type="button" id="kt-rig-cancel-import">${esc(t("Cancel import"))}</button></div></fieldset>
      <div class="kt-rig-actions"><button class="btn" type="button" id="kt-rig-delete">${esc(t("Delete profile"))}</button><button class="btn" type="button" id="kt-rig-confirm-delete" hidden>${esc(t("Confirm delete profile"))}</button></div></form>`;
    root.document.body.append(dialog);form=$('#kt-rig-form');
    const invalidatePending=()=>{if(pending){pending=null;$('#kt-rig-session').hidden=true;error('The draft changed. Save again to choose session-only recovery for the latest values.');}};
    form.addEventListener('input',invalidatePending);form.addEventListener('change',invalidatePending);
    $('#kt-rig-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{importGeneration++;opener?.focus?.();});
    dialog.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const nodes=[...dialog.querySelectorAll('button,input,select,[tabindex]')].filter(n=>!n.disabled&&!n.hidden&&n.getClientRects().length);const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&root.document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&root.document.activeElement===last){e.preventDefault();first.focus();}});
    for(const n of dialog.querySelectorAll('[data-dimension]'))n.addEventListener('input',()=>{n.dataset.dirty='true';});
    for(const kind of ['length','weight'])$('#kt-rig-'+kind+'-unit').onchange=e=>{try{readDimensions();draft.displayUnits[kind]=e.target.value;renderDimensions();error('');}catch(err){e.target.value=draft.displayUnits[kind];error(err.message);}};
    form.onsubmit=e=>{e.preventDefault();try{save(readDraft());}catch(err){error(err.message);}};
    $('#kt-rig-session').onclick=()=>{if(pending)save(pending,{sessionOnly:true});};
    $('#kt-rig-reset').onclick=()=>{draft=create();render();status('Draft reset. Save to replace your profile.');};
    $('#kt-rig-use').onchange=e=>{if(!e.target.checked){unlink('Profile preferences remain in the filters until you change or reset them.');return;}const p=store.get();if(!p||!root.KampTrailFilters?.applyProfile(p)){e.target.checked=false;error('Save a valid profile before applying it.');return;}linked=true;updateLink();};
    $('#kt-rig-export').onclick=()=>{try{download(pending||readDraft());status('Exported the current draft as a portable JSON profile.');}catch(err){error(err.message);}};
    $('#kt-rig-import').onchange=async e=>{const generation=++importGeneration;preview=null;$('#kt-rig-preview').hidden=true;error('');const file=e.target.files?.[0];if(!file)return;try{if(file.size>MAX_BYTES)fail('Choose a JSON profile no larger than 32 KiB.');const text=await file.text();if(generation!==importGeneration||!dialog.open)return;preview=parse(text);$('#kt-rig-preview-text').textContent=summary(preview);$('#kt-rig-preview').hidden=false;status('Preview only. Your current profile and matching filters are unchanged.');}catch(err){if(generation===importGeneration&&dialog.open)error(err.message);}finally{if(generation===importGeneration)e.target.value='';}};
    $('#kt-rig-replace').onclick=()=>{if(preview)save(preview);};
    $('#kt-rig-cancel-import').onclick=()=>{importGeneration++;preview=null;$('#kt-rig-preview').hidden=true;status('Import cancelled.');};
    $('#kt-rig-delete').onclick=()=>{$('#kt-rig-confirm-delete').hidden=false;status('Confirm to delete your saved profile. Current filter values remain until you change or reset them.');};
    $('#kt-rig-confirm-delete').onclick=()=>{const result=store.remove();if(!result.ok){error(result.error);return;}unlink('Profile deleted.');draft=create();render();status(store.status().notice);};
  }
  function error(text){$('#kt-rig-error').textContent=t(text);}
  function renderDimensions(){for(const k of Object.keys(DIMENSIONS)){const unit=draft.displayUnits[k==='weightKg'?'weight':'length'],n=$('#kt-rig-'+k);n.value=fromCanonical(draft.rig[k],k,unit);n.dataset.dirty='false';n.max=String(DIMENSIONS[k]/factor(k,unit));dialog.querySelector('[data-unit="'+k+'"]').textContent='('+unit+')';}}
  function readDimensions(){const values={};for(const k of Object.keys(DIMENSIONS)){const n=$('#kt-rig-'+k);if(n.validity.badInput)fail(t('Enter a valid {field}.',{field:t(labels[k]).toLowerCase()}));values[k]=n.dataset.dirty==='true'?toCanonical(n.value,k,draft.displayUnits[k==='weightKg'?'weight':'length']):draft.rig[k];}Object.assign(draft.rig,values);}
  function readDraft(){readDimensions();const p=clone(draft);p.name=$('#kt-rig-name').value.trim();p.updatedAt=new Date().toISOString();p.rig.category=$('#kt-rig-category').value;p.campsite.cost=$('#kt-rig-cost').value;p.campsite.type=$('#kt-rig-type').value;p.campsite.includeUnknownLength=$('#kt-rig-unknown').checked;for(const k of ['amenities','hookups'])p.campsite[k]=[...dialog.querySelectorAll('[name="rig-'+k+'"]:checked')].map(n=>n.value);return validate(p);}
  function render(){
    importGeneration++;
    $('#kt-rig-name').value=draft.name;for(const k of ['length','weight'])$('#kt-rig-'+k+'-unit').value=draft.displayUnits[k];renderDimensions();$('#kt-rig-category').value=draft.rig.category;for(const k of ['cost','type'])$('#kt-rig-'+k).value=draft.campsite[k];$('#kt-rig-unknown').checked=draft.campsite.includeUnknownLength;for(const k of ['amenities','hookups'])dialog.querySelectorAll('[name="rig-'+k+'"]').forEach(n=>n.checked=draft.campsite[k].includes(n.value));
    pending=null;preview=null;$('#kt-rig-session').hidden=true;$('#kt-rig-confirm-delete').hidden=true;$('#kt-rig-preview').hidden=true;$('#kt-rig-delete').disabled=!store.get();error('');updateLink();
  }
  function save(p,options){
    const result=store.save(p,options);if(!result.ok){pending=clone(p);$('#kt-rig-session').hidden=false;error(result.error);return false;}
    draft=store.get();if(linked)root.KampTrailFilters?.applyProfile(draft);render();status(store.status().notice);return true;
  }
  function summary(p){
    const lines=[p.name,t('Saved: {date}',{date:root.KampTrailI18n?.date?root.KampTrailI18n.date(p.updatedAt,{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC':p.updatedAt}),t('Source category: {category}',{category:enumLabel('rig',p.rig.category)})];
    for(const k of Object.keys(DIMENSIONS)){const unit=p.displayUnits[k==='weightKg'?'weight':'length'];lines.push(t(labels[k])+': '+(p.rig[k]===null?t('Not set'):fromCanonical(p.rig[k],k,unit)+' '+unit));}
    lines.push(t('Fee: {fee}',{fee:enumLabel('fee',p.campsite.cost)}),t('Type: {type}',{type:enumLabel('type',p.campsite.type)}),t('Hookups: {hookups}',{hookups:p.campsite.hookups.map(v=>enumLabel('hookup',v)).join(', ')||t('Any')}),t('Amenities: {amenities}',{amenities:p.campsite.amenities.map(v=>enumLabel('amenity',v)).join(', ')||t('Any')}),t('Include unknown length: {value}',{value:t(p.campsite.includeUnknownLength?'Yes':'No')}));return lines.join('\n');
  }
  function download(p){const blob=new Blob([JSON.stringify(validate(p),null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=root.document.createElement('a');a.href=url;a.download='kamptrail-rig-profile.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function open(){init();if(!dialog)build();opener=root.document.activeElement;draft=store.get()||create();render();status(store.status().notice||'Measurements stay on this device. Save a profile to enable matching.');if(!dialog.open)dialog.showModal();$('#kt-rig-name').focus();}
  return {version:'2.25.0',schemaVersion:1,MAX_BYTES,KEY,validate,parse,create,fromCanonical,toCanonical,toFilters,createStore,init,open,unlink,getProfile:()=>{init();return store.get();},isLinked:()=>linked};
});
