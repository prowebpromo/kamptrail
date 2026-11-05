'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mount,VERSION,STORAGE_KEY,MAX_AGE_MS}=require('../consent-controls.js');
class Bus{
  constructor(){this.listeners=new Map();}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type,event={}){for(const fn of this.listeners.get(type)||[])fn(event);}
}
class Element extends Bus{
  constructor(tag,doc){super();this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.attributes={};this.textContent='';this.hidden=false;}
  appendChild(node){this.children.push(node);node.parent=this;return node;}
  setAttribute(key,value){this.attributes[key]=String(value);}
  focus(){this.ownerDocument.activeElement=this;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
}
function sharedStorage(){const data=new Map();return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};}
function setup({storage=sharedStorage(),time=2000000000000,maxAgeMs=MAX_AGE_MS}={}){
  let clock=time;const timers=new Map();let nextTimer=0;
  const win=new Bus(),doc=new Bus(),calls=[],changes=[];
  doc.defaultView=win;doc.createElement=tag=>new Element(tag,doc);win.localStorage=storage;
  const container=new Element('div',doc),adapter={setConsent:value=>calls.push(value),configure(){assert.fail('Controls must never configure the adapter');}};
  const options={container,adapter,storage,window:win,document:doc,now:()=>clock,maxAgeMs,schedule:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,at:clock+delay,delay});return id;},cancel:id=>timers.delete(id),onChange:value=>changes.push(value)};
  const component=mount(options);
  const nodes=()=>{const all=[];function walk(node){all.push(node);node.children.forEach(walk);}walk(container);return all;};
  const button=text=>nodes().find(n=>n.tagName==='BUTTON'&&n.textContent===text);
  function click(text){button(text).emit('click');}
  function advance(ms){clock+=ms;for(const [id,timer]of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}}
  return {component,options,container,adapter,calls,changes,storage,win,doc,timers,nodes,button,click,advance,setTime:value=>{clock=value;}};
}
function record(choice,time=2000000000000,maxAgeMs=MAX_AGE_MS){return {version:VERSION,choice,savedAt:time,expiresAt:time+maxAgeMs};}

test('initial unknown is denied with equal accessible choices, a live status and no modal',()=>{
  const f=setup();assert.deepEqual(f.calls,[false]);assert.equal(f.component.getStatus().choice,'unknown');
  const section=f.nodes().find(n=>n.tagName==='SECTION'),heading=f.nodes().find(n=>n.tagName==='H2');assert.equal(section.attributes.role,'region');assert.equal(section.attributes['aria-labelledby'],heading.id);assert.equal(f.nodes().some(n=>n.tagName==='DIALOG'||n.attributes['aria-modal']),false);
  const allow=f.button('Allow optional analytics'),decline=f.button('Decline');assert.equal(allow.type,'button');assert.equal(decline.type,'button');assert.equal(allow.attributes.style,decline.attributes.style);assert.equal(f.nodes().some(n=>n.attributes.role==='status'&&n.attributes['aria-live']==='polite'),true);
  assert.equal(f.button('Revoke and clear choice').hidden,false);f.click('Change choice');assert.equal(f.doc.activeElement,allow);assert.equal(f.nodes().some(n=>n.textContent.includes('separate from safety terms and location permission')),true);
});

test('grant and decline persist exact versioned choices while never enabling the adapter',()=>{
  const f=setup();f.click('Allow optional analytics');assert.equal(f.component.getStatus().analyticsConsent,true);assert.deepEqual(JSON.parse(f.storage.getItem(STORAGE_KEY)),record('granted'));assert.equal(f.calls.at(-1),true);
  f.click('Decline');assert.equal(f.component.getStatus().choice,'denied');assert.equal(f.calls.at(-1),false);assert.equal(JSON.parse(f.storage.getItem(STORAGE_KEY)).choice,'denied');assert.equal(f.nodes().find(n=>n.textContent==='Your saved choice: decline optional analytics.').attributes.role,'status');
});

test('valid grants and declines survive reload and synchronize the injected adapter',()=>{
  for(const choice of ['granted','denied']){
    const storage=sharedStorage();storage.setItem(STORAGE_KEY,JSON.stringify(record(choice)));const f=setup({storage});assert.equal(f.component.getStatus().choice,choice);assert.equal(f.calls.at(-1),choice==='granted');assert.equal(f.calls[0],false);
  }
});

