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
    assert.match(code, /strlen\(\$body\) \+ strlen\(\$chunk\) > \$limit/);
    assert.match(code, /\$limit = .*KE_FIREWX_MAX_BYTES : KE_MAX_BYTES/);
    // NWS asks for an app-identifying User-Agent. A project URL is enough, and no personal address belongs in it.
    const agent = code.match(/CURLOPT_USERAGENT => '([^']+)'/)[1];
    assert.match(agent, /^KampTrail\/1\.0 \(https:\/\/kamptrail\.com/);
    assert.doesNotMatch(agent, /@/);
    assert.match(code, /CURLOPT_HEADERFUNCTION/);
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
      check($q['maxAllowableOffset']===0.001 && $q['outSR']==='4326');
      check($q['outFields']==='FID,Start,End_,Density');
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

test('environment NWS active query uses supported parameters and retains response caps', { skip: !capable }, () => {
    php(`
    $query=['kind'=>'alerts','lat'=>39.0,'lng'=>-90.0];
    $calls=0;
    $http=function($url,$parameters)use(&$calls){
      $calls++; check($url===KE_ALERTS);
      // Match the live NWS endpoint, which returns HTTP 400 for query.limit.
      if(array_diff(array_keys($parameters),['point','status'])) throw new KeException('upstream_unavailable');
      check($parameters===['point'=>'39,-90','status'=>'actual']);
      return ['type'=>'FeatureCollection','features'=>[]];
    };
    $result=ke_fetch($query,$http,strtotime('2026-10-29T20:00:00Z'));
    check($calls===1 && $result['ok']===true && $result['kind']==='alerts');
    check($result['data']['features']===[]);
    $tooMany=static fn($url,$parameters)=>['type'=>'FeatureCollection','features'=>array_fill(0,KE_MAX_FEATURES+1,[])];
    rejects(fn()=>ke_fetch($query,$tooMany,time()),'zoom_in');
    $partial=static fn($url,$parameters)=>['type'=>'FeatureCollection','features'=>[],'pagination'=>['next'=>'https://api.weather.gov/alerts/next']];
    rejects(fn()=>ke_fetch($query,$partial,time()),'zoom_in');
    `);
});

test('environment distinguishes complete empty responses from partial upstream failure', { skip: !capable }, () => {
    php(`
    $query=['kind'=>'fire','bbox'=>[-110,35,-105,40]];
    $http=static function($url,$q){
      check($url===KE_FIRE);
      if(isset($q['returnCountOnly'])) return ['count'=>0];
      check($q['maxAllowableOffset']===0.001 && $q['outSR']==='4326');
      check($q['outFields']==='OBJECTID,poly_IncidentName,poly_GISAcres,poly_DateCurrent,poly_PolygonDateTime,poly_IRWINID,attr_IncidentName,attr_IncidentTypeCategory');
      return ['type'=>'FeatureCollection','features'=>[]];
    };
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
        rejects(fn()=>ke_cached(['kind'=>'smoke','bbox'=>[-110,35,-105,40]],$dir,$fetch,2632),'busy');
        $lock=fopen($dir.'/cache.lock','c+');flock($lock,LOCK_EX);
        rejects(fn()=>ke_cached($query,$dir,$fetch,2700),'busy');flock($lock,LOCK_UN);fclose($lock);
        $alerts=['kind'=>'alerts','lat'=>40,'lng'=>-105];
        $alertFetch=static fn()=>['data'=>['features'=>[['properties'=>['expires'=>gmdate('c',2820),'ends'=>null]]]]];
        check(count(ke_cached($alerts,$dir,$alertFetch,2800)['data']['features'])===1);
        check(count(ke_cached($alerts,$dir,$alertFetch,2821)['data']['features'])===0);
        for($i=0;$i<100;$i++) ke_cached(['kind'=>'alerts','lat'=>$i/100,'lng'=>0],$dir,$fetch,3000+2*$i);
        check(count(glob($dir.'/*.json'))<=KE_CACHE_SLOTS);
        check(count(scandir($dir))<=KE_CACHE_SLOTS+3);
        `);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

const fixtures = path.join(root, 'tests/fixtures/fire-weather');
const captured = (name) => JSON.stringify(fs.readFileSync(path.join(fixtures, 'captured', name), 'utf8'));

test('fire-weather queries accept only the fixed national query and a strict zone path', { skip: !capable }, () => {
    php(`
    check(ke_query(['kind'=>'firewx'])===['kind'=>'firewx']);
    check(ke_query(['kind'=>'zone','zone'=>'fire/COZ214'])===['kind'=>'zone','zone'=>'fire/COZ214']);
    foreach([['kind'=>'firewx','bbox'=>'1,2,3,4'],['kind'=>'firewx','url'=>'https://example.com'],['kind'=>'zone'],['kind'=>'zone','zone'=>'../alerts'],['kind'=>'zone','zone'=>'fire/coz214'],['kind'=>'zone','zone'=>'marine/COZ214'],['kind'=>'zone','zone'=>'fire/COZ214/x'],['kind'=>'zone','zone'=>['fire/COZ214']],['kind'=>'zone','zone'=>"fire/COZ214\n"]] as $q) rejects(fn()=>ke_query($q),'invalid_query');
    // Transport refuses any base that is not a fixed source or a validated zone path.
    rejects(fn()=>ke_http('https://api.weather.gov/zones/fire/../../alerts',[]),'upstream_unavailable');
    rejects(fn()=>ke_http('https://example.com/',[]),'upstream_unavailable');
    `);
});

test('fire-weather normalizer keeps polygon, zone-only and cancel messages, drops expired, test and other events', { skip: !capable }, () => {
    php(`
    $now=strtotime('2026-11-01T15:00:00Z');
    $base=['status'=>'Actual','messageType'=>'Alert','event'=>'Red Flag Warning','headline'=>'Red Flag Warning issued','areaDesc'=>'Test area','severity'=>'Severe','sent'=>'2026-11-01T14:00:00Z','effective'=>'2026-11-01T14:00:00Z','onset'=>'2026-11-01T16:00:00Z','expires'=>'2026-11-02T03:00:00Z','ends'=>'2026-11-02T03:00:00Z','description'=>'long text','instruction'=>'do not include','id'=>'urn:a:1','affectedZones'=>['https://api.weather.gov/zones/fire/COZ214','https://api.weather.gov/zones/fire/COZ214','https://example.com/zones/fire/COZ215','https://api.weather.gov/zones/fire/../x']];
    $mk=function(array $over,$geometry=null) use($base){return ['type'=>'Feature','id'=>'x','geometry'=>$geometry,'properties'=>array_merge($base,$over)];};
    $collection['features']=[
      $mk(['id'=>'urn:a:1'],$polygon),
      $mk(['id'=>'urn:a:2','event'=>'Fire Weather Watch']),
      $mk(['id'=>'urn:a:3','expires'=>'2026-11-01T14:59:59Z','ends'=>null]),
      $mk(['id'=>'urn:a:4','status'=>'Test']),
      $mk(['id'=>'urn:a:5','event'=>'Small Craft Advisory']),
      $mk(['id'=>'urn:a:6','messageType'=>'Cancel','expires'=>'2026-11-01T14:00:00Z','ends'=>null,'references'=>[['identifier'=>'urn:a:1'],['identifier'=>7]]]),
      $mk(['id'=>'urn:a:7','messageType'=>'Ack']),
    ];
    $out=ke_normalize('firewx',$collection,$now)['features'];
    check(array_column(array_column($out,'properties'),'id')===['urn:a:1','urn:a:2','urn:a:6'], json_encode(array_column(array_column($out,'properties'),'id')));
    check($out[0]['geometry']['type']==='Polygon' && $out[1]['geometry']===null);
    check($out[1]['properties']['zones']===['fire/COZ214'] && $out[1]['properties']['zone_count']===1);
    check(!array_key_exists('description',$out[0]['properties']) && !array_key_exists('instruction',$out[0]['properties']));
    check($out[2]['properties']['messageType']==='Cancel' && $out[2]['properties']['references']===['urn:a:1']);
    $collection['features']=[$mk(['expires'=>null,'ends'=>null])];
    rejects(fn()=>ke_normalize('firewx',$collection,$now),'upstream_unavailable');
    $collection['features']=[$mk([],['type'=>'Point','coordinates'=>[1,2]])];
    rejects(fn()=>ke_normalize('firewx',$collection,$now),'upstream_unavailable');
    $collection['features']=[];
    check(ke_normalize('firewx',$collection,$now)['features']===[]);
    `);
});

test('real captured empty NWS responses and the real alert schema pass through the fire-weather normalizer', { skip: !capable }, () => {
    php(`
    $now=strtotime('2026-11-01T15:00:00Z');
    $raw=json_decode(${captured('alerts/red-flag-warning-p1.json')},true);
    $result=ke_fetch(['kind'=>'firewx'],function($url,$q)use($raw){check($url===KE_ALERTS);check($q===['event'=>'Red Flag Warning,Fire Weather Watch','status'=>'actual']);return $raw;},$now);
    check($result['ok']===true && $result['kind']==='firewx' && $result['data']['features']===[] && $result['partial']===false);
    // A real, non-fire alert is excluded. The same real record with only its event rewritten is a SYNTHETIC test input.
    $real=json_decode(${captured('alerts/small-craft-advisory-p1.json')},true);
    check(ke_normalize('firewx',$real,$now)['features']===[]);
    $real['features'][0]['properties']['event']='Red Flag Warning';
    $real['features'][0]['properties']['expires']='2026-11-02T03:00:00Z'; $real['features'][0]['properties']['ends']=null;
    $real['features'][0]['properties']['affectedZones']=['https://api.weather.gov/zones/fire/COZ214'];
    $out=ke_normalize('firewx',$real,$now)['features'];
    check(count($out)===1 && $out[0]['properties']['zones']===['fire/COZ214'] && $out[0]['geometry']===null);
    `);
});

test('real captured NWS zone geometry resolves, is simplified under budget, and mismatches are refused', { skip: !capable }, () => {
    php(`
    $now=strtotime('2026-11-01T15:00:00Z');
    foreach([['fire/COZ214',${captured('zones/fire_COZ214.json')}],['fire/CAZ281',${captured('zones/fire_CAZ281.json')}],['fire/NMZ104',${captured('zones/fire_NMZ104.json')}]] as [$zone,$body]){
      $raw=json_decode($body,true);
      $result=ke_fetch(['kind'=>'zone','zone'=>$zone],function($url,$q)use($zone,$raw){check($url===KE_ZONE_BASE.$zone && $q===[]);return $raw;},$now);
      $g=$result['data']['features'][0]['geometry']; check(in_array($g['type'],['Polygon','MultiPolygon'],true));
      $rings=$g['type']==='Polygon'?$g['coordinates']:array_merge(...$g['coordinates']);
      foreach($rings as $ring){check(count($ring)>=4 && count($ring)<=1501 && $ring[0]===$ring[count($ring)-1]);}
      check($result['data']['features'][0]['properties']['id']===substr($zone,5));
    }
    $raw=json_decode(${captured('zones/fire_COZ214.json')},true);
    rejects(fn()=>ke_fetch(['kind'=>'zone','zone'=>'fire/COZ999'],fn($u,$q)=>$raw,$now),'upstream_unavailable');
    $raw['geometry']=null;
    rejects(fn()=>ke_fetch(['kind'=>'zone','zone'=>'fire/COZ214'],fn($u,$q)=>$raw,$now),'upstream_unavailable');
    `);
});

test('fire-weather cache follows upstream max-age within bounds, drops expired alerts but keeps cancels, and honors Retry-After', { skip: !capable }, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-firewx-'));
    try {
        php(`
        check(ke_ttl('firewx',null)===300 && ke_ttl('firewx',30)===300 && ke_ttl('firewx',450)===450 && ke_ttl('firewx',99999)===600);
        check(ke_ttl('zone',null)===3600 && ke_ttl('zone',1051363)===86400 && ke_ttl('zone',7200)===7200);
        check(ke_ttl('alerts',9999)===300 && ke_ttl('smoke',null)===900);
        $dir=${JSON.stringify(directory)}; $q=['kind'=>'firewx'];
        $feature=fn($id,$type,$exp)=>['properties'=>['id'=>$id,'messageType'=>$type,'expires'=>$exp,'ends'=>null]];
        $fetch=static fn($qq,$now)=>['data'=>['features'=>[$feature('a','Alert',gmdate('c',2820)),$feature('b','Alert',gmdate('c',9000)),$feature('c','Cancel',gmdate('c',2000))]]];
        $ids=fn($r)=>array_column(array_column($r['data']['features'],'properties'),'id');
        check($ids(ke_cached($q,$dir,$fetch,2800))===['a','b','c']);
        check($ids(ke_cached($q,$dir,$fetch,2821))===['b','c']);
        // Rate limited upstream: failure is cached for Retry-After (bounded), then retried.
        $calls=0; $limited=function($qq,$now)use(&$calls){$calls++;$GLOBALS['ke_upstream_meta']=['max_age'=>null,'retry_after'=>120];throw new KeException('rate_limited',503);};
        $dir2=${JSON.stringify(directory + '/b')};
        rejects(fn()=>ke_cached($q,$dir2,$limited,5000),'rate_limited'); check($calls===1);
        rejects(fn()=>ke_cached($q,$dir2,$limited,5100),'rate_limited'); check($calls===1);
        ke_cached($q,$dir2,$fetch,5121); 
        `);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
