<?php
// Accept a camper's correction or new-campsite proposal for moderation. Nothing is published automatically.
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
kt_require_method('POST');

$pdo = kt_db();
if (!$pdo) kt_unavailable();
try {
    if (kt_pending_migrations($pdo)) kt_unavailable();
} catch (Throwable $e) {
    kt_unavailable();
}

$in = kt_json_body();
$errors = [];

// Spam checks: a hidden field people never fill, and a minimum time on the form.
if (kt_text($in['website'] ?? '', 200) !== '') kt_json(202, ['ok' => true, 'status' => 'received']);
$elapsed = (int)($in['elapsed_ms'] ?? 0);
if ($elapsed < 3000) $errors['form'] = 'Please take a moment to review your report, then send it again.';

$kind = (string)($in['kind'] ?? '');
if (!in_array($kind, ['correction', 'new_place'], true)) $errors['kind'] = 'Choose a correction or a new campsite.';

$campsiteId = kt_text($in['campsite_id'] ?? '', 200);
$campsiteName = kt_text($in['campsite_name'] ?? '', 200);
if ($kind === 'correction' && $campsiteId === '') $errors['campsite_id'] = 'The campsite is missing. Reopen the listing and try again.';
if ($kind === 'new_place' && mb_strlen($campsiteName) < 3) $errors['campsite_name'] = 'Enter the campsite name.';

$lat = $in['lat'] ?? null; $lng = $in['lng'] ?? null;
$hasCoords = is_numeric($lat) && is_numeric($lng);
if ($hasCoords && (abs((float)$lat) > 90 || abs((float)$lng) > 180)) $errors['coordinates'] = 'Coordinates are out of range.';
if ($kind === 'new_place' && !$hasCoords) $errors['coordinates'] = 'Coordinates are required for a new campsite.';

$allowedProblems = ['closed', 'not_allowed', 'fee', 'location', 'amenities', 'access', 'name', 'other', 'new'];
$problems = array_values(array_unique(array_filter(array_map('strval', is_array($in['problems'] ?? null) ? $in['problems'] : []), fn($p) => in_array($p, $allowedProblems, true))));
if ($kind === 'correction' && !$problems) $errors['problems'] = 'Choose what is wrong.';

$details = kt_text($in['details'] ?? '', 4000);
if (mb_strlen($details) < 10) $errors['details'] = 'Describe what you saw in at least a sentence.';
$source = kt_text($in['source'] ?? '', 500);
$email = kt_text($in['contact_email'] ?? '', 200);
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) $errors['contact_email'] = 'Enter a valid email or leave it blank.';
if (($in['firsthand'] ?? false) !== true) $errors['firsthand'] = 'Confirm the report is first-hand or from an official source.';

if ($errors) kt_json(422, ['ok' => false, 'error' => 'invalid', 'fields' => $errors]);

$client = kt_client_hash();
try {
    $since = gmdate('Y-m-d H:i:s', time() - 3600);
    $count = $pdo->prepare('SELECT COUNT(*) FROM submissions WHERE client_hash = ? AND created_at >= ?');
    $count->execute([$client, $since]);
    if ((int)$count->fetchColumn() >= 5) kt_json(429, ['ok' => false, 'error' => 'rate_limited', 'message' => 'You have sent several reports in the last hour. Please try again later.']);

    $token = bin2hex(random_bytes(16));
    $now = kt_now();
    $stmt = $pdo->prepare('INSERT INTO submissions (public_token, kind, campsite_id, campsite_name, lat, lng, problems, details, source_note, contact_email, client_hash, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $stmt->execute([$token, $kind, $campsiteId ?: null, $campsiteName ?: null, $hasCoords ? round((float)$lat, 6) : null, $hasCoords ? round((float)$lng, 6) : null,
        $problems ? implode(',', $problems) : null, $details, $source ?: null, $email ?: null, $client, 'received', $now, $now]);
} catch (Throwable $e) {
    error_log('KampTrail API: submission insert failed');
    kt_unavailable();
}

kt_json(201, ['ok' => true, 'token' => $token, 'status' => 'received', 'status_url' => 'api/status.php?token=' . $token]);
