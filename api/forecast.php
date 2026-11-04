<?php
declare(strict_types=1);
require_once __DIR__ . '/_lib/forecast.php';
kt_require_method('GET');
try {
    $query = kf_query($_GET);
    $catalogue = kf_catalogue(dirname(__DIR__) . '/data/campsites/coordinate-index.json');
    $directory = dirname(__DIR__, 2) . '/private/kamptrail-weather';
    $now = time();
    if ($query['kind'] === 'index') {
        $manifest = kf_index($directory, $catalogue, 'kf_http', $now);
        $now = time(); kf_assert(kf_time($manifest['expires_at']) > $now, 'stale');
        kt_json(200, ['ok'=>true, 'server_now'=>gmdate('Y-m-d\TH:i:s\Z', $now), 'manifest'=>$manifest]);
    }
    [$raw, $hash, $expires] = kf_get_state($directory, $catalogue, $query['snapshot'], $query['state'], 'kf_http', $now);
    kf_assert(kf_time($expires) > time(), 'stale');
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: same-origin');
    header('Cache-Control: public, max-age=' . max(0, min(300, kf_time($expires) - time())) . ', must-revalidate');
    header('ETag: "' . $hash . '"');
    if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === '"' . $hash . '"') { http_response_code(304); exit; }
    header('Content-Length: ' . strlen($raw)); echo $raw;
} catch (KfException $e) {
    if ($e->status === 503) header('Retry-After: 900');
    kt_json($e->status, ['ok'=>false,'error'=>$e->reason,'message'=>'Forecast samples are unavailable. Try again later.']);
} catch (Throwable $e) {
    error_log('KampTrail forecast: request failed');
    kt_json(503, ['ok'=>false,'error'=>'unavailable','message'=>'Forecast samples are unavailable. Try again later.']);
}
