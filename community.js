/* Moderated, first-hand camper reviews. Private management codes stay on this device unless the author copies one. */
(function () {
  'use strict';
  const t = (key, params) => (typeof window !== 'undefined' ? window.KampTrailI18n : globalThis.KampTrailI18n)?.t(key, params) ?? String(key).replace(/\{([a-zA-Z0-9_]+)\}/g, (token, name) => Object.hasOwn(params || {}, name) ? String(params[name]) : token);
  const STORE='kt_reviews_v1', API='api/community.php';
  const st={dialog:null,site:null,focus:null,opened:0,view:0};
  const el=(tag,attrs={},text)=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs))if(v!==false&&v!=null)n.setAttribute(k,k.startsWith('aria-')?String(v):v===true?'':v);if(text!=null)n.textContent=text;return n;};
  const button=(text,fn)=>{const b=el('button',{type:'button',class:'btn'},text);b.onclick=fn;return b;};
  function saved(){try{const a=JSON.parse(localStorage.getItem(STORE));return Array.isArray(a)?a.filter(r=>/^[a-f0-9]{64}$/.test(r?.token)):[];}catch{return [];}}
  function remember(r){try{localStorage.setItem(STORE,JSON.stringify([r,...saved().filter(x=>x.token!==r.token)].slice(0,100)));return true;}catch{return false;}}
  function stopVideos(){st.dialog?.querySelectorAll?.('iframe.kt-video-player')?.forEach(frame=>frame.remove());}
  function shell(title){
    stopVideos();
    if(!st.dialog){const d=el('dialog',{id:'kt-community','aria-labelledby':'kt-community-title'}),head=el('div',{class:'kt-report-head'});head.append(el('h2',{id:'kt-community-title'}),button(t("Close"),()=>d.close()));d.append(head,el('div',{class:'kt-community-body'}));d.addEventListener('close',()=>{stopVideos();st.view++;st.focus?.focus?.();});document.body.append(d);st.dialog=d;}
    st.view++;st.dialog.querySelector('h2').textContent=title;const body=st.dialog.querySelector('.kt-community-body');body.replaceChildren();if(!st.dialog.open)st.dialog.showModal();return body;
  }
  function field(label,input,hint){if(!input.hasAttribute('aria-label'))input.setAttribute('aria-label',label);const l=el('label',{class:'kt-field'});l.append(el('span',{},label),input);if(hint)l.append(el('small',{},hint));return l;}
  async function request(body,token){const r=await fetch(API,{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body});const out=await r.json().catch(()=>({}));if(!r.ok)throw new Error((out.message?t(out.message):null)||(r.status===413?t("The upload is too large. Use smaller photos."):t("The reviews service is unavailable. Try again when you have a connection.")));return out;}
  function message(text,error=false){return el('p',{role:'status','aria-live':'polite',class:error?'kt-report-msg is-error':'kt-report-msg'},text);}
  function image(p,review){
    const fig=el('figure'),a=el('a',{href:'api/photo.php?id='+p.id,target:'_blank',rel:'noopener noreferrer'}),img=el('img',{src:'api/photo.php?id='+p.id,loading:'lazy',width:p.width,height:p.height,alt:t("Campsite photo by {0}, visited {1}", {"0":(review.display_name),"1":(review.visited_on)})});
    a.append(img);fig.append(a,button(t("Report photo"),()=>report(review.id,p.id)));return fig;
  }
  function videoCard(review,site,view){
    const video=review.video;
    if(video?.provider!=='youtube'||!/^[A-Za-z0-9_-]{11}$/.test(video.id||''))return null;
    const box=el('section',{class:'kt-review-video','aria-label':t('Visitor video')}),notice=message('');
    const link=el('a',{href:'https://www.youtube.com/watch?v='+video.id,target:'_blank',rel:'noopener noreferrer'},t('Open video on YouTube'));
    box.append(el('h5',{},t('Visitor video')),el('p',{class:'kt-fine'},t('Visitor-supplied YouTube video. Posted and recorded dates are unknown; the review visit date does not establish the video date.')),
      el('p',{class:'kt-fine'},t('Play loads a third-party YouTube player. YouTube may show ads and collect information. Video playback needs a connection.')),link);
    const play=button(t('Play video'),async()=>{
      play.disabled=true;notice.textContent=t('Checking publication…');
      try{
        const response=await fetch(API+'?site='+encodeURIComponent(site)+'&review_id='+encodeURIComponent(review.id),{cache:'no-store'}),out=await response.json();
        if(view!==st.view||!box.isConnected||!st.dialog.open)return;
        if(!response.ok||out.review_id!==review.id||out.video?.provider!=='youtube'||out.video.id!==video.id)throw Error('unavailable');
        stopVideos();
        const frame=el('iframe',{class:'kt-video-player',src:'https://www.youtube-nocookie.com/embed/'+video.id+'?autoplay=1',title:t('Visitor video on YouTube'),allow:'autoplay; encrypted-media; picture-in-picture; fullscreen',allowfullscreen:true,referrerpolicy:'strict-origin-when-cross-origin',sandbox:'allow-scripts allow-same-origin allow-presentation'});
        box.append(frame);notice.textContent=t('Playback is provided by YouTube.');
      }catch{if(view===st.view&&box.isConnected)notice.textContent=t('Video could not be verified. It may be unpublished or unavailable. Try again online.');}
      finally{play.disabled=false;}
    });
    box.append(play,notice);return box;
  }
  function legacyAddress(body,site){
    if(location.hostname!=='prowebpromo.github.io')return false;
    const href='https://kamptrail.com/'+(site?'#site='+encodeURIComponent(site.properties.id):'');
    body.append(el('p',{},t("Reviews and photos are hosted at kamptrail.com. Open the current app to read, contribute or manage a review.")),el('a',{href,target:'_blank',rel:'noopener noreferrer'},t("Open KampTrail reviews")));
    return true;
  }
  function monthDetails(container,data,selected=''){
    const D=window.KampTrailDiscovery;
    container.replaceChildren();
    const panel=el('details',{class:'kt-monthly-reports'});panel.append(el('summary',{},t("Reports by visit month")));
    const info=message('');panel.append(info);container.append(panel);
    if(!D?.validMonthly(data)){info.textContent=t("Visit-month summaries are unavailable. Individual dated reviews remain below.");return;}
    if(D.monthlyView(data).mode!=='ready'){info.textContent=t("This visit-month summary is expired or has an invalid check date. Reload reviews online.");return;}
    panel.append(el('p',{class:'kt-fine'},t("Calendar visit months across all reported years. These are counts of published firsthand condition reports, not numeric subscores or current conditions. Approach reports concern each contributor’s rig. Carrier reports stay in individual reviews.")));
    const select=el('select',{'aria-label':t("Visit month")});select.append(el('option',{value:''},t("All visit months")));for(const [key,label]of Object.entries(D.MONTHS))select.append(el('option',{value:key},label));select.value=selected;
    panel.append(field(t("Visit month"),select),el('p',{class:'kt-fine'},t('Checked {checked}. {unreported} published reviews have no condition fields. {excluded} condition reports have unusable visit dates. {invalid} reviews have unusable condition data.',{checked:new Date(data.checked_at).toLocaleString(window.KampTrailI18n?.locale()),unreported:data.unreported_reviews,excluded:data.excluded_dates,invalid:data.invalid_observations})));
    const counts=el('ul');panel.append(counts,el('p',{class:'kt-fine'},t("Missing fields remain unreported. Past reports do not establish safety, camping permission or conditions on your next visit.")));
    function render(){
      counts.replaceChildren();const row=D.monthlyView(data,select.value);
      if(row.mode!=='ready'){info.textContent=t("This summary has expired. Reload reviews online.");return;}
      info.textContent=row.reports?t('{count} published condition {reports} · visits {first} through {latest}.',{count:row.reports,reports:t(row.reports===1?'report':'reports'),first:row.first_visit,latest:row.latest_visit}):t('No published condition reports with usable visit dates{month}. Missing evidence stays unknown.',{month:select.value?t(' for this month'):''});
      if(!row.reports)return;
      for(const [axis,a]of Object.entries(D.AXES)){
        const values=row.axes[axis],known=Object.values(values).reduce((n,v)=>n+v,0),parts=Object.entries(a.values).filter(([key])=>values[key]).map(([key,label])=>`${label}: ${values[key]}`);
        if(row.reports-known)parts.push(t('Not reported: {count}',{count:row.reports-known}));
        counts.append(el('li',{},`${axis==='access'?t("Approach (contributor’s rig)"):a.label}: ${parts.join(' · ')}`));
      }
    }
    select.onchange=render;render();
  }
  async function open(site){
    st.focus=document.activeElement;st.site=site;const name=site.properties.name,body=shell(t("Reviews and photos"));const view=st.view;
    body.append(el('h3',{},name),el('p',{class:'kt-fine'},t("Firsthand camper experiences. Reviews and photos are checked by a moderator before publication. They do not verify current fees, access or road conditions.")));
    if(legacyAddress(body,site))return;
    const actions=el('div',{class:'kt-community-actions'});actions.append(button(t('Write a review'),()=>edit({campsite_id:site.properties.id,campsite_name:name})),button(t('My reviews'),mine));body.append(actions);
    const summary=message(t('Loading reviews…')),monthly=el('div'),list=el('div',{class:'kt-review-list'});body.append(summary,monthly,list);
    const more=button(t('Load more reviews'),()=>load(more.dataset.before));more.hidden=true;body.append(more);
    async function load(before){
      more.disabled=true;
      try{const res=await fetch(API+'?site='+encodeURIComponent(site.properties.id)+(before?'&before='+before:''));const out=await res.json();if(!res.ok)throw new Error();if(view!==st.view)return;
        summary.textContent=out.count?t('{0}/5 from {1} published {2}.',{'0':out.average,'1':out.count,'2':t(out.count===1?'review':'reviews')}):t('No published reviews yet. Been here? Share your experience.');
        monthDetails(monthly,out.monthly,monthly.querySelector('select')?.value||'');
        for(const r of out.reviews){
          const article=el('article',{class:'kt-review-card'});article.append(el('h4',{},`${r.rating}/5 · ${r.display_name}`),el('p',{class:'kt-fine'},t("Visited {0}{1} · submitted {2}", {"0":(r.visited_on),"1":(r.rig?' · '+r.rig:''),"2":(String(r.created_at).slice(0,10))})),el('p',{class:'kt-review-text'},r.body));
          const observed=window.KampTrailDiscovery?.describe(r.observations);if(observed)article.append(el('p',{class:'kt-observation'},t("Reported on ")+r.visited_on+' · '+observed));
          if(r.photos.length){const gallery=el('div',{class:'kt-photo-grid'});r.photos.forEach(p=>gallery.append(image(p,r)));article.append(gallery);}
          const video=videoCard(r,site.properties.id,view);if(video)article.append(video);
          article.append(button(t("Report review"),()=>report(r.id)));list.append(article);
        }
        more.hidden=!out.next_before;more.dataset.before=out.next_before||'';
      }catch{if(view===st.view){summary.replaceChildren(document.createTextNode(navigator.onLine?t('Reviews could not be loaded.'):t('Reviews and photos need an internet connection.')),button(t('Retry'),()=>load(before)));if(!monthly.hasChildNodes())monthly.append(el('p',{class:'kt-fine'},t("Visit-month summaries are unavailable until reviews reload.")));}}
      finally{more.disabled=false;}
    }
    await load();
  }
  function codePanel(body,token){
    const input=el('input',{readonly:true,value:token,'aria-label':t("Private management code")});
    body.append(field(t("Private management code"),input,t("Anyone with this code can edit or delete this review. Keep it private. Save it to manage your review if browser data is cleared or you switch devices.")));
    const feedback=message('');body.append(button(t("Copy management code"),async()=>{try{await navigator.clipboard.writeText(token);feedback.textContent=t("Copied.");}catch{input.select();feedback.textContent=t("Select and copy the code above.");}}),feedback);
  }
  function edit(review,token){
    const body=shell(token?t("Edit your review"):t("Write a review"));st.opened=Date.now();body.append(el('h3',{},review.campsite_name));const f=el('form');
    f.append(field(t("Public name"),el('input',{name:'display_name',required:true,maxlength:60,value:review.display_name||'',autocomplete:'nickname'}),t("Use a nickname if you prefer. This will be public.")));
    const rating=el('select',{name:'rating',required:true});rating.append(el('option',{value:''},t("Choose a rating")));for(let i=1;i<=5;i++)rating.append(el('option',{value:i,selected:+review.rating===i},t("{0} of 5", {"0":(i)})));f.append(field(t("Overall rating"),rating));
    f.append(field(t("Date visited"),el('input',{name:'visited_on',type:'date',required:true,max:new Date().toISOString().slice(0,10),value:review.visited_on||''})),field(t("Rig or camping setup (optional)"),el('input',{name:'rig',maxlength:100,value:review.rig||''}),t("For example: 22-foot camper van.")));
    window.KampTrailDiscovery?.observeFields(f,review,el,field);
    const video=el('input',{name:'youtube_video',maxlength:200,value:review.video?.id||'',autocomplete:'off',spellcheck:false});
    f.append(field(t('YouTube video (optional)'),video,t('One video ID or exact https://www.youtube.com/watch?v=ID or https://youtu.be/ID URL. No video files are uploaded.')));
    if(review.video)f.append(button(t('Remove attached video'),()=>{video.value='';}),el('p',{class:'kt-fine'},t('Leave the video field empty to remove it when you save.')));
    f.append(el('p',{class:'kt-fine'},t('Attach only a video you recorded or have permission to share about this campsite. The whole review and video need moderator approval. Saving edits removes both from public view until reviewed again.')));
    const text=el('textarea',{name:'body',required:true,minlength:20,maxlength:3000,rows:5},review.body||'');f.append(field(t("Your experience"),text,t("What helped you decide, and what should the next camper know? Include road access, noise, conditions or carrier reception you observed.")));
    if(token&&review.photos?.length){const set=el('fieldset');set.append(el('legend',{},t("Existing photos")));for(const p of review.photos){const l=el('label',{class:'kt-confirm'});l.append(el('input',{name:'remove_photos[]',type:'checkbox',value:p.id}),t(" Remove photo #{0} ({1})", {"0":(p.id),"1":(p.status)}));set.append(l);}f.append(set);}
    const files=el('input',{name:'photos[]',type:'file',accept:'image/jpeg,image/png,image/webp',multiple:true});
    f.append(field(t("Photos (optional)"),files,t("Up to 3 total. JPEG, PNG or WebP, 6 MB and 16 megapixels per image. Images are resized and metadata is removed. HEIC is not supported.")));
    const preview=el('div',{class:'kt-photo-grid'}),urls=[];f.append(preview);files.onchange=()=>{urls.splice(0).forEach(URL.revokeObjectURL);preview.replaceChildren();for(const file of [...files.files].slice(0,3)){if(!/^image\/(jpeg|png|webp)$/.test(file.type))continue;const u=URL.createObjectURL(file);urls.push(u);preview.append(el('img',{src:u,alt:t("Photo selected for upload")}));}};
    st.dialog.addEventListener('close',()=>urls.splice(0).forEach(URL.revokeObjectURL),{once:true});
    const hp=el('input',{name:'website',tabindex:-1,autocomplete:'off','aria-hidden':true,class:'kt-hp'});f.append(hp);
    const consent=el('label',{class:'kt-confirm'});consent.append(el('input',{type:'checkbox',name:'firsthand',value:1,required:true}),t(" This is my firsthand experience. I own these photos or have permission to publish them on KampTrail. I have not copied another app’s reviews."));f.append(consent);
    f.append(el('p',{class:'kt-fine'},t("Your name, review, visit date, rig details, optional observations and approved photos become public. Do not include private contact details, identifiable people without permission, or sensitive locations. Moderators check submissions before publication.")));
    if(token)f.append(el('p',{class:'kt-fine'},t("Saving edits removes this review and its photos from public view until they are reviewed again.")));
    const msg=message(''),send=el('button',{type:'submit',class:'btn primary'},token?t("Save and resubmit"):t("Send for review"));f.append(msg,send);body.append(f,button(t("My reviews"),mine));
    f.onsubmit=async e=>{e.preventDefault();const chosen=[...files.files],remaining=(review.photos||[]).filter(p=>!new FormData(f).getAll('remove_photos[]').includes(String(p.id))).length;
      if(chosen.length+remaining>3||chosen.some(f=>f.size>6291456)){msg.textContent=t("Use at most 3 photos total, each 6 MB or smaller.");return;}
      const data=new FormData(f);if(!chosen.length)data.delete('photos[]');data.set('action',token?'edit':'submit');data.set('campsite_id',review.campsite_id);data.set('campsite_name',review.campsite_name);data.set('elapsed_ms',Date.now()-st.opened);data.set('observations',JSON.stringify(window.KampTrailDiscovery?.formValues(f)||{}));send.disabled=true;msg.textContent=t("Sending…");
      try{const out=await request(data,token);window.dispatchEvent(new CustomEvent('kamptrail:communitychanged'));const code=token||out.token;const stored=remember({token:code,name:review.campsite_name,at:new Date().toISOString()});urls.splice(0).forEach(URL.revokeObjectURL);const done=shell(t("Review received"));done.append(message(t('Thanks. Your review, photos and optional video are waiting for moderation.')),el('p',{class:'kt-fine'},stored?t("Your management code is saved on this device."):t("This browser could not save the code. Copy it now so you can manage your review.")));codePanel(done,code);done.append(button(t("My reviews"),mine));}
      catch(err){msg.textContent=err.message;msg.classList.add('is-error');}finally{send.disabled=false;}
    };
  }
  async function manage(token){
    const body=shell(t("Manage your review")),view=st.view;body.append(message(t("Loading…")));
    try{const res=await fetch(API,{headers:{Authorization:'Bearer '+token}}),out=await res.json();if(view!==st.view)return;if(!res.ok)throw new Error((out.message?t(out.message):null)||t("Review unavailable."));const r=out.review;
      remember({token,name:r.campsite_name,at:r.updated_at});body.replaceChildren(el('h3',{},r.campsite_name),message(`Status: ${r.status}.`));if(r.public_note)body.append(el('p',{},t("Moderator note: ")+r.public_note));
      if(r.status==='deleted'){body.append(el('p',{},t("Your review and photo content have been deleted.")));return;}
      body.append(el('p',{class:'kt-review-text'},r.body),button(t("Edit review"),()=>edit(r,token)));codePanel(body,token);
      const confirm=el('label',{class:'kt-confirm'}),check=el('input',{type:'checkbox'});confirm.append(check,t(" Delete my review and photos permanently."));const del=button(t("Delete my review"),async()=>{if(!check.checked){notice.textContent=t("Check the deletion confirmation first.");return;}del.disabled=true;const data=new FormData();data.set('action','delete');try{await request(data,token);window.dispatchEvent(new CustomEvent('kamptrail:communitychanged'));await manage(token);}catch(err){notice.textContent=err.message;del.disabled=false;}}),notice=message('');body.append(confirm,del,notice,button(t("My reviews"),mine));
    }catch(err){if(view===st.view)body.replaceChildren(message(err.message||t("Unable to load your review. Try again online."),true),button(t("Retry"),()=>manage(token)),button(t("My reviews"),mine));}
  }
  function mine(){st.focus=document.activeElement;const body=shell(t("My reviews"));if(legacyAddress(body))return;body.append(el('p',{class:'kt-fine'},t("Management codes stay on this device. Copy yours to keep access on another device. No account is needed.")));
    const list=el('ul',{class:'kt-report-list'});for(const r of saved()){const li=el('li');li.append(button(r.name,()=>manage(r.token)));list.append(li);}if(!saved().length)body.append(el('p',{},t("No reviews saved on this device yet.")));body.append(list);
    const f=el('form'),code=el('input',{name:'code',required:true,pattern:'[a-f0-9]{64}',autocomplete:'off',spellcheck:false});f.append(field(t("Restore a private management code"),code),el('button',{type:'submit',class:'btn'},t("Open my review")));f.onsubmit=e=>{e.preventDefault();manage(code.value.trim());};body.append(f);
  }
  function report(id,photo){const body=shell(photo?t("Report a photo"):t("Report a review")),f=el('form');const reason=el('textarea',{name:'reason',required:true,minlength:10,maxlength:1000,rows:4});f.append(field(t("What is the problem?"),reason,t("Examples: private information, harassment, copied content, or a misleading campsite claim. A moderator will review the report.")));const msg=message(''),send=el('button',{class:'btn',type:'submit'},t("Send report"));f.append(msg,send);body.append(f);f.onsubmit=async e=>{e.preventDefault();send.disabled=true;const data=new FormData(f);data.set('action','report');data.set('review_id',id);if(photo)data.set('photo_id',photo);try{const out=await request(data);body.replaceChildren(message(t(out.message)),button(t("Close"),()=>st.dialog.close()));}catch(err){msg.textContent=err.message;send.disabled=false;}};}
  window.KampTrailCommunity={version:'2.19.0',open,mine};
})();
