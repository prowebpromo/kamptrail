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
test('starting another player replaces the old iframe and reporting destroys playback',async()=>{
 const e=await boot(),play=e.dialog.findButton('Play video');await play.onclick();const first=e.dialog.querySelector('iframe');await play.onclick();assert.equal(first.isConnected,false);assert.equal(e.dialog.querySelectorAll('iframe').length,1);
 e.dialog.findButton('Report review').onclick();assert.equal(e.dialog.querySelectorAll('iframe').length,0);assert.equal(e.document.body.querySelectorAll('iframe').length,0);
});
const {spawnSync,execFileSync}=require('node:child_process'),path=require('node:path');
const hasPhp=spawnSync('php',['-v'],{stdio:'ignore'}).status===0;
test('PHP snapshot hashing binds exact displayed content and video-free grouping enforces limits after projection',{skip:!hasPhp},()=>{
 const source=path.resolve(__dirname,'../api/_lib/observations.php');
 const output=execFileSync('php',['-r',`
 require ${JSON.stringify(source)};
 $row=['id'=>1,'body'=>'Original visitor words','updated_at'=>'2026-10-30 12:00:00'];
 $details=['noise'=>'quiet','scores'=>['quietness'=>4],'video_id'=>'abcdefghijk'];
 $photos=[['id'=>1,'status'=>'pending']];
 $snapshot=kc_review_snapshot_hash($row,$details,$photos);
 $changed=$details;$changed['video_id']='lmnopqrstuv';
 $edited=$row;$edited['body']='Changed in the same second';
 $changedPhotos=$photos;$changedPhotos[0]['status']='published';
 $rows=[];foreach(['abcdefghijk','lmnopqrstuv','123456789_-'] as $video){$d=$details;$d['video_id']=$video;$rows[]=['campsite_id'=>'qa:test','latest_visit'=>'2026-10-01','details'=>json_encode($d)];}
 $groups=ko_discovery_groups($rows,1);
 $rows[]=['campsite_id'=>'qa:test','latest_visit'=>'2026-10-02','details'=>json_encode($details)];$overflow=false;try{ko_discovery_groups($rows,1);}catch(OverflowException $e){$overflow=true;}
 echo json_encode(['unchanged'=>$snapshot===kc_review_snapshot_hash($row,$details,$photos),'video_changed'=>$snapshot!==kc_review_snapshot_hash($row,$changed,$photos),'body_changed'=>$snapshot!==kc_review_snapshot_hash($edited,$details,$photos),'photos_changed'=>$snapshot!==kc_review_snapshot_hash($row,$details,$changedPhotos),'groups'=>$groups,'overflow'=>$overflow,'projection'=>ko_conditions(['private'=>'do not expose','noise'=>'quiet','access'=>'invalid','scores'=>['quietness'=>4,'shade'=>6,'private'=>'ignore'],'signals'=>[['carrier'=>'verizon','signal'=>'strong','environment'=>'outdoors','private'=>'ignore'],['carrier'=>'bad','signal'=>'strong']]]),'media_only'=>ko_discovery_groups([['campsite_id'=>'qa:test','latest_visit'=>'2026-10-01','details'=>'{"video_id":"abcdefghijk"}']],1)]);
 `],{encoding:'utf8'});
 const out=JSON.parse(output);for(const key of ['unchanged','video_changed','body_changed','photos_changed','overflow'])assert.equal(out[key],true,key);
 assert.deepEqual(out.groups,[{campsite_id:'qa:test',values:{noise:'quiet',scores:{quietness:4}},count:3,latest_visit:'2026-10-01'}]);assert.deepEqual(out.media_only,[]);assert.deepEqual(out.projection,{noise:'quiet',scores:{quietness:4},signals:[{carrier:'verizon',signal:'strong',environment:'outdoors'}]});
});
