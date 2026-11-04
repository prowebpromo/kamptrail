<?php
// CLI only: run from Hostinger cron every five minutes. No public trigger or bearer token.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/notifications.php';
try {
    $pdo = kt_db();
    if (!$pdo || !ktn_ready($pdo) || !ktn_transport_config()) { fwrite(STDERR, "Notifications not configured or migration pending.\n"); exit(1); }
    $result = ktn_drain($pdo);
    echo 'Notices attempted: ' . $result['attempted'] . '; SMTP accepted: ' . $result['accepted'] . ".\n";
} catch (Throwable $e) { fwrite(STDERR, "Notification worker failed; pending notices retained.\n"); exit(1); }
