<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';

const KE_FIRE = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query';
const KE_ALERTS = 'https://api.weather.gov/alerts/active';
const KE_SMOKE = 'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/NOAA_Satellite_Smoke_Detection_(v1)/FeatureServer/0/query';
const KE_ZONE_BASE = 'https://api.weather.gov/zones/';
const KE_FIREWX_EVENTS = ['Red Flag Warning', 'Fire Weather Watch'];
const KE_FIREWX_MAX_BYTES = 8388608;
const KE_ZONE_PATTERN = '/^(fire|forecast|county)\/[A-Z]{2}[CZ]\d{3}$/D';
const KE_DEFAULT_RETRY_SECONDS = 60;
const KE_NWS_KINDS = ['alerts', 'firewx', 'zone'];
const KE_MAX_BYTES = 4194304;
const KE_MAX_FEATURES = 500;
const KE_MAX_COORDINATES = 60000;
const KE_CACHE_SLOTS = 32;

final class KeException extends RuntimeException {
    public string $reason;
    public int $status;
    /** Seconds the client must wait before asking again, when the upstream said so. */
    public ?int $retryAfter;
    public function __construct(string $reason, int $status = 502, ?int $retryAfter = null) {
        parent::__construct($reason); $this->reason = $reason; $this->status = $status; $this->retryAfter = $retryAfter;
    }
}

/** Parse before any cache or upstream access. Inputs never select a host or URL. */
function ke_query(array $input): array {
    $kind = $input['kind'] ?? null;
    if (!is_string($kind) || !in_array($kind, ['fire', 'smoke', 'alerts', 'firewx', 'zone'], true)) throw new KeException('invalid_query', 400);
    $allowed = $kind === 'alerts' ? ['kind', 'lat', 'lng'] : ($kind === 'firewx' ? ['kind'] : ($kind === 'zone' ? ['kind', 'zone'] : ['kind', 'bbox']));
    if (array_diff(array_keys($input), $allowed)) throw new KeException('invalid_query', 400);
    // Fire-weather alerts are one fixed national query. A zone is a fixed NWS path, never a caller URL.
    if ($kind === 'firewx') return ['kind' => $kind];
    if ($kind === 'zone') {
        if (!is_string($input['zone'] ?? null) || !preg_match(KE_ZONE_PATTERN, $input['zone'])) throw new KeException('invalid_query', 400);
        return ['kind' => $kind, 'zone' => $input['zone']];
    }
    if ($kind === 'alerts') {
        $lat = ke_number($input['lat'] ?? null); $lng = ke_number($input['lng'] ?? null);
        if (abs($lat) > 90 || abs($lng) > 180) throw new KeException('invalid_query', 400);
        return ['kind' => $kind, 'lat' => round($lat, 5), 'lng' => round($lng, 5)];
    }
    if (!is_string($input['bbox'] ?? null)) throw new KeException('invalid_query', 400);
    $parts = explode(',', $input['bbox']);
    if (count($parts) !== 4) throw new KeException('invalid_query', 400);
    [$w, $s, $e, $n] = array_map('ke_number', $parts);
    if (abs($w) > 180 || abs($e) > 180 || abs($s) > 90 || abs($n) > 90 || $w >= $e || $s >= $n) throw new KeException('invalid_query', 400);
    if ($e - $w > 10 || $n - $s > 10) throw new KeException('zoom_in', 422);
    return ['kind' => $kind, 'bbox' => [$w, $s, $e, $n]];
}

function ke_number($value): float {
    if (!is_string($value) || strlen($value) > 24 || !preg_match('/^-?(?:\d+(?:\.\d*)?|\.\d+)$/D', $value)) throw new KeException('invalid_query', 400);
    $n = (float)$value;
    if (!is_finite($n)) throw new KeException('invalid_query', 400);
    return $n;
}

/** Reads the caching and rate-limit headers NWS sends. Retry-After (seconds or HTTP date) and Expires are kept exactly. */
function ke_note_header(string $line, int $now): void {
    if (preg_match('/^cache-control:.*\bmax-age=(\d{1,9})/i', $line, $m)) $GLOBALS['ke_upstream_meta']['max_age'] = (int)$m[1];
    if (preg_match('/^retry-after:\s*(.+?)\s*$/i', $line, $m)) {
        $until = preg_match('/^\d{1,9}$/', $m[1]) ? $now + (int)$m[1] : strtotime($m[1]);
        if ($until !== false && $until > 0) $GLOBALS['ke_upstream_meta']['retry_until'] = $until;
    }
    if (preg_match('/^expires:\s*(.+?)\s*$/i', $line, $m) && ($when = strtotime($m[1])) !== false) $GLOBALS['ke_upstream_meta']['expires'] = $when;
}

