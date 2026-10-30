<?php
// Moderator page: review reports, set status with a public note, keep an audit trail, apply schema migrations.
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
require __DIR__ . '/_lib/community-admin.php';
require __DIR__ . '/_lib/permissions-admin.php';

header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
kt_headers('text/html; charset=utf-8');

function h($v): string { return htmlspecialchars((string)$v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function page(string $title, string $body): never {
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' . h($title) . '</title>'
        . '<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f5f5ef;color:#203b2d}main{max-width:980px;margin:auto;padding:20px}h1{font-size:22px}.card{background:#fff;border:1px solid #d8dfd5;border-radius:8px;padding:14px;margin:12px 0}.meta{color:#55694f;font-size:13px}button,input,select,textarea{font:inherit}textarea{width:100%}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.err{color:#8a2a1a}nav a{margin-right:12px}table{border-collapse:collapse;font-size:13px}td,th{padding:4px 8px;border-bottom:1px solid #e3e8df;text-align:left}</style>'
        . '</head><body><main>' . $body . '</main></body></html>';
    exit;
}

$config = kt_config();
$password = is_array($config) ? (string)($config['moderator_password'] ?? '') : '';
if (!$config || strlen($password) < 12) {
    http_response_code(503);
    page('Moderation unavailable', '<h1>Moderation is not configured</h1><p>The server configuration is missing or has no moderator password of 12 or more characters.</p>');
}

session_name('kt_mod');
session_set_cookie_params(['lifetime' => 0, 'path' => dirname($_SERVER['SCRIPT_NAME'] ?? '/api/admin.php') . '/', 'secure' => !empty($_SERVER['HTTPS']), 'httponly' => true, 'samesite' => 'Strict']);
session_start();
if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
$csrf = $_SESSION['csrf'];
$self = h(basename(__FILE__));

if (($_POST['do'] ?? '') === 'logout' && hash_equals($csrf, (string)($_POST['csrf'] ?? ''))) { $_SESSION = []; session_destroy(); header('Location: ' . basename(__FILE__)); exit; }

if (empty($_SESSION['moderator'])) {
    $error = '';
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && ($_POST['do'] ?? '') === 'login') {
        $fails = (int)($_SESSION['fails'] ?? 0);
        if ($fails >= 5) { sleep(2); }
        if (hash_equals($csrf, (string)($_POST['csrf'] ?? '')) && hash_equals($password, (string)($_POST['password'] ?? ''))) {
            session_regenerate_id(true);
            $_SESSION['moderator'] = (string)($config['moderator_name'] ?? 'moderator');
            $_SESSION['fails'] = 0;
            header('Location: ' . basename(__FILE__)); exit;
        }
        $_SESSION['fails'] = $fails + 1;
        sleep(1);
        $error = '<p class="err">That password did not work.</p>';
    }
    page('KampTrail moderation', '<h1>KampTrail moderation</h1>' . $error . '<form method="post" action="' . $self . '" class="card"><input type="hidden" name="do" value="login"><input type="hidden" name="csrf" value="' . h($csrf) . '"><label>Password <input type="password" name="password" autocomplete="current-password" required></label> <button>Sign in</button></form>');
}

$pdo = kt_db();
if (!$pdo) { http_response_code(503); page('Database unavailable', '<h1>Database unavailable</h1><p>The moderation database could not be reached. Check the server configuration and MySQL status in hPanel.</p>'); }
$moderator = (string)$_SESSION['moderator'];
$notice = '';

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    if (!hash_equals($csrf, (string)($_POST['csrf'] ?? ''))) { http_response_code(400); page('Expired form', '<p>This form expired. <a href="' . $self . '">Reload</a>.</p>'); }
    try {
        if (($_POST['do'] ?? '') === 'migrate') {
            $applied = kt_migrate($pdo);
            $notice = $applied ? 'Applied migrations: ' . h(implode(', ', $applied)) : 'No migrations were pending.';
        } elseif (str_starts_with((string)($_POST['do'] ?? ''), 'permission_')) {
            $notice = kp_admin_action($pdo, $moderator);
        } elseif (str_starts_with((string)($_POST['do'] ?? ''), 'community_')) {
            $notice = kc_moderate($pdo, $moderator);
        } elseif (($_POST['do'] ?? '') === 'set') {
            $id = (int)($_POST['id'] ?? 0);
            $to = (string)($_POST['status'] ?? '');
            $note = kt_text($_POST['public_note'] ?? '', 1000);
            if (!in_array($to, KT_STATUSES, true)) throw new InvalidArgumentException('status');
            $pdo->beginTransaction();
            $row = $pdo->prepare('SELECT status FROM submissions WHERE id = ?');
            $row->execute([$id]);
            $from = $row->fetchColumn();
            if ($from === false) { $pdo->rollBack(); throw new InvalidArgumentException('id'); }
            $pdo->prepare('UPDATE submissions SET status = ?, public_note = ?, updated_at = ? WHERE id = ?')->execute([$to, $note ?: null, kt_now(), $id]);
            $pdo->prepare('INSERT INTO moderation_log (submission_id, action, from_status, to_status, note, moderator, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                ->execute([$id, 'set_status', (string)$from, $to, $note ?: null, $moderator, kt_now()]);
            $pdo->commit();
            $notice = 'Report ' . $id . ' set to ' . h($to) . '.';
        }
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('KampTrail API: moderation action failed');
        $notice = '<span class="err">That action could not be completed.</span>';
    }
}

$pending = [];
try { $pending = kt_pending_migrations($pdo); } catch (Throwable $e) { $pending = ['unknown']; }
$body = '<div class="row"><h1 style="flex:1">KampTrail moderation</h1><form method="post" action="' . $self . '"><input type="hidden" name="do" value="logout"><input type="hidden" name="csrf" value="' . h($csrf) . '"><button>Sign out</button></form></div>';
if ($notice) $body .= '<p class="card">' . $notice . '</p>';
if ($pending) {
    $body .= '<div class="card"><strong>Schema migrations pending:</strong> ' . h(implode(', ', $pending)) . '<form method="post" action="' . $self . '"><input type="hidden" name="do" value="migrate"><input type="hidden" name="csrf" value="' . h($csrf) . '"><button>Apply migrations</button></form></div>';
    page('KampTrail moderation', $body);
}
$body .= '<nav><a href="' . $self . '">Campsite corrections</a><a href="' . $self . '?community=1">Reviews, photos and reports</a><a href="' . $self . '?permissions=1">Overnight permission reports</a><a href="fcc-setup.php">FCC credentials</a></nav>';
if (isset($_GET['permissions'])) page('KampTrail permission moderation', $body . kp_admin_view($pdo, $csrf, $self));
if (isset($_GET['community'])) page('KampTrail community moderation', $body . kc_admin_body($pdo, $csrf, $self));
$filter = in_array($_GET['status'] ?? 'received', KT_STATUSES, true) ? (string)($_GET['status'] ?? 'received') : 'received';
$body .= '<nav>' . implode('', array_map(fn($s) => '<a href="' . $self . '?status=' . h($s) . '">' . ($s === $filter ? '<strong>' . h($s) . '</strong>' : h($s)) . '</a>', KT_STATUSES)) . '</nav>';
$rows = $pdo->prepare('SELECT * FROM submissions WHERE status = ? ORDER BY created_at ASC LIMIT 100');
$rows->execute([$filter]);
$list = $rows->fetchAll();
if (!$list) $body .= '<p class="card">No reports with status ' . h($filter) . '.</p>';
foreach ($list as $r) {
    $log = $pdo->prepare('SELECT * FROM moderation_log WHERE submission_id = ? ORDER BY id');
    $log->execute([$r['id']]);
    $logRows = $log->fetchAll();
    $where = $r['lat'] !== null ? h($r['lat']) . ', ' . h($r['lng']) . ' · <a href="https://www.openstreetmap.org/?mlat=' . h($r['lat']) . '&amp;mlon=' . h($r['lng']) . '#map=16/' . h($r['lat']) . '/' . h($r['lng']) . '" rel="noopener noreferrer" target="_blank">map</a>' : 'no coordinates';
    $body .= '<div class="card"><div class="meta">#' . h($r['id']) . ' · ' . h($r['kind']) . ' · received ' . h($r['created_at']) . ' UTC · ' . $where . '</div>'
        . '<h2 style="font-size:17px;margin:6px 0">' . h($r['campsite_name'] ?: '(no name)') . ($r['campsite_id'] ? ' <span class="meta">' . h($r['campsite_id']) . '</span>' : '') . '</h2>'
        . ($r['problems'] ? '<p><strong>Problems:</strong> ' . h(str_replace(',', ', ', $r['problems'])) . '</p>' : '')
        . '<p style="white-space:pre-wrap">' . h($r['details']) . '</p>'
        . ($r['source_note'] ? '<p><strong>Source:</strong> ' . h($r['source_note']) . '</p>' : '')
        . ($r['contact_email'] ? '<p class="meta">Contact: ' . h($r['contact_email']) . '</p>' : '')
        . ($r['public_note'] ? '<p class="meta">Public note: ' . h($r['public_note']) . '</p>' : '')
        . '<form method="post" action="' . $self . '?status=' . h($filter) . '" class="row"><input type="hidden" name="do" value="set"><input type="hidden" name="csrf" value="' . h($csrf) . '"><input type="hidden" name="id" value="' . h($r['id']) . '">'
        . '<select name="status">' . implode('', array_map(fn($s) => '<option value="' . h($s) . '"' . ($s === $r['status'] ? ' selected' : '') . '>' . h($s) . '</option>', KT_STATUSES)) . '</select>'
        . '<input name="public_note" maxlength="1000" placeholder="Public note shown to the submitter" style="flex:1;min-width:240px" value="' . h($r['public_note'] ?? '') . '"><button>Save</button></form>';
    if ($logRows) {
        $body .= '<table><tr><th>When (UTC)</th><th>By</th><th>Change</th><th>Note</th></tr>';
        foreach ($logRows as $l) $body .= '<tr><td>' . h($l['created_at']) . '</td><td>' . h($l['moderator']) . '</td><td>' . h($l['from_status']) . ' → ' . h($l['to_status']) . '</td><td>' . h($l['note'] ?? '') . '</td></tr>';
        $body .= '</table>';
    }
    $body .= '</div>';
}
page('KampTrail moderation', $body);
