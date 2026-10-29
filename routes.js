/* Road geometry and along-route discovery. Distances from a route are not driving detours. */
(function(global){
  'use strict';
  const MI=1609.344,EARTH=3958.7613,MAX_STOPS=25,CELL=.5,PAGE=40;
  const st={dialog:null,view:0,previousFocus:null};
  const rad=v=>v*Math.PI/180;
  function miles(a,b){const dlat=rad(b[1]-a[1]),dlon=rad(b[0]-a[0]),h=Math.sin(dlat/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(dlon/2)**2;return EARTH*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}
  function segmentDistance(p,a,b){
    const wrap=x=>((x+540)%360)-180,c=Math.cos(rad(p[1])),ax=rad(wrap(a[0]-p[0]))*EARTH*c,ay=rad(a[1]-p[1])*EARTH,bx=ax+rad(wrap(b[0]-a[0]))*EARTH*c,by=rad(b[1]-p[1])*EARTH;
    const dx=bx-ax,dy=by-ay,t=dx*dx+dy*dy?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy))):0;
    return{distance:Math.hypot(ax+t*dx,ay+t*dy),t};
  }
  function simplify(points,tolerance=.025){
    if(points.length<3)return points;const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
    while(stack.length){const[a,b]=stack.pop();let max=tolerance,split=-1;for(let i=a+1;i<b;i++){const d=segmentDistance(points[i],points[a],points[b]).distance;if(d>max){max=d;split=i;}}if(split>=0){keep.add(split);stack.push([a,split],[split,b]);}}
    return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
  }
  function validRoute(r){return r&&Number.isFinite(Date.parse(r.calculated_at))&&Number.isFinite(r.distance)&&r.distance>=0&&Number.isFinite(r.duration)&&r.duration>=0&&r.geometry?.type==='LineString'&&Array.isArray(r.geometry.coordinates)&&r.geometry.coordinates.length>=2&&r.geometry.coordinates.length<=150000&&r.geometry.coordinates.every(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90)&&Array.isArray(r.legs)&&r.legs.length>=1&&r.legs.every(l=>Number.isFinite(l.distance)&&l.distance>=0&&Number.isFinite(l.duration)&&l.duration>=0)&&Array.isArray(r.leg_ends)&&r.leg_ends.length===r.legs.length&&r.leg_ends.every((n,i)=>Number.isInteger(n)&&n>=(i?r.leg_ends[i-1]:0)&&n<r.geometry.coordinates.length)&&r.leg_ends.at(-1)===r.geometry.coordinates.length-1;}
  function corridor(route,radius){
    const grid=new Map(),segments=[];let start=0,progress=0;
    route.leg_ends.forEach((end,leg)=>{const line=simplify(route.geometry.coordinates.slice(start,end+1));start=end;for(let i=1;i<line.length;i++){
      const a=line[i-1],b=line[i],length=miles(a,b),index=segments.length;segments.push({a,b,leg,progress,length});progress+=length;
      const dy=(radius+.03)/69,dx=dy/Math.max(.07,Math.cos(rad(Math.max(Math.abs(a[1]),Math.abs(b[1])))));
      const endLng=a[0]+((b[0]-a[0]+540)%360)-180;const west=Math.floor((Math.min(a[0],endLng)-dx)/CELL),east=Math.floor((Math.max(a[0],endLng)+dx)/CELL),south=Math.floor((Math.min(a[1],b[1])-dy)/CELL),north=Math.floor((Math.max(a[1],b[1])+dy)/CELL);
      for(let x=west;x<=east;x++)for(let y=south;y<=north;y++){const key=(((x+360)%720+720)%720-360)+','+y;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(index);}
    }});
    return p=>{const ids=grid.get(Math.floor(p[0]/CELL)+','+Math.floor(p[1]/CELL))||[];let best=null;for(const id of ids){const s=segments[id],d=segmentDistance(p,s.a,s.b);if(d.distance<=radius&&(!best||d.distance<best.distance))best={distance:d.distance,leg:s.leg,progress:s.progress+s.length*d.t};}return best;};
  }
  function indexFeature(row){const m=row.m||{};return{type:'Feature',geometry:{type:'Point',coordinates:[row.lng,row.lat]},properties:{id:row.id,legacy_ids:Array.isArray(row.legacy_ids)?row.legacy_ids:[],name:row.name,fee_status:m.f||'unknown',type:m.t||'unknown',amenities:Array.isArray(m.a)?m.a:[],rig_friendly:Array.isArray(m.r)?m.r:[],road_difficulty:m.d||null,rating:Number.isFinite(m.q)?m.q:null,rv_sigs:Array.isArray(m.g)?m.g:[]}};}
  function find(sites,route,radius,filters={},exclude=[]){const near=corridor(route,radius),skip=new Set(exclude),out=[];for(const row of sites){if(skip.has(row.id)||!Number.isFinite(row.lng)||!Number.isFinite(row.lat))continue;const hit=near([row.lng,row.lat]);if(!hit)continue;const feature=indexFeature(row);if(global.DataQuality&&!DataQuality.applyFilters([feature],filters).length)continue;out.push({row,feature,...hit});}return out.sort((a,b)=>a.leg-b.leg||a.progress-b.progress||a.distance-b.distance||a.row.name.localeCompare(b.row.name));}
  const cacheName=()=>`kamptrail:${new URL('./',location.href).href}:routes-v1`;
  const key=points=>points.map(p=>p.map(v=>+v.toFixed(5)).join(',')).join(';');
  const cacheURL=points=>new URL('__saved_road_route__?points='+encodeURIComponent(key(points)),new URL('./',location.href)).href;
  async function cached(points){try{const c=await caches.open(cacheName()),r=await c.match(cacheURL(points));if(r){const d=await r.json();if(validRoute(d)&&Number.isFinite(Date.parse(d.calculated_at)))return d;}}catch{}return null;}
  async function remember(points,route){try{const c=await caches.open(cacheName());await c.put(cacheURL(points),new Response(JSON.stringify(route),{headers:{'Content-Type':'application/json'}}));const keys=await c.keys();for(const k of keys.slice(0,Math.max(0,keys.length-8)))await c.delete(k);}catch{/* Storage failure never turns a successful route into a failed calculation. */}}
  async function calculate(points,{refresh=false}={}){
    if(location.hostname==='prowebpromo.github.io')throw new Error('Road routing runs at kamptrail.com. Export your saved stops as GPX here, then import them at the current address.');
    if(!Array.isArray(points)||points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>85)||points.length<2||points.length>26||new Set(points.map(p=>p.join(','))).size<2)throw new Error('Choose at least two different locations, with at most 25 saved stops.');
    const saved=await cached(points),age=saved?Date.now()-Date.parse(saved.calculated_at):Infinity;
    if(saved&&(!navigator.onLine||(!refresh&&age<86400000)))return{...saved,from_cache:true,offline:!navigator.onLine};
    if(!navigator.onLine)throw new Error('This road route has not been saved on this device. Reconnect to calculate it.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{const r=await fetch('api/route.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({points}),signal:controller.signal}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Road routing is unavailable. Try again later.');if(!validRoute(d.route))throw new Error('The routing service returned incomplete road geometry.');await remember(points,d.route);return d.route;}catch(e){if(saved)return{...saved,from_cache:true,source_unavailable:true};if(e.name==='AbortError')throw new Error('Road routing timed out. Try again or use external directions.');throw e;}finally{clearTimeout(timer);}
  }
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  function button(text,fn){const b=el('button',text,'btn');b.type='button';b.onclick=fn;return b;}
  function shell(){if(!st.dialog){const d=el('dialog');d.id='kt-route-discovery';d.setAttribute('aria-labelledby','kt-route-discovery-title');const h=el('div',null,'kt-report-head'),title=el('h2','Campsites along your route');title.id='kt-route-discovery-title';h.append(title,button('Close',()=>d.close()));d.append(h,el('div',null,'kt-route-discovery-body'));d.addEventListener('close',()=>{st.view++;st.previousFocus?.focus?.();});document.body.append(d);st.dialog=d;}st.view++;const body=st.dialog.querySelector('.kt-route-discovery-body');body.replaceChildren();if(!st.dialog.open)st.dialog.showModal();return body;}
  const fee=p=>({free:'Reported free',conditional:'Free with conditions',paid:'Paid; amount in listing',unknown:'Fee unknown'}[p.fee_status]||'Fee unknown');
  const time=s=>{const m=Math.round(s/60),h=Math.floor(m/60);return h?`${h} hr ${m%60} min`:`${m} min`;};
  function activeFilters(f){return(f.cost&&f.cost!=='all')||(f.type&&f.type!=='all')||(f.rigSize&&f.rigSize!=='all')||f.rigLength>0||f.amenities?.length||f.hookups?.length||f.minRating>0||(f.roadDifficulty&&f.roadDifficulty!=='all')||global.KampTrailDiscovery?.active(f);}
  function filtersLabel(f){return[f.cost&&f.cost!=='all'?f.cost+' fees':null,f.type&&f.type!=='all'?f.type:null,f.rigLength>0?f.rigLength+' ft rig':null,...(f.hookups||[]),...(f.amenities||[]),f.rigSize&&f.rigSize!=='all'?f.rigSize:null,f.minRating>0?'Community rating '+f.minRating+'+':null,+f.minReviews>1?(f.minReviews+'+ published reviews'):f.minRating>0?'1+ published reviews':null,...Object.entries(global.KampTrailDiscovery?.AXES||{}).filter(([k])=>f['observed_'+k]).map(([k,a])=>a.label+': '+a.values[f['observed_'+k]]),f.observed_carrier?global.KampTrailDiscovery.CARRIERS[f.observed_carrier]:null,f.observed_signal?'Signal: '+global.KampTrailDiscovery.SIGNAL_FILTER[f.observed_signal]:null,global.KampTrailDiscovery?.conditions(f)?(+f.observedDays>0?'Visits within '+f.observedDays+' days':'Any visit date'):null].filter(Boolean).join(' · ')||'All fees and campsite types';}
  function tripKey(sites){return sites.map(s=>s.properties.id+'@'+s.geometry.coordinates.join(',')).join('|');}
  async function open(route,sites,callbacks={}){
    if(!validRoute(route))return;st.previousFocus=document.activeElement;const body=shell(),view=st.view,originalKey=tripKey(sites),points=sites.map(s=>s.geometry.coordinates),filters={...(global.kamptrailFilters||{})};let index=null,rows=[],shown=0;
    if(route.from_cache)body.append(el('p',`Saved route from ${route.calculated_at.slice(0,10)}. ${route.offline?'Offline.':route.source_unavailable?'Routing service unavailable.':''} Conditions may have changed.`,'kt-fine'));
    body.append(el('p',`${Math.round(route.distance/MI).toLocaleString()} road miles · ${time(route.duration)} by car. Route calculated ${route.calculated_at.slice(0,10)}.`),el('p','Find catalogue campsites near the actual road route. Distance from the line is approximate straight-line distance. Driving detours are calculated separately. Routes do not check RV height, weight, length or road conditions.','kt-fine'));
    const controls=el('div',null,'kt-route-search-controls'),radius=el('select');radius.setAttribute('aria-label','Search distance on each side of route');for(const n of [1,5,10,25]){const o=el('option',`${n} ${n===1?'mile':'miles'} each side`);o.value=n;o.selected=n===5;radius.append(o);}const radiusLabel=el('label','Search corridor ');radiusLabel.append(radius);
    const use=el('input');use.type='checkbox';use.checked=true;const useLabel=el('label');useLabel.append(use,' Use current map filters');const terms=el('input');terms.type='search';terms.setAttribute('aria-label','Filter campsite names');terms.placeholder='Campsite name (optional)';const sort=el('select');sort.setAttribute('aria-label','Sort route results');for(const [value,text]of [['progress','Order along route'],['distance','Distance from route']]){const o=el('option',text);o.value=value;sort.append(o);}controls.append(radiusLabel,useLabel,el('p',filtersLabel(filters),'kt-fine'),terms,sort);body.append(controls);
    const evidence=el('p',null,'kt-fine');body.append(evidence);
    const status=el('p','Loading national campsite index…');status.setAttribute('role','status');status.setAttribute('aria-live','polite');const list=el('div',null,'kt-route-results'),more=button('Show more campsites',()=>renderMore());more.hidden=true;body.append(status,list,more);
    const unchanged=()=>{const now=global.KampTrailTrip?.getStops?.().map(x=>x.feature).filter(Boolean);return !now||tripKey(now)===originalKey;};
    const stillCurrent=()=>view===st.view&&st.dialog.open;
    function search(){if(!index||!stillCurrent())return;list.replaceChildren();shown=0;more.hidden=true;
      if(use.checked&&(activeFilters(filters)&&index.filter_version!==1||global.KampTrailDiscovery?.active(filters)&&index.community_version!==1)){status.textContent='Filter details are unavailable in this saved catalogue. Reconnect and retry the catalogue.';status.append(button('Retry catalogue',()=>load(true)));return;}
      evidence.textContent=global.KampTrailDiscovery?.active(filters)&&use.checked?global.KampTrailDiscovery.status():'';
      rows=find(index.sites,route,+radius.value,use.checked?filters:{},sites.map(s=>s.properties.id));const term=terms.value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();if(term)rows=rows.filter(x=>x.row.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(term));if(sort.value==='distance')rows.sort((a,b)=>a.distance-b.distance||a.progress-b.progress);
      status.textContent=rows.length?`${rows.length.toLocaleString()} matching campsites within ${radius.value} miles of the road route.`:'No catalogue campsites match this corridor and these filters. Unknown fees or rig lengths do not count as verified matches.';renderMore();
    }
    function renderMore(){for(const match of rows.slice(shown,shown+PAGE)){
      const{row,feature}=match,card=el('article',null,'kt-route-result'),p=feature.properties;card.append(el('h3',row.name),el('p',`${fee(p)} · about ${match.distance.toFixed(1)} mi from route · leg ${match.leg+1}`));
      const community=global.KampTrailDiscovery?.summary(p);if(community)card.append(el('p',`${(community.rating_sum/community.rating_count).toFixed(1)}/5 · ${community.rating_count} published ${community.rating_count===1?'review':'reviews'} · latest visit ${community.latest_visit}`,'kt-fine'));
      const matched=use.checked?global.KampTrailDiscovery?.matchNote(p,filters):'';if(matched)card.append(el('p',matched,'kt-fine'));
      if(filters.rigLength>0&&use.checked&&!DataQuality.matchingSites(p,+filters.rigLength,filters.hookups||[],false))card.append(el('p','RV length not documented.','kt-fine'));
      const note=el('p',null,'kt-fine'),actions=el('div',null,'kt-community-actions');
      actions.append(button('View listing',async()=>{if(!unchanged()){note.textContent='Your stops changed. Calculate the new route before using these results.';return;}note.textContent='Loading listing…';try{await KampTrailData.loadStates(row.states||[]);if(!stillCurrent())return;st.dialog.close();if(!KampTrailData.focusCampsite(row.id))global.showToast?.('The source listing is unavailable. Try again when connected.','error');}catch{note.textContent='This listing could not load. Try again when connected.';}}));
      const detour=button('Estimate driving detour',async()=>{if(!unchanged()){note.textContent='Your stops changed. Calculate the new route first.';return;}detour.disabled=true;note.textContent='Calculating a car route through this campsite…';try{const via=points.slice();via.splice(match.leg+1,0,[row.lng,row.lat]);const added=await calculate(via);if(!stillCurrent())return;if(!unchanged()){note.textContent='Your stops changed while routing. Calculate the updated trip.';return;}const seconds=Math.max(0,added.duration-route.duration),distance=Math.max(0,(added.distance-route.distance)/MI);note.textContent=`Estimated added car driving: ${time(seconds)}, ${distance.toFixed(1)} mi. The route can change; RV restrictions are not checked.`;}catch(e){note.textContent=e.message;}finally{detour.disabled=false;}});actions.append(detour);
      actions.append(button(`Add after stop ${match.leg+1}`,()=>{if(!unchanged()){note.textContent='Your stops changed. Calculate the new route first.';return;}st.dialog.close();callbacks.insert?.(feature,match.leg);global.showToast?.('Stop added in route order. Calculate again to update the road route.','info');}));card.append(actions,note);list.append(card);
    }shown=Math.min(rows.length,shown+PAGE);more.hidden=shown>=rows.length;}
    async function load(force=false){status.textContent='Loading national campsite index…';try{index=await KampTrailData.loadSearchIndex(force);if(stillCurrent())search();}catch{if(stillCurrent()){status.textContent='The campsite catalogue is unavailable. Reconnect or retry.';status.append(button('Retry catalogue',()=>load(true)));}}}
    global.addEventListener?.('kamptrail:discoveryupdated',search);st.dialog.addEventListener('close',()=>global.removeEventListener?.('kamptrail:discoveryupdated',search),{once:true});if(global.KampTrailDiscovery?.active(filters))global.KampTrailDiscovery.load();
    radius.onchange=search;use.onchange=search;sort.onchange=search;let timer;terms.oninput=()=>{clearTimeout(timer);timer=setTimeout(search,200);};await load();
  }
  global.KampTrailRoutes={version:'2.9.0',calculate,open,validRoute,indexFeature,find,corridor,simplify,segmentDistance,miles,key,MAX_STOPS};
})(typeof window!=='undefined'?window:globalThis);