/** Upstream freshness lifetime in seconds: Cache-Control max-age, else the Expires header, else unknown. */
function ke_freshness_seconds(array $meta, int $now): ?int {
    if (is_int($meta['max_age'] ?? null)) return max(0, $meta['max_age']);
    if (is_int($meta['expires'] ?? null)) return max(0, $meta['expires'] - $now);
    return null;
}

const KE_RETIRED_FILE = 'firewx-retired.json';
const KE_RETIRED_UNKNOWN_SECONDS = 604800;

/** Retirement history kept across proxy cache refreshes. Each id stays until the later of its alert's expires and ends. */
function ke_merge_retired(string $directory, array $value, int $now): array {
    $path = $directory . '/' . KE_RETIRED_FILE;
    if (is_link($path)) return $value;
    $known = [];
    $stored = is_file($path) && filesize($path) <= 200000 ? json_decode((string)@file_get_contents($path), true) : null;
    foreach (is_array($stored) ? $stored : [] as $id => $until) if (is_string($id) && is_int($until) && $until > $now) $known[$id] = $until;   // prune expired
    $until = [];
    foreach ($value['data']['features'] ?? [] as $f) {
        $p = $f['properties'] ?? [];
        $times = array_filter([isset($p['expires']) ? strtotime((string)$p['expires']) : false, isset($p['ends']) ? strtotime((string)$p['ends']) : false]);
        if (is_string($p['id'] ?? null) && $times) $until[$p['id']] = max($times);
    }
    foreach ($value['data']['retired'] ?? [] as $id) {
        if (!is_string($id)) continue;
        $end = $until[$id] ?? ($known[$id] ?? $now + KE_RETIRED_UNKNOWN_SECONDS);
        if ($end > $now) $known[$id] = max($known[$id] ?? 0, $end);
    }
    $known = array_slice($known, -KE_MAX_FEATURES * 4, null, true);
    if (@file_put_contents($path, json_encode($known)) !== false) @chmod($path, 0600);
    // The server filters against the full retained history (up to 2,000 ids) before the client list is capped, so a
    // retired alert is never returned as active even when its id is beyond the ids the client receives.
    // A retired id that falls off a full history (oldest pruned first) is no longer remembered; see docs.
    if (isset($value['data']['features']) && is_array($value['data']['features'])) {
        $value['data']['features'] = array_values(array_filter($value['data']['features'], static fn($f): bool => !isset($known[$f['properties']['id'] ?? ''])));
    }
    $value['data']['retired'] = array_slice(array_keys($known), -KE_MAX_FEATURES);   // newest 500 go to the client
    return $value;
}

/** Transport has no URL override, follows no redirects, and caps bytes before decoding. */
function ke_http(string $base, array $query): array {
    $zone = str_starts_with($base, KE_ZONE_BASE) && preg_match(KE_ZONE_PATTERN, substr($base, strlen(KE_ZONE_BASE)));
    if ((!$zone && !in_array($base, [KE_FIRE, KE_ALERTS, KE_SMOKE], true)) || !function_exists('curl_init')) throw new KeException('upstream_unavailable');
    $url = $query ? $base . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986) : $base;
    $limit = $zone || ($base === KE_ALERTS && isset($query['event'])) ? KE_FIREWX_MAX_BYTES : KE_MAX_BYTES;
    $body = ''; $oversized = false; $GLOBALS['ke_upstream_meta'] = ['max_age' => null, 'retry_until' => null, 'expires' => null];
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 12,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => 'KampTrail/1.0 (https://kamptrail.com; public environment context)',
        CURLOPT_HTTPHEADER => ['Accept: application/geo+json, application/json'],
        // Honor the upstream caching and rate-limit headers (NWS sends Cache-Control and Retry-After).
        CURLOPT_HEADERFUNCTION => static function ($handle, string $line): int { ke_note_header($line, time()); return strlen($line); },
        CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body, &$oversized, $limit): int {
            if (strlen($body) + strlen($chunk) > $limit) { $oversized = true; return 0; }
            $body .= $chunk; return strlen($chunk);
        }]);
    $ok = curl_exec($ch); $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if ($oversized) throw new KeException('zoom_in', 422);
    $meta = &$GLOBALS['ke_upstream_meta'];
    // Cache-Control max-age wins. Without it, the Expires header sets the freshness deadline.
    $meta['max_age'] = ke_freshness_seconds($meta, time());
    if ($status === 429 || ($status === 503 && $meta['retry_until'] !== null)) {
        $until = $meta['retry_until'] ?? time() + KE_DEFAULT_RETRY_SECONDS;
        throw new KeException('rate_limited', 503, max(1, $until - time()));
    }
    unset($meta);
    if ($ok === false || $status !== 200) throw new KeException('upstream_unavailable');
    $data = json_decode($body, true, 32);
    if (!is_array($data) || isset($data['error'])) throw new KeException('upstream_unavailable');
    return $data;
}

