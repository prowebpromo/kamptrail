<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
const KR_PROVIDER = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';
const KR_MAX_POINTS = 26;
const KR_MAX_RESPONSE = 5000000;
function kr_error(int $code,string $message): never {kt_json($code,['ok'=>false,'message'=>$message]);}
function kr_points($raw): array {
    if (!is_array($raw) || count($raw)<2 || count($raw)>KR_MAX_POINTS) kr_error(422,'Choose between 2 and 26 stops with valid coordinates.');
    $out=[];
    foreach ($raw as $p) {
        if (!is_array($p) || count($p)!==2 || !is_numeric($p[0]) || !is_numeric($p[1])) kr_error(422,'A stop has no valid coordinates.');
        $lng=(float)$p[0];$lat=(float)$p[1];
        if (!is_finite($lng)||!is_finite($lat)||abs($lng)>180||abs($lat)>85) kr_error(422,'A stop is outside the supported coordinate range.');
        $out[]=[round($lng,5),round($lat,5)];
    }
    if (count(array_unique(array_map(fn($p)=>implode(',',$p),$out)))<2) kr_error(422,'Choose at least two different locations.');
    return $out;
}
function kr_normalize(array $data,int $count): array {
    $route=$data['routes'][0]??null;
    if (($data['code']??'')!=='Ok' || !is_array($route)) kr_error(422,'No car route could be found. Check the stops, or use Directions for the whole trip.');
    $geometry=$route['geometry']??[];$coords=$geometry['coordinates']??[];$legs=$route['legs']??[];
    if (($geometry['type']??'')!=='LineString'||!is_array($coords)||count($coords)<2||count($coords)>150000||!is_array($legs)||count($legs)!==$count-1) kr_error(502,'The routing service returned incomplete geometry. Try a shorter trip.');
    foreach ($coords as $p) if (!is_array($p)||count($p)<2||!is_numeric($p[0])||!is_numeric($p[1])||abs((float)$p[0])>180||abs((float)$p[1])>90) kr_error(502,'The routing service returned invalid geometry.');
    $clean=[];$ends=[];$segments=0;
    foreach ($legs as $leg) {
        $dist=$leg['distance']??null;$duration=$leg['duration']??null;$annotations=$leg['annotation']['distance']??null;
        if (!is_numeric($dist)||!is_numeric($duration)||!is_finite((float)$dist)||!is_finite((float)$duration)||(float)$dist<0||(float)$duration<0||!is_array($annotations)) kr_error(502,'The routing service returned incomplete route legs.');
        $segments+=count($annotations);$ends[]=$segments;$clean[]=['distance'=>(float)$dist,'duration'=>(float)$duration];
    }
    if ($segments!==count($coords)-1) kr_error(502,'The routing service could not align its road geometry with the stops.');
    foreach (['distance','duration'] as $key) if (!is_numeric($route[$key]??null)||!is_finite((float)$route[$key])||(float)$route[$key]<0) kr_error(502,'The routing service returned invalid totals.');
    return ['geometry'=>['type'=>'LineString','coordinates'=>$coords],'legs'=>$clean,'leg_ends'=>$ends,'distance'=>(float)$route['distance'],'duration'=>(float)$route['duration'],'calculated_at'=>gmdate('c')];
}
function kr_reserve(PDO $pdo): void {
    $pdo->beginTransaction();
    $pdo->exec('UPDATE routing_state SET last_started_ms=last_started_ms WHERE id=1');
    $last=(int)$pdo->query('SELECT last_started_ms FROM routing_state WHERE id=1')->fetchColumn();$now=(int)floor(microtime(true)*1000);
    if ($now-$last<1100) {$pdo->rollBack();header('Retry-After: 2');kr_error(429,'The routing service is busy. Wait two seconds, then retry.');}
    $since=gmdate('Y-m-d H:i:s',time()-3600);$client=kt_client_hash();
    $q=$pdo->prepare('SELECT COUNT(*) FROM routing_events WHERE client_hash=? AND created_at>=?');$q->execute([$client,$since]);
    if ((int)$q->fetchColumn()>=60) {$pdo->rollBack();kr_error(429,'This connection has reached the hourly routing limit. Cached routes still work. Please try again later.');}
    $pdo->prepare('DELETE FROM routing_events WHERE created_at<?')->execute([$since]);
    $pdo->prepare('INSERT INTO routing_events (client_hash,created_at) VALUES (?,?)')->execute([$client,kt_now()]);
    $pdo->prepare('UPDATE routing_state SET last_started_ms=? WHERE id=1')->execute([$now]);$pdo->commit();
}
function kr_provider(): string {
    // A local fixture server is allowed only under PHP's local development SAPI, never in deployed PHP-FPM.
    $fixture=getenv('KAMPTRAIL_TEST_ROUTER');
    if (PHP_SAPI==='cli-server' && is_string($fixture) && preg_match('~^http://127\.0\.0\.1:[0-9]+/$~D',$fixture)) return $fixture;
    return KR_PROVIDER;
}
