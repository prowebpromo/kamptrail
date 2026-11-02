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
    // The control capture was limited to one alert, so NWS added a pagination link. A paginated answer is refused as incomplete.
    rejects(fn()=>ke_normalize('firewx',$real,$now),'zoom_in');
    unset($real['pagination']);
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
        // Rate limited upstream: the failure is held until Retry-After, with no cap, and it blocks every NWS key.
        $calls=0; $limited=function($qq,$now)use(&$calls){$calls++;throw new KeException('rate_limited',503,7200);};
        $dir2=${JSON.stringify(directory + '/b')}; $zone=['kind'=>'zone','zone'=>'fire/COZ214'];
        try{ke_cached($q,$dir2,$limited,5000);check(false);}catch(KeException $e){check($e->reason==='rate_limited' && $e->retryAfter===7200);}
        check($calls===1);
        foreach([5100,8600,12199] as $t){ try{ke_cached($q,$dir2,$limited,$t);check(false);}catch(KeException $e){check($e->reason==='rate_limited' && $e->retryAfter===12200-$t, "t=$t got ".$e->retryAfter);} }
        // A different NWS key is blocked too, without any upstream call. 7200 s is well past the 600 s alert cap.
        $zoneCalls=0; $zoneFetch=function($qq,$now)use(&$zoneCalls){$zoneCalls++;return ['ok'=>true];};
        rejects(fn()=>ke_cached($zone,$dir2,$zoneFetch,9000),'rate_limited'); check($zoneCalls===0);
        // A non-NWS key is unaffected.
        ke_cached(['kind'=>'fire','bbox'=>[-110,35,-105,40]],$dir2,$zoneFetch,9000); check($zoneCalls===1);
        check($calls===1);
        // At the deadline the request goes through again.
        ke_cached($q,$dir2,$fetch,12200); 
        // Retry-After and Expires headers are read exactly, as seconds or as an HTTP date.
        $GLOBALS['ke_upstream_meta']=['max_age'=>null,'retry_until'=>null,'expires'=>null];
        ke_note_header("Retry-After: 120\r\n",1000); check($GLOBALS['ke_upstream_meta']['retry_until']===1120);
        ke_note_header("retry-after: Thu, 01 Jan 2026 00:10:00 GMT\r\n",1000); check($GLOBALS['ke_upstream_meta']['retry_until']===strtotime('2026-01-01T00:10:00Z'));
        ke_note_header("Retry-After: 99999999\r\n",1000); check($GLOBALS['ke_upstream_meta']['retry_until']===100000999);
        ke_note_header("Retry-After: junk\r\n",1000); check($GLOBALS['ke_upstream_meta']['retry_until']===100000999);
        ke_note_header("Cache-Control: public, max-age=451, s-maxage=9\r\n",1000); check($GLOBALS['ke_upstream_meta']['max_age']===451);
        ke_note_header("Expires: Thu, 01 Jan 2026 00:10:00 GMT\r\n",1000); check($GLOBALS['ke_upstream_meta']['expires']===strtotime('2026-01-01T00:10:00Z'));
        `);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a message that replaced or cancelled an alert keeps it retired after the message expires or leaves the feed', { skip: !capable }, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-retired-'));
    try {
        php(`
        $now=strtotime('2026-11-01T15:00:00Z');
        $mk=fn($id,$type,$exp,$refs)=>['type'=>'Feature','geometry'=>null,'properties'=>['status'=>'Actual','messageType'=>$type,'event'=>'Red Flag Warning','headline'=>'h','id'=>$id,'sent'=>'2026-11-01T14:00:00Z','expires'=>$exp,'ends'=>null,'references'=>array_map(fn($r)=>['identifier'=>$r],$refs)]];
        // The Update has already expired and is dropped. The original is still unexpired.
        $collection['features']=[$mk('orig','Alert','2026-11-02T03:00:00Z',[]),$mk('upd','Update','2026-11-01T14:30:00Z',['orig']),$mk('gone','Alert','2026-11-02T03:00:00Z',[]),$mk('cx','Cancel','2026-11-01T14:30:00Z',['gone'])];
        $data=ke_normalize('firewx',$collection,$now);
        $ids=array_column(array_column($data['features'],'properties'),'id');
        check($ids===['orig','gone','cx'], json_encode($ids));
        check($data['retired']===['orig','gone'], json_encode($data['retired']));
        // Cached copy: the Update is live at fetch time, then expires inside the cache window. The original stays retired.
        $dir=${JSON.stringify(directory)}; $q=['kind'=>'firewx'];
        $collection['features']=[$mk('orig','Alert','2026-11-02T03:00:00Z',[]),$mk('upd','Update','2026-11-01T15:02:00Z',['orig'])];
        $fetch=fn($qq,$n)=>['ok'=>true,'data'=>ke_normalize('firewx',$collection,$n)];
        $first=ke_cached($q,$dir,$fetch,$now);
        check(array_column(array_column($first['data']['features'],'properties'),'id')===['upd'], 'orig is retired by upd');
        $later=ke_cached($q,$dir,$fetch,$now+200);
        check(array_column(array_column($later['data']['features'],'properties'),'id')===[], 'update expired, orig stays retired and is not returned as active');
        check(in_array('orig',$later['data']['retired'],true), json_encode($later['data']['retired']));
        `);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('retirement history survives proxy cache refreshes and is pruned after the original expires', { skip: !capable }, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-retired2-'));
    try {
        php(`
        $t0=strtotime('2026-11-01T15:00:00Z'); $dir=${JSON.stringify(directory)}; $q=['kind'=>'firewx'];
        $mk=fn($id,$type,$exp,$refs)=>['type'=>'Feature','geometry'=>null,'properties'=>['status'=>'Actual','messageType'=>$type,'event'=>'Red Flag Warning','headline'=>'h','id'=>$id,'sent'=>'2026-11-01T14:00:00Z','expires'=>$exp,'ends'=>null,'references'=>array_map(fn($r)=>['identifier'=>$r],$refs)]];
        $aExpires=gmdate('c',$t0+3000);
        $responses=[[$mk('A','Alert',$aExpires,[]),$mk('B','Update',gmdate('c',$t0+5000),['A'])]];
        $current=$responses[0];
        $fetch=function($qq,$n)use(&$current,$collection){$c=$collection;$c['features']=$current;return ['ok'=>true,'data'=>ke_normalize('firewx',$c,$n)];};
        $ids=fn($r)=>array_column(array_column($r['data']['features'],'properties'),'id');
        $r1=ke_cached($q,$dir,$fetch,$t0);
        check($ids($r1)===['B'] && $r1['data']['retired']===['A'], json_encode($r1['data']['retired']));
        // Response 2: the next good upstream answer carries A alone. A fresh client must still see A retired.
        $current=[$mk('A','Alert',$aExpires,[])];
        $r2=ke_cached($q,$dir,$fetch,$t0+400);
        check($ids($r2)===[], 'A is retired, so the server never returns it as active: '.json_encode($ids($r2)));
        check($r2['data']['retired']===['A'], 'history merged: '.json_encode($r2['data']['retired']));
        $stored=json_decode(file_get_contents($dir.'/firewx-retired.json'),true);
        check($stored==['A'=>$t0+3000], json_encode($stored));
        // Still retained while A is unexpired, even from the cache hit path.
        check(ke_cached($q,$dir,$fetch,$t0+450)['data']['retired']===['A']);
        // The later of expires and ends is kept.
        $current=[$mk('C','Alert',gmdate('c',$t0+1000),[]),$mk('D','Update',gmdate('c',$t0+1000),['C'])];
        $current[0]['properties']['ends']=gmdate('c',$t0+9000);
        $r3=ke_cached($q,$dir,$fetch,$t0+800);
        $stored=json_decode(file_get_contents($dir.'/firewx-retired.json'),true);
        check($stored['C']===$t0+9000 && $stored['A']===$t0+3000, json_encode($stored));
        // After A expires it is pruned. C is still held until its ends time.
        $current=[];
        $r4=ke_cached($q,$dir,$fetch,$t0+3100);
        check($r4['data']['retired']===['C'], json_encode($r4['data']['retired']));
        $r5=ke_cached($q,$dir,$fetch,$t0+9100);
        check($r5['data']['retired']===[] && json_decode(file_get_contents($dir.'/firewx-retired.json'),true)==[]);
        `);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('server filters against the full retained history: 501 retirements, A is #501, and a response with A alone returns no active A', { skip: !capable }, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-retired3-'));
    try {
        php(`
        $now=strtotime('2026-11-01T15:00:00Z'); $dir=${JSON.stringify(directory)};
        $feature=fn($id)=>['properties'=>['id'=>$id,'messageType'=>'Alert','expires'=>gmdate('c',$now+3600),'ends'=>null]];
        $merge=function($features,$retired,$t)use($dir){return ke_merge_retired($dir,['data'=>['features'=>$features,'retired'=>$retired]],$t);};
        $ids=array_map(fn($n)=>"R$n",range(1,500)); $ids[]='A';   // A is retirement #501
        check(count($ids)===501);
        foreach(array_chunk($ids,100) as $chunk) $merge([],$chunk,$now);
        $stored=json_decode(file_get_contents($dir.'/firewx-retired.json'),true);
        check(count($stored)===501 && array_key_last($stored)==='A', 'all 501 retained');
        $r=$merge([$feature('A'),$feature('R1'),$feature('fresh')],[],$now+400);
        $active=array_column(array_column($r['data']['features'],'properties'),'id');
        check($active===['fresh'], 'active: '.json_encode($active));
        check(count($r['data']['retired'])===500, 'client list capped at 500');
        `);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('retirement history holds at most 2,000 ids, prunes the oldest first, and an expired id leaves the history', { skip: !capable }, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-retired4-'));
    try {
        php(`
        $now=strtotime('2026-11-01T15:00:00Z'); $dir=${JSON.stringify(directory)};
        $feature=fn($id,$exp)=>['properties'=>['id'=>$id,'messageType'=>'Alert','expires'=>gmdate('c',$exp),'ends'=>null]];
        $merge=function($features,$retired,$t)use($dir){return ke_merge_retired($dir,['data'=>['features'=>$features,'retired'=>$retired]],$t);};
        $features=[]; $all=[];
        for($n=1;$n<=2010;$n++){ $all[]="X$n"; $features[]=$feature("X$n",$now+86400); }
        foreach(array_chunk($all,100) as $i=>$chunk) $merge(array_slice($features,$i*100,100),$chunk,$now);
        $stored=json_decode(file_get_contents($dir.'/firewx-retired.json'),true);
        check(count($stored)===2000, 'kept '.count($stored));
        check(!isset($stored['X1']) && !isset($stored['X10']) && isset($stored['X11']) && isset($stored['X2010']), 'oldest pruned first');
        $r=$merge([$feature('X1',$now+86400),$feature('X2010',$now+86400)],[],$now+60);
        $active=array_column(array_column($r['data']['features'],'properties'),'id');
        check($active===['X1'], json_encode($active));
        $r=$merge([],[],$now+86401);
        check(json_decode(file_get_contents($dir.'/firewx-retired.json'),true)==[] && $r['data']['retired']===[]);
        `);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('polling limits are separate from freshness: a retained copy past the upstream deadline is served labelled stale, and not refetched early', { skip: !capable }, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-stale-'));
    try {
        php(`
        $t0=1793545200; $dir=${JSON.stringify(directory)};
        // [kind, query, polling limit in seconds, header meta, seconds until the copy is stale (null = already stale one second later)]
        $cases=[
          ['firewx',['kind'=>'firewx'],300,['max_age'=>60,'expires'=>null],60],
          ['firewx',['kind'=>'firewx'],300,['max_age'=>0,'expires'=>null],0],
          ['firewx',['kind'=>'firewx'],300,['max_age'=>null,'expires'=>$t0-500],0],
          ['zone',['kind'=>'zone','zone'=>'fire/COZ214'],3600,['max_age'=>60,'expires'=>null],60],
          ['zone',['kind'=>'zone','zone'=>'fire/COZ214'],3600,['max_age'=>0,'expires'=>null],0],
          ['zone',['kind'=>'zone','zone'=>'fire/COZ214'],3600,['max_age'=>null,'expires'=>$t0-500],0],
        ];
        foreach($cases as $i=>[$kind,$q,$poll,$meta,$staleAfter]){
          $d=$dir.'/c'.$i; $calls=0;
          $fetch=function($qq,$n)use(&$calls,$meta,$kind){$calls++;$GLOBALS['ke_upstream_meta']=['max_age'=>$meta['max_age'],'retry_until'=>null,'expires'=>$meta['expires']];return ['ok'=>true,'kind'=>$kind,'data'=>['type'=>'FeatureCollection','features'=>[]]];};
          $first=ke_cached($q,$d,$fetch,$t0);
          check($first['stale']===false && isset($first['fresh_until']), "$kind $i first");
          check($first['fresh_until']===gmdate('c',$t0+$staleAfter), "$kind $i deadline ".$first['fresh_until']);
          // Past the upstream deadline and inside the polling limit: served from the copy, labelled stale, no refetch.
          foreach([$staleAfter+1,intdiv($poll,2),$poll-1] as $dt){
            $hit=ke_cached($q,$d,$fetch,$t0+$dt);
            check($hit['stale']===true, "$kind $i stale at +$dt");
            check($calls===1, "$kind $i refetched early at +$dt");
          }
          // At the polling limit NWS is asked again and the new copy is fresh.
          $again=ke_cached($q,$d,$fetch,$t0+$poll);
          check($calls===2 && $again['stale']===false, "$kind $i refetch at polling limit");
        }
        // A stale copy never lets a request through during a Retry-After.
        $d=$dir.'/rl'; $calls=0;
        $ok=function($qq,$n)use(&$calls){$calls++;$GLOBALS['ke_upstream_meta']=['max_age'=>0,'retry_until'=>null,'expires'=>null];return ['ok'=>true,'data'=>['features'=>[]]];};
        $limited=function($qq,$n)use(&$calls){$calls++;throw new KeException('rate_limited',503,1000);};
        ke_cached(['kind'=>'firewx'],$d,$ok,$t0);
        rejects(fn()=>ke_cached(['kind'=>'firewx'],$d,$limited,$t0+300),'rate_limited'); check($calls===2);
        rejects(fn()=>ke_cached(['kind'=>'firewx'],$d,$ok,$t0+900),'rate_limited'); check($calls===2);
        ke_cached(['kind'=>'firewx'],$d,$ok,$t0+1300); check($calls===3);
        // Bounds that govern polling, not freshness.
        check(ke_ttl('firewx',60)===300 && ke_ttl('zone',60)===3600 && ke_ttl('firewx',9999)===600);
        check(ke_freshness_seconds(['max_age'=>60,'expires'=>$t0+999],$t0)===60 && ke_freshness_seconds(['max_age'=>null,'expires'=>$t0+90],$t0)===90 && ke_freshness_seconds(['max_age'=>null,'expires'=>$t0-5],$t0)===0 && ke_freshness_seconds(['max_age'=>null,'expires'=>null],$t0)===null);
        `);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