function ke_text($value, int $max = 300): ?string {
    if (!is_string($value) && !is_int($value) && !is_float($value)) return null;
    $text = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', (string)$value);
    if ($text === null) return null;
    // Avoid a dependency on mbstring while preserving valid UTF-8 at the byte cap.
    $text = substr($text, 0, $max);
    while ($text !== '' && !preg_match('//u', $text)) $text = substr($text, 0, -1);
    return $text;
}

function ke_date($value): ?string {
    if (is_int($value) || is_float($value)) {
        if (!is_finite((float)$value) || $value < 0 || $value > 4102444800000) return null;
        return gmdate('c', (int)floor($value / 1000));
    }
    if (!is_string($value) || strlen($value) > 64 || !preg_match('/^\d{4}-\d{2}-\d{2}[T ]/', $value)) return null;
    $time = strtotime($value); return $time === false ? null : gmdate('c', $time);
}

/** HMS publishes YYYYDDD HHmm UTC (day of year is one-based). */
function ke_smoke_date($value): ?string {
    if (!is_string($value) || !preg_match('/^(\d{4})(\d{3}) (\d{2})(\d{2})$/D', $value, $m)) return null;
    $year = (int)$m[1]; $day = (int)$m[2]; $hour = (int)$m[3]; $minute = (int)$m[4];
    if ($year < 2000 || $year > 2100 || $day < 1 || $day > (date('L', gmmktime(0, 0, 0, 1, 1, $year)) === '1' ? 366 : 365) || $hour > 23 || $minute > 59) return null;
    return gmdate('c', gmmktime($hour, $minute, 0, 1, $day, $year));
}

function ke_smoke_properties(array $feature): array {
    $p = $feature['properties'];
    $start = ke_smoke_date($p['Start'] ?? null); $end = ke_smoke_date($p['End_'] ?? null);
    $density = is_string($p['Density'] ?? null) ? strtolower($p['Density']) : '';
    if ($start === null || $end === null || strtotime($end) < strtotime($start) || !in_array($density, ['light', 'medium', 'heavy'], true)) throw new KeException('upstream_unavailable');
    return ['id' => ke_text($p['FID'] ?? $feature['id'] ?? null), 'name' => 'Satellite smoke', 'source_updated_at' => $end, 'density' => $density, 'start' => $start, 'end' => $end];
}

function ke_smoke_fetch(array $query, callable $http, int $now): array {
    $latest = $http(KE_SMOKE, ['where' => '1=1', 'f' => 'json', 'outFields' => 'Start', 'returnGeometry' => 'false', 'orderByFields' => 'Start DESC', 'resultRecordCount' => 1]);
    $stamp = $latest['features'][0]['attributes']['Start'] ?? null;
    $date = ke_smoke_date($stamp);
    // Missing observations are unavailable, never interpreted as clear skies.
    if ($date === null || strtotime($date) > $now + 3600 || $now - strtotime($date) > 48 * 3600) throw new KeException('upstream_unavailable');
    $parameters = ['where' => "Start LIKE '" . substr($stamp, 0, 7) . " %'", 'geometry' => implode(',', $query['bbox']), 'geometryType' => 'esriGeometryEnvelope', 'inSR' => '4326', 'spatialRel' => 'esriSpatialRelIntersects'];
    $count = $http(KE_SMOKE, $parameters + ['f' => 'json', 'returnCountOnly' => 'true']);
    if (!isset($count['count']) || !is_int($count['count']) || $count['count'] < 0) throw new KeException('upstream_unavailable');
    if ($count['count'] > KE_MAX_FEATURES) throw new KeException('zoom_in', 422);
    $raw = $http(KE_SMOKE, $parameters + ['f' => 'geojson', 'outSR' => '4326', 'outFields' => 'FID,Start,End_,Density', 'returnGeometry' => 'true', 'maxAllowableOffset' => 0.001, 'resultRecordCount' => KE_MAX_FEATURES + 1]);
    if (!is_array($raw['features'] ?? null) || count($raw['features']) !== $count['count']) throw new KeException('upstream_unavailable');
    return [$raw, ['name' => 'NOAA HMS satellite smoke', 'url' => 'https://www.ospo.noaa.gov/products/land/hms.html', 'observation_date' => substr($date, 0, 10)]];
}