test('invalid, future, expired and different-version choices fail closed and are cleared',()=>{
  const time=2000000000000;
  for(const value of ['{broken',null,{},record('unknown'),{...record('granted'),version:1},{...record('granted'),expiresAt:time-1},record('granted',time+1),{...record('granted'),expiresAt:time+MAX_AGE_MS+1},{...record('granted'),savedAt:'yesterday'}]){
    const storage=sharedStorage();storage.setItem(STORAGE_KEY,typeof value==='string'?value:JSON.stringify(value));const f=setup({storage,time});assert.equal(f.component.getStatus().choice,'unknown',JSON.stringify(value));assert.equal(f.calls.includes(true),false);assert.equal(storage.getItem(STORAGE_KEY),null);
  }
});

test('expiry revokes during an open page and long expiry timers stay within browser bounds',()=>{
  const f=setup({maxAgeMs:1000});f.click('Allow optional analytics');f.advance(999);assert.equal(f.component.getStatus().analyticsConsent,true);f.advance(1);assert.equal(f.calls.at(-1),false);assert.equal(f.component.getStatus().choice,'unknown');assert.equal(f.storage.getItem(STORAGE_KEY),null);
  const long=setup();long.click('Allow optional analytics');assert.equal([...long.timers.values()][0].delay,2147483647);long.advance(2147483647);assert.equal(long.component.getStatus().analyticsConsent,true);assert.equal(long.timers.size,1);
});

test('resuming or reading status revokes expired state even if a browser timer was delayed',()=>{
  for(const signal of ['focus','pageshow','visibilitychange','status']){
    const f=setup({maxAgeMs:1000});f.click('Allow optional analytics');f.setTime(2000000001000);
    if(signal==='status')f.component.getStatus();else(signal==='visibilitychange'?f.doc:f.win).emit(signal);
    assert.equal(f.calls.at(-1),false,signal);assert.equal(f.component.getStatus().choice,'unknown');
  }
});

test('revocation and decline deny before attempting any storage write or removal',()=>{
  const storage=sharedStorage(),f=setup({storage});f.click('Allow optional analytics');let checked=0;
  storage.removeItem=key=>{assert.equal(f.calls.at(-1),false);checked++;storage.data.delete(key);};f.click('Revoke and clear choice');assert.equal(checked,1);assert.equal(f.component.getStatus().choice,'unknown');
  f.click('Allow optional analytics');storage.setItem=(key,value)=>{assert.equal(f.calls.at(-1),false);checked++;storage.data.set(key,value);};f.click('Decline');assert.equal(checked,2);
});

test('blocked storage is explicit and memory-only choices disappear on reload',()=>{
  const storage={getItem(){throw new Error('Blocked');},setItem(){throw new Error('Blocked');},removeItem(){throw new Error('Blocked');}};
  const f=setup({storage});assert.equal(f.component.getStatus().persistence,'memory');assert.equal(f.calls.at(-1),false);f.click('Allow optional analytics');assert.equal(f.component.getStatus().analyticsConsent,true);assert.equal(f.nodes().some(n=>!n.hidden&&n.textContent.includes('applies only to this page and is lost on reload')),true);f.click('Revoke and clear choice');assert.equal(f.component.getStatus().choice,'unknown');assert.equal(f.calls.at(-1),false);
  const reload=setup({storage});assert.equal(reload.component.getStatus().choice,'unknown');assert.equal(reload.calls.includes(true),false);
});

test('failed clearing stops current permission and warns that the previous stored choice may remain',()=>{
  const storage=sharedStorage(),f=setup({storage});f.click('Allow optional analytics');storage.removeItem=()=>{throw new Error('Cannot remove');};f.component.clear();assert.equal(f.calls.at(-1),false);assert.equal(f.component.getStatus().clearFailed,true);assert.equal(f.component.getStatus().choice,'unknown');assert.equal(f.nodes().some(n=>n.textContent.includes('A previously saved choice may remain')),true);
});

test('a failed decline write removes the old grant and keeps the current decline memory-only',()=>{
  const storage=sharedStorage(),f=setup({storage});f.click('Allow optional analytics');let removal=0;
  storage.setItem=()=>{assert.equal(f.calls.at(-1),false);throw new Error('Cannot write');};storage.removeItem=key=>{assert.equal(f.calls.at(-1),false);removal++;storage.data.delete(key);};
  f.click('Decline');assert.equal(removal,1);assert.equal(f.component.getStatus().choice,'denied');assert.equal(f.component.getStatus().persistence,'memory');assert.equal(f.component.getStatus().clearFailed,false);assert.equal(storage.getItem(STORAGE_KEY),null);
  const reload=setup({storage});assert.equal(reload.component.getStatus().choice,'unknown');assert.equal(reload.calls.includes(true),false);
});

