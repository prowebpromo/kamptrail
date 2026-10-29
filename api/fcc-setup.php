<?php
// Moderator-only credential intake. Never return, prefill, log or download secrets.
declare(strict_types=1);
require __DIR__ . '/_lib/bootstrap.php';
kt_headers('text/html; charset=utf-8');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
// no-referrer makes native form POSTs send Origin: null in browsers.
// same-origin preserves our origin check without sending referrers off-site.
header('Referrer-Policy: same-origin');
header('X-Robots-Tag: noindex, nofollow');
function fcc_page(int $code, string $message, string $csrf = ''): never {
    http_response_code($code);
    $form = $csrf === '' ? '<p><a href="admin.php">Sign in to moderation</a></p>' : '<form method="post" action="fcc-setup.php" autocomplete="off"><input type="hidden" name="csrf" value="' . htmlspecialchars($csrf, ENT_QUOTES) . '"><label>FCC account email<input type="email" name="username" required maxlength="254" autocomplete="off"></label><label>FCC API token<input type="password" name="fcc_token" required minlength="16" maxlength="512" autocomplete="off" spellcheck="false"></label><button>Save FCC credentials</button></form><p>The token stays masked. Both fields are required. Saved values are never displayed.</p><p><a href="admin.php">Back to moderation</a></p>';
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>FCC credentials | KampTrail moderation</title><style>body{font:16px/1.5 system-ui;background:#f5f5ef;color:#203b2d;margin:0}main{max-width:560px;margin:40px auto;padding:24px;background:white;border-radius:8px}label{display:block;margin:18px 0}input{display:block;box-sizing:border-box;width:100%;padding:10px;font:inherit}button{padding:12px;font:inherit}p{overflow-wrap:anywhere}</style></head><body><main><h1>FCC coverage credentials</h1><p>' . htmlspecialchars($message, ENT_QUOTES) . '</p>' . $form . '</main></body></html>';
    exit;
}
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'POST'], true)) { header('Allow: GET, POST'); fcc_page(405, 'Method not allowed.'); }
$local = PHP_SAPI === 'cli-server' && in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
if (empty($_SERVER['HTTPS']) && !$local) fcc_page(403, 'HTTPS is required.');
$config = kt_config();
if (!$config || kt_config_too_open() !== false || strlen((string)($config['moderator_password'] ?? '')) < 12) fcc_page(503, 'Private moderator configuration is required.');
session_name('kt_mod');
session_set_cookie_params(['lifetime'=>0,'path'=>dirname($_SERVER['SCRIPT_NAME'] ?? '/api/fcc-setup.php') . '/','secure'=>!$local,'httponly'=>true,'samesite'=>'Strict']);
session_start();
if (empty($_SESSION['moderator'])) fcc_page(403, 'Sign in to KampTrail moderation before saving credentials.');
if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
$csrf = $_SESSION['csrf'];
if ($method === 'GET') fcc_page(200, 'Enter the FCC account email and Public Map Data API token. They are stored privately outside the web root.', $csrf);
if (!is_string($_POST['csrf'] ?? null) || !hash_equals($csrf, $_POST['csrf'])) fcc_page(403, 'This form expired. Reload it and try again.', $csrf);
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$expected = ($local ? 'http://' : 'https://') . ($_SERVER['HTTP_HOST'] ?? '');
if ($origin !== '' && $origin !== $expected) fcc_page(403, 'This request did not originate from KampTrail.', $csrf);
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 4096) fcc_page(413, 'The submitted form was too large.', $csrf);
$username = $_POST['username'] ?? null;
$token = $_POST['fcc_token'] ?? null;
if (!is_string($username) || strlen($username) > 254 || !filter_var($username, FILTER_VALIDATE_EMAIL) || !is_string($token) || !preg_match('/^[\x21-\x7e]{16,512}$/D', $token)) fcc_page(422, 'Enter a valid FCC account email and an API token without whitespace. Both fields are required.', $csrf);
$directory = dirname(kt_config_path()) . '/fcc-install/fcc-data';
$target = $directory . '/credentials.json';
$temp = false;
try {
    if (!is_dir($directory) || is_link($directory) || (fileperms($directory) & 0077) !== 0 || realpath($directory) !== $directory) throw new RuntimeException('storage');
    if (is_link($target) || (file_exists($target) && (!is_file($target) || (fileperms($target) & 0077) !== 0))) throw new RuntimeException('permissions');
    $temp = tempnam($directory, '.credential-');
    if ($temp === false || !chmod($temp, 0600)) throw new RuntimeException('temp');
    $content = json_encode(['username'=>$username,'token'=>$token], JSON_THROW_ON_ERROR);
    if (file_put_contents($temp, $content, LOCK_EX) !== strlen($content)) throw new RuntimeException('write');
    if (!rename($temp, $target)) throw new RuntimeException('replace');
    $temp = false;
} catch (Throwable $e) {
    if (is_string($temp)) @unlink($temp);
    // Deliberately do not log the exception or any request fields.
    fcc_page(503, 'Private credential storage is unavailable. No credential values were displayed.', $csrf);
}
unset($token, $content, $username);
$_SESSION['csrf'] = bin2hex(random_bytes(16));
fcc_page(200, 'FCC credentials saved privately. Authentication has not been tested yet. You may close this page.', $_SESSION['csrf']);
