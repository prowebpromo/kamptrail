'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const helper = path.join(root, 'api/_lib/environment.php');
const endpoint = path.join(root, 'api/environment.php');
const capable = spawnSync('php', ['-v']).status === 0;
if (process.env.KT_REQUIRE_PHP === '1' && !capable) throw new Error('Environment API tests require PHP.');
function php(code) {
    const result = spawnSync('php', [], { input: `<?php require ${JSON.stringify(helper)};
function check($condition, $message='assertion failed') { if (!$condition) throw new Exception($message); }
function rejects($fn, $reason) { try { $fn(); } catch (KeException $e) { check($e->reason === $reason, $e->reason); return; } throw new Exception('expected rejection'); }
$ring = [[-105,40],[-104,40],[-104,41],[-105,40]];
$polygon = ['type'=>'Polygon','coordinates'=>[$ring]];
$collection = ['type'=>'FeatureCollection','features'=>[]];
${code}`, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
}

test('environment transport is fixed HTTPS, bounded, no redirects or fixture bypass', () => {
    const code = fs.readFileSync(helper, 'utf8');
    assert.match(code, /CURLOPT_FOLLOWLOCATION => false/);
    assert.match(code, /CURLOPT_PROTOCOLS => CURLPROTO_HTTPS/);
    assert.match(code, /CURLOPT_SSL_VERIFYPEER => true/);
    assert.match(code, /strlen\(\$body\) \+ strlen\(\$chunk\) > KE_MAX_BYTES/);
    assert.doesNotMatch(code, /getenv\(|kt_config\(|kt_db\(/);
});

test('environment rejects malformed and excessive queries before accessing any provider', { skip: !capable }, () => {
    php(`
    foreach ([[], ['kind'=>'evil'], ['kind'=>['fire']], ['kind'=>'fire','bbox'=>[]], ['kind'=>'fire','bbox'=>'1,2,3'], ['kind'=>'fire','bbox'=>'1,2,NaN,4'], ['kind'=>'fire','bbox'=>'170,20,-170,25'], ['kind'=>'fire','bbox'=>'0,0,2,2','url'=>'https://example.com'], ['kind'=>'alerts','lat'=>'90.1','lng'=>'0'], ['kind'=>'alerts','lat'=>'0','lng'=>['0']], ['kind'=>'alerts','lat'=>'1e1','lng'=>'0']] as $query) rejects(fn()=>ke_query($query),'invalid_query');
    rejects(fn()=>ke_query(['kind'=>'fire','bbox'=>'-120,30,-100,40']),'zoom_in');
    check(ke_query(['kind'=>'fire','bbox'=>'-110,30,-100,40'])['bbox']===[-110.0,30.0,-100.0,40.0]);
    check(ke_query(['kind'=>'alerts','lat'=>'40.123456','lng'=>'-105'])['lat']===40.12346);
    `);
});

test('environment API emits safe invalid-query and method responses', { skip: !capable }, () => {
    for (const [method, query, expected] of [['GET', { kind: 'fire', bbox: '-120,30,-100,40' }, 'zoom_in'], ['GET', { kind: 'alerts', lat: 'x', lng: '0' }, 'invalid_query'], ['POST', {}, 'method_not_allowed']]) {
        const result = spawnSync('php', [], { input: `<?php $_SERVER['REQUEST_METHOD']=${JSON.stringify(method)}; $_GET=json_decode(${JSON.stringify(JSON.stringify(query))},true); require ${JSON.stringify(endpoint)};`, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const data = JSON.parse(result.stdout);
        assert.equal(data.ok, false);
        assert.equal(data.error, expected);
        assert.ok(!result.stdout.includes(root));
    }
});

test('environment validates complete polygon collections and total geometry budget', { skip: !capable }, () => {
    php(`
    $feature=['type'=>'Feature','geometry'=>$polygon,'properties'=>['poly_IncidentName'=>'Test','poly_GISAcres'=>12,'poly_DateCurrent'=>1793203200000,'secret'=>'drop']];
    $collection['features']=[$feature];
    $result=ke_normalize('fire',$collection,time());
    check($result['features'][0]['properties']['name']==='Test');
    check($result['features'][0]['properties']['acres']===12.0);
    check(!isset($result['features'][0]['properties']['secret']));
    check($result['features'][0]['properties']['source_updated_at']==='2026-10-28T16:00:00+00:00');
    $bad=$collection; $bad['properties']['exceededTransferLimit']=true;
    rejects(fn()=>ke_normalize('fire',$bad,time()),'zoom_in');
    $bad=$collection; $bad['pagination']['next']='https://example.org/next';
    rejects(fn()=>ke_normalize('fire',$bad,time()),'zoom_in');
    $bad=$collection; $bad['features']=array_fill(0,501,$feature);
    rejects(fn()=>ke_normalize('fire',$bad,time()),'zoom_in');
    $bad=$collection; $bad['features'][0]['geometry']['coordinates'][0][0]=[181,40];
    rejects(fn()=>ke_normalize('fire',$bad,time()),'upstream_unavailable');
    $bad=$collection; $bad['features'][0]['geometry']['coordinates'][0][3]=[-106,40];
    rejects(fn()=>ke_normalize('fire',$bad,time()),'upstream_unavailable');
    $bad=$collection; $bad['features'][0]['geometry']=null;
    rejects(fn()=>ke_normalize('fire',$bad,time()),'upstream_unavailable');
    $bad=$collection; $bad['features'][0]['geometry']['coordinates']=[array_fill(0,KE_MAX_COORDINATES+1,[-105,40])];
    $bad['features'][0]['geometry']['type']='Polygon';
    rejects(fn()=>ke_normalize('fire',$bad,time()),'zoom_in');
    `);
});

test('environment keeps only actual unexpired NWS alerts, accepts null zone geometry', { skip: !capable }, () => {
    php(`
    $now=strtotime('2026-10-29T12:00:00Z');
    $p=['status'=>'Actual','messageType'=>'Alert','event'=>'Red Flag Warning','headline'=>'Red Flag Warning issued','expires'=>'2026-10-29T18:00:00Z','sent'=>'2026-10-29T10:00:00Z','description'=>'Wind and dry fuels.'];
    $f=['type'=>'Feature','id'=>'urn:alert:1','geometry'=>null,'properties'=>$p];
    $test=$f; $test['properties']['status']='Test';
    $expired=$f; $expired['properties']['expires']='2026-10-29T11:00:00Z';
    $ended=$f; $ended['properties']['ends']='2026-10-29T11:00:00Z';
    $cancel=$f; $cancel['properties']['messageType']='Cancel';
    $collection['features']=[$f,$test,$expired,$ended,$cancel];
    $clean=ke_normalize('alerts',$collection,$now)['features'];
    check(count($clean)===1); check($clean[0]['geometry']===null);
    check($clean[0]['properties']['id']==='urn:alert:1'); check($clean[0]['properties']['instruction']===null);
    $collection['features'][0]['properties']['expires']='nonsense';
    rejects(fn()=>ke_normalize('alerts',$collection,$now),'upstream_unavailable');
    `);
});

test('environment reads latest NOAA observation day and detects stale or incomplete smoke', { skip: !capable }, () => {
    php(`
    $now=strtotime('2026-10-29T20:00:00Z');
    check(ke_smoke_date('2026302 1200')==='2026-10-29T12:00:00+00:00');
    foreach(['2026366 1200','2026000 1200','2026302 2400','2026302 1260','bad'] as $stamp) check(ke_smoke_date($stamp)===null);
    check(ke_smoke_date('2024366 1200')==='2024-12-31T12:00:00+00:00');
    $calls=[];
    $http=function($url,$q)use(&$calls,$polygon){
      $calls[]=$q; check($url===KE_SMOKE);
      if(isset($q['orderByFields']))return ['features'=>[['attributes'=>['Start'=>'2026302 1200']]]];
      check($q['where']==="Start LIKE '2026302 %'");
      if(isset($q['returnCountOnly']))return ['count'=>1];
      return ['type'=>'FeatureCollection','features'=>[['type'=>'Feature','geometry'=>$polygon,'properties'=>['FID'=>1,'Start'=>'2026302 1200','End_'=>'2026302 1500','Density'=>'Light']]]];
    };
    $result=ke_fetch(['kind'=>'smoke','bbox'=>[-110,35,-105,40]],$http,$now);
    check(count($calls)===3); check($result['data']['features'][0]['properties']['density']==='light');
    check($result['data']['features'][0]['properties']['end']==='2026-10-29T15:00:00+00:00');
    check($result['source']['observation_date']==='2026-10-29');
    rejects(fn()=>ke_fetch(['kind'=>'smoke','bbox'=>[-110,35,-105,40]],$http,$now+3*86400),'upstream_unavailable');
    rejects(fn()=>ke_fetch(['kind'=>'smoke','bbox'=>[-110,35,-105,40]],$http,$now-86400),'upstream_unavailable');
    `);
});

test('environment distinguishes complete empty responses from partial upstream failure', { skip: !capable }, () => {
    php(`
    $query=['kind'=>'fire','bbox'=>[-110,35,-105,40]];
    $http=static fn($url,$q)=>isset($q['returnCountOnly'])?['count'=>0]:['type'=>'FeatureCollection','features'=>[]];
    $result=ke_fetch($query,$http,1793304000);
    check($result['ok']===true && $result['partial']===false && count($result['data']['features'])===0);
    check($result['kind']==='fire' && $result['version']===1 && isset($result['retrieved_at']));
    $http=static fn($url,$q)=>isset($q['returnCountOnly'])?['count'=>1]:['type'=>'FeatureCollection','features'=>[]];
    rejects(fn()=>ke_fetch($query,$http,time()),'upstream_unavailable');
    $http=static fn($url,$q)=>['count'=>501];
    rejects(fn()=>ke_fetch($query,$http,time()),'zoom_in');
    `);
});

test('environment cache expires without stale fallback, caches failures, bounds disk slots and locks', { skip: !capable }, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-environment-'));
    try {
        php(`
        $dir=${JSON.stringify(directory)}; $calls=0; $query=['kind'=>'fire','bbox'=>[-110,35,-105,40]];
        $fetch=function($q,$now)use(&$calls){$calls++;return ['ok'=>true,'retrieved_at'=>gmdate('c',$now)];};
        $first=ke_cached($query,$dir,$fetch,2000);
        check(ke_cached($query,$dir,$fetch,2100)===$first && $calls===1);
        ke_cached($query,$dir,$fetch,2300); check($calls===2);
        $fail=function($q,$now)use(&$calls){$calls++;throw new KeException('upstream_unavailable');};
        rejects(fn()=>ke_cached($query,$dir,$fail,2600),'upstream_unavailable'); check($calls===3);
        rejects(fn()=>ke_cached($query,$dir,$fail,2610),'upstream_unavailable'); check($calls===3);
        ke_cached($query,$dir,$fetch,2631); check($calls===4);
        $lock=fopen($dir.'/cache.lock','c+');flock($lock,LOCK_EX);
        rejects(fn()=>ke_cached($query,$dir,$fetch,2700),'busy');flock($lock,LOCK_UN);fclose($lock);
        for($i=0;$i<100;$i++) ke_cached(['kind'=>'alerts','lat'=>$i/100,'lng'=>0],$dir,$fetch,3000+2*$i);
        check(count(glob($dir.'/*.json'))<=KE_CACHE_SLOTS);
        check(count(scandir($dir))<=KE_CACHE_SLOTS+3);
        `);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