/** Round to ~10 m and thin very dense rings (zone borders) so overlay payloads stay small. Rings stay closed. */
function ke_simplify_geometry(array $geometry, int $maxRingPoints = 1500): array {
    $polygons = ($geometry['type'] ?? '') === 'Polygon' ? [$geometry['coordinates'] ?? []] : ($geometry['coordinates'] ?? []);
    foreach ($polygons as $i => $polygon) {
        if (!is_array($polygon)) continue;
        foreach ($polygon as $j => $ring) {
            if (!is_array($ring)) continue;
            $points = [];
            foreach ($ring as $point) {
                if (!is_array($point) || !isset($point[0], $point[1]) || !is_numeric($point[0]) || !is_numeric($point[1])) { $points[] = $point; continue; }
                $rounded = [round((float)$point[0], 4), round((float)$point[1], 4)];
                if (!$points || $points[count($points) - 1] !== $rounded) $points[] = $rounded;
            }
            if (count($points) > $maxRingPoints) {
                $step = (int)ceil(count($points) / $maxRingPoints); $thin = [];
                foreach ($points as $k => $point) if ($k % $step === 0) $thin[] = $point;
                $thin[] = $points[0];
                $points = $thin;
            }
            $polygons[$i][$j] = $points;
        }
    }
    return ['type' => $geometry['type'], 'coordinates' => ($geometry['type'] ?? '') === 'Polygon' ? $polygons[0] : $polygons];
}

/** Only polygon geometries can enter a viewport overlay; null is valid for NWS zones. */
function ke_geometry($geometry, bool $allowNull, int &$coordinateCount): ?array {
    if ($geometry === null && $allowNull) return null;
    if (!is_array($geometry) || !in_array($geometry['type'] ?? '', ['Polygon', 'MultiPolygon'], true) || !is_array($geometry['coordinates'] ?? null)) throw new KeException('upstream_unavailable');
    $polygons = $geometry['type'] === 'Polygon' ? [$geometry['coordinates']] : $geometry['coordinates'];
    if (!$polygons || count($polygons) > 1000) throw new KeException('upstream_unavailable');
    $clean = [];
    foreach ($polygons as $polygon) {
        if (!is_array($polygon) || !$polygon || count($polygon) > 1000) throw new KeException('upstream_unavailable');
        $rings = [];
        foreach ($polygon as $ring) {
            if (!is_array($ring) || count($ring) < 4) throw new KeException('upstream_unavailable');
            $points = [];
            foreach ($ring as $point) {
                if (++$coordinateCount > KE_MAX_COORDINATES) throw new KeException('zoom_in', 422);
                if (!is_array($point) || !isset($point[0], $point[1]) || (!is_int($point[0]) && !is_float($point[0])) || (!is_int($point[1]) && !is_float($point[1])) || !is_finite((float)$point[0]) || !is_finite((float)$point[1]) || abs($point[0]) > 180 || abs($point[1]) > 90) throw new KeException('upstream_unavailable');
                $points[] = [(float)$point[0], (float)$point[1]];
            }
            if ($points[0] !== $points[count($points) - 1]) throw new KeException('upstream_unavailable');
            $rings[] = $points;
        }
        $clean[] = $rings;
    }
    return ['type' => $geometry['type'], 'coordinates' => $geometry['type'] === 'Polygon' ? $clean[0] : $clean];
}

