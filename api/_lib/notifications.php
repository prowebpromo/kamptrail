<?php
// Owner-only notices. No submitted text, email, diagnostics or receipt tokens leave this queue.
declare(strict_types=1);

const KTN_MIGRATION = '007_feedback_notifications';
const KTN_MAX_ATTEMPTS = 5;

function ktn_ready(PDO $pdo): bool { return in_array(KTN_MIGRATION, kt_applied_migrations($pdo), true); }
function ktn_enabled(): bool { return (kt_config()['notifications']['enabled'] ?? false) === true; }

/** Called after submission commit; disabled/unmigrated installations keep accepting reports. */
function ktn_enqueue(PDO $pdo, int $id, string $kind, string $now): void {
    if (!in_array($kind, ['bug', 'feature'], true) || !ktn_enabled()) return;
    if (!ktn_ready($pdo)) { error_log('KampTrail notifications: migration pending; report saved without notice'); return; }
    $pdo->prepare('INSERT INTO notification_outbox (submission_id, state, attempts, next_attempt_at, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)')
        ->execute([$id, 'pending', $now, $now, $now]);
}

/** Fixed message content and destination URL; never interpolate visitor input. */
function ktn_message(array $row): array {
    $kind = $row['kind'] === 'bug' ? 'bug report' : 'feature request';
    $id = (int)$row['submission_id'];
    return [
        'subject' => 'KampTrail: new ' . $kind . ' #' . $id,
        'body' => "A new KampTrail $kind has been received.\n\nReport: #$id\nReceived (UTC): " . $row['received_at'] . "\n\nReview it in the private moderation dashboard:\nhttps://kamptrail.com/api/admin.php\n\nSign in and find report #$id. No report content is included in this notice.\n",
        'message_id' => '<kamptrail-feedback-' . $id . '@kamptrail.com>',
    ];
}

/** Validate all transport settings before connecting. Secrets are never returned or logged. */
function ktn_transport_config(): ?array {
    $cfg = kt_config()['notifications'] ?? [];
    if (!is_array($cfg) || ($cfg['enabled'] ?? false) !== true) return null;
    foreach (['recipient', 'from', 'username'] as $key) {
        if (!is_string($cfg[$key] ?? null) || preg_match('/[\r\n]/', $cfg[$key]) || !filter_var($cfg[$key], FILTER_VALIDATE_EMAIL)) return null;
    }
    // The owner authorized this recipient only. Requests can never choose it.
    if (strtolower($cfg['recipient']) !== 'chuck@boondockorbust.com') return null;
    if (!is_string($cfg['host'] ?? null) || !preg_match('/\A[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\z/', $cfg['host'])) return null;
    if (!in_array([$cfg['port'] ?? null, $cfg['encryption'] ?? null], [[465, 'ssl'], [587, 'tls']], true)) return null;
    if (!is_string($cfg['password'] ?? null) || $cfg['password'] === '') return null;
    return $cfg;
}

function ktn_smtp_send(array $message): bool {
    $cfg = ktn_transport_config();
    if (!$cfg) return false;
    require_once __DIR__ . '/phpmailer/Exception.php';
    require_once __DIR__ . '/phpmailer/PHPMailer.php';
    require_once __DIR__ . '/phpmailer/SMTP.php';
    $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host = $cfg['host'];
        $mail->Port = $cfg['port'];
        $mail->SMTPSecure = $cfg['encryption'];
        $mail->SMTPAuth = true;
        $mail->Username = $cfg['username'];
        $mail->Password = $cfg['password'];
        $mail->SMTPDebug = 0;
        $mail->Timeout = 5;
        $mail->getSMTPInstance()->Timelimit = 10;
        $mail->CharSet = 'UTF-8';
        $mail->setFrom($cfg['from'], 'KampTrail');
        $mail->addAddress($cfg['recipient']);
        $mail->Subject = $message['subject'];
        $mail->Body = $message['body'];
        $mail->MessageID = $message['message_id'];
        $mail->isHTML(false);
        return $mail->send();
    } catch (Throwable $e) {
        // PHPMailer errors can include addresses, hosts and server replies. Never log them.
        return false;
    } finally { $mail->smtpClose(); }
}

