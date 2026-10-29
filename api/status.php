<?php
// Public status of one report, looked up by the private token the submitter received.
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
kt_require_method('GET');

$token = (string)($_GET['token'] ?? '');
if (!preg_match('/^[a-f0-9]{32}$/', $token)) kt_json(400, ['ok' => false, 'error' => 'invalid_token']);
$pdo = kt_db();
if (!$pdo) kt_unavailable();
try {
    $stmt = $pdo->prepare('SELECT kind, campsite_name, campsite_id, status, public_note, created_at, updated_at FROM submissions WHERE public_token = ?');
    $stmt->execute([$token]);
    $row = $stmt->fetch();
} catch (Throwable $e) {
    error_log('KampTrail API: status lookup failed');
    kt_unavailable();
}
if (!$row) kt_json(404, ['ok' => false, 'error' => 'not_found']);
// Spam decisions are not disclosed. They read as not accepted.
$status = $row['status'] === 'spam' ? 'rejected' : $row['status'];
kt_json(200, [
    'ok' => true,
    'status' => $status,
    'kind' => $row['kind'],
    'campsite_name' => $row['campsite_name'],
    'campsite_id' => $row['campsite_id'],
    'note' => $row['status'] === 'spam' ? null : $row['public_note'],
    'created_at' => $row['created_at'] . 'Z',
    'updated_at' => $row['updated_at'] . 'Z',
]);
