<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';

const KF_RELEASE = 'https://github.com/prowebpromo/kamptrail/releases/download/forecast-data-v1/';
const KF_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const KF_REGIONS = ['conus','alaska','hawaii'];
const KF_MANIFEST_MAX = 262144;
const KF_GZIP_MAX = 2097152;
const KF_JSON_MAX = 8388608;
const KF_DISK_MAX = 314572800;
const KF_REFRESH = 900;
const KF_GRACE = 1800;
const KF_MAX_AGE = 10800;

final class KfException extends RuntimeException {
    public function __construct(public string $reason, public int $status = 503, public int $retryAfter = KF_REFRESH) { parent::__construct($reason); }
}
function kf_assert(bool $condition, string $reason = 'invalid_forecast', int $status = 503): void {
    if (!$condition) throw new KfException($reason, $status);
}
function kf_hash($s): bool { return is_string($s) && preg_match('/^[a-f0-9]{64}$/D', $s) === 1; }
function kf_snapshot($s): bool { return is_string($s) && preg_match('/^[a-f0-9]{24}$/D', $s) === 1; }
function kf_int($n, int $min, int $max): bool { return is_int($n) && $n >= $min && $n <= $max; }
function kf_number($n, float $min, float $max): bool { return (is_int($n) || is_float($n)) && is_finite((float)$n) && $n >= $min && $n <= $max; }
function kf_keys(array $a, array $keys): void { $actual = array_keys($a); sort($actual); sort($keys); kf_assert($actual === $keys); }
function kf_time($s): int {
    kf_assert(is_string($s) && preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/D', $s) === 1);
    $n = strtotime($s); kf_assert($n !== false && $n >= 1577836800 && $n <= 4133980800 && gmdate('Y-m-d\TH:i:s\Z', $n) === $s); return $n;
}
/** JSON decoding discards duplicate keys; reject them before trusting schema/hash identity. */
function kf_unique_json_keys(string $raw): void {
    $stack = []; $offset = 0; $length = strlen($raw);
    while ($offset < $length) {
        $offset += strcspn($raw, '"{}[]', $offset);
        if ($offset >= $length) break;
        $token = $raw[$offset++];
        if ($token === '{' || $token === '[') { $stack[] = ['object'=>$token === '{', 'keys'=>[]]; continue; }
        if ($token === '}' || $token === ']') { array_pop($stack); continue; }
        $start = $offset - 1;
        // JSON is already syntactically valid. Skip quoted values without regex backtracking.
        do {
            $end = strpos($raw, '"', $offset); kf_assert($end !== false);
            $slashes = 0;
            for ($j = $end - 1; $j > $start && $raw[$j] === '\\'; $j--) $slashes++;
            $offset = $end + 1;
        } while ($slashes % 2 === 1);
        $next = $offset;
        while ($next < $length && str_contains(" \r\n\t", $raw[$next])) $next++;
        if ($next >= $length || $raw[$next] !== ':') continue;
        $index = count($stack) - 1; kf_assert($index >= 0 && $stack[$index]['object']);
        $key = ':' . json_decode(substr($raw, $start, $offset - $start), true, 2, JSON_THROW_ON_ERROR);
        kf_assert(!isset($stack[$index]['keys'][$key])); $stack[$index]['keys'][$key] = true;
    }
}
function kf_json(string $raw, int $limit): array {
    kf_assert(strlen($raw) <= $limit);
    try { $value = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); }
    catch (Throwable $e) { throw new KfException('invalid_forecast'); }
    kf_assert(is_array($value)); kf_unique_json_keys($raw); return $value;
}
function kf_query(array $q): array {
    $kind = $q['kind'] ?? null;
    if ($kind === 'index' && count($q) === 1) return ['kind'=>'index'];
    if ($kind === 'state' && count($q) === 3 && is_string($q['state'] ?? null) && in_array($q['state'], KF_STATES, true) && kf_snapshot($q['snapshot'] ?? null)) return ['kind'=>'state','state'=>$q['state'],'snapshot'=>$q['snapshot']];
    throw new KfException('invalid_query', 400);
}
function kf_catalogue(string $path): array {
    kf_assert(!is_link($path) && is_file($path) && filesize($path) <= 1024, 'catalogue_unavailable');
    $c = kf_json((string)file_get_contents($path), 1024);
    kf_keys($c, ['version','sha256','count']);
    kf_assert($c['version'] === 1 && kf_hash($c['sha256']) && kf_int($c['count'], 0, 100000), 'catalogue_unavailable'); return $c;
}
/** Validate transport and source freshness; expired local data may be read solely for cleanup. */
function kf_manifest(string $raw, array $catalogue, int $now, bool $allowExpired = false): array {
    $m = kf_json($raw, KF_MANIFEST_MAX);
    kf_keys($m, ['version','snapshot_id','catalogue_sha256','generated_at','expires_at','source','regions','states','coverage']);
    kf_assert($m['version'] === 1 && kf_snapshot($m['snapshot_id']) && kf_hash($m['catalogue_sha256']));
    kf_assert(hash_equals($catalogue['sha256'], $m['catalogue_sha256']), 'catalogue_mismatch');
    $generated = kf_time($m['generated_at']); $expiry = kf_time($m['expires_at']);
    kf_assert($generated <= $now + 300 && $expiry > $generated && $expiry <= $generated + KF_MAX_AGE);
    if (!$allowExpired) kf_assert($expiry > $now, 'stale');
    kf_assert(is_array($m['source']) && is_array($m['regions']) && is_array($m['states']) && is_array($m['coverage']));
    kf_keys($m['source'], ['name','files']); kf_keys($m['regions'], KF_REGIONS); kf_keys($m['states'], KF_STATES);
    kf_assert($m['source']['name'] === 'NOAA/NWS NDFD' && is_array($m['source']['files']) && array_is_list($m['source']['files']) && count($m['source']['files']) === 3);
    $seen = []; $sourceBytes = 0;
    foreach ($m['source']['files'] as $file) {
        kf_assert(is_array($file)); kf_keys($file, ['region','url','etag','last_modified','bytes','sha256']);
        $r = $file['region']; kf_assert(is_string($r) && in_array($r, KF_REGIONS, true) && !isset($seen[$r])); $seen[$r] = true;
        kf_assert($file['url'] === 'https://noaa-ndfd-pds.s3.amazonaws.com/opnl/AR.' . $r . '/VP.001-003/ds.temp.bin');
        kf_assert(kf_hash($file['sha256']) && is_string($file['etag']) && strlen($file['etag']) >= 1 && strlen($file['etag']) <= 256 && !preg_match('/[\x00-\x1f\x7f]/', $file['etag']) && kf_int($file['bytes'], 1, 157286400));
        $modified = kf_time($file['last_modified']); kf_assert($modified <= $generated + 300 && $modified <= $now + 300 && $expiry <= $modified + KF_MAX_AGE); $sourceBytes += $file['bytes'];
    }
    kf_assert($sourceBytes <= 157286400);
    foreach ($m['regions'] as $region) {
        kf_assert(is_array($region)); kf_keys($region, ['times','grid_sha256','max_step_seconds','reference_times']);
        kf_assert(kf_hash($region['grid_sha256']) && kf_int($region['max_step_seconds'], 1, 10800) && is_array($region['times']) && array_is_list($region['times']) && count($region['times']) >= 1 && count($region['times']) <= 100);
        $last = null;
        foreach ($region['times'] as $stamp) { $t = kf_time($stamp); kf_assert($t >= $generated - 86400 && $t <= $generated + 8 * 86400 && ($last === null || ($t > $last && $t - $last <= $region['max_step_seconds']))); $last = $t; }
        kf_assert(is_array($region['reference_times']) && array_is_list($region['reference_times']) && count($region['reference_times']) >= 1 && count($region['reference_times']) <= 100);
        $last = null;
        foreach ($region['reference_times'] as $stamp) { $t = kf_time($stamp); kf_assert($t <= $generated + 300 && ($last === null || $t > $last)); $last = $t; }
    }
    $memberships = 0;
    foreach ($m['states'] as $state => $s) {
        kf_assert(is_array($s)); kf_keys($s, ['asset','sha256','json_sha256','bytes','json_bytes','count']);
        kf_assert($s['asset'] === 'forecast-v1-' . $m['snapshot_id'] . '-' . $state . '.json.gz' && kf_hash($s['sha256']) && kf_hash($s['json_sha256']) && kf_int($s['bytes'], 1, KF_GZIP_MAX) && kf_int($s['json_bytes'], 2, KF_JSON_MAX) && kf_int($s['count'], 0, 20000)); $memberships += $s['count'];
    }
    kf_keys($m['coverage'], ['total','grid_known','unknown']);
    foreach ($m['coverage'] as $n) kf_assert(kf_int($n, 0, 100000));
    kf_assert($memberships >= $m['coverage']['total'] && $m['coverage']['total'] === $catalogue['count'] && $m['coverage']['grid_known'] + $m['coverage']['unknown'] === $m['coverage']['total']);
    return $m;
}
function kf_state(string $raw, array $m, string $state): array {
    $s = $m['states'][$state]; kf_assert(strlen($raw) === $s['json_bytes'] && hash_equals($s['json_sha256'], hash('sha256', $raw)));
    $d = kf_json($raw, KF_JSON_MAX); kf_keys($d, ['version','snapshot_id','state','generated_at','expires_at','records']);
    kf_assert(is_object(json_decode($raw)->records ?? null));
    kf_assert($d['version'] === 1 && $d['snapshot_id'] === $m['snapshot_id'] && $d['state'] === $state && $d['generated_at'] === $m['generated_at'] && $d['expires_at'] === $m['expires_at'] && is_array($d['records']) && count($d['records']) === $s['count']);
    foreach ($d['records'] as $id => $r) {
        kf_assert((is_string($id) || is_int($id)) && strlen((string)$id) >= 1 && strlen((string)$id) <= 200 && !preg_match('/[\x00-\x1f\x7f]/', (string)$id) && is_array($r));
        kf_assert(is_string($r['coordinate_key'] ?? null) && preg_match('/^-?\d{1,2}\.\d{7},-?\d{1,3}\.\d{7}$/D', $r['coordinate_key']) === 1);
        [$lat,$lng] = array_map('floatval', explode(',', $r['coordinate_key'])); kf_assert(abs($lat) <= 90 && abs($lng) <= 180);
        kf_assert(sprintf('%.7F,%.7F', $lat === 0.0 ? 0.0 : $lat, $lng === 0.0 ? 0.0 : $lng) === $r['coordinate_key']);
        if (($r['status'] ?? null) === 'unknown') {
            kf_keys($r, ['coordinate_key','status','reason']); kf_assert(is_string($r['reason']) && strlen($r['reason']) >= 1 && strlen($r['reason']) <= 100 && !preg_match('/[\x00-\x1f\x7f]/', $r['reason'])); continue;
        }
        kf_keys($r, ['coordinate_key','region','status','grid_lat','grid_lng','grid_distance_m','temperatures_c']);
        kf_assert($r['status'] === 'known' && is_string($r['region']) && isset($m['regions'][$r['region']]) && kf_number($r['grid_lat'], -90, 90) && kf_number($r['grid_lng'], -180, 180) && kf_number($r['grid_distance_m'], 0, 5000));
        kf_assert(is_array($r['temperatures_c']) && array_is_list($r['temperatures_c']) && count($r['temperatures_c']) === count($m['regions'][$r['region']]['times']));
        foreach ($r['temperatures_c'] as $v) kf_assert($v === null || kf_number($v, -100, 70));
    }
    return $d;
}
function kf_unpack(string $compressed, array $m, string $state): string {
    $s = $m['states'][$state]; kf_assert(strlen($compressed) === $s['bytes'] && strlen($compressed) <= KF_GZIP_MAX && hash_equals($s['sha256'], hash('sha256', $compressed)));
    // A hard expanded-byte cap prevents gzip bombs before JSON allocation.
    $raw = @gzdecode($compressed, min(KF_JSON_MAX, $s['json_bytes']) + 1);
    kf_assert(is_string($raw) && strlen($raw) === $s['json_bytes']); kf_state($raw, $m, $state); return $raw;
}
/** Accept only a fixed public release path, then the verified GitHub release CDN. */
function kf_url(string $url, bool $initial): void {
    kf_assert(!preg_match('/[\x00-\x20\x7f]/', $url), 'upstream_unavailable');
    $p = parse_url($url); kf_assert(is_array($p) && ($p['scheme'] ?? '') === 'https' && !isset($p['user']) && !isset($p['pass']) && !isset($p['port']) && !isset($p['fragment']), 'upstream_unavailable');
    if ($initial) kf_assert(str_starts_with($url, KF_RELEASE) && !isset($p['query']) && preg_match('/^(?:current-[ab]\.json|forecast-v1-[a-f0-9]{24}-[A-Z]{2}\.json\.gz)$/D', substr($url, strlen(KF_RELEASE))) === 1, 'upstream_unavailable');
    else kf_assert(($p['host'] ?? '') === 'release-assets.githubusercontent.com', 'upstream_unavailable');
}
function kf_http(string $url, int $limit): string {
    kf_assert(function_exists('curl_init'), 'upstream_unavailable'); kf_url($url, true);
    static $deadline = null;
    if ($deadline === null) $deadline = microtime(true) + 25;
    for ($hop = 0; $hop < 2; $hop++) {
        $remaining = (int)(1000 * ($deadline - microtime(true))); kf_assert($remaining >= 100, 'upstream_unavailable');
        if ($hop) kf_url($url, false);
        $body = ''; $headers = []; $headerBytes = 0; $oversized = false; $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_FOLLOWLOCATION=>false, CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER=>true, CURLOPT_SSL_VERIFYHOST=>2, CURLOPT_CONNECTTIMEOUT=>4, CURLOPT_TIMEOUT_MS=>min(8000, $remaining),
            CURLOPT_USERAGENT=>'KampTrail/2.13 (https://kamptrail.com; forecast cache)',
            CURLOPT_HTTPHEADER=>['Accept: application/octet-stream, application/json', 'Cache-Control: no-cache'],
            CURLOPT_HEADERFUNCTION=>static function($h, string $line) use (&$headers, &$headerBytes): int { $headerBytes += strlen($line); if ($headerBytes > 32768) return 0; $parts = explode(':', $line, 2); if (count($parts) === 2) $headers[strtolower(trim($parts[0]))] = trim($parts[1]); return strlen($line); },
            CURLOPT_WRITEFUNCTION=>static function($h, string $chunk) use (&$body, &$oversized, $limit): int { if (strlen($body) + strlen($chunk) > $limit) { $oversized = true; return 0; } $body .= $chunk; return strlen($chunk); }]);
        $ok = curl_exec($ch); $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        kf_assert(!$oversized && $ok !== false, 'upstream_unavailable');
        if ($status === 200) return $body;
        if (in_array($status, [301,302,303,307,308], true) && isset($headers['location'])) { $url = $headers['location']; continue; }
        $retry = KF_REFRESH;
        if (in_array($status, [403,429,503], true) && isset($headers['retry-after'])) {
            $value = $headers['retry-after'];
            $delay = preg_match('/^\d{1,10}$/D', $value) ? (int)$value : max(0, (strtotime($value) ?: time()) - time());
            $retry = max(KF_REFRESH, $delay);
        }
        throw new KfException('upstream_unavailable', 503, $retry);
    }
    throw new KfException('upstream_unavailable');
}
function kf_dir(string $dir): void {
    kf_assert(!is_link(dirname($dir)) && !is_link($dir), 'cache_unavailable');
    if (!is_dir($dir)) kf_assert(@mkdir($dir, 0700, true), 'cache_unavailable');
    kf_assert(is_dir($dir) && is_writable($dir) && ((fileperms($dir) & 0077) === 0), 'cache_unavailable');
}
function kf_read(string $path, int $limit): ?string {
    clearstatcache(true, $path);
    kf_assert(!is_link(dirname($path)) && !is_link($path), 'cache_unavailable');
    if (!is_file($path)) return null;
    $n = filesize($path); kf_assert(is_int($n) && $n <= $limit, 'cache_unavailable');
    $raw = @file_get_contents($path, false, null, 0, $limit + 1); kf_assert(is_string($raw) && strlen($raw) <= $limit, 'cache_unavailable'); return $raw;
}
function kf_write(string $path, string $raw): void {
    kf_assert(!is_link(dirname($path)) && !is_link($path), 'cache_unavailable');
    $tmp = tempnam(dirname($path), '.stage-'); kf_assert(is_string($tmp), 'cache_unavailable');
    try {
        kf_assert(@chmod($tmp, 0600), 'cache_unavailable'); $f = @fopen($tmp, 'wb'); kf_assert($f !== false, 'cache_unavailable');
        try { kf_assert(fwrite($f, $raw) === strlen($raw) && fflush($f), 'cache_unavailable'); if (function_exists('fsync')) kf_assert(fsync($f), 'cache_unavailable'); }
        finally { fclose($f); }
        kf_assert(@rename($tmp, $path), 'cache_unavailable');
    } finally { if (is_file($tmp)) @unlink($tmp); }
}
function kf_lock(string $path, bool $exclusive = true) {
    kf_assert(!is_link(dirname($path)) && !is_link($path), 'cache_unavailable'); $f = @fopen($path, 'c'); kf_assert($f !== false, 'cache_unavailable'); @chmod($path, 0600);
    if (!flock($f, ($exclusive ? LOCK_EX : LOCK_SH) | LOCK_NB)) { fclose($f); return null; } return $f;
}
function kf_unlock($lock): void { if (is_resource($lock)) { flock($lock, LOCK_UN); fclose($lock); } }
function kf_usage(string $dir): int {
    $total = 0; $count = 0;
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $f) {
        kf_assert(!$f->isLink(), 'cache_unavailable'); if (!$f->isFile()) continue;
        $total += $f->getSize(); kf_assert(++$count <= 2000 && $total <= KF_DISK_MAX, 'cache_full');
    }
    return $total;
}
function kf_control(string $dir): array {
    $raw = kf_read($dir . '/active.json', 8192); if ($raw === null) return ['current'=>null,'previous'=>null,'retired'=>[],'high_water'=>0];
    $a = kf_json($raw, 8192); kf_keys($a, ['current','previous','retired','high_water']);
    kf_assert(($a['current'] === null || kf_snapshot($a['current'])) && ($a['previous'] === null || kf_snapshot($a['previous'])) && is_array($a['retired']) && count($a['retired']) <= 8 && is_int($a['high_water']), 'cache_unavailable');
    foreach ($a['retired'] as $id=>$stamp) kf_assert(kf_snapshot($id) && is_int($stamp), 'cache_unavailable'); return $a;
}
function kf_local(string $dir, string $id, array $catalogue, int $now): array {
    kf_assert(kf_snapshot($id), 'unavailable'); $raw = kf_read($dir . '/' . $id . '/manifest.json', KF_MANIFEST_MAX); kf_assert($raw !== null, 'unavailable');
    $m = kf_manifest($raw, $catalogue, $now); kf_assert($m['snapshot_id'] === $id); return $m;
}
/** Caller holds global metadata lock. Only expired, unprotected known cache files are removed. */
function kf_cleanup(string $dir, array &$active, int $now, array $preserve = []): void {
    foreach (glob($dir . '/*', GLOB_ONLYDIR) ?: [] as $sub) {
        $id = basename($sub); kf_assert(!is_link($sub), 'cache_unavailable'); if (!kf_snapshot($id) || $id === $active['current'] || $id === $active['previous'] || in_array($id, $preserve, true)) continue;
        clearstatcache(true, $sub); $modified = filemtime($sub); kf_assert(is_int($modified), 'cache_unavailable');
        // A crash after mkdir but before manifest promotion must not strand a quota slot forever.
        // Without a manifest, allow the full source lifetime plus reader grace from directory mtime.
        $raw = kf_read($sub . '/manifest.json', KF_MANIFEST_MAX); $expires = $modified + KF_MAX_AGE;
        if ($raw !== null) { try { $expires = kf_time(kf_json($raw, KF_MANIFEST_MAX)['expires_at'] ?? null); } catch (KfException $e) { continue; } }
        $retired = $active['retired'][$id] ?? $modified;
        if ($now <= max($expires, $retired) + KF_GRACE) continue;
        $names = scandir($sub); kf_assert(is_array($names), 'cache_unavailable'); $files = [];
        foreach ($names as $name) {
            if ($name === '.' || $name === '..') continue;
            $path = $sub . '/' . $name;
            kf_assert(!is_link($path) && is_file($path), 'cache_unavailable');
            kf_assert($name === 'manifest.json' || preg_match('/^[A-Z]{2}(?:-attempt)?\.json$|^[A-Z]{2}\.lock$/D', $name) === 1 || str_starts_with($name, '.stage-'), 'cache_unavailable');
            $files[] = $path;
        }
        // Validate the whole directory before removing any of its contents.
        foreach ($files as $path) kf_assert(@unlink($path), 'cache_unavailable');
        kf_assert(@rmdir($sub), 'cache_unavailable'); unset($active['retired'][$id]);
    }
}
/** Manifest refresh is independent of lazily loaded shards and preserves last good state. */
function kf_index(string $dir, array $catalogue, callable $http, int $now): array {
    kf_dir($dir); $lock = kf_lock($dir . '/metadata.lock');
    try {
        if ($lock !== null) {
            $active = kf_control($dir); $reservation = kf_read($dir . '/refresh.json', 128); $next = 0;
            if ($reservation !== null) { $r = kf_json($reservation, 128); $next = is_int($r['next'] ?? null) ? $r['next'] : $now + KF_REFRESH; }
            if ($now >= $next) {
                kf_write($dir . '/refresh.json', json_encode(['next'=>$now + KF_REFRESH]));
                $candidates = []; $retry = KF_REFRESH;
                foreach (['a','b'] as $slot) {
                    try { $raw = $http(KF_RELEASE . 'current-' . $slot . '.json', KF_MANIFEST_MAX); $m = kf_manifest($raw, $catalogue, $now); $candidates[] = ['manifest'=>$m,'raw'=>$raw]; }
                    catch (KfException $e) { $retry = max($retry, $e->retryAfter); /* One bad pointer never removes the other. */ }
                }
                if ($retry > KF_REFRESH) kf_write($dir . '/refresh.json', json_encode(['next'=>$now + $retry]));
                usort($candidates, static fn($a,$b)=>strcmp($b['manifest']['generated_at'], $a['manifest']['generated_at']));
                if (count($candidates) === 2 && $candidates[0]['manifest']['generated_at'] === $candidates[1]['manifest']['generated_at'] && $candidates[0]['manifest'] !== $candidates[1]['manifest']) $candidates = [];
                foreach ($candidates as $candidate) {
                    $m = $candidate['manifest']; $id = $m['snapshot_id']; $generated = kf_time($m['generated_at']);
                    if ($generated < $active['high_water'] || ($generated === $active['high_water'] && $active['current'] !== $id)) continue;
                    $existing = kf_read($dir . '/' . $id . '/manifest.json', KF_MANIFEST_MAX);
                    if ($existing !== null && kf_json($existing, KF_MANIFEST_MAX) !== $m) continue;
                    if ($id !== $active['current']) {
                        kf_cleanup($dir, $active, $now, [$id]);
                        $dirs = array_filter(glob($dir . '/*', GLOB_ONLYDIR) ?: [], static fn($p)=>kf_snapshot(basename($p)));
                        kf_assert(is_dir($dir . '/' . $id) || count($dirs) < 4, 'cache_full'); kf_assert(kf_usage($dir) + KF_MANIFEST_MAX < KF_DISK_MAX, 'cache_full');
                        kf_dir($dir . '/' . $id); kf_write($dir . '/' . $id . '/manifest.json', $candidate['raw']);
                        if ($active['current'] !== null) $active['retired'][$active['current']] = $now;
                        $active['previous'] = $active['current']; $active['current'] = $id; $active['high_water'] = max($active['high_water'], $generated);
                        kf_write($dir . '/active.json', json_encode($active, JSON_UNESCAPED_SLASHES));
                    }
                    break;
                }
            }
        }
    } catch (KfException $e) { /* Cache/upstream failure can still serve an already accepted fresh snapshot. */ }
    finally { kf_unlock($lock); }
    $active = kf_control($dir); kf_assert(kf_snapshot($active['current']), 'unavailable'); return kf_local($dir, $active['current'], $catalogue, $now);
}
/** Snapshot must already exist locally. Each download reserves one of two global slots. */
function kf_get_state(string $dir, array $catalogue, string $id, string $state, callable $http, int $now): array {
    kf_assert(kf_snapshot($id) && in_array($state, KF_STATES, true), 'invalid_query', 400); kf_dir($dir);
    $meta = kf_lock($dir . '/metadata.lock', false); kf_assert($meta !== null, 'busy');
    try {
        $active = kf_control($dir); kf_assert($id === $active['current'] || $id === $active['previous'] || isset($active['retired'][$id]), 'unavailable');
        $m = kf_local($dir, $id, $catalogue, $now); $path = $dir . '/' . $id . '/' . $state . '.json';
        $raw = kf_read($path, KF_JSON_MAX);
        if ($raw !== null) { kf_state($raw, $m, $state); return [$raw, $m['states'][$state]['json_sha256'], $m['expires_at']]; }
        $shard = kf_lock($dir . '/' . $id . '/' . $state . '.lock'); kf_assert($shard !== null, 'busy');
        $slot = null;
        try {
        $attempt = $dir . '/' . $id . '/' . $state . '-attempt.json';
        $prior = kf_read($attempt, 128);
        if ($prior !== null) { $r = kf_json($prior, 128); kf_assert(is_int($r['next'] ?? null) && $now >= $r['next'], 'backoff'); }
        for ($i = 0; $i < 2; $i++) { $slot = kf_lock($dir . '/download-' . $i . '.lock'); if ($slot !== null) break; }
        kf_assert($slot !== null, 'busy');
        try {
            // Reserve enough for both concurrent maximum-size writers plus metadata.
            kf_assert(kf_usage($dir) + 2 * KF_JSON_MAX + KF_MANIFEST_MAX <= KF_DISK_MAX, 'cache_full');
            kf_write($attempt, json_encode(['next'=>$now + KF_REFRESH]));
            try { $compressed = $http(KF_RELEASE . $m['states'][$state]['asset'], KF_GZIP_MAX); }
            catch (KfException $e) { if ($e->retryAfter > KF_REFRESH) kf_write($attempt, json_encode(['next'=>$now + $e->retryAfter])); throw $e; }
            $raw = kf_unpack($compressed, $m, $state); kf_write($path, $raw);
            return [$raw, $m['states'][$state]['json_sha256'], $m['expires_at']];
        } finally { kf_unlock($slot); }
        } finally { kf_unlock($shard); }
    } finally { kf_unlock($meta); }
}