/** Zone paths such as "fire/COZ214" from NWS affectedZones URLs. Anything else is dropped. */
function ke_zone_paths($zones): array {
    $paths = [];
    foreach (is_array($zones) ? $zones : [] as $url) {
        if (is_string($url) && str_starts_with($url, KE_ZONE_BASE) && preg_match(KE_ZONE_PATTERN, substr($url, strlen(KE_ZONE_BASE))) && !in_array(substr($url, strlen(KE_ZONE_BASE)), $paths, true)) $paths[] = substr($url, strlen(KE_ZONE_BASE));
    }
    return $paths;
}

/** Alert ids a fire-weather message says it replaces or cancels, read before any expiry filtering. */
function ke_firewx_references($feature): array {
    $p = is_array($feature) ? ($feature['properties'] ?? null) : null;
    if (!is_array($p) || ($p['status'] ?? '') !== 'Actual' || !in_array($p['messageType'] ?? '', ['Alert', 'Update', 'Cancel'], true) || !in_array($p['event'] ?? '', KE_FIREWX_EVENTS, true)) return [];
    $ids = [];
    foreach (is_array($p['references'] ?? null) ? array_slice($p['references'], 0, 20) : [] as $ref) if (is_array($ref) && is_string($ref['identifier'] ?? null) && $ref['identifier'] !== '') $ids[] = ke_text($ref['identifier'], 500);
    return $ids;
}

/** Red Flag Warnings and Fire Weather Watches only. Cancel messages are kept so the client can retire the alerts they reference. */
function ke_firewx_properties(array $p, int $now): ?array {
    if (($p['status'] ?? '') !== 'Actual' || !in_array($p['messageType'] ?? '', ['Alert', 'Update', 'Cancel'], true)) return null;
    if (!in_array($p['event'] ?? '', KE_FIREWX_EVENTS, true)) return null;
    $expires = ke_date($p['expires'] ?? null); $ends = ke_date($p['ends'] ?? null);
    if ($expires === null && $ends === null) throw new KeException('upstream_unavailable');
    $cancel = $p['messageType'] === 'Cancel';
    if (!$cancel && (($expires !== null && strtotime($expires) <= $now) || ($ends !== null && strtotime($ends) <= $now))) return null;
    $references = [];
    foreach (is_array($p['references'] ?? null) ? array_slice($p['references'], 0, 20) : [] as $ref) {
        $id = is_array($ref) && is_string($ref['identifier'] ?? null) ? ke_text($ref['identifier'], 500) : null;
        if ($id !== null && $id !== '') $references[] = $id;
    }
    $zones = ke_zone_paths($p['affectedZones'] ?? []);
    $props = ['id' => ke_text($p['id'] ?? null, 500), 'name' => ke_text($p['event'], 100), 'source_updated_at' => ke_date($p['sent'] ?? null)];
    foreach (['event', 'headline', 'areaDesc', 'severity', 'messageType', 'status'] as $key) $props[$key] = ke_text($p[$key] ?? null, 2000);
    foreach (['sent', 'effective', 'onset', 'expires', 'ends'] as $key) $props[$key] = ke_date($p[$key] ?? null);
    $props['references'] = $references; $props['zone_count'] = count($zones); $props['zones'] = array_slice($zones, 0, 60);
    return $props;
}

