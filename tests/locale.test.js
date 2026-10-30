const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../locale.js'),'utf8');
function boot(saved='en', blocked=false, dom){
  const rows=new Map([['kt_language',saved],['kt_trip','visitor notes: Leave my words unchanged.'],['kt_filters_mvp','{"cost":"free"}']]);
  const context={Intl,Date,localStorage:{getItem:key=>{if(blocked)throw Error('blocked');return rows.get(key);},setItem:(key,value)=>{if(blocked)throw Error('blocked');rows.set(key,value);}},document:dom};
  context.window=context;vm.runInNewContext(source,context);return {api:context.KampTrailI18n,rows,context};
}
test('explicit supported language persists without changing trips, filters or user content',()=>{
  const {api,rows}=boot();assert.equal(api.language,'en');assert.equal(api.t('Save stop'),'Save stop');assert.equal(api.setLanguage('es'),true);
  assert.equal(rows.get('kt_language'),'es');assert.equal(api.t('Save stop'),'Guardar parada');assert.equal(rows.get('kt_trip'),'visitor notes: Leave my words unchanged.');assert.equal(rows.get('kt_filters_mvp'),'{"cost":"free"}');
  const restarted=boot(rows.get('kt_language'));assert.equal(restarted.api.language,'es');assert.equal(restarted.api.setLanguage('fr'),false);assert.equal(restarted.api.language,'es');
});
test('invalid preferences and unavailable storage retain a usable English fallback',()=>{
  assert.equal(boot('de').api.language,'en');const {api}=boot('es',true);assert.equal(api.language,'en');assert.equal(api.t('Missing future UI key'),'Missing future UI key');assert.equal(api.setLanguage('es'),false);assert.equal(api.language,'en');
});
test('interpolation is literal, handles zero, and never evaluates visitor text or prototype keys',()=>{
  const {api}=boot('es');assert.equal(api.t('Move {name} up',{name:'<script>${alert(1)}</script>'}),'Subir <script>${alert(1)}</script>');assert.equal(api.t('{count} in this view · {total} loaded{loading}',{count:0,total:12,loading:''}),'0 en esta vista · 12 cargados');
  assert.equal(api.t('constructor'),'constructor');assert.equal(api.t('Unknown {value}'),'Unknown {value}');assert.equal(api.t('Camping is free'),'Camping is free');
});
test('numbers use selected locale and date-only inputs keep their UTC calendar date',()=>{
  const {api}=boot('es');assert.equal(api.number(1234.5),new Intl.NumberFormat('es-US').format(1234.5));
  assert.equal(api.date('2026-01-01',{year:'numeric',month:'2-digit',day:'2-digit'}),new Intl.DateTimeFormat('es-US',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'UTC'}).format(new Date('2026-01-01T00:00:00Z')));
  assert.equal(api.date('not-a-date'),'not-a-date');assert.equal(api.date('2026-02-30'),'2026-02-30');assert.equal(api.date(''),'Desconocido');
});
test('only explicitly marked first-party elements change; html lang is set before DOM readiness',()=>{
  const marked={dataset:{i18n:'Save stop'},textContent:'Save stop'},sourceNode={textContent:'Camping is free'},input={getAttribute:()=> 'City, campsite, or lat, lng',setAttribute:(k,v)=>input[k]=v};
  const listeners={},dom={documentElement:{lang:'en'},addEventListener:(name,fn)=>listeners[name]=fn,querySelectorAll:selector=>selector==='[data-i18n]'?[marked]:selector==='[data-i18n-placeholder]'?[input]:[],getElementById:()=>null};
  const {api}=boot('es',false,dom);assert.equal(dom.documentElement.lang,'es');listeners.DOMContentLoaded();assert.equal(marked.textContent,'Guardar parada');assert.equal(input.placeholder,'Ciudad, lugar de acampada o latitud, longitud');assert.equal(sourceNode.textContent,'Camping is free');
  assert.deepEqual(Array.from(api.supported),['en','es']);
});
test('locale asset is present in early boot, offline shell and release package',()=>{
  const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');const index=read('index.html');assert.ok(index.indexOf('src="locale.js?v=')<index.indexOf('src="app.js?v='));assert.match(index,/id="kt-language"/);assert.match(read('service-worker.js'),/'locale\.js'/);assert.match(read('scripts/build-release.js'),/'locale\.js'/);assert.match(read('playwright.config.js'),/'locale\.spec\.js'/);
});
test('explicit selector changes reload only after successful storage and recover accessibly from denial',()=>{
  for(const blocked of [false,true]){
    let reloads=0,change;const help={textContent:'',setAttribute:(k,v)=>help[k]=v},choice={value:'en',addEventListener:(_name,fn)=>change=fn},listeners={};
    const dom={documentElement:{lang:'en'},querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners[name]=fn,getElementById:id=>id==='kt-language'?choice:id==='kt-language-help'?help:null};
    const env=boot('en',blocked,dom);env.context.location={reload:()=>reloads++};listeners.DOMContentLoaded();choice.value='es';change();
    assert.equal(reloads,blocked?0:1);assert.equal(dom.documentElement.lang,blocked?'en':'es');assert.equal(choice.value,blocked?'en':'es');
    if(blocked){assert.match(help.textContent,/could not be saved/);assert.equal(help.role,'status');}
  }
});
test('Spanish labels preserve application identifiers, numeric scores and unspecified signal payloads',()=>{
  const env=boot('es');env.context.FormData=class{constructor(values){this.values=values;}get(k){return this.values[k]??null;}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../community-discovery.js'),'utf8'),env.context);
  const d=env.context.KampTrailDiscovery,values={observed_noise:'quiet',signal_att:'weak',score_quietness:'4',score_comfort:'1'};
  assert.deepEqual(JSON.parse(JSON.stringify(d.formValues(values))),{noise:'quiet',signals:[{carrier:'att',signal:'weak',environment:'unspecified'}],scores:{quietness:4,comfort:1}});
  assert.equal(d.season('2026-01-01'),'winter');assert.equal(d.SEASONS.winter,'Invierno (dic.–feb.)');assert.equal(d.SCORES.quietness.label,'Tranquilidad');
  const summary={rating_count:3,rating_sum:12,latest_visit:'2026-01-01',observations:[{values:{scores:{quietness:4}},count:3,latest_visit:'2026-01-01'}]};
  assert.equal(d.validSites({camp:summary}),true);assert.equal(d.matchesSummary(summary,{scoreSeason:'winter',minScore_quietness:4,observedDays:0}),true);assert.equal(d.matchesSummary(summary,{scoreSeason:'winter',minScore_quietness:5,observedDays:0}),false);
  const text=d.seasonalText(d.seasonalScores(summary.observations));assert.match(text,/Invierno.*Tranquilidad: 4\.0\/5.*valoraciones explícitas: 3/);assert.match(d.seasonalText(d.seasonalScores([{...summary.observations[0],count:1}])),/datos insuficientes/);
  assert.equal(env.api.label('type','dispersed'),'Acampada dispersa');assert.equal(env.api.label('type','Original source words'),'Original source words');assert.equal(env.api.label('not_a_vocabulary','Paid'),'Paid');
});
test('translated numeric form labels keep canonical options and do not infer missing sub-ratings',()=>{
  const env=boot('es');vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../community-discovery.js'),'utf8'),env.context);
  const el=(tag,attrs={},text)=>({tag,attrs,text,children:[],append(...nodes){this.children.push(...nodes);}}),form=el('form'),field=(label,input,hint)=>({label,input,hint});
  env.context.KampTrailDiscovery.observeFields(form,{observations:{scores:{quietness:4}}},el,field);
  const numeric=form.children[1].children.filter(x=>x.input);assert.equal(numeric[0].label,'Tranquilidad');assert.equal(numeric[0].input.attrs.name,'score_quietness');assert.equal(numeric[0].input.children.find(x=>x.attrs.selected).attrs.value,'4');assert.equal(numeric[1].input.children.filter(x=>x.attrs.selected).length,0);assert.match(numeric[0].hint,/Muy ruidoso \(1\) a muy tranquilo \(5\)/);
  const fields=form.children[0].children.filter(x=>x.input);assert.ok(fields.some(x=>x.label==='Señal de AT&T'));const setting=fields.find(x=>x.label==='Entorno de AT&T');assert.equal(setting.input.children.find(x=>x.attrs.selected).attrs.value,'unspecified');assert.equal(setting.input.children.find(x=>x.attrs.selected).text,'Entorno sin especificar');
});
test('advanced weather/rest-area descriptions and land-care help translate while source words survive',()=>{
  const env=boot('es');Object.assign(env.context,{TextEncoder,TextDecoder,URL,Map,Set});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../rest-areas.js'),'utf8'),env.context);
  const raw='Original TxDOT location words <img src=x>',text=env.context.KampTrailRestAreas.describe({location:raw,milepost:'32'},{source:{retrieved_at:'2026-10-30T00:00:00Z'},duration_context:{source:{retrieved_at:'2026-10-30T00:00:00Z'}}});assert.ok(text.startsWith(raw));assert.match(text,/no establece permiso para dormir de noche/);
  assert.match(env.api.t('Forecast samples unknown, incomplete, expired or unavailable.'),/Muestras del pronóstico/);assert.match(env.api.t('Designation and dates do not establish current road conditions, clearance, camping permission, or suitability for your RV. Check the current district map, closures and posted signs.'),/no establecen/);
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');assert.match(html,/id="kt-camping-care"/);assert.match(html,/data-i18n="Camping care checklist"/);assert.equal(env.api.t('Respect the land'),'Respeta el terreno');assert.match(env.api.t('Small choices help protect the places you visit. Before camping, confirm permission, stay duration, fire restrictions and waste requirements with the land manager. Current local orders and posted rules control.'),/Rigen las órdenes locales vigentes/);
});
test('Spanish review reporting sends the canonical action and preserves original visitor text',async()=>{
  class Element{
    constructor(tag){this.tag=tag;this.attrs={};this.children=[];this._text='';this.dataset={};}
    setAttribute(k,v){this.attrs[k]=String(v);}hasAttribute(k){return Object.hasOwn(this.attrs,k);}append(...items){this.children.push(...items);}addEventListener(){}showModal(){this.open=true;}
    replaceChildren(...items){this._text='';this.children=items;}set textContent(x){this._text=String(x);this.children=[];}get textContent(){return this._text+this.children.map(x=>typeof x==='string'?x:x.textContent).join(' ');}
    querySelector(selector){for(const x of this.children){if(selector.startsWith('.')?x.attrs?.class?.split(' ').includes(selector.slice(1)):x.tag===selector)return x;const found=x.querySelector?.(selector);if(found)return found;}return null;}
    findText(text){for(const x of this.children){if(x.tag==='button'&&x.textContent===text)return x;const found=x.findText?.(text);if(found)return found;}return null;}
  }
  const env=boot('es');const document={body:new Element('body'),activeElement:new Element('button'),createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})};let sent;
  Object.assign(env.context,{document,location:{hostname:'example.test'},navigator:{onLine:true},FormData:class{constructor(){this.data={reason:'Original visitor report reason'};}set(k,v){this.data[k]=v;}get(k){return this.data[k];}},fetch:async(_url,options)=>{
    if(options?.method==='POST'){sent=options.body.data;return{ok:true,json:async()=>({ok:true,message:'Report received. A moderator will review it.'})};}
    return{ok:true,json:async()=>({ok:true,count:1,average:5,reviews:[{id:7,rating:5,display_name:'Original Name',visited_on:'2026-01-01',created_at:'2026-01-02',body:'Original visitor words <script>alert(1)</script>',photos:[]}],next_before:null,scores_available:false})};
  }});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../community.js'),'utf8'),env.context);await env.context.KampTrailCommunity.open({properties:{id:'qa:locale-report',name:'Original Place'}});
  assert.match(document.body.textContent,/Original visitor words <script>alert\(1\)<\/script>/);document.body.findText('Denunciar reseña').onclick();await document.body.querySelector('form').onsubmit({preventDefault(){}});
  assert.equal(sent.action,'report');assert.equal(sent.review_id,7);assert.equal(sent.reason,'Original visitor report reason');assert.match(document.body.textContent,/Informe recibido/);
});
test('Spanish rig and height display preserves portable profile keys and raw OSM tags',async()=>{
  const env=boot('es');Object.assign(env.context,{TextEncoder,TextDecoder,URL,crypto:require('node:crypto').webcrypto});
  for(const file of ['rig-profile.js','clearances.js','route-clearance.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../'+file),'utf8'),env.context);
  const rig=env.context.KampTrailRigProfile,p=rig.create();p.name='Original rig name';p.rig.heightMm=3200;p.rig.campsiteFitLengthMm=6706;p.campsite.hookups=['electric'];
  const saved=rig.validate(p);assert.equal(saved.name,'Original rig name');assert.equal(saved.rig.heightMm,3200);assert.equal(rig.toFilters(saved).hookups[0],'electric');assert.equal(saved.displayUnits.length,'ft');assert.equal(env.api.t('Rig profile'),'Perfil del vehículo');assert.equal(env.api.t('Nearby mapped heights (RI pilot)'),'Alturas cartografiadas cercanas (piloto de RI)');
  const C=env.context.KampTrailClearances,raw={tags:{maxheight:'3.7 m'},metres:{maxheight:3.7}};assert.match(C.heightText(raw,'maxheight'),/^3.7 m/);assert.deepEqual(raw.tags,{maxheight:'3.7 m'});assert.match(C.heightText(raw,'maxheight:physical'),/Desconocido/);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../community-discovery.js'),'utf8'),env.context);assert.equal(env.context.KampTrailDiscovery.MONTHS['01'],'Enero');assert.equal(env.context.KampTrailDiscovery.season('2026-01-05'),'winter');
});

test('Spanish height evidence translates product explanations while retaining raw tags, source identities and dates',()=>{
  const env=boot('es');Object.assign(env.context,{TextEncoder,TextDecoder,Uint8Array,URL,module:{exports:{}}});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../clearances.js'),'utf8'),env.context);
  const C=env.context.module.exports,data=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/clearances/RI.json'),'utf8')),row=structuredClone(data.records[0]);
  const raw='none';row.tags.maxheight=raw;row.metres.maxheight=null;
  assert.equal(C.heightText(row,'maxheight'),'none (límite numérico desconocido)');
  assert.match(C.heightText(row,'maxheight:physical'),/no hay etiqueta en la fuente/);
  const description=C.describe(row,data,true);assert.match(description,/Instantánea guardada/);assert.match(description,/no aplica restricciones del vehículo|ni aplica restricciones del vehículo/);assert.ok(description.includes(data.source.extract_timestamp));assert.ok(description.includes(data.source.retrieved_at));assert.ok(description.includes(row.edited_at));assert.equal(C.sourceLink(row),'https://www.openstreetmap.org/'+row.osm_type+'/'+row.osm_id);
});
