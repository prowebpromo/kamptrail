<?php
// Fixed-provider, light-use car routing. No coordinates or route geometry are stored in KampTrail's database.
declare(strict_types=1);
require __DIR__ . '/_lib/routing.php';
kt_require_method('POST');
$origin=$_SERVER['HTTP_ORIGIN']??'';
if ($origin!=='' && parse_url($origin,PHP_URL_HOST)!==explode(':',$_SERVER['HTTP_HOST']??'')[0]) kr_error(403,'Use the routing control on KampTrail.');
$points=kr_points(kt_json_body(5000)['points']??null);
$pdo=kt_db();
if (!$pdo || !in_array('003_routing',kt_applied_migrations($pdo),true)) kr_error(503,'Road routing is temporarily unavailable. Saved stops and external directions still work.');
try {
    kr_reserve($pdo);
    $coords=implode(';',array_map(fn($p)=>$p[0].','.$p[1],$points));
    $url=kr_provider().$coords.'?overview=full&geometries=geojson&steps=false&annotations=distance&alternatives=false';
    $context=stream_context_create(['http'=>['timeout'=>15,'ignore_errors'=>true,'header'=>"User-Agent: KampTrail route planner (+https://github.com/prowebpromo/kamptrail)\r\nAccept: application/json\r\n"]]);
    $raw=@file_get_contents($url,false,$context,0,KR_MAX_RESPONSE+1);
    if (!is_string($raw)||strlen($raw)>KR_MAX_RESPONSE) kr_error(502,'Road routing is unavailable or this trip is too large. Retry or split it into shorter trips.');
    $data=json_decode($raw,true);
    if (!is_array($data)) kr_error(502,'Road routing is unavailable right now. Try again later.');
    $route=kr_normalize($data,count($points));
    kt_json(200,['ok'=>true,'route'=>$route,'provider'=>'FOSSGIS OSRM car routing']);
} catch (Throwable $e) {
    if ($pdo->inTransaction())$pdo->rollBack();
    error_log('KampTrail routing: provider request failed');kr_error(502,'Road routing is unavailable right now. Saved stops and external directions still work.');
}
