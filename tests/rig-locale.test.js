'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

function boot(){
  class Node{
    constructor(tag,attrs={}){this.tag=tag;this.attrs=attrs;this.dataset={};for(const[k,v]of Object.entries(attrs))if(k.startsWith('data-'))this.dataset[k.slice(5)]=v;this.value=attrs.value||'';this.hidden=Object.hasOwn(attrs,'hidden');this.validity={badInput:false};this.children=[];}
    setAttribute(k,v){this.attrs[k]=String(v);}addEventListener(){}append(...nodes){this.children.push(...nodes);}focus(){this.focused=true;}showModal(){this.open=true;}
    set innerHTML(html){this.html=html;this.nodes=[...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)].map(([,tag,raw])=>new Node(tag,Object.fromEntries([...raw.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m=>[m[1],m[2]||'']))));}
    get innerHTML(){return this.html;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    querySelectorAll(selector){
      if(selector.startsWith('#'))return(this.nodes||[]).filter(n=>n.attrs.id===selector.slice(1));
      const match=selector.match(/^\[([\w-]+)(?:="([^"]*)")?\](:checked)?$/);
      return match?(this.nodes||[]).filter(n=>Object.hasOwn(n.attrs,match[1])&&(match[2]===undefined||n.attrs[match[1]]===match[2])&&(!match[3]||n.checked)):[];
    }
  }
  const profile={format:'kamptrail-rig-profile',schemaVersion:1,id:'50c56c9d-7bbc-4d5e-8d4b-84049e903313',name:'Save profile',createdAt:'2026-10-30T12:00:00.000Z',updatedAt:'2026-10-30T12:00:00.000Z',displayUnits:{length:'m',weight:'kg'},rig:{category:'all',travelLengthMm:18000,campsiteFitLengthMm:10669,heightMm:3900,widthMm:2500,weightKg:9000},campsite:{cost:'free',type:'all',amenities:[],hookups:['electric'],includeUnknownLength:false}};
  const dictionary={'Rig profile':'Perfil del vehículo','Profile name':'Nombre del perfil','Save profile':'Guardar perfil','Free':'Gratis','Unsupported profile format or schema version.':'El formato del perfil o la versión del esquema no son compatibles.','Could not save on this device. Your previous profile is unchanged. Export this draft or choose Use session only.':'No se pudo guardar en este dispositivo. Tu perfil anterior sigue igual.'};
  const rows=new Map([['kt_rig_profile_v1',JSON.stringify(profile)]]),document={body:new Node('body'),activeElement:new Node('button'),getElementById:()=>null,createElement:tag=>new Node(tag)};
  const context={document,TextEncoder,Date,CustomEvent:class{},crypto:{randomUUID:()=>profile.id},localStorage:{getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)},KampTrailI18n:{t:(key,params={})=>(dictionary[key]||String(key)).replace(/\{([a-zA-Z0-9_]+)\}/g,(token,name)=>Object.hasOwn(params,name)?String(params[name]):token)},dispatchEvent(){},addEventListener(){}};
  context.window=context;vm.runInNewContext(fs.readFileSync('rig-profile.js','utf8'),context);
  return{api:context.KampTrailRigProfile,document,profile,rows};
}

test('Spanish rig shell preserves a profile name matching a UI key and canonical option values',()=>{
  const e=boot(),before=e.rows.get('kt_rig_profile_v1');e.api.open();const d=e.document.body.children[0];
  assert.match(d.innerHTML,/>Perfil del vehículo<\/h2>/);assert.match(d.innerHTML,/>Nombre del perfil<\/label>/);assert.match(d.innerHTML,/>Guardar perfil<\/button>/);assert.match(d.innerHTML,/<option value="free">Gratis<\/option>/);
  assert.equal(d.querySelector('#kt-rig-name').value,'Save profile');assert.equal(e.api.getProfile().name,'Save profile');assert.equal(e.rows.get('kt_rig_profile_v1'),before);assert.equal(e.api.toFilters(e.api.getProfile()).rigLength,10669/304.8);assert.equal(e.api.toFilters(e.api.getProfile()).cost,'free');
});

test('Spanish import validation and storage errors retain atomic profile state',()=>{
  const e=boot();assert.throws(()=>e.api.parse(JSON.stringify({...e.profile,format:'future'})),/El formato del perfil/);
  const raw=JSON.stringify(e.profile),storage={getItem:()=>raw,setItem(){throw Error('quota');}},store=e.api.createStore(storage),candidate=e.api.parse(JSON.stringify({...e.profile,name:'Original visitor name <script>unchanged</script>'}));
  const result=store.save(candidate);assert.equal(result.ok,false);assert.match(result.error,/No se pudo guardar/);assert.equal(store.get().name,'Save profile');assert.equal(JSON.parse(store.export()).name,'Save profile');
});
