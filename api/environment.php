<?php
declare(strict_types=1);
require_once __DIR__ . '/_lib/environment.php';
kt_require_method('GET');
try {
    $query = ke_query($_GET);
    $directory = dirname(__DIR__, 2) . '/private/environment-cache';
    $result = ke_cached($query, $directory, static fn(array $q, int $now): array => ke_fetch($q, 'ke_http', $now), time());
    kt_json(200, $result);
} catch (KeException $e) {
    if ($e->status === 503) header('Retry-After: ' . ($e->retryAfter ?? 5));
    $message = $e->reason === 'zoom_in' ? 'Zoom in to load environmental context for a smaller area.' : ($e->reason === 'invalid_query' ? 'Choose a valid map area or point.' : 'Environmental context is temporarily unavailable. Try again shortly.');
    kt_json($e->status, ['ok' => false, 'version' => 1, 'error' => $e->reason, 'message' => $message]);
} catch (Throwable $e) {
    error_log('KampTrail environment: request failed');
    kt_json(503, ['ok' => false, 'version' => 1, 'error' => 'unavailable', 'message' => 'Environmental context is temporarily unavailable. Try again shortly.']);
}