/** Reject incomplete datasets instead of returning a reassuring partial/empty result. */
function ke_normalize(string $kind, array $data, int $now): array {
    if (($data['type'] ?? '') !== 'FeatureCollection' || !is_array($data['features'] ?? null)) throw new KeException('upstream_unavailable');
    $features = $data['features'];
    if (count($features) > KE_MAX_FEATURES || !empty($data['exceededTransferLimit']) || !empty($data['properties']['exceededTransferLimit']) || !empty($data['pagination']['next'])) throw new KeException('zoom_in', 422);
    foreach (['numberMatched', 'totalFeatures'] as $total) if (isset($data[$total]) && is_numeric($data[$total]) && (int)$data[$total] > count($features)) throw new KeException('zoom_in', 422);
    $out = []; $coordinateCount = 0; $retired = [];
    foreach ($features as $feature) {
        if ($kind === 'firewx') foreach (ke_firewx_references($feature) as $id) $retired[] = $id;
        if (!is_array($feature) || ($feature['type'] ?? '') !== 'Feature' || !is_array($feature['properties'] ?? null)) throw new KeException('upstream_unavailable');
        $p = $feature['properties'];
        if ($kind === 'alerts') {
            if (($p['status'] ?? '') !== 'Actual' || !in_array($p['messageType'] ?? '', ['Alert', 'Update'], true)) continue;
            $expires = ke_date($p['expires'] ?? null); $ends = ke_date($p['ends'] ?? null);
            if ($expires === null) throw new KeException('upstream_unavailable');
            if (strtotime($expires) <= $now || ($ends !== null && strtotime($ends) <= $now)) continue;
            if (!is_string($p['event'] ?? null) || $p['event'] === '' || !is_string($p['headline'] ?? null) || $p['headline'] === '') throw new KeException('upstream_unavailable');
            $props = ['id' => ke_text($feature['id'] ?? $p['id'] ?? null, 500), 'name' => ke_text($p['event'] ?? null), 'source_updated_at' => ke_date($p['sent'] ?? null)];
            foreach (['event', 'headline', 'description', 'instruction', 'severity', 'areaDesc', 'response', 'status', 'messageType'] as $key) $props[$key] = ke_text($p[$key] ?? null, in_array($key, ['description', 'instruction'], true) ? 16000 : 2000);
            foreach (['sent', 'effective', 'onset', 'expires', 'ends'] as $key) $props[$key] = ke_date($p[$key] ?? null);
        } elseif ($kind === 'firewx') {
            $props = ke_firewx_properties($p, $now);
            if ($props === null) continue;
        } elseif ($kind === 'zone') {
            $props = ['id' => ke_text($p['id'] ?? null, 12), 'name' => ke_text($p['name'] ?? null, 200), 'state' => ke_text($p['state'] ?? null, 2)];
        } elseif ($kind === 'fire') {
            $acres = $p['poly_GISAcres'] ?? null;
            $props = ['id' => ke_text($p['poly_IRWINID'] ?? $feature['id'] ?? $p['OBJECTID'] ?? null),
                'name' => ke_text($p['poly_IncidentName'] ?? $p['attr_IncidentName'] ?? null),
                'source_updated_at' => ke_date($p['poly_PolygonDateTime'] ?? $p['poly_DateCurrent'] ?? null),
                'acres' => is_numeric($acres) && is_finite((float)$acres) && $acres >= 0 ? (float)$acres : null,
                'type' => ke_text($p['attr_IncidentTypeCategory'] ?? null, 20)];
        } else {
            $props = ke_smoke_properties($feature);
        }
        $geometry = $feature['geometry'] ?? null;
        if (in_array($kind, ['firewx', 'zone'], true) && is_array($geometry) && in_array($geometry['type'] ?? '', ['Polygon', 'MultiPolygon'], true)) $geometry = ke_simplify_geometry($geometry);
        $out[] = ['type' => 'Feature', 'geometry' => ke_geometry($geometry, $kind === 'alerts' || $kind === 'firewx', $coordinateCount), 'properties' => $props];
    }
    $result = ['type' => 'FeatureCollection', 'features' => $out];
    // Ids named by any Update or Cancel, including messages dropped for being expired. The client keeps them retired.
    if ($kind === 'firewx') $result['retired'] = array_slice(array_values(array_unique($retired)), 0, KE_MAX_FEATURES);
    return $result;
}

