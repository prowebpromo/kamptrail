/* Moderated, first-hand camper reviews. Private management codes stay on this device unless the author copies one. */
(function () {
  'use strict';
  const STORE='kt_reviews_v1', API='api/community.php';
  const st={dialog:null,site:null,focus:null,opened:0,view:0};
  const el=(tag,attrs={},text)=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs))if(v!==false&&v!=null)n.setAttribute(k,k.startsWith('aria-')?String(v):v===true?'':v);if(text!=null)n.textContent=text;return n;};
  const button=(text,fn)=>{const b=el('button',{type:'button',class:'btn'},text);b.onclick=fn;return b;};
  function saved(){try{const a=JSON.parse(localStorage.getItem(STORE));return Array.isArray(a)?a.filter(r=>/^[a-f0-9]{64}$/.test(r?.token)):[];}catch{return [];}}
  function remember(r){try{localStorage.setItem(STORE,JSON.stringify([r,...saved().filter(x=>x.token!==r.token)].slice(0,100)));return true;}catch{return false;}}
  function shell(title){
    if(!st.dialog){const d=el('dialog',{id:'kt-community','aria-labelledby':'kt-community-title'}),head=el('div',{class:'kt-report-head'});head.append(el('h2',{id:'kt-community-title'}),button('Close',()=>d.close()));d.append(head,el('div',{class:'kt-community-body'}));d.addEventListener('close',()=>{st.view++;st.focus?.focus?.();});document.body.append(d);st.dialog=d;}
    st.view++;st.dialog.querySelector('h2').textContent=title;const body=st.dialog.querySelector('.kt-community-body');body.replaceChildren();if(!st.dialog.open)st.dialog.showModal();return body;
  }
  function field(label,input,hint){if(!input.hasAttribute('aria-label'))input.setAttribute('aria-label',label);const l=el('label',{class:'kt-field'});l.append(el('span',{},label),input);if(hint)l.append(el('small',{},hint));return l;}
  async function request(body,token){const r=await fetch(API,{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body});const out=await r.json().catch(()=>({}));if(!r.ok)throw new Error(out.message||(r.status===413?'The upload is too large. Use smaller photos.':'The reviews service is unavailable. Try again when you have a connection.'));return out;}
  function message(text,error=false){return el('p',{role:'status','aria-live':'polite',class:error?'kt-report-msg is-error':'kt-report-msg'},text);}
  function image(p,review){
    const fig=el('figure'),a=el('a',{href:'api/photo.php?id='+p.id,target:'_blank',rel:'noopener noreferrer'}),img=el('img',{src:'api/photo.php?id='+p.id,loading:'lazy',width:p.width,height:p.height,alt:`Campsite photo by ${review.display_name}, visited ${review.visited_on}`});
    a.append(img);fig.append(a,button('Report photo',()=>report(review.id,p.id)));return fig;
  }
  function legacyAddress(body,site){
    if(location.hostname!=='prowebpromo.github.io')return false;
    const href='https://kamptrail.com/'+(site?'#site='+encodeURIComponent(site.properties.id):'');
    body.append(el('p',{},'Reviews and photos are hosted at kamptrail.com. Open the current app to read, contribute or manage a review.'),el('a',{href,target:'_blank',rel:'noopener noreferrer'},'Open KampTrail reviews'));
    return true;
  }
  async function open(site){
    st.focus=document.activeElement;st.site=site;const name=site.properties.name,body=shell('Reviews and photos');const view=st.view;
    body.append(el('h3',{},name),el('p',{class:'kt-fine'},'Firsthand camper experiences. Reviews and photos are checked by a moderator before publication. They do not verify current fees, access or road conditions.'));
    if(legacyAddress(body,site))return;
    const actions=el('div',{class:'kt-community-actions'});actions.append(button('Write a review',()=>edit({campsite_id:site.properties.id,campsite_name:name})),button('My reviews',mine));body.append(actions);
    const summary=message('Loading reviews…'),list=el('div',{class:'kt-review-list'});body.append(summary,list);
    const more=button('Load more reviews',()=>load(more.dataset.before));more.hidden=true;body.append(more);
    async function load(before){
      more.disabled=true;
      try{const res=await fetch(API+'?site='+encodeURIComponent(site.properties.id)+(before?'&before='+before:''));const out=await res.json();if(!res.ok)throw new Error();if(view!==st.view)return;
        summary.textContent=out.count?`${out.average}/5 from ${out.count} published ${out.count===1?'review':'reviews'}.`:'No published reviews yet. Been here? Share your experience.';
        for(const r of out.reviews){
          const article=el('article',{class:'kt-review-card'});article.append(el('h4',{},`${r.rating}/5 · ${r.display_name}`),el('p',{class:'kt-fine'},`Visited ${r.visited_on}${r.rig?' · '+r.rig:''} · submitted ${String(r.created_at).slice(0,10)}`),el('p',{class:'kt-review-text'},r.body));
          const observed=window.KampTrailDiscovery?.describe(r.observations);if(observed)article.append(el('p',{class:'kt-observation'},'Reported on '+r.visited_on+' · '+observed));
          if(r.photos.length){const gallery=el('div',{class:'kt-photo-grid'});r.photos.forEach(p=>gallery.append(image(p,r)));article.append(gallery);}
          article.append(button('Report review',()=>report(r.id)));list.append(article);
        }
        more.hidden=!out.next_before;more.dataset.before=out.next_before||'';
      }catch{if(view===st.view){summary.replaceChildren(document.createTextNode(navigator.onLine?'Reviews could not be loaded.':'Reviews and photos need an internet connection.'),button('Retry',()=>load(before)));}}
      finally{more.disabled=false;}
    }
    await load();
  }
  function codePanel(body,token){
    const input=el('input',{readonly:true,value:token,'aria-label':'Private management code'});
    body.append(field('Private management code',input,'Anyone with this code can edit or delete this review. Keep it private. Save it to manage your review if browser data is cleared or you switch devices.'));
    const feedback=message('');body.append(button('Copy management code',async()=>{try{await navigator.clipboard.writeText(token);feedback.textContent='Copied.';}catch{input.select();feedback.textContent='Select and copy the code above.';}}),feedback);
  }
  function edit(review,token){
    const body=shell(token?'Edit your review':'Write a review');st.opened=Date.now();body.append(el('h3',{},review.campsite_name));const f=el('form');
    f.append(field('Public name',el('input',{name:'display_name',required:true,maxlength:60,value:review.display_name||'',autocomplete:'nickname'}),'Use a nickname if you prefer. This will be public.'));
    const rating=el('select',{name:'rating',required:true});rating.append(el('option',{value:''},'Choose a rating'));for(let i=1;i<=5;i++)rating.append(el('option',{value:i,selected:+review.rating===i},`${i} of 5`));f.append(field('Overall rating',rating));
    f.append(field('Date visited',el('input',{name:'visited_on',type:'date',required:true,max:new Date().toISOString().slice(0,10),value:review.visited_on||''})),field('Rig or camping setup (optional)',el('input',{name:'rig',maxlength:100,value:review.rig||''}),'For example: 22-foot camper van.'));
    window.KampTrailDiscovery?.observeFields(f,review,el,field);
    const text=el('textarea',{name:'body',required:true,minlength:20,maxlength:3000,rows:5},review.body||'');f.append(field('Your experience',text,'What helped you decide, and what should the next camper know? Include road access, noise, conditions or carrier reception you observed.'));
    if(token&&review.photos?.length){const set=el('fieldset');set.append(el('legend',{},'Existing photos'));for(const p of review.photos){const l=el('label',{class:'kt-confirm'});l.append(el('input',{name:'remove_photos[]',type:'checkbox',value:p.id}),` Remove photo #${p.id} (${p.status})`);set.append(l);}f.append(set);}
    const files=el('input',{name:'photos[]',type:'file',accept:'image/jpeg,image/png,image/webp',multiple:true});
    f.append(field('Photos (optional)',files,'Up to 3 total. JPEG, PNG or WebP, 6 MB and 16 megapixels per image. Images are resized and metadata is removed. HEIC is not supported.'));
    const preview=el('div',{class:'kt-photo-grid'}),urls=[];f.append(preview);files.onchange=()=>{urls.splice(0).forEach(URL.revokeObjectURL);preview.replaceChildren();for(const file of [...files.files].slice(0,3)){if(!/^image\/(jpeg|png|webp)$/.test(file.type))continue;const u=URL.createObjectURL(file);urls.push(u);preview.append(el('img',{src:u,alt:'Photo selected for upload'}));}};
    st.dialog.addEventListener('close',()=>urls.splice(0).forEach(URL.revokeObjectURL),{once:true});
    const hp=el('input',{name:'website',tabindex:-1,autocomplete:'off','aria-hidden':true,class:'kt-hp'});f.append(hp);
    const consent=el('label',{class:'kt-confirm'});consent.append(el('input',{type:'checkbox',name:'firsthand',value:1,required:true}),' This is my firsthand experience. I own these photos or have permission to publish them on KampTrail. I have not copied another app’s reviews.');f.append(consent);
    f.append(el('p',{class:'kt-fine'},'Your name, review, visit date, rig details, optional observations and approved photos become public. Do not include private contact details, identifiable people without permission, or sensitive locations. Moderators check submissions before publication.'));
    if(token)f.append(el('p',{class:'kt-fine'},'Saving edits removes this review and its photos from public view until they are reviewed again.'));
    const msg=message(''),send=el('button',{type:'submit',class:'btn primary'},token?'Save and resubmit':'Send for review');f.append(msg,send);body.append(f,button('My reviews',mine));
    f.onsubmit=async e=>{e.preventDefault();const chosen=[...files.files],remaining=(review.photos||[]).filter(p=>!new FormData(f).getAll('remove_photos[]').includes(String(p.id))).length;
      if(chosen.length+remaining>3||chosen.some(f=>f.size>6291456)){msg.textContent='Use at most 3 photos total, each 6 MB or smaller.';return;}
      const data=new FormData(f);if(!chosen.length)data.delete('photos[]');data.set('action',token?'edit':'submit');data.set('campsite_id',review.campsite_id);data.set('campsite_name',review.campsite_name);data.set('elapsed_ms',Date.now()-st.opened);data.set('observations',JSON.stringify(window.KampTrailDiscovery?.formValues(f)||{}));send.disabled=true;msg.textContent='Sending…';
      try{const out=await request(data,token);window.dispatchEvent(new CustomEvent('kamptrail:communitychanged'));const code=token||out.token;const stored=remember({token:code,name:review.campsite_name,at:new Date().toISOString()});urls.splice(0).forEach(URL.revokeObjectURL);const done=shell('Review received');done.append(message('Thanks. Your review and photos are waiting for moderation.'),el('p',{class:'kt-fine'},stored?'Your management code is saved on this device.':'This browser could not save the code. Copy it now so you can manage your review.'));codePanel(done,code);done.append(button('My reviews',mine));}
      catch(err){msg.textContent=err.message;msg.classList.add('is-error');}finally{send.disabled=false;}
    };
  }
  async function manage(token){
    const body=shell('Manage your review'),view=st.view;body.append(message('Loading…'));
    try{const res=await fetch(API,{headers:{Authorization:'Bearer '+token}}),out=await res.json();if(view!==st.view)return;if(!res.ok)throw new Error(out.message||'Review unavailable.');const r=out.review;
      remember({token,name:r.campsite_name,at:r.updated_at});body.replaceChildren(el('h3',{},r.campsite_name),message(`Status: ${r.status}.`));if(r.public_note)body.append(el('p',{},'Moderator note: '+r.public_note));
      if(r.status==='deleted'){body.append(el('p',{},'Your review and photo content have been deleted.'));return;}
      body.append(el('p',{class:'kt-review-text'},r.body),button('Edit review',()=>edit(r,token)));codePanel(body,token);
      const confirm=el('label',{class:'kt-confirm'}),check=el('input',{type:'checkbox'});confirm.append(check,' Delete my review and photos permanently.');const del=button('Delete my review',async()=>{if(!check.checked){notice.textContent='Check the deletion confirmation first.';return;}del.disabled=true;const data=new FormData();data.set('action','delete');try{await request(data,token);window.dispatchEvent(new CustomEvent('kamptrail:communitychanged'));await manage(token);}catch(err){notice.textContent=err.message;del.disabled=false;}}),notice=message('');body.append(confirm,del,notice,button('My reviews',mine));
    }catch(err){if(view===st.view)body.replaceChildren(message(err.message||'Unable to load your review. Try again online.',true),button('Retry',()=>manage(token)),button('My reviews',mine));}
  }
  function mine(){st.focus=document.activeElement;const body=shell('My reviews');if(legacyAddress(body))return;body.append(el('p',{class:'kt-fine'},'Management codes stay on this device. Copy yours to keep access on another device. No account is needed.'));
    const list=el('ul',{class:'kt-report-list'});for(const r of saved()){const li=el('li');li.append(button(r.name,()=>manage(r.token)));list.append(li);}if(!saved().length)body.append(el('p',{},'No reviews saved on this device yet.'));body.append(list);
    const f=el('form'),code=el('input',{name:'code',required:true,pattern:'[a-f0-9]{64}',autocomplete:'off',spellcheck:false});f.append(field('Restore a private management code',code),el('button',{type:'submit',class:'btn'},'Open my review'));f.onsubmit=e=>{e.preventDefault();manage(code.value.trim());};body.append(f);
  }
  function report(id,photo){const body=shell(photo?'Report a photo':'Report a review'),f=el('form');const reason=el('textarea',{name:'reason',required:true,minlength:10,maxlength:1000,rows:4});f.append(field('What is the problem?',reason,'Examples: private information, harassment, copied content, or a misleading campsite claim. A moderator will review the report.'));const msg=message(''),send=el('button',{class:'btn',type:'submit'},'Send report');f.append(msg,send);body.append(f);f.onsubmit=async e=>{e.preventDefault();send.disabled=true;const data=new FormData(f);data.set('action','report');data.set('review_id',id);if(photo)data.set('photo_id',photo);try{const out=await request(data);body.replaceChildren(message(out.message),button('Close',()=>st.dialog.close()));}catch(err){msg.textContent=err.message;send.disabled=false;}};}
  window.KampTrailCommunity={version:'2.13.0',open,mine};
})();
