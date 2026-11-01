/* Clearance candidates along a calculated route. Road association comes only from exact OSM identity
   carried by the route; distance only finds nearby candidates. Never a routing, passage or safety decision. */
(function(root){
 'use strict';
 const t=(key,params={})=>(typeof window!=='undefined'?window.KampTrailI18n:globalThis.KampTrailI18n)?.t(key,params)??String(key).replace(/\{([a-zA-Z0-9_]+)\}/g,(token,name)=>Object.hasOwn(params,name)?String(params[name]):token);
 const VERSION='2.35.0',SCHEMA='kamptrail-route-clearance-1',RADIUS=100,CHUNK=64;
 const MAX_ROUTE_TILES=96,MAX_ROUTE_BYTES=12*1024*1024,MAX_FOUND=2000,BUDGET=20000000;
 // The RI pilot is protected and not in the national dataset yet, so a route there has no data.
 const NOT_IN_DATASET={RI:[-71.907,41.095,-71.088,42.019]};
 const ID=/^[1-9][0-9]{0,15}$/;
 const coord=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
 function xy(p,lat){return [p[0]*111320*Math.cos(lat*Math.PI/180),p[1]*111320];}
 function pointSegment(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy,s=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d)):0;return Math.hypot(p[0]-a[0]-s*dx,p[1]-a[1]-s*dy);}
 function segmentDistance(a,b,c,d){const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b);if(x*y<=0&&z*w<=0&&Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))&&Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1])))return 0;return Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));}
 function bounds(points){return points.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[180,90,-180,-90]);}
 function grow(b,m=RADIUS){const lat=Math.max(Math.abs(b[1]),Math.abs(b[3])),dy=m/111000,dx=dy/Math.max(.05,Math.cos(lat*Math.PI/180));return [b[0]-dx,b[1]-dy,b[2]+dx,b[3]+dy];}
 const hit=(a,b)=>a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
 function nearBounds(a,b){return hit(grow(a),b);}
 // Shortest planar distance from a candidate to one route segment, in metres.
 function segmentMetres(a,b,pts,budget){const lat=(a[1]+b[1])/2,A=xy(a,lat),B=xy(b,lat);if(pts.length===1){if(--budget.left<0)throw Error('Search limit reached');return pointSegment(xy(pts[0],lat),A,B);}let best=Infinity;for(let j=1;j<pts.length;j++){if(--budget.left<0)throw Error('Search limit reached');best=Math.min(best,segmentDistance(A,B,xy(pts[j-1],lat),xy(pts[j],lat)));if(!best)return 0;}return best;}
 function distance(route,points,budget){let best=Infinity;const pb=bounds(points);for(let i=1;i<route.length;i++){if(--budget.left<0)throw Error('Search limit reached');if(!nearBounds(bounds([route[i-1],route[i]]),pb))continue;best=Math.min(best,segmentMetres(route[i-1],route[i],points,budget));if(best===0)return 0;}return best;}

 function routeShape(route){
  const coords=route?.geometry?.coordinates;
  if(route?.geometry?.type!=='LineString'||!Array.isArray(coords)||coords.length<2||coords.length>150000||!coords.every(coord))throw Error('Invalid route');
  // Optional exact identity: way_ids[i] is the OSM way that segment i (coords[i] to coords[i+1]) drives; node_ids[i] is the OSM node at coords[i].
  const osm=route.osm;let ways=null,nodes=null;
  if(osm!==undefined){
   if(!osm||typeof osm!=='object'||Array.isArray(osm))throw Error('Invalid route identity');
   if(osm.way_ids!==undefined){if(!Array.isArray(osm.way_ids)||osm.way_ids.length!==coords.length-1||!osm.way_ids.every(v=>v===null||typeof v==='string'&&ID.test(v)))throw Error('Invalid route way ids');ways=osm.way_ids;}
   if(osm.node_ids!==undefined){if(!Array.isArray(osm.node_ids)||osm.node_ids.length!==coords.length||!osm.node_ids.every(v=>v===null||typeof v==='string'&&ID.test(v)))throw Error('Invalid route node ids');nodes=osm.node_ids;}
  }
  const ends=Array.isArray(route.leg_ends)&&route.leg_ends.every(Number.isSafeInteger)?route.leg_ends:[coords.length-1];
  const chunks=[];for(let i=0;i<coords.length-1;i+=CHUNK){const end=Math.min(coords.length-1,i+CHUNK);chunks.push({from:i,to:end,box:grow(bounds(coords.slice(i,end+1)))});}
  return {coords,ways,nodes,ends,chunks,waySet:ways?new Set(ways.filter(Boolean)):null,nodeSet:nodes?new Set(nodes.filter(Boolean)):null};
 }
 const segBox=(s,i)=>grow(bounds([s.coords[i],s.coords[i+1]]));
 function legOf(s,i){const k=s.ends.findIndex(e=>i<e);return k<0?s.ends.length:k+1;}
 function lengthOf(s,from,to){let m=0;for(let i=from;i<to;i++){const a=s.coords[i],b=s.coords[i+1],lat=(a[1]+b[1])/2,A=xy(a,lat),B=xy(b,lat);m+=Math.hypot(A[0]-B[0],A[1]-B[1]);}return m;}

 // Association from exact OSM identity only. Distance never associates a candidate with the driven road.
 function associate(c,s,near){
  if(c.osm_type==='way'){
   if(!s.waySet)return {association:'unresolved',evidence:['route_has_no_way_ids']};
   if(s.waySet.has(c.osm_id)){
    if(c.applies_to==='unknown')return {association:'unresolved',evidence:['route_way_id_equals_candidate_way','applies_to_unknown']};
    return {association:'on_route',evidence:['route_way_id_equals_candidate_way','applies_to='+c.applies_to]};
   }
   if(near.every(i=>s.ways[i]!==null))return {association:'not_on_route',evidence:['route_way_ids_exclude_candidate_way']};
   return {association:'unresolved',evidence:['route_way_ids_incomplete_near_candidate']};
  }
  if(!s.nodeSet)return {association:'unresolved',evidence:['route_has_no_node_ids']};
  if(s.nodeSet.has(c.osm_id))return {association:'on_route',evidence:['route_passes_candidate_node']};
  if(near.every(i=>s.nodes[i]!==null&&s.nodes[i+1]!==null))return {association:'not_on_route',evidence:['route_node_ids_exclude_candidate_node']};
  return {association:'unresolved',evidence:['route_node_ids_incomplete_near_candidate']};
 }
 function direction(c,assoc){
  if(assoc!=='on_route')return 'unresolved';
  if(c.status==='directional_only'||c.status==='mixed'||Object.keys(c.tags).some(k=>/:(forward|backward|lanes)$/.test(k)))return 'unresolved';
  return 'not_directional';
 }

 async function analyze(route,{env=root,rigMm=null,store=null,base=''}={}){
  const C=env.KampTrailClearances||(typeof require==='function'?require('./clearances.js'):null);if(!C?.createStore)throw Error('Clearance validation unavailable');
  const s=routeShape(route),data=store||C.createStore(env,base),m=await data.loadManifest();
  // Tiles each segment needs, in route order. Tiles beyond the budget leave their segments missing.
  const needed=new Map();
  for(const ch of s.chunks)for(const e of m.tiles){if(!hit(e.bbox,ch.box))continue;for(let i=ch.from;i<ch.to;i++)if(hit(e.bbox,segBox(s,i))){if(!needed.has(e.path))needed.set(e.path,{entry:e,first:i,segments:[],chunks:new Set()});const n=needed.get(e.path);n.segments.push(i);n.chunks.add(ch);}}
  const order=[...needed.values()].sort((a,b)=>a.first-b.first||a.entry.path.localeCompare(b.entry.path));
  const missing=new Map(),mark=(i,reason)=>{if(!missing.has(i))missing.set(i,reason);};
  let bytes=0,loaded=[],skipped=[];
  for(const n of order){if(loaded.length<MAX_ROUTE_TILES&&bytes+n.entry.bytes<=MAX_ROUTE_BYTES){loaded.push(n);bytes+=n.entry.bytes;}else skipped.push(n);}
  for(const n of skipped)for(const i of n.segments)mark(i,'route_tile_budget');
  for(let i=0;i<s.coords.length-1;i++)for(const [region,box] of Object.entries(NOT_IN_DATASET))if(hit(segBox(s,i),box))mark(i,'region_not_in_dataset:'+region);
  const found=new Map(),budget={left:BUDGET};let failed=0;
  for(let k=0;k<loaded.length;k+=4){
   await Promise.all(loaded.slice(k,k+4).map(async n=>{
    let doc;try{doc=await data.loadTile(n.entry);}catch{failed++;for(const i of n.segments)mark(i,'tile_failed_integrity');return;}
    for(const c of doc.candidates){
     if(found.has(c.id))continue;const pts=C.points(c),cb=C.bboxOf(c);let best=Infinity,nearest=-1;const near=[];
     for(const ch of n.chunks){if(!hit(ch.box,cb))continue;for(let i=ch.from;i<ch.to;i++){if(--budget.left<0)throw Error('Search limit reached');if(!hit(segBox(s,i),cb))continue;const d=segmentMetres(s.coords[i],s.coords[i+1],pts,budget);if(d<=RADIUS)near.push(i);if(d<best){best=d;nearest=i;}}}
     if(best>RADIUS)continue;
     const a=associate(c,s,near),cmp=C.compare(c,rigMm);
     found.set(c.id,{candidate:c,id:c.id,osm_type:c.osm_type,osm_id:c.osm_id,distance_m:Math.round(best),nearest_segment:nearest,leg:legOf(s,nearest),association:a.association,association_evidence:a.evidence,direction:direction(c,a.association),state:C.state(c),status:c.status,applies_to:c.applies_to,comparison:cmp,route_conflict:a.association==='on_route'&&cmp.conflict});
     if(found.size>MAX_FOUND)throw Error('Search limit reached');
    }
   }));
  }
  const ranges=[];for(const i of [...missing.keys()].sort((a,b)=>a-b)){const r=missing.get(i),last=ranges.at(-1);if(last&&last.to===i&&last.reason===r)last.to=i+1;else ranges.push({from:i,to:i+1,reason:r});}
  for(const r of ranges)r.length_m=Math.round(lengthOf(s,r.from,r.to));
  const rows=[...found.values()].sort((a,b)=>a.nearest_segment-b.nearest_segment||a.id.localeCompare(b.id));
  const by=x=>rows.filter(x).length;
  return {schema:SCHEMA,dataset:{schema:m.schema,attribution:m.attribution,copyright_url:m.copyright_url,sources:m.sources,not_in_dataset:Object.keys(m.states_protected)},
   rig_height_mm:Number.isSafeInteger(rigMm)?rigMm:null,search_radius_m:RADIUS,
   association_method:s.waySet||s.nodeSet?'exact_osm_identity':'none',
   association_limits:s.waySet||s.nodeSet?'Only candidates whose OSM way or node id is in the route identity lists are on the route. Segments without ids stay unresolved.':'The route carries no OSM way or node ids, so no candidate can be tied to the driven road. All nearby candidates are unresolved.',
   segments:s.coords.length-1,tiles:{needed:order.length,loaded:loaded.length-failed,failed,skipped:skipped.length,bytes},missing:ranges,candidates:rows,
   summary:{on_route:by(r=>r.association==='on_route'),on_route_conflicts:by(r=>r.route_conflict),on_route_unresolved_value:by(r=>r.association==='on_route'&&r.state!=='comparable'),unresolved:by(r=>r.association==='unresolved'),not_on_route:by(r=>r.association==='not_on_route'),missing_segments:ranges.reduce((n,r)=>n+r.to-r.from,0)},
   route_clear:false};
 }
 // The old RI-only entry point is kept for callers; it now reads the national candidates.
 async function load(route,env=root){const r=await analyze(route,{env});return {source:r.dataset,found:r.candidates.map(x=>({item:x.candidate,meters:x.distance_m,...x}))};}

 function open(route,env=root){
  const doc=env.document,C=env.KampTrailClearances,el=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const d=el('dialog');d.id='kt-route-clearance';d.setAttribute('aria-labelledby','kt-route-clearance-title');
  const h=el('h2',t('Clearance candidates along route'));h.id='kt-route-clearance-title';
  const close=el('button',t('Close'));close.type='button';close.onclick=()=>d.close();
  const intro=el('p',t('Searches OpenStreetMap clearance candidates within about 100 m of the calculated route. A candidate counts as on the driven road only when the route carries the same OSM way or node id. Nearby candidates without that evidence stay unresolved: they may be on another road, another level or another direction. Segments without data, and any unmapped hazards, are unknown. Nothing here means a route is clear.'));
  const status=el('p',t('Loading clearance candidates…'));status.setAttribute('role','status');
  const list=el('div');d.append(close,h,intro,status,list);if(C?.attributionNode)d.append(C.attributionNode(doc));doc.body.append(d);d.showModal();
  let stale=false;const invalidate=()=>{stale=true;status.textContent=t('The route, itinerary or rig height changed. Close and search the current route again.');list.replaceChildren();};
  const events=['kamptrail:tripchanged','kamptrail:routechanged','kamptrail:rigprofilechanged'];for(const e of events)env.addEventListener(e,invalidate,{once:true});
  d.addEventListener('close',()=>{stale=true;for(const e of events)env.removeEventListener(e,invalidate);d.remove();});
  let rigMm=null;try{rigMm=env.KampTrailRigProfile?.getProfile?.()?.rig?.heightMm??null;}catch{}
  const section=(title,cls)=>{const s=el('section');s.className='kt-route-clearance-'+cls;s.append(el('h3',title));list.append(s);return s;};
  const entry=(x,box)=>{
   const c=x.candidate,a=el('article'),title=el('h4',`${c.context.name||c.context.ref||t('Source object')} · ${t('about {m} m from route, leg {leg}',{m:x.distance_m,leg:x.leg})}`);
   const raw=el('p',Object.entries(c.tags).map(([k,v])=>`${k}: ${v}`).join(' · '));
   const verdict=el('p',x.association==='on_route'?C.comparisonText(x.comparison):x.comparison.compared?t('Not counted against this route: {text}',{text:C.comparisonText(x.comparison)}):C.stateText(c));
   const why=el('p',t('Road association: {association} ({evidence}). Direction: {direction}.',{association:{on_route:t('on the driven road'),not_on_route:t('on a different road'),unresolved:t('unresolved')}[x.association],evidence:x.association_evidence.join(', '),direction:x.direction==='not_directional'?t('no direction limit tagged'):t('unresolved')}));
   const link=el('a',t('View OSM {0} {1} (edited {2})',{0:c.osm_type,1:c.osm_id,2:c.edited_at}));link.href=`https://www.openstreetmap.org/${c.osm_type}/${encodeURIComponent(c.osm_id)}`;link.target='_blank';link.rel='noopener noreferrer';
   a.append(title,raw,verdict,why,link);box.append(a);
  };
  analyze(route,{env,rigMm}).then(r=>{
   if(stale)return;const s=r.summary;
   status.textContent=t('On the driven road: {on} ({conflicts} conflict with your rig height, {unresolvedValue} need checking or unknown). Nearby, road unresolved: {unresolved}. On a different road: {other}. Segments without data: {missing}. This is not a clear-route result.',{on:s.on_route,conflicts:s.on_route_conflicts,unresolvedValue:s.on_route_unresolved_value,unresolved:s.unresolved,other:s.not_on_route,missing:s.missing_segments});
   list.append(el('p',r.association_method==='none'?t('This route has no OSM road identity, so no candidate can be tied to the driven road. Every nearby candidate below is unresolved.'):t('Road association uses exact OSM way and node ids carried by the route.')));
   if(r.rig_height_mm===null)list.append(el('p',t('Save a travel height in your rig profile to compare.')));
   const on=section(t('On the driven road (exact OSM id)'),'resolved');for(const x of r.candidates.filter(x=>x.association==='on_route'))entry(x,on);if(!s.on_route)on.append(el('p',t('None identified. This does not mean the road is clear.')));
   const un=section(t('Nearby, road relationship unresolved'),'unresolved');for(const x of r.candidates.filter(x=>x.association==='unresolved'))entry(x,un);if(!s.unresolved)un.append(el('p',t('None within about 100 m.')));
   if(s.not_on_route){const other=section(t('Nearby, on a different road (exact OSM id)'),'other');for(const x of r.candidates.filter(x=>x.association==='not_on_route'))entry(x,other);}
   const miss=section(t('Route segments without clearance data'),'missing');
   if(!r.missing.length)miss.append(el('p',t('Data loaded for every segment. Unmapped hazards are still unknown.')));
   for(const m of r.missing)miss.append(el('p',t('Segments {from} to {to} (about {km} km): {reason}.',{from:m.from,to:m.to,km:(m.length_m/1000).toFixed(1),reason:m.reason.startsWith('region_not_in_dataset')?t('{region} is not in this dataset yet',{region:m.reason.split(':')[1]}):m.reason==='tile_failed_integrity'?t('data failed its integrity check'):t('too much data for one route check')})));
   const dates=Object.entries(r.dataset.sources).map(([k,v])=>`${k} ${v.extract_timestamp.slice(0,10)}`);
   list.append(el('p',t('OSM extract dates by state: {dates}.',{dates:dates.length>8?dates.slice(0,8).join(', ')+' …':dates.join(', ')})));
  }).catch(()=>{if(!stale)status.textContent=t('Clearance data is unavailable or the search could not be completed. No clearance conclusion is possible.');});
  return d;
 }
 const api={version:VERSION,SCHEMA,RADIUS,MAX_ROUTE_TILES,MAX_ROUTE_BYTES,NOT_IN_DATASET,analyze,load,open,distance,nearBounds,routeShape,associate};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.KampTrailRouteClearance=api;
})(typeof window!=='undefined'?window:globalThis);
