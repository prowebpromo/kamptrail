<?php
// Public health check. Reports states only, never configuration values or error text.
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
kt_require_method('GET');

$config = kt_config();
if (!$config) kt_json(503, ['ok' => false, 'api' => KT_API_VERSION, 'config' => 'missing', 'database' => 'not_configured']);
$pdo = kt_db();
if (!$pdo) kt_json(503, ['ok' => false, 'api' => KT_API_VERSION, 'config' => 'present', 'database' => 'unavailable']);
try {
    $pdo->query('SELECT 1');
    $pending = kt_pending_migrations($pdo);
} catch (Throwable $e) {
    error_log('KampTrail API: health query failed');
    kt_json(503, ['ok' => false, 'api' => KT_API_VERSION, 'config' => 'present', 'database' => 'unavailable']);
}
$tooOpen = kt_config_too_open();
kt_json($pending ? 503 : 200, [
    'ok' => !$pending,
    'api' => KT_API_VERSION,
    'config' => 'present',
    'config_permissions' => $tooOpen === null ? 'unknown' : ($tooOpen ? 'too_open' : 'private'),
    'database' => 'ok',
    'schema' => $pending ? 'migrations_pending' : 'current',
    'accepting_reports' => !$pending,
    'community' => in_array('002_community', kt_applied_migrations($pdo), true) ? 'ready' : 'migrations_pending',
    'photo_processing' => extension_loaded('gd') && class_exists('finfo') ? 'ready' : 'unavailable',
]);