function ke_fetch(array $query, callable $http, int $now): array {
    $kind = $query['kind'];
    if ($kind === 'fire') {
        $parameters = ['where' => '1=1', 'geometry' => implode(',', $query['bbox']), 'geometryType' => 'esriGeometryEnvelope', 'inSR' => '4326', 'spatialRel' => 'esriSpatialRelIntersects'];
        $count = $http(KE_FIRE, $parameters + ['f' => 'json', 'returnCountOnly' => 'true']);
        if (!isset($count['count']) || !is_int($count['count']) || $count['count'] < 0) throw new KeException('upstream_unavailable');
        if ($count['count'] > KE_MAX_FEATURES) throw new KeException('zoom_in', 422);
        // Generalize map context to ~110 m latitude; full intersecting shapes can otherwise exceed the byte cap even in a small viewport.
        $raw = $http(KE_FIRE, $parameters + ['f' => 'geojson', 'outSR' => '4326', 'outFields' => 'OBJECTID,poly_IncidentName,poly_GISAcres,poly_DateCurrent,poly_PolygonDateTime,poly_IRWINID,attr_IncidentName,attr_IncidentTypeCategory', 'returnGeometry' => 'true', 'maxAllowableOffset' => 0.001, 'resultRecordCount' => KE_MAX_FEATURES + 1]);
        if (!is_array($raw['features'] ?? null) || count($raw['features']) !== $count['count']) throw new KeException('upstream_unavailable');
        $source = ['name' => 'NIFC WFIGS current fire perimeters', 'url' => 'https://data-nifc.opendata.arcgis.com/'];
    } elseif ($kind === 'alerts') {
        // /alerts/active rejects a limit parameter; response byte/feature caps still apply locally.
        $raw = $http(KE_ALERTS, ['point' => $query['lat'] . ',' . $query['lng'], 'status' => 'actual']);
        $source = ['name' => 'National Weather Service active alerts', 'url' => 'https://www.weather.gov/alerts'];
    } elseif ($kind === 'firewx') {
        $raw = $http(KE_ALERTS, ['event' => implode(',', KE_FIREWX_EVENTS), 'status' => 'actual']);
        $source = ['name' => 'National Weather Service active alerts', 'url' => 'https://www.weather.gov/fire/'];
    } elseif ($kind === 'zone') {
        $feature = $http(KE_ZONE_BASE . $query['zone'], []);
        if (($feature['type'] ?? '') !== 'Feature' || ($feature['properties']['id'] ?? '') !== substr($query['zone'], strpos($query['zone'], '/') + 1)) throw new KeException('upstream_unavailable');
        $feature['geometry'] ??= null;
        if ($feature['geometry'] === null) throw new KeException('upstream_unavailable');
        $raw = ['type' => 'FeatureCollection', 'features' => [$feature]];
        $source = ['name' => 'National Weather Service zone', 'url' => 'https://www.weather.gov/'];
    } else {
        [$raw, $source] = ke_smoke_fetch($query, $http, $now);
    }
    return ['ok' => true, 'version' => 1, 'kind' => $kind, 'retrieved_at' => gmdate('c', $now), 'source' => $source, 'partial' => false, 'data' => ke_normalize($kind, $raw, $now)];
}

/** Server cache lifetime. Never shorter than the app floor, never longer than a cap, and it follows upstream max-age inside that range. */
function ke_ttl(string $kind, ?int $maxAge): int {
    if ($kind === 'smoke') return 900;
    if ($kind === 'zone') return min(86400, max(3600, $maxAge ?? 0));
    if ($kind === 'firewx') return min(600, max(300, $maxAge ?? 0));
    return 300;
}

