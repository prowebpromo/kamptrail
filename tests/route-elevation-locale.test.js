'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const E=require('../route-elevation.js');
const words={
 'Terrain along the calculated car route':'Terreno a lo largo de la ruta calculada para automóvil',
 'Load terrain profile':'Cargar perfil de terreno',
 'Load sampled terrain for this route.':'Carga las muestras de terreno de esta ruta.',
 'Terrain samples saved on this device.':'Muestras de terreno guardadas en este dispositivo.',
 'Source updated':'Actualización de la fuente',
 'Raw acquisition metadata':'Metadatos originales de adquisición',
 'Offline: showing dated saved samples for this exact route, including gaps.':'Sin conexión: muestras guardadas con fecha de esta ruta exacta.'
};
const t=(key,params={})=>(words[key]||String(key)).replace(/\{([a-zA-Z0-9_]+)\}/g,(m,k)=>Object.hasOwn(params,k)?String(params[k]):m);
const route={geometry:{type:'LineString',coordinates:[[-110,40],[-109.999,40]]},leg_ends:[1]};
const date='2026-10-30T12:00:00Z',datum='Original Datum <script>untouched</script>',metadata={pubdate:'Original provider words'};
const source={name:'USGS 3DEP',url:'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer',units:'meters',datum};
function setup(extra={}){
 const cache=new Map(),requests=[];
 const env={crypto:crypto.webcrypto,TextEncoder,AbortController,setTimeout,clearTimeout,navigator:{onLine:true},KampTrailI18n:{t,locale:()=> 'es-US'},localStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)},fetch:async(url,options)=>{
  requests.push({url,options});const samples=JSON.parse(options.body).samples;
  return{ok:true,text:async()=>JSON.stringify({ok:true,version:1,retrieved_at:date,source,samples:samples.map(p=>({...p,status:'value',elevation_m:304.8,datum,source_updated_at:date,retrieved_at:date,acquisition_metadata:metadata}))})};
 },...extra};return{env,requests,cache};
}
test('Spanish terrain messages leave exact-route identity, provider payload, units and original source metadata unchanged',async()=>{
 const {env,requests}=setup(),session=E.createSession(env,route);await session.ready;
 assert.equal(session.state.message,'Carga las muestras de terreno de esta ruta.');assert.equal(requests.length,0);
 const canonical=E.canonical(route);await session.load();assert.equal(session.state.key,await E.identity(route,env));assert.equal(E.canonical(route),canonical);
 assert.equal(session.state.message,'Muestras de terreno guardadas en este dispositivo.');assert.equal(requests.length,1);
 assert.equal(requests[0].url,'api/route-elevation.php');assert.deepEqual(Object.keys(JSON.parse(requests[0].options.body)),['samples']);
 assert.equal(session.state.profile.values[0].source.name,'USGS 3DEP');assert.equal(session.state.profile.values[0].datum,datum);assert.deepEqual(session.state.profile.values[0].acquisition_metadata,metadata);assert.equal(session.state.profile.values[0].retrieved_at,date);assert.equal(session.state.profile.values[0].elevation_m,304.8);
 const saved=JSON.stringify(session.state.profile);env.navigator.onLine=false;await session.load();assert.match(session.state.message,/Sin conexión/);assert.equal(JSON.stringify(session.state.profile),saved);assert.equal(requests.length,1);
});
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.classList={add(){}};this.namespaceURI='http://www.w3.org/2000/svg';}
 append(...nodes){this.children.push(...nodes);}setAttribute(k,v){this.attrs[k]=String(v);}addEventListener(){}focus(){}remove(){this.removed=true;}showModal(){this.open=true;}
 replaceChildren(...nodes){this.children=nodes;this._text='';}set textContent(v){this._text=String(v);this.children=[];}get textContent(){return(this._text||'')+this.children.map(n=>typeof n==='string'?n:n.textContent).join(' ');}
 querySelector(selector){for(const child of this.children){if(child.tag===selector)return child;const found=child.querySelector?.(selector);if(found)return found;}return null;}
 findButton(label){for(const child of this.children){if(child.tag==='button'&&child.textContent===label)return child;const found=child.findButton?.(label);if(found)return found;}return null;}
}
test('terrain dialog uses explicit Spanish product labels while source and acquisition text stay literal',async()=>{
 const body=new Element('body'),document={body,activeElement:{focus(){}},createElement:tag=>new Element(tag),createElementNS:(_ns,tag)=>new Element(tag)};
 const {env,requests}=setup({document,addEventListener(){}}),ui=E.create(env);assert.equal(ui.open(route),true);
 for(let i=0;i<3;i++)await Promise.resolve();assert.equal(requests.length,0);assert.match(body.textContent,/Terreno a lo largo de la ruta calculada para automóvil/);
 const load=body.findButton('Cargar perfil de terreno');assert.ok(load);await load.onclick();
 assert.match(body.textContent,/Original Datum <script>untouched<\/script>/);assert.match(body.textContent,/Original provider words/);assert.match(body.textContent,/Actualización de la fuente/);assert.match(body.textContent,/Metadatos originales de adquisición/);
 ui.close();
});
