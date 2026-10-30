'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),helper=path.join(root,'api/_lib/route-elevation.php'),endpoint=path.join(root,'api/route-elevation.php');
const capable=spawnSync('php',['-r','exit(extension_loaded("pdo_sqlite")?0:1);']).status===0;
if(process.env.KT_REQUIRE_PHP==='1'&&!capable)throw new Error('Route terrain API tests require real PHP PDO SQLite.');
function php(code){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kt-terrain-'));try{const out=spawnSync('php',[],{input:`<?php require ${JSON.stringify(helper)};
function check($ok,$message='check failed'){if(!$ok)throw new Exception($message);}
function rejects($fn,$reason){try{$fn();}catch(KreException $e){check($e->reason===$reason,$e->reason);return;}throw new Exception('expected rejection');}
$dir=${JSON.stringify(dir)}.'/cache';$now=1793361600;
$points=[['id'=>7,'lat'=>40.0,'lon'=>-105.0],['id'=>8,'lat'=>41.0,'lon'=>-104.0]];
$meta=['name'=>'3DEPElevation','serviceDataType'=>'esriImageServiceDataTypeElevation','bandCount'=>1];
function row($id,$x,$y,$v){return ['locationId'=>$id,'location'=>['x'=>$x,'y'=>$y,'spatialReference'=>['wkid'=>4326]],'value'=>$v,'attributes'=>['VerticalDatum'=>'NAVD88','pubdate'=>'2025-01-01']];}
$rows=['samples'=>[row(1,-104,41,-50),row(0,-105,40,0)]];
$server=['REQUEST_METHOD'=>'POST','HTTP_HOST'=>'example.test:443','HTTPS'=>'on','HTTP_ORIGIN'=>'https://example.test:443','CONTENT_TYPE'=>'application/json','REMOTE_ADDR'=>'127.0.0.1'];
${code}`,encoding:'utf8',timeout:30000});assert.equal(out.status,0,out.stderr||out.stdout||String(out.error));return out.stdout;}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('terrain transport and cache have fixed bounds and no production test bypass',()=>{
 const h=fs.readFileSync(helper,'utf8'),e=fs.readFileSync(endpoint,'utf8');
 for(const pattern of [/CURLOPT_FOLLOWLOCATION=>false/,/CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS/,/CURLOPT_TIMEOUT=>12/,/strlen\(\$body\)\+strlen\(\$chunk\)>KRE_RESPONSE_MAX/,/LOCK_EX\|LOCK_NB/,/PRAGMA busy_timeout=0/,/PRAGMA max_page_count=1024/])assert.match(h,pattern);
 assert.doesNotMatch(h,/KAMPTRAIL_TEST|shell_exec\(|curl_error\(|kt_config\(/);
 assert.match(e,/KRE_BODY_MAX\+1/);assert.match(e,/'kre_http'/);assert.match(h,/dirname\(kt_config_path\(\)\)/);
});
test('strict bounded JSON, origin, method and sample IDs reject before cache access',{skip:!capable},()=>php(`
 $raw=json_encode(['samples'=>$points]);check(kre_request($server,[],$raw)===$points);
 foreach(['https://example.test','http://example.test:443','https://example.test:444','https://example.test:443/','null','https://example.test.evil:443','']as$o){$s=$server;$s['HTTP_ORIGIN']=$o;rejects(fn()=>kre_request($s,[],$raw),'invalid_origin');}
 $s=$server;$s['REQUEST_METHOD']='GET';rejects(fn()=>kre_request($s,[],$raw),'method_not_allowed');
 foreach(['text/plain','application/jsonx','application/json; nonsense=x']as$type){$s=$server;$s['CONTENT_TYPE']=$type;rejects(fn()=>kre_request($s,[],$raw),'invalid_content_type');}
 $s=$server;$s['CONTENT_LENGTH']=KRE_BODY_MAX+1;rejects(fn()=>kre_request($s,[],$raw),'too_large');
 rejects(fn()=>kre_request($server,[],str_repeat('x',KRE_BODY_MAX+1)),'too_large');
 rejects(fn()=>kre_request($server,['url'=>'https://evil'],$raw),'invalid_query');
 foreach(['{','{"samples":[],"samples":[]}','{"samples":[{"id":0,"lat":0,"lon":0,"\\\\u006cat":1}]}']as$bad)rejects(fn()=>kre_request($server,[],$bad),'invalid_json');
 foreach([[],['samples'=>[]],['samples'=>array_fill(0,51,$points[0])],['samples'=>[$points[0],$points[0]]],['samples'=>[['id'=>200,'lat'=>0,'lon'=>0]]],['samples'=>[['id'=>true,'lat'=>0,'lon'=>0]]],['samples'=>[['id'=>0,'lat'=>'0','lon'=>0]]],['samples'=>[['id'=>0,'lat'=>91,'lon'=>0]]],['samples'=>$points,'route_name'=>'secret']]as$b)rejects(fn()=>kre_request($server,[],json_encode($b)),'invalid_query');
 check(!file_exists($dir));
`));
test('USGS contract joins shuffled IDs and coordinates; zero and negative remain valid',{skip:!capable},()=>php(`
 $p=kre_parameters($points);check($p['geometryType']==='esriGeometryMultipoint'&&$p['interpolation']==='RSP_BilinearInterpolation'&&$p['returnFirstValueOnly']==='true');
 check(json_decode($p['geometry'],true)['spatialReference']['wkid']===4326);
 $r=kre_normalize($rows,$points,$now);check($r[0]['elevation_m']===0.0&&$r[1]['elevation_m']===-50.0);check($r[0]['datum']==='NAVD88'&&str_starts_with($r[0]['source_updated_at'],'2025-01-01'));
 $rows['samples'][0]['value']='NoData';check(kre_normalize($rows,$points,$now)[1]['status']==='no_data');
 $rows['samples'][0]['value']='-3.2e1';check(kre_normalize($rows,$points,$now)[1]['elevation_m']===-32.0);
 foreach(['Infinity',true,10000,-501]as$v){$rows['samples'][0]['value']=$v;check(kre_normalize($rows,$points,$now)[1]['status']==='unavailable');}
 unset($rows['samples'][0]['value']);check(kre_normalize($rows,$points,$now)[1]['status']==='unavailable');
 $dupe=['samples'=>[row(0,-105,40,3),row(0,-105,40,3)]];$r=kre_normalize($dupe,$points,$now);check($r[0]['reason']==='duplicate_location_id'&&$r[1]['reason']==='missing_sample');
 foreach([['samples'=>[row(0,-104,40,1)]],['samples'=>[row(2,-104,41,1)]],['samples'=>[row(true,-104,41,1)]],['error'=>[]],['samples'=>array_fill(0,5,row(0,-105,40,1))]]as$b)rejects(fn()=>kre_normalize($b,$points,$now),'upstream_unavailable');
 $b=['samples'=>[row(0,-105,40,1)]];$b['samples'][0]['location']['spatialReference']['wkid']=3857;rejects(fn()=>kre_normalize($b,$points,$now),'upstream_unavailable');
 $meta['bandCount']=2;rejects(fn()=>kre_source($meta,$now),'upstream_unavailable');
`));
test('raw mixed-format metadata remains attributable without invented or rolled-over source dates',{skip:!capable},()=>php(`
 foreach([2013,'2013',20130101,'20130101','2026-02-30','2026-10-30T24:00:00Z']as$v){
  check(kre_date($v)===null,'ambiguous or invalid date must remain unknown');
  $sample=$rows;$sample['samples'][1]['attributes']['pubdate']=$v;
  $r=kre_normalize($sample,$points,$now);check($r[0]['status']==='value');
  check($r[0]['source_updated_at']===null);check($r[0]['acquisition_metadata']['pubdate']===$v);
 }
 check(kre_date('2024-02-29')==='2024-02-29T00:00:00+00:00');
 check(kre_date('2025-01-01T01:00:00+02:00')==='2024-12-31T23:00:00+00:00');
 check(kre_date(1735689600000)===null);check(kre_date(1735689600000,true)==='2025-01-01T00:00:00+00:00');
 $meta['editingInfo']=['lastEditDate'=>1735689600000];check(kre_source($meta,$now)['source_updated_at']==='2025-01-01T00:00:00+00:00');
 $rows['samples'][1]['attributes']['AcquisitionDate']=1735689600000;
 $rows['samples'][1]['attributes']['EndDate']='2026-02-30';
 $r=kre_normalize($rows,$points,$now);check($r[0]['acquisition_metadata']['AcquisitionDate']===1735689600000);
 check($r[0]['acquisition_metadata']['EndDate']==='2026-02-30');check($r[0]['status']==='value');
`));
test('real SQLite cache isolates coordinate identity, expires and stores no route or client identities',{skip:!capable},()=>php(`
 $calls=0;$http=function($url,$p)use(&$calls,$meta,$rows){$calls++;return $url===KRE_SERVICE?$meta:$rows;};
 $r=kre_cached($points,$dir,'client-a',$http,$now);check($calls===2&&$r['samples'][0]['id']===7&&$r['samples'][0]['elevation_m']===0.0);
 $reordered=[$points[1],$points[0]];$reordered[0]['id']=90;$r=kre_cached($reordered,$dir,'client-b',$http,$now+1);check($calls===2&&$r['samples'][0]['id']===90&&kre_number($r['samples'][0]['elevation_m'])&&(float)$r['samples'][0]['elevation_m']===-50.0);
 $db=kre_db($dir);check((int)$db->query('SELECT count(*) FROM samples')->fetchColumn()===2);
 $all=json_encode($db->query('SELECT * FROM samples')->fetchAll(PDO::FETCH_ASSOC));check(!str_contains($all,'-105')&&!str_contains($all,'client-a')&&!str_contains($all,'geometry')&&!str_contains($all,'"lat"'));
 $bad=static function(){throw new KreException('upstream_unavailable');};$r=kre_cached($points,$dir,'client-a',$bad,$now+KRE_TTL-1);check($r['samples'][0]['status']==='value');
 rejects(fn()=>kre_cached($points,$dir,'client-a',$bad,$now+KRE_TTL),'upstream_unavailable');
`));
test('nonblocking lock, pretransport reservations, client/global budgets and slot bounds',{skip:!capable},()=>php(`
 $calls=0;$http=function($url,$p)use(&$calls,$meta){$calls++;if($url===KRE_SERVICE)return $meta;throw new KreException('upstream_unavailable');};
 $r=kre_cached($points,$dir,'a',$http,$now);check($r['samples'][0]['status']==='unavailable'&&$r['samples'][0]['reason']==='upstream_unavailable'&&$calls===2);
 kre_cached($points,$dir,'a',$http,$now+1);check($calls===2);
 $lock=fopen($dir.'/cache.lock','c+');flock($lock,LOCK_EX);rejects(fn()=>kre_cached($points,$dir,'a',$http,$now+2),'busy');flock($lock,LOCK_UN);fclose($lock);check($calls===2);
 for($i=2;$i<12;$i++)kre_cached($points,$dir,'a',$http,$now+2);rejects(fn()=>kre_cached($points,$dir,'a',$http,$now+3),'rate_limited');check($calls===2);
 $db=kre_db($dir);$q=$db->prepare('INSERT OR REPLACE INTO budgets(slot,window,count) VALUES(0,?,24)');$q->execute([intdiv($now+61,60)]);
 rejects(fn()=>kre_cached([['id'=>0,'lat'=>0.0,'lon'=>0.0]],$dir,'a',$http,$now+61),'rate_limited');check($calls===2);
 $db->exec('DELETE FROM budgets');
 for($i=0;$i<600;$i++){kre_cached([['id'=>0,'lat'=>($i/1000),'lon'=>0.0]],$dir,'client-'.$i,$http,$now+120+$i*61);}
 check((int)$db->query('SELECT count(*) FROM samples')->fetchColumn()<=KRE_CACHE_SLOTS);check((int)$db->query('SELECT count(*) FROM budgets')->fetchColumn()<=KRE_CLIENT_SLOTS+1);check(filesize($dir.'/cache.sqlite')<=4194304);
 check(count(scandir($dir))<=4);
`));
test('cache symlinks and public webroot cannot hold private terrain cache',{skip:!capable},()=>php(`
 $outside=dirname($dir).'/outside';file_put_contents($outside,'keep');mkdir($dir,0700);symlink($outside,$dir.'/cache.lock');
 rejects(fn()=>kre_cached($points,$dir,'a',static fn()=>[],$now),'cache_unavailable');check(file_get_contents($outside)==='keep');unlink($dir.'/cache.lock');
 symlink($outside,$dir.'/cache.sqlite');rejects(fn()=>kre_cached($points,$dir,'a',static fn()=>[],$now),'cache_unavailable');check(file_get_contents($outside)==='keep');
 rejects(fn()=>kre_db(${JSON.stringify(root)}),'cache_unavailable');
`));
// The HTTP fixture injects transport into the same dispatcher as the public endpoint.
// Production accepts no environment or request override for the provider URL.
test('HTTP POST handler integrates real SQLite and bounded fixture provider',{skip:!capable},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kt-terrain-http-'));let calls=0,mode='ok';
 const upstream=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{calls++;res.setHeader('Content-Type','application/json');const p=new URLSearchParams(body);if(!p.has('geometry'))return res.end(JSON.stringify({name:'3DEPElevation',serviceDataType:'esriImageServiceDataTypeElevation',bandCount:1}));const g=JSON.parse(p.get('geometry'));assert.equal(g.spatialReference.wkid,4326);assert.equal(p.get('interpolation'),'RSP_BilinearInterpolation');if(mode==='broken')return res.end('{');res.end(JSON.stringify({samples:g.points.map(([x,y],i)=>({locationId:i,location:{x,y,spatialReference:{wkid:4326}},value:i===0?0:'NoData'})).reverse()}));});});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const router=path.join(dir,'router.php');fs.writeFileSync(router,`<?php require ${JSON.stringify(helper)};
 $http=static function($url,$params){$ctx=stream_context_create(['http'=>['method'=>'POST','timeout'=>2,'header'=>'Content-Type: application/x-www-form-urlencoded','content'=>http_build_query($params)]]);return kre_json(file_get_contents('http://127.0.0.1:${upstream.address().port}/',false,$ctx,0,KRE_RESPONSE_MAX+1));};
 [$status,$body]=kre_dispatch($_SERVER,$_GET,file_get_contents('php://input',false,null,0,KRE_BODY_MAX+1),${JSON.stringify(path.join(dir,'cache'))},$http,time());if($status===405)header('Allow: POST');kt_json($status,$body);`);
 const socket=http.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=spawn('php',['-S',`127.0.0.1:${port}`,router],{cwd:dir,stdio:'ignore'}),base=`http://127.0.0.1:${port}`;
 const post=(body,headers={})=>fetch(base,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
 try{
  for(let i=0;i<60;i++){try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,50));}}
  assert.equal((await fetch(base)).status,405);assert.equal((await post({samples:[]},{Origin:base+'/'})).status,403);assert.equal((await post({samples:[]},{'Content-Type':'text/plain'})).status,415);assert.equal((await post('x'.repeat(8193))).status,413);assert.equal(calls,0);
  let r=await post({samples:[{id:11,lat:40,lon:-105},{id:12,lat:41,lon:-104}]});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');let data=await r.json();assert.equal(data.samples[0].elevation_m,0);assert.equal(data.samples[1].status,'no_data');assert.equal(calls,2);
  r=await post({samples:[{id:99,lat:40,lon:-105}]});data=await r.json();assert.equal(data.samples[0].id,99);assert.equal(calls,2);
  mode='broken';r=await post({samples:[{id:0,lat:0,lon:0}]});data=await r.json();assert.equal(data.samples[0].status,'unavailable');assert.equal(data.samples[0].elevation_m,null);assert.equal(calls,3);
 }finally{child.kill();await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