/** Fixed hash slots bound data AND lock files. No user-controlled path/config/database. */
function ke_cached(array $query, string $directory, callable $fetch, int $now): array {
    if (is_link($directory) || (!is_dir($directory) && !@mkdir($directory, 0700, true)) || !is_writable($directory)) throw new KeException('cache_unavailable', 503);
    $lockPath = $directory . '/cache.lock';
    if (is_link($lockPath)) throw new KeException('cache_unavailable', 503);
    $lock = @fopen($lockPath, 'c+');
    if (!$lock) throw new KeException('cache_unavailable', 503);
    @chmod($lockPath, 0600);
    if (!flock($lock, LOCK_EX | LOCK_NB)) { fclose($lock); throw new KeException('busy', 503); }
    try {
        $key = hash('sha256', json_encode($query));
        $path = $directory . '/' . (hexdec(substr($key, 0, 6)) % KE_CACHE_SLOTS) . '.json';
        if (is_link($path)) throw new KeException('cache_unavailable', 503);
        $cached = is_file($path) && filesize($path) <= 2100000 ? json_decode((string)@file_get_contents($path), true) : null;
        $ttl = ke_ttl($query['kind'], is_int($cached['max_age'] ?? null) ? $cached['max_age'] : null);
        if (is_array($cached) && ($cached['key'] ?? '') === $key && is_int($cached['at'] ?? null) && $cached['at'] <= $now && (isset($cached['error']) ? $now < ($cached['retry_until'] ?? $cached['at'] + 30) : $now - $cached['at'] < $ttl)) {
            if (isset($cached['error'])) throw new KeException($cached['error'], $cached['status'], isset($cached['retry_until']) ? max(1, $cached['retry_until'] - $now) : null);
            if (is_array($cached['value'] ?? null)) {
                $value = $cached['value'];
                // An alert can expire during its five-minute cache lifetime.
                // A message that expires or is dropped here may have replaced or cancelled another alert. What it
                // retired stays retired, so the older alert can never become active again after its replacement is gone.
                if ($query['kind'] === 'firewx') {
                    $retired = is_array($value['data']['retired'] ?? null) ? $value['data']['retired'] : [];
                    $value['data']['features'] = array_values(array_filter($value['data']['features'] ?? [], static function (array $f) use ($now, &$retired): bool {
                        $p = $f['properties'];
                        if (($p['messageType'] ?? '') === 'Cancel') return true;
                        $live = ($p['expires'] === null || strtotime($p['expires']) > $now) && ($p['ends'] === null || strtotime($p['ends']) > $now);
                        if (!$live) foreach (is_array($p['references'] ?? null) ? $p['references'] : [] as $id) $retired[] = $id;
                        return $live;
                    }));
                    $value['data']['retired'] = array_slice(array_values(array_unique($retired)), 0, KE_MAX_FEATURES);
                    $value = ke_merge_retired($directory, $value, $now);
                }
                // The polling limit decides when NWS is asked again. The upstream deadline decides when the copy is labelled stale.
                if (isset($value['fresh_until'])) $value['stale'] = $now > strtotime($value['fresh_until']);
                if ($query['kind'] === 'alerts') $value['data']['features'] = array_values(array_filter($value['data']['features'] ?? [], static function (array $f) use ($now): bool {
                    $p = $f['properties'];
                    return strtotime($p['expires']) > $now && ($p['ends'] === null || strtotime($p['ends']) > $now);
                }));
                return $value;
            }
        }
        // A rate-limit answer from NWS blocks every NWS request until its Retry-After time, whatever the key.
        $blockPath = $directory . '/nws-retry-until';
        if (in_array($query['kind'], KE_NWS_KINDS, true) && !is_link($blockPath) && is_file($blockPath)) {
            $until = (int)@file_get_contents($blockPath);
            if ($until > $now) throw new KeException('rate_limited', 503, $until - $now);
        }
        // A global reservation also limits repeated unique cache misses and failures.
        rewind($lock); $last = (int)stream_get_contents($lock);
        if ($now - $last < 2) throw new KeException('busy', 503);
        rewind($lock); ftruncate($lock, 0); fwrite($lock, (string)$now); fflush($lock);
        try {
            $GLOBALS['ke_upstream_meta'] = ['max_age' => null, 'retry_until' => null, 'expires' => null];
            $value = $fetch($query, $now);
            if (in_array($query['kind'], ['firewx', 'zone'], true)) {
                if ($query['kind'] === 'firewx') $value = ke_merge_retired($directory, $value, $now);
                $age = ke_freshness_seconds($GLOBALS['ke_upstream_meta'], $now);
                $value['fresh_until'] = gmdate('c', $now + ($age ?? ke_ttl($query['kind'], null)));
                $value['stale'] = false;
            }
            $entry = ['key' => $key, 'at' => $now, 'value' => $value, 'max_age' => $GLOBALS['ke_upstream_meta']['max_age'] ?? null];
        } catch (KeException $e) {
            $entry = ['key' => $key, 'at' => $now, 'error' => $e->reason, 'status' => $e->status];
            if ($e->reason === 'rate_limited') {
                $entry['retry_until'] = $now + ($e->retryAfter ?? KE_DEFAULT_RETRY_SECONDS);
                if (in_array($query['kind'], KE_NWS_KINDS, true) && !is_link($blockPath)) {
                    $previous = is_file($blockPath) ? (int)@file_get_contents($blockPath) : 0;
                    @file_put_contents($blockPath, (string)max($previous, $entry['retry_until'])); @chmod($blockPath, 0600);
                }
            }
            $value = null;
        }
        $encoded = json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($encoded === false) throw new KeException('upstream_unavailable');
        if (strlen($encoded) > 2097152) throw new KeException('zoom_in', 422);
        if (@file_put_contents($path, $encoded) === false) throw new KeException('cache_unavailable', 503);
        @chmod($path, 0600);
        if ($value === null) throw new KeException($entry['error'], $entry['status'], isset($entry['retry_until']) ? max(1, $entry['retry_until'] - $now) : null);
        return $value;
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}
