<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';

const KE_FIRE = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query';
const KE_ALERTS = 'https://api.weather.gov/alerts/active';
const KE_SMOKE = 'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/NOAA_Satellite_Smoke_Detection_(v1)/FeatureServer/0/query';
const KE_MAX_BYTES = 4194304;
const KE_MAX_FEATURES = 500;
const KE_MAX_COORDINATES = 60000;
const KE_CACHE_SLOTS = 32;

final class KeException extends RuntimeException {
    public string $reason;
    public int $status;
    public function __construct(string $reason, int $status = 502) {
        parent::__construct($reason); $this->reason = $reason; $this->status = $status;
    }
}

/** Parse before any cache or upstream access. Inputs never select a host or URL. */
function ke_query(array $input): array {
    $kind = $input['kind'] ?? null;
    if (!is_string($kind) || !in_array($kind, ['fire', 'smoke', 'alerts'], true)) throw new KeException('invalid_query', 400);
    $allowed = $kind === 'alerts' ? ['kind', 'lat', 'lng'] : ['kind', 'bbox'];
    if (array_diff(array_keys($input), $allowed)) throw new KeException('invalid_query', 400);
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

/** Transport has no URL override, follows no redirects, and caps bytes before decoding. */
function ke_http(string $base, array $query): array {
    if (!in_array($base, [KE_FIRE, KE_ALERTS, KE_SMOKE], true) || !function_exists('curl_init')) throw new KeException('upstream_unavailable');
    $url = $base . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    $body = ''; $oversized = false;
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 12,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => 'KampTrail/1.0 (https://kamptrail.com; public environment context)',
        CURLOPT_HTTPHEADER => ['Accept: application/geo+json, application/json'],
        CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body, &$oversized): int {
            if (strlen($body) + strlen($chunk) > KE_MAX_BYTES) { $oversized = true; return 0; }
            $body .= $chunk; return strlen($chunk);
        }]);
    $ok = curl_exec($ch); $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if ($oversized) throw new KeException('zoom_in', 422);
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

/** Reject incomplete datasets instead of returning a reassuring partial/empty result. */
function ke_normalize(string $kind, array $data, int $now): array {
    if (($data['type'] ?? '') !== 'FeatureCollection' || !is_array($data['features'] ?? null)) throw new KeException('upstream_unavailable');
    $features = $data['features'];
    if (count($features) > KE_MAX_FEATURES || !empty($data['exceededTransferLimit']) || !empty($data['properties']['exceededTransferLimit']) || !empty($data['pagination']['next'])) throw new KeException('zoom_in', 422);
    foreach (['numberMatched', 'totalFeatures'] as $total) if (isset($data[$total]) && is_numeric($data[$total]) && (int)$data[$total] > count($features)) throw new KeException('zoom_in', 422);
    $out = []; $coordinateCount = 0;
    foreach ($features as $feature) {
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
        $out[] = ['type' => 'Feature', 'geometry' => ke_geometry($feature['geometry'] ?? null, $kind === 'alerts', $coordinateCount), 'properties' => $props];
    }
    return ['type' => 'FeatureCollection', 'features' => $out];
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
        $raw = $http(KE_ALERTS, ['point' => $query['lat'] . ',' . $query['lng'], 'status' => 'actual', 'limit' => KE_MAX_FEATURES]);
        $source = ['name' => 'National Weather Service active alerts', 'url' => 'https://www.weather.gov/alerts'];
    } else {
        [$raw, $source] = ke_smoke_fetch($query, $http, $now);
    }
    return ['ok' => true, 'version' => 1, 'kind' => $kind, 'retrieved_at' => gmdate('c', $now), 'source' => $source, 'partial' => false, 'data' => ke_normalize($kind, $raw, $now)];
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
        $ttl = $query['kind'] === 'smoke' ? 900 : 300;
        if (is_array($cached) && ($cached['key'] ?? '') === $key && is_int($cached['at'] ?? null) && $cached['at'] <= $now && $now - $cached['at'] < (isset($cached['error']) ? 30 : $ttl)) {
            if (isset($cached['error'])) throw new KeException($cached['error'], $cached['status']);
            if (is_array($cached['value'] ?? null)) {
                $value = $cached['value'];
                // An alert can expire during its five-minute cache lifetime.
                if ($query['kind'] === 'alerts') $value['data']['features'] = array_values(array_filter($value['data']['features'] ?? [], static function (array $f) use ($now): bool {
                    $p = $f['properties'];
                    return strtotime($p['expires']) > $now && ($p['ends'] === null || strtotime($p['ends']) > $now);
                }));
                return $value;
            }
        }
        // A global reservation also limits repeated unique cache misses and failures.
        rewind($lock); $last = (int)stream_get_contents($lock);
        if ($now - $last < 2) throw new KeException('busy', 503);
        rewind($lock); ftruncate($lock, 0); fwrite($lock, (string)$now); fflush($lock);
        try {
            $value = $fetch($query, $now);
            $entry = ['key' => $key, 'at' => $now, 'value' => $value];
        } catch (KeException $e) {
            $entry = ['key' => $key, 'at' => $now, 'error' => $e->reason, 'status' => $e->status];
            $value = null;
        }
        $encoded = json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($encoded === false) throw new KeException('upstream_unavailable');
        if (strlen($encoded) > 2097152) throw new KeException('zoom_in', 422);
        if (@file_put_contents($path, $encoded) === false) throw new KeException('cache_unavailable', 503);
        @chmod($path, 0600);
        if ($value === null) throw new KeException($entry['error'], $entry['status']);
        return $value;
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}
