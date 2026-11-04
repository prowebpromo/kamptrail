<?php
// Published visitor clearance reports in a bounding box: only moderator-applied submissions, never contact details or prose.
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/clearance-reports.php';
kt_require_method('GET');
$raw = $_GET['bbox'] ?? '';
$box = is_string($raw) && strlen($raw) <= 80 ? array_map('trim', explode(',', $raw)) : [];
if (count($box) !== 4 || array_filter($box, fn($v) => !is_numeric($v))) kt_json(422, ['ok' => false, 'error' => 'invalid_bbox']);
[$w, $s, $e, $n] = array_map('floatval', $box);
if ($w < -180 || $e > 180 || $s < -90 || $n > 90 || $w > $e || $s > $n || ($e - $w) * ($n - $s) > 25) kt_json(422, ['ok' => false, 'error' => 'invalid_bbox']);
$pdo = kt_db();
if (!$pdo) kt_unavailable();
try {
    if (!kcr_ready($pdo)) kt_unavailable();
    $q = $pdo->prepare("SELECT s.id, s.lat, s.lng, s.updated_at, c.posted, c.hundredths, c.observed_on, c.direction, c.osm_ref FROM submissions s JOIN clearance_reports c ON c.submission_id = s.id
        WHERE s.kind = 'clearance' AND s.status = 'applied' AND s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ? ORDER BY s.id LIMIT 201");
    $q->execute([$s, $n, $w, $e]);
    $rows = $q->fetchAll();
} catch (Throwable $e) {
    error_log('KampTrail API: clearance report lookup failed');
    kt_unavailable();
}
$truncated = count($rows) > 200;
$out = array_map(fn($r) => ['id' => (int)$r['id'], 'lat' => (float)$r['lat'], 'lng' => (float)$r['lng'], 'posted' => $r['posted'], 'hundredths' => (int)$r['hundredths'],
    'observed_on' => $r['observed_on'], 'direction' => $r['direction'], 'osm_ref' => $r['osm_ref'], 'published_at' => str_replace(' ', 'T', substr((string)$r['updated_at'], 0, 19)) . 'Z'], array_slice($rows, 0, 200));
kt_json(200, ['ok' => true, 'version' => 1, 'source' => 'moderated_visitor_reports', 'reports' => $out, 'truncated' => $truncated]);