/** Atomically lease one notice; $send is a test seam, never sourced from request/config data. */
function ktn_dispatch(PDO $pdo, int $id, ?callable $send = null): bool {
    if (!ktn_enabled() || !ktn_ready($pdo)) return false;
    $now = kt_now();
    $lease = bin2hex(random_bytes(16));
    $until = gmdate('Y-m-d H:i:s', time() + 300);
    $claim = $pdo->prepare("UPDATE notification_outbox SET state='sending', lease_token=?, lease_until=?, attempts=attempts+1, updated_at=? WHERE submission_id=? AND attempts < ? AND ((state IN ('pending','failed') AND next_attempt_at <= ?) OR (state='sending' AND lease_until < ?))");
    $claim->execute([$lease, $until, $now, $id, KTN_MAX_ATTEMPTS, $now, $now]);
    if ($claim->rowCount() !== 1) return false;
    $query = $pdo->prepare('SELECT n.submission_id, n.attempts, s.kind, s.created_at AS received_at FROM notification_outbox n JOIN submissions s ON s.id=n.submission_id WHERE n.submission_id=? AND n.lease_token=?');
    $query->execute([$id, $lease]);
    $row = $query->fetch();
    $accepted = false;
    try {
        if ($row && in_array($row['kind'], ['bug', 'feature'], true)) $accepted = ($send ?? 'ktn_smtp_send')(ktn_message($row)) === true;
    } catch (Throwable $e) { $accepted = false; }
    $next = gmdate('Y-m-d H:i:s', time() + min(3600, 60 * (2 ** max(0, (int)($row['attempts'] ?? 1) - 1))));
    $pdo->prepare('UPDATE notification_outbox SET state=?, accepted_at=?, next_attempt_at=?, lease_token=NULL, lease_until=NULL, updated_at=? WHERE submission_id=? AND lease_token=?')
        ->execute([$accepted ? 'sent' : 'failed', $accepted ? kt_now() : null, $next, kt_now(), $id, $lease]);
    if (!$accepted) error_log('KampTrail notifications: SMTP not accepted; notice remains queued');
    return $accepted;
}

function ktn_retry(PDO $pdo, int $id): bool {
    if (!ktn_enabled() || !ktn_ready($pdo)) return false;
    $now = kt_now();
    $stmt = $pdo->prepare("UPDATE notification_outbox SET state='pending', attempts=0, next_attempt_at=?, lease_token=NULL, lease_until=NULL, updated_at=? WHERE submission_id=? AND (state IN ('pending','failed') OR (state='sending' AND lease_until < ?))");
    $stmt->execute([$now, $now, $id, $now]);
    if ($stmt->rowCount() !== 1) return false;
    return ktn_dispatch($pdo, $id);
}

function ktn_drain(PDO $pdo, int $limit = 10): array {
    if (!ktn_enabled() || !ktn_ready($pdo)) return ['attempted' => 0, 'accepted' => 0];
    $now = kt_now();
    $q = $pdo->prepare("SELECT submission_id FROM notification_outbox WHERE attempts < ? AND ((state IN ('pending','failed') AND next_attempt_at <= ?) OR (state='sending' AND lease_until < ?)) ORDER BY created_at LIMIT " . max(1, min(10, $limit)));
    $q->execute([KTN_MAX_ATTEMPTS, $now, $now]);
    $ids = $q->fetchAll(PDO::FETCH_COLUMN);
    $accepted = 0;
    foreach ($ids as $id) if (ktn_dispatch($pdo, (int)$id)) $accepted++;
    return ['attempted' => count($ids), 'accepted' => $accepted];
}
