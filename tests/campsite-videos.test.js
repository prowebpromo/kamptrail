const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
class Element{
 constructor(tag){this.tag=tag;this.attrs={};this.children=[];this.listeners={};this.dataset={};this._text='';}
 setAttribute(k,v){this.attrs[k]=String(v);}hasAttribute(k){return Object.hasOwn(this.attrs,k);}
 append(...items){for(const item of items){this.children.push(item);if(typeof item==='object')item.parent=this;}}
 replaceChildren(...items){for(const child of this.children)if(typeof child==='object')child.parent=null;this.children=[];this._text='';this.append(...items);}
 set textContent(v){this.replaceChildren();this._text=String(v);}get textContent(){return this._text+this.children.map(x=>typeof x==='string'?x:x.textContent).join(' ');}
 get isConnected(){return this.tag==='body'||!!this.parent?.isConnected;}
 addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}showModal(){this.open=true;}close(){this.open=false;for(const f of this.listeners.close||[])f();}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);this.parent=null;}
 querySelectorAll(selector){const matches=[];for(const child of this.children){if(typeof child!=='object')continue;const [tag,cls]=selector.startsWith('.')?['',selector.slice(1)]:selector.split('.');if((!tag||child.tag===tag)&&(!cls||(child.attrs.class||'').split(' ').includes(cls)))matches.push(child);matches.push(...child.querySelectorAll?.(selector)||[]);}return matches;}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
 findButton(text){return this.querySelectorAll('button').find(x=>x.textContent===text);}
}
async function boot({recheck,spanish=false}={}){
 const document={documentElement:{},addEventListener(){},body:new Element('body'),activeElement:{focus(){}},createElement:t=>new Element(t),createTextNode:text=>({textContent:text})},requests=[];
 const review={id:1,rating:4,display_name:'Original Name',visited_on:'2026-10-01',created_at:'2026-10-02',body:'Visitor text <script>unchanged</script>',photos:[],video:{provider:'youtube',id:'abcdefghijk',url:'https://evil.test/ignored'}};
 const context={document,location:{hostname:'example.test'},navigator:{onLine:true},Date,fetch:async(url,options)=>{requests.push({url,options});if(url.includes('review_id='))return recheck?recheck():{ok:true,json:async()=>({review_id:1,video:review.video})};return{ok:true,json:async()=>({count:1,average:4,reviews:[review],next_before:null,scores_available:false})};},localStorage:{getItem:()=>spanish?'es':'en'}};
 context.window=context;vm.runInNewContext(fs.readFileSync('locale.js','utf8'),context);vm.runInNewContext(fs.readFileSync('community.js','utf8'),context);
 await context.KampTrailCommunity.open({properties:{id:'qa:video',name:'Original Place'}});
 return{document,requests,api:context.KampTrailCommunity,dialog:document.body.querySelector('dialog')};
}
test('video player makes no external request until publication recheck and uses a fixed provider URL',async()=>{
 const e=await boot();assert.equal(e.requests.length,1);assert.equal(e.dialog.querySelectorAll('iframe').length,0);assert.equal(e.dialog.querySelectorAll('img').length,0);assert.match(e.dialog.textContent,/Visitor text <script>unchanged<\/script>/);assert.match(e.dialog.textContent,/Posted and recorded dates are unknown/);
 await e.dialog.findButton('Play video').onclick();assert.equal(e.requests.length,2);assert.equal(e.requests[1].options.cache,'no-store');const frame=e.dialog.querySelector('iframe');assert.equal(frame.attrs.src,'https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1');assert.equal(frame.attrs.title,'Visitor video on YouTube');assert.equal(frame.attrs.sandbox,'allow-scripts allow-same-origin allow-presentation');assert.equal(e.dialog.querySelector('a').attrs.href,'https://www.youtube.com/watch?v=abcdefghijk');
 e.dialog.close();assert.equal(frame.isConnected,false);assert.equal(e.dialog.querySelectorAll('iframe').length,0);
});
test('rejected and changed publication never render a player',async()=>{
 for(const recheck of [async()=>({ok:false,json:async()=>({})}),async()=>({ok:true,json:async()=>({review_id:1,video:{provider:'youtube',id:'differentid'}})}),async()=>{throw Error('offline');}]){
  const e=await boot({recheck});await e.dialog.findButton('Play video').onclick();assert.equal(e.dialog.querySelectorAll('iframe').length,0);assert.match(e.dialog.textContent,/Video could not be verified/);
 }
});
test('delayed publication cannot mount after leaving the review; Spanish UI keeps visitor words',async()=>{
 let release;const e=await boot({recheck:()=>new Promise(resolve=>release=resolve)});const pending=e.dialog.findButton('Play video').onclick();e.dialog.findButton('Report review').onclick();release({ok:true,json:async()=>({review_id:1,video:{provider:'youtube',id:'abcdefghijk'}})});await pending;assert.equal(e.dialog.querySelectorAll('iframe').length,0);
 const es=await boot({spanish:true});assert.ok(es.dialog.findButton('Reproducir video'));assert.match(es.dialog.textContent,/Visitor text <script>unchanged<\/script>/);assert.match(es.dialog.textContent,/Se desconocen las fechas/);
});