test('failed decline write and failed old-grant removal explicitly warn about reload and other pages',()=>{
  const storage=sharedStorage(),f=setup({storage});f.click('Allow optional analytics');storage.setItem=()=>{throw new Error('Cannot write');};storage.removeItem=()=>{assert.equal(f.calls.at(-1),false);throw new Error('Cannot remove');};
  f.click('Decline');assert.equal(f.component.getStatus().choice,'denied');assert.equal(f.component.getStatus().analyticsConsent,false);assert.equal(f.component.getStatus().clearFailed,true);assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).choice,'granted');assert.equal(f.nodes().some(n=>n.textContent.includes('return on reload. Other open pages may still use it.')),true);
});

test('cross-tab storage changes use current storage and synchronize grant, decline, clear and invalid data',()=>{
  const storage=sharedStorage(),a=setup({storage}),b=setup({storage});a.click('Allow optional analytics');b.win.emit('storage',{key:STORAGE_KEY,storageArea:storage});assert.equal(b.component.getStatus().analyticsConsent,true);
  a.click('Decline');b.win.emit('storage',{key:STORAGE_KEY,storageArea:storage,newValue:JSON.stringify(record('granted'))});assert.equal(b.component.getStatus().choice,'denied');
  a.component.clear();b.win.emit('storage',{key:null,storageArea:storage});assert.equal(b.component.getStatus().choice,'unknown');assert.equal(b.calls.at(-1),false);
  storage.setItem(STORAGE_KEY,'invalid');b.win.emit('storage',{key:STORAGE_KEY,storageArea:storage});assert.equal(b.component.getStatus().choice,'unknown');assert.equal(storage.getItem(STORAGE_KEY),null);
  storage.setItem(STORAGE_KEY,JSON.stringify(record('granted')));b.win.emit('storage',{key:'another-key',storageArea:storage});b.win.emit('storage',{key:STORAGE_KEY,storageArea:sharedStorage()});assert.equal(b.component.getStatus().choice,'unknown');
});

test('cross-tab read failures deny before reading and do not trust a supplied grant payload',()=>{
  const storage=sharedStorage(),f=setup({storage});f.click('Allow optional analytics');storage.getItem=()=>{assert.equal(f.calls.at(-1),false);throw new Error('Blocked');};f.win.emit('storage',{key:STORAGE_KEY,storageArea:storage,newValue:JSON.stringify(record('granted'))});assert.equal(f.component.getStatus().choice,'unknown');assert.equal(f.component.getStatus().persistence,'memory');
});

test('mount is singleton per container and destroy cleans up without enabling or deleting a saved choice',()=>{
  const f=setup();assert.equal(mount(f.options),f.component);assert.equal(f.container.children.length,1);assert.equal(f.calls.length,1);f.click('Allow optional analytics');f.component.destroy();f.component.destroy();assert.equal(f.calls.at(-1),false);assert.equal(f.container.children.length,0);assert.equal(f.timers.size,0);assert.equal(f.storage.getItem(STORAGE_KEY)!==null,true);f.win.emit('storage',{key:STORAGE_KEY,storageArea:f.storage});assert.equal(f.calls.at(-1),false);
});

test('custom storage keys and durations are explicit and invalid configuration is rejected',()=>{
  const f=setup({maxAgeMs:1000});assert.equal(f.component.getStatus().maxAgeMs,1000);assert.throws(()=>mount({...f.options,container:new Element('div',f.doc),maxAgeMs:0}));assert.throws(()=>mount({...f.options,container:new Element('div',f.doc),storageKey:''}));
  const container=new Element('div',f.doc),component=mount({...f.options,container,storageKey:'isolated-choice',maxAgeMs:1000});container.children[0].children.find(n=>n.attributes.role==='group').children[0].emit('click');assert.equal(f.storage.getItem('isolated-choice')!==null,true);assert.equal(component.getStatus().choice,'granted');
});

test('send-time controls check blocks the real adapter transport when an expiry timer was suspended',()=>{
  const {createAdapter}=require('../consent-analytics.js'),f=setup({maxAgeMs:1000});f.component.destroy();f.win.location={href:'https://kamptrail.com/'};f.doc.querySelectorAll=()=>[];
  const adapter=createAdapter({window:f.win,document:f.doc}),controls=mount({...f.options,adapter});const sent=[];
  adapter.configure({enabled:true,transport(event,params){if(controls.getStatus().analyticsConsent&&adapter.getStatus().permitted)sent.push({event,params});}});
  f.click('Allow optional analytics');f.win.emit('kamptrail:metric',{detail:{event:'kt_search_performed',sequence:1,mode:'map',source:'other'}});assert.equal(sent.length,1);
  f.setTime(2000000001000);f.win.emit('kamptrail:metric',{detail:{event:'kt_search_performed',sequence:2,mode:'map',source:'other'}});assert.equal(sent.length,1);assert.equal(adapter.getStatus().analyticsConsent,false);assert.equal(f.storage.getItem(STORAGE_KEY),null);controls.destroy();adapter.destroy();
});
