<?php
// KampTrail contributions API: shared setup. Never echo configuration, credentials or database errors.
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

const KT_API_VERSION = '1.0.0';
const KT_STATUSES = ['received', 'accepted', 'rejected', 'applied', 'spam'];
const KT_PUBLIC_STATUSES = ['received', 'accepted', 'rejected', 'applied'];

function kt_config_path(): string {
    $override = getenv('KAMPTRAIL_CONFIG');
    if (is_string($override) && $override !== '') return $override;
    // public_html/api/_lib -> the domain folder that holds public_html/ and private/.
    return dirname(__DIR__, 3) . '/private/kamptrail-config.php';
}

/** @return array<string,mixed>|null */
function kt_config(): ?array {
    static $config = false;
    if ($config !== false) return $config;
    $path = kt_config_path();
    if (!is_file($path) || !is_readable($path)) return $config = null;
    try {
        $loaded = (static function (string $file) { return require $file; })($path);
    } catch (Throwable $e) {
        error_log('KampTrail API: configuration could not be loaded');
        return $config = null;
    }
    return $config = is_array($loaded) ? $loaded : null;
}

/** Permission bits beyond owner read/write mean the file is readable by others. */
function kt_config_too_open(): ?bool {
    $path = kt_config_path();
    if (!is_file($path)) return null;
    $perms = @fileperms($path);
    return $perms === false ? null : (($perms & 0077) !== 0);
}

function kt_db(): ?PDO {
    static $pdo = false;
    if ($pdo !== false) return $pdo;
    $config = kt_config();
    if (!$config || !isset($config['db']) || !is_array($config['db'])) return $pdo = null;
    $db = $config['db'];
    try {
        if (!empty($db['dsn'])) {
            $pdo = new PDO((string)$db['dsn'], $db['user'] ?? null, $db['pass'] ?? null);
        } else {
            $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $db['host'] ?? 'localhost', $db['name'] ?? '');
            $pdo = new PDO($dsn, (string)($db['user'] ?? ''), (string)($db['pass'] ?? ''), [PDO::ATTR_TIMEOUT => 5]);
        }
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
        return $pdo;
    } catch (Throwable $e) {
        error_log('KampTrail API: database connection failed');
        return $pdo = null;
    }
}

function kt_driver(PDO $pdo): string { return (string)$pdo->getAttribute(PDO::ATTR_DRIVER_NAME); }

function kt_now(): string { return gmdate('Y-m-d H:i:s'); }

function kt_headers(string $type = 'application/json; charset=utf-8'): void {
    header('Content-Type: ' . $type);
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
}

/** @param array<string,mixed> $body */
function kt_json(int $code, array $body): never {
    http_response_code($code);
    kt_headers();
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function kt_unavailable(): never {
    kt_json(503, ['ok' => false, 'error' => 'unavailable', 'message' => 'Reports are temporarily unavailable. Please try again later.']);
}

function kt_require_method(string $method): void {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== $method) {
        header('Allow: ' . $method);
        kt_json(405, ['ok' => false, 'error' => 'method_not_allowed']);
    }
}

function kt_client_hash(): string {
    $config = kt_config() ?? [];
    $salt = (string)($config['ip_salt'] ?? '');
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    return hash('sha256', $salt . '|' . $ip);
}

/** @return list<string> */
function kt_applied_migrations(PDO $pdo): array {
    try {
        return array_map('strval', $pdo->query('SELECT version FROM schema_migrations ORDER BY version')->fetchAll(PDO::FETCH_COLUMN));
    } catch (Throwable $e) {
        return [];
    }
}

/** @return list<string> Versions applied by this call. */
function kt_migrate(PDO $pdo): array {
    $migrations = require __DIR__ . '/migrations.php';
    $driver = kt_driver($pdo) === 'mysql' ? 'mysql' : 'sqlite';
    $pdo->exec($driver === 'mysql'
        ? 'CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(32) PRIMARY KEY, applied_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
        : 'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    $done = kt_applied_migrations($pdo);
    $applied = [];
    foreach ($migrations as $version => $sql) {
        if (in_array($version, $done, true)) continue;
        foreach ($sql[$driver] as $statement) $pdo->exec($statement);
        $stmt = $pdo->prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
        $stmt->execute([$version, kt_now()]);
        $applied[] = $version;
    }
    return $applied;
}

function kt_pending_migrations(PDO $pdo): array {
    $migrations = require __DIR__ . '/migrations.php';
    return array_values(array_diff(array_keys($migrations), kt_applied_migrations($pdo)));
}

/** Read a JSON request body with a size limit. @return array<string,mixed> */
function kt_json_body(int $limit = 20000): array {
    $raw = file_get_contents('php://input', false, null, 0, $limit + 1);
    if ($raw === false || strlen($raw) > $limit) kt_json(413, ['ok' => false, 'error' => 'too_large']);
    $data = json_decode($raw, true);
    if (!is_array($data)) kt_json(400, ['ok' => false, 'error' => 'invalid_json']);
    return $data;
}

function kt_text($value, int $max): string {
    $text = trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', (string)$value) ?? '');
    return mb_substr($text, 0, $max);
}
