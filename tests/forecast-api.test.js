'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),helper=path.join(root,'api/_lib/forecast.php'),endpoint=path.join(root,'api/forecast.php'),fixture=path.join(__dirname,'fixtures/forecast.php');
const capable=spawnSync('php',['-v']).status===0;
if(process.env.KT_REQUIRE_PHP==='1'&&!capable)throw new Error('Forecast API checks require PHP.');
function php(code){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kamptrail-forecast-test-'));
  try{
    const out=spawnSync('php',[],{input:`<?php require ${JSON.stringify(helper)}; require ${JSON.stringify(fixture)};
      function check($ok,$message='check failed'){if(!$ok)throw new Exception($message);}
      function rejects($fn,$reason=null){try{$fn();}catch(KfException $e){if($reason!==null)check($e->reason===$reason,'reason: '.$e->reason);return;}throw new Exception('expected rejection');}
      $dir=${JSON.stringify(dir)}.'/cache';$now=strtotime('2026-10-29T12:00:00Z');$f=ff_fixture($now);
      ${code}`,encoding:'utf8',timeout:30000});
    assert.equal(out.status,0,out.stderr||out.stdout||String(out.error));return out.stdout;
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('forecast transport is fixed unauthenticated HTTPS and bounded before parse',()=>{
  const h=fs.readFileSync(helper,'utf8'),e=fs.readFileSync(endpoint,'utf8');
  assert.match(h,/CURLOPT_FOLLOWLOCATION=>false/);assert.match(h,/CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS/);
  assert.match(h,/CURLOPT_SSL_VERIFYPEER=>true/);assert.match(h,/release-assets\.githubusercontent\.com/);
  assert.match(h,/strlen\(\$body\) \+ strlen\(\$chunk\) > \$limit/);
  assert.doesNotMatch(h,/getenv\(|kt_config\(|kt_db\(|Authorization:|curl_error\(/);
  assert.match(e,/private\/kamptrail-weather/);assert.doesNotMatch(e,/\$_POST|\$_FILES/);
});
test('forecast queries and redirect destinations cannot select arbitrary paths or providers',{skip:!capable},()=>php(`
  check(kf_query(['kind'=>'index'])===['kind'=>'index']);
  check(kf_query(['kind'=>'state','state'=>'CA','snapshot'=>str_repeat('a',24)])['state']==='CA');
  foreach([[],['kind'=>[]],['kind'=>'index','url'=>'https://evil'],['kind'=>'state','state'=>'../','snapshot'=>str_repeat('a',24)],['kind'=>'state','state'=>'CA','snapshot'=>'../x'],['kind'=>'state','state'=>'CA','snapshot'=>str_repeat('A',24)]]as$q)rejects(fn()=>kf_query($q),'invalid_query');
  kf_url(KF_RELEASE.'current-a.json',true);kf_url('https://release-assets.githubusercontent.com/github-production-release-asset/x?sig=not-a-credential',false);
  foreach(['http://github.com/x','https://github.com.evil/x','https://user:pass@release-assets.githubusercontent.com/x','https://127.0.0.1/x','https://release-assets.githubusercontent.com:443/x','file:///tmp/x','https://github.com/prowebpromo/other/releases/download/x/current-a.json',KF_RELEASE.'../x']as$u)rejects(fn()=>kf_url($u,true));
  foreach(['https://github.com/evil','https://objects.githubusercontent.com/x','https://release-assets.githubusercontent.com.evil/x']as$u)rejects(fn()=>kf_url($u,false));
`));
test('manifest binds exact catalogue, fixed NOAA inputs, counts and source-derived expiry',{skip:!capable},()=>php(`
  check(kf_manifest($f['raw'],$f['catalogue'],$now)['snapshot_id']===str_repeat('a',24));
  $bad=$f['manifest'];$bad['source']['files'][0]['url']='https://evil.test/input';rejects(fn()=>kf_manifest(json_encode($bad),$f['catalogue'],$now));
  $bad=$f['manifest'];$bad['source']['files'][0]['last_modified']=gmdate('Y-m-d\\TH:i:s\\Z',$now-7200);rejects(fn()=>kf_manifest(json_encode($bad),$f['catalogue'],$now));
  $bad=$f['manifest'];$bad['expires_at']=gmdate('Y-m-d\\TH:i:s\\Z',$now+10801);rejects(fn()=>kf_manifest(json_encode($bad),$f['catalogue'],$now));
  $bad=$f['manifest'];$bad['regions']['conus']['times'][1]=$bad['regions']['conus']['times'][0];rejects(fn()=>kf_manifest(json_encode($bad),$f['catalogue'],$now));
  $bad=$f['manifest'];$bad['coverage']['total']=2;rejects(fn()=>kf_manifest(json_encode($bad),$f['catalogue'],$now));
  $bad=$f['manifest'];unset($bad['states']['AK']);rejects(fn()=>kf_manifest(json_encode($bad),$f['catalogue'],$now));
  $c=$f['catalogue'];$c['sha256']=str_repeat('b',64);rejects(fn()=>kf_manifest($f['raw'],$c,$now),'catalogue_mismatch');
  rejects(fn()=>kf_manifest($f['raw'],$f['catalogue'],$now+7200),'stale');
  foreach(['2026-02-30T12:00:00Z','2026-10-29T25:00:00Z','2026-10-29T12:00:00+00:00','2026-10-29']as$t)rejects(fn()=>kf_time($t));
`));
test('JSON duplicate keys and escaped aliases never acquire a schema identity',{skip:!capable},()=>php(`
  foreach(['{"a":1,"a":2}','{"a":1,"\\\\u0061":2}','{"x":{"a":1,"a":2}}','{"a":[{"x":1,"x":2}]}']as$raw)rejects(fn()=>kf_json($raw,1024));
  check(kf_json('{"a":{"x":1},"b":{"x":2},"c":[1,2,3]}',1024)['b']['x']===2);
  check(kf_json(json_encode(['quoted'=>'a"b\\\\c{}[]','nested'=>['ok'=>true]]),1024)['nested']['ok']===true);
  rejects(fn()=>kf_json(str_repeat(' ',1025),1024));
`));
test('required source digests, reference inventories and declared cadence are validated',{skip:!capable},()=>php(`
  foreach(['missing_hash','hash','missing_references','empty_references','duplicate_references','future_reference','reference_bound','cadence','membership_count']as$case){
    $m=$f['manifest'];
    if($case==='missing_hash')unset($m['source']['files'][0]['sha256']);
    if($case==='hash')$m['source']['files'][0]['sha256']=str_repeat('G',64);
    if($case==='missing_references')unset($m['regions']['conus']['reference_times']);
    if($case==='empty_references')$m['regions']['conus']['reference_times']=[];
    if($case==='duplicate_references')$m['regions']['conus']['reference_times']=[$m['generated_at'],$m['generated_at']];
    if($case==='future_reference')$m['regions']['conus']['reference_times']=[gmdate('Y-m-d\\TH:i:s\\Z',$now+7201)];
    if($case==='reference_bound')$m['regions']['conus']['reference_times']=array_fill(0,101,$m['generated_at']);
    if($case==='cadence')$m['regions']['conus']['max_step_seconds']=3599;
    if($case==='membership_count')$m['states']['CA']['count']=0;
    rejects(fn()=>kf_manifest(json_encode($m),$f['catalogue'],$now));
  }
`));
test('forecast-start metadata can follow publication without extending freshness',{skip:!capable},()=>php(`
  $m=$f['manifest'];$m['regions']['conus']['reference_times']=[gmdate('Y-m-d\\TH:i:s\\Z',$now+600)];
  $m['regions']['conus']['times']=array_map(fn($h)=>gmdate('Y-m-d\\TH:i:s\\Z',$now+$h*3600),[1,2,3]);
  $checked=kf_manifest(json_encode($m),$f['catalogue'],$now);check($checked['expires_at']===$f['manifest']['expires_at']);
  rejects(fn()=>kf_manifest(json_encode($m),$f['catalogue'],$now+7200),'stale');
  $m['source']['files'][0]['last_modified']=gmdate('Y-m-d\\TH:i:s\\Z',$now+301);rejects(fn()=>kf_manifest(json_encode($m),$f['catalogue'],$now));
`));
test('state bytes are hash-bound, retain zero/null/negative samples, reject malformed records',{skip:!capable},()=>php(`
  $raw=kf_unpack($f['compressed'][$f['manifest']['states']['CA']['asset']],$f['manifest'],'CA');check($raw===$f['states']['CA']);
  $r=kf_state($raw,$f['manifest'],'CA')['records']['site-one'];check($r['temperatures_c']===[0,null,-5.125]);
  kf_state($f['states']['AK'],$f['manifest'],'AK');
  rejects(fn()=>kf_state($raw.' ',$f['manifest'],'CA'));
  foreach(['coordinate','samples','temperature','hot','cold','distance','status','identity']as$mutation){$copy=$f;$d=json_decode($raw,true);
    if($mutation==='coordinate')$d['records']['site-one']['coordinate_key']='037.0000000,-120.0000000';
    if($mutation==='samples')$d['records']['site-one']['temperatures_c']=[0];
    if($mutation==='temperature')$d['records']['site-one']['temperatures_c']=[0,'3',4];
    if($mutation==='hot')$d['records']['site-one']['temperatures_c']=[0,70.001,4];
    if($mutation==='cold')$d['records']['site-one']['temperatures_c']=[0,-100.001,4];
    if($mutation==='distance')$d['records']['site-one']['grid_distance_m']=5000.001;
    if($mutation==='status')$d['records']['site-one']['status']='observed';
    if($mutation==='identity')$d['snapshot_id']=str_repeat('b',24);
    $bad=ff_restate($copy,'CA',$d);rejects(fn()=>kf_state($bad,$copy['manifest'],'CA'));
  }
  $copy=$f;$d=json_decode($raw,true);$d['records']['site-one']=['coordinate_key'=>'37.0000000,-120.0000000','status'=>'unknown','reason'=>'outside_domain'];$unknown=ff_restate($copy,'CA',$d);kf_state($unknown,$copy['manifest'],'CA');
`));
test('gzip bombs, corrupt hashes and declared byte mismatches cannot enter the cache',{skip:!capable},()=>php(`
  $asset=$f['manifest']['states']['CA']['asset'];rejects(fn()=>kf_unpack('garbage',$f['manifest'],'CA'));
  $bomb=gzencode(str_repeat('x',KF_JSON_MAX+100));$m=$f['manifest'];$m['states']['CA']['bytes']=strlen($bomb);$m['states']['CA']['sha256']=hash('sha256',$bomb);$m['states']['CA']['json_bytes']=KF_JSON_MAX;
  rejects(fn()=>kf_unpack($bomb,$m,'CA'));
  $m=$f['manifest'];$m['states']['CA']['json_sha256']=str_repeat('0',64);rejects(fn()=>kf_unpack($f['compressed'][$asset],$m,'CA'));
`));
test('index uses two slots, does not download shards, and limits refresh attempts',{skip:!capable},()=>php(`
  $calls=[];$http=function($url,$limit)use(&$calls,$f){$calls[]=$url;if(str_ends_with($url,'current-a.json'))throw new KfException('upstream_unavailable');return$f['raw'];};
  $m=kf_index($dir,$f['catalogue'],$http,$now);check($m['snapshot_id']===$f['manifest']['snapshot_id']);check(count($calls)===2);
  check(count(glob($dir.'/'.$m['snapshot_id'].'/*.json'))===1);
  kf_index($dir,$f['catalogue'],$http,$now+1);check(count($calls)===2);
  $failure=static function(){throw new KfException('upstream_unavailable');};
  check(kf_index($dir,$f['catalogue'],$failure,$now+901)['snapshot_id']===$m['snapshot_id']);
  rejects(fn()=>kf_index($dir,$f['catalogue'],$failure,$now+7200),'stale');
`));
test('new manifest promotion is atomic, retains previous, and cannot roll back',{skip:!capable},()=>php(`
  $http=static fn()=>$f['raw'];kf_index($dir,$f['catalogue'],$http,$now);
  $new=ff_fixture($now+1000,'b');$http=static fn()=>$new['raw'];kf_index($dir,$f['catalogue'],$http,$now+1000);
  $a=kf_control($dir);check($a['current']===str_repeat('b',24)&&$a['previous']===str_repeat('a',24));check(is_file($dir.'/'.str_repeat('a',24).'/manifest.json'));
  check(kf_index($dir,$f['catalogue'],static fn()=>$f['raw'],$now+2000)['snapshot_id']===str_repeat('b',24));
  $handle=fopen($dir.'/active.json','rb');$old=stream_get_contents($handle);kf_write($dir.'/active.json',json_encode($a));rewind($handle);check(stream_get_contents($handle)===$old);fclose($handle);
`));
test('conflicting pointers and changed immutable manifests preserve last accepted snapshot',{skip:!capable},()=>php(`
  kf_index($dir,$f['catalogue'],static fn()=>$f['raw'],$now);
  $left=ff_fixture($now+1000,'b');$right=ff_fixture($now+1000,'c');
  $http=static fn($url)=>str_ends_with($url,'current-a.json')?$left['raw']:$right['raw'];
  check(kf_index($dir,$f['catalogue'],$http,$now+1000)['snapshot_id']===$f['manifest']['snapshot_id']);
  $changed=$f['manifest'];$changed['source']['files'][0]['etag']='changed';
  check(kf_index($dir,$f['catalogue'],static fn()=>json_encode($changed),$now+2000)['source']['files'][0]['etag']==='fixture');
  $lock=kf_lock($dir.'/metadata.lock');$calls=0;$http=function()use(&$calls){$calls++;throw new KfException('unexpected_network');};
  check(kf_index($dir,$f['catalogue'],$http,$now+3000)['snapshot_id']===$f['manifest']['snapshot_id']);check($calls===0);kf_unlock($lock);
`));
test('metadata retry delay is shared across requests without extending absolute expiry',{skip:!capable},()=>php(`
  kf_index($dir,$f['catalogue'],static fn()=>$f['raw'],$now);$calls=0;
  $http=function()use(&$calls){$calls++;throw new KfException('upstream_unavailable',503,3600);};
  check(kf_index($dir,$f['catalogue'],$http,$now+900)['snapshot_id']===$f['manifest']['snapshot_id']);check($calls===2);
  kf_index($dir,$f['catalogue'],$http,$now+1800);check($calls===2);
  kf_index($dir,$f['catalogue'],$http,$now+4500);check($calls===4);
  rejects(fn()=>kf_index($dir,$f['catalogue'],$http,$now+7200),'stale');check($calls===4);
`));
test('shards load only accepted snapshots and serve exact cached raw bytes',{skip:!capable},()=>php(`
  kf_index($dir,$f['catalogue'],static fn()=>$f['raw'],$now);$calls=0;
  $http=function($url,$limit)use(&$calls,$f){$calls++;return$f['compressed'][basename($url)];};
  rejects(fn()=>kf_get_state($dir,$f['catalogue'],str_repeat('b',24),'CA',$http,$now),'unavailable');check($calls===0);
  [$raw,$hash,$expiry]=kf_get_state($dir,$f['catalogue'],$f['manifest']['snapshot_id'],'CA',$http,$now);check($raw===$f['states']['CA']&&$hash===hash('sha256',$raw));check($calls===1);
  kf_get_state($dir,$f['catalogue'],$f['manifest']['snapshot_id'],'CA',$http,$now+1);check($calls===1);
  rejects(fn()=>kf_get_state($dir,$f['catalogue'],$f['manifest']['snapshot_id'],'CA',$http,$now+7200),'stale');
`));
test('two global download slots and per-shard locks reject concurrent excess',{skip:!capable},()=>php(`
  kf_index($dir,$f['catalogue'],static fn()=>$f['raw'],$now);$a=kf_lock($dir.'/download-0.lock');$b=kf_lock($dir.'/download-1.lock');$calls=0;
  $http=function()use(&$calls){$calls++;throw new KfException('upstream_unavailable');};
  rejects(fn()=>kf_get_state($dir,$f['catalogue'],$f['manifest']['snapshot_id'],'CA',$http,$now),'busy');check($calls===0);kf_unlock($a);kf_unlock($b);
  $shard=kf_lock($dir.'/'.$f['manifest']['snapshot_id'].'/CA.lock');rejects(fn()=>kf_get_state($dir,$f['catalogue'],$f['manifest']['snapshot_id'],'CA',$http,$now),'busy');check($calls===0);kf_unlock($shard);
`));
test('failed shard downloads back off and never leave a partial file',{skip:!capable},()=>php(`
  kf_index($dir,$f['catalogue'],static fn()=>$f['raw'],$now);$calls=0;
  $http=function()use(&$calls){$calls++;throw new KfException('upstream_unavailable',503,1800);};
  rejects(fn()=>kf_get_state($dir,$f['catalogue'],$f['manifest']['snapshot_id'],'CA',$http,$now),'upstream_unavailable');
  rejects(fn()=>kf_get_state($dir,$f['catalogue'],$f['manifest']['snapshot_id'],'CA',$http,$now+901),'backoff');check($calls===1);check(!is_file($dir.'/'.$f['manifest']['snapshot_id'].'/CA.json'));
  rejects(fn()=>kf_get_state($dir,$f['catalogue'],$f['manifest']['snapshot_id'],'CA',$http,$now+1800),'upstream_unavailable');check($calls===2);
`));
test('cache quota and symlinks reject writes without affecting an accepted manifest',{skip:!capable},()=>php(`
  kf_index($dir,$f['catalogue'],static fn()=>$f['raw'],$now);$before=file_get_contents($dir.'/active.json');
  $handle=fopen($dir.'/quota.bin','wb');ftruncate($handle,KF_DISK_MAX-100);fclose($handle);
  $calls=0;$http=function()use(&$calls){$calls++;return'';};rejects(fn()=>kf_get_state($dir,$f['catalogue'],$f['manifest']['snapshot_id'],'CA',$http,$now),'cache_full');check($calls===0&&file_get_contents($dir.'/active.json')===$before);unlink($dir.'/quota.bin');
  symlink($dir.'/active.json',$dir.'/'.$f['manifest']['snapshot_id'].'/CA.json');rejects(fn()=>kf_get_state($dir,$f['catalogue'],$f['manifest']['snapshot_id'],'CA',$http,$now),'cache_unavailable');
  unlink($dir.'/'.$f['manifest']['snapshot_id'].'/CA.json');
  $sub=$dir.'/'.$f['manifest']['snapshot_id'];rename($sub,$dir.'/held');symlink($dir.'/held',$sub);rejects(fn()=>kf_get_state($dir,$f['catalogue'],$f['manifest']['snapshot_id'],'CA',$http,$now),'cache_unavailable');
`));
test('expiry-aware cleanup protects current and previous generations',{skip:!capable},()=>php(`
  kf_dir($dir);$a=['current'=>str_repeat('c',24),'previous'=>str_repeat('b',24),'retired'=>[str_repeat('a',24)=>$now+1000],'high_water'=>$now+2000];
  foreach(['a','b','c']as$letter){$fixture=ff_fixture($now,$letter);$sub=$dir.'/'.str_repeat($letter,24);kf_dir($sub);kf_write($sub.'/manifest.json',$fixture['raw']);}
  kf_cleanup($dir,$a,$now+8999);check(is_dir($dir.'/'.str_repeat('a',24)));
  kf_cleanup($dir,$a,$now+9001);check(!is_dir($dir.'/'.str_repeat('a',24)));check(is_dir($dir.'/'.str_repeat('b',24))&&is_dir($dir.'/'.str_repeat('c',24)));
`));
test('manifestless crash remnants expire after source lifetime plus grace while protected directories survive',{skip:!capable},()=>php(`
  kf_dir($dir);$a=['current'=>str_repeat('a',24),'previous'=>str_repeat('b',24),'retired'=>[],'high_water'=>0];
  foreach(['a','b','c','d','e']as$letter){$sub=$dir.'/'.str_repeat($letter,24);kf_dir($sub);kf_write($sub.'/.stage-fixture','partial');touch($sub,$now);}
  kf_cleanup($dir,$a,$now+KF_MAX_AGE+KF_GRACE,[str_repeat('c',24)]);
  check(is_dir($dir.'/'.str_repeat('d',24)));
  touch($dir.'/'.str_repeat('e',24),$now+100);
  kf_cleanup($dir,$a,$now+KF_MAX_AGE+KF_GRACE+1,[str_repeat('c',24)]);
  check(!is_dir($dir.'/'.str_repeat('d',24)));
  foreach(['a','b','c','e']as$letter)check(is_file($dir.'/'.str_repeat($letter,24).'/.stage-fixture'));
`));
test('four abandoned manifestless generations cannot permanently prevent a new snapshot',{skip:!capable},()=>php(`
  kf_dir($dir);
  foreach(['b','c','d','e']as$letter){$sub=$dir.'/'.str_repeat($letter,24);kf_dir($sub);touch($sub,$now-KF_MAX_AGE-KF_GRACE-1);}
  $m=kf_index($dir,$f['catalogue'],static fn()=>$f['raw'],$now);check($m['snapshot_id']===$f['manifest']['snapshot_id']);
  check(count(glob($dir.'/*',GLOB_ONLYDIR))===1);
`));
test('orphan cleanup refuses symlinks and unrelated content before deleting any files',{skip:!capable},()=>php(`
  kf_dir($dir);$a=['current'=>null,'previous'=>null,'retired'=>[],'high_water'=>0];
  $outside=$dir.'/outside';kf_write($outside,'keep');$sub=$dir.'/'.str_repeat('a',24);kf_dir($sub);
  kf_write($sub.'/.stage-fixture','partial');symlink($outside,$sub.'/CA.json');touch($sub,$now-KF_MAX_AGE-KF_GRACE-1);
  rejects(function()use($dir,&$a,$now){kf_cleanup($dir,$a,$now);},'cache_unavailable');
  check(file_get_contents($outside)==='keep'&&is_link($sub.'/CA.json')&&is_file($sub.'/.stage-fixture'));
  unlink($sub.'/CA.json');kf_write($sub.'/unrelated.txt','keep too');touch($sub,$now-KF_MAX_AGE-KF_GRACE-1);
  rejects(function()use($dir,&$a,$now){kf_cleanup($dir,$a,$now);},'cache_unavailable');
  check(is_file($sub.'/unrelated.txt')&&is_file($sub.'/.stage-fixture'));
`));
test('forecast endpoint rejects bad query or method before private cache access',{skip:!capable},()=>{
  for(const [method,q,reason]of [['POST',{},'method_not_allowed'],['GET',{kind:'evil'},'invalid_query']]){
    const out=spawnSync('php',[],{input:`<?php $_SERVER['REQUEST_METHOD']=${JSON.stringify(method)};$_GET=json_decode(${JSON.stringify(JSON.stringify(q))},true);require ${JSON.stringify(endpoint)};`,encoding:'utf8'});
    assert.equal(out.status,0,out.stderr);assert.equal(JSON.parse(out.stdout).error,reason);assert.ok(!out.stdout.includes(root));
  }
});
