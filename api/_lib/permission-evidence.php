<?php
// Locally reviewed, exact-place evidence. This module never fetches source URLs.
declare(strict_types=1);
function kp_coordinates($c): bool {
    return is_array($c) && array_is_list($c) && count($c) === 2 &&
        (is_int($c[0]) || is_float($c[0])) && (is_int($c[1]) || is_float($c[1])) &&
        is_finite((float)$c[0]) && is_finite((float)$c[1]) && abs($c[0]) <= 180 && abs($c[1]) <= 90;
}
function kp_coordinate5(float $value): string {
    $n = ($value < 0 ? -1 : 1) * floor(abs($value) * 100000 + 0.5) / 100000;
    return number_format($n == 0 ? 0 : $n, 5, '.', '');
}
function kp_spot_id(array $coordinates): string { return 'spot:' . kp_coordinate5((float)$coordinates[1]) . ',' . kp_coordinate5((float)$coordinates[0]); }
function kp_place_key(array $place): string { return $place['kind'] === 'spot' ? $place['id'] : $place['kind'] . ':' . $place['id']; }
function kp_data_dir(): string { return dirname(__DIR__) . '/_data/permissions'; }
function kp_read_local(string $file, int $max): ?array {
    if (!is_file($file) || filesize($file) > $max) return null;
    $raw = @file_get_contents($file, false, null, 0, $max + 1);
    if (!is_string($raw) || strlen($raw) > $max) return null;
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}
/** Canonical coordinates, kinds and IDs come from published catalogues, never proximity or name. */
function kp_resolve_place(array $input, ?string $directory = null): ?array {
    if (!in_array($input['kind'] ?? '', ['campsite','service','spot'], true) ||
        !is_string($input['id'] ?? null) || strlen($input['id']) < 1 || strlen($input['id']) > 160 || preg_match('/[\x00-\x20\x7f]/', $input['id']) ||
        !is_string($input['name'] ?? null) || strlen($input['name']) > 240 || !kp_coordinates($input['coordinates'] ?? null)) return null;
    if ($input['kind'] === 'spot') {
        if ($input['id'] !== kp_spot_id($input['coordinates'])) return null;
        return ['kind'=>'spot','id'=>$input['id'],'name'=>trim($input['name']),
            'coordinates'=>[(float)kp_coordinate5((float)$input['coordinates'][0]),(float)kp_coordinate5((float)$input['coordinates'][1])]];
    }
    $key = kp_place_key($input);
    $data = kp_read_local(($directory ?? kp_data_dir()) . '/' . substr(hash('sha256', $key), 0, 2) . '.json', 2000000);
    $known = $data['places'][$key] ?? null;
    if (($data['version'] ?? null) !== 1 || !is_array($known) || ($known['kind'] ?? null) !== $input['kind'] || ($known['id'] ?? null) !== $input['id'] || !kp_coordinates($known['coordinates'] ?? null)) return null;
    foreach ([0,1] as $i) if ((float)$known['coordinates'][$i] !== (float)$input['coordinates'][$i]) return null;
    return $known;
}
function kp_utc($value): ?int {
    if (!is_string($value) || !preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/D', $value)) return null;
    $date = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s\Z', $value, new DateTimeZone('UTC'));
    return $date && $date->format('Y-m-d\TH:i:s\Z') === $value ? $date->getTimestamp() : null;
}
function kp_day($value): bool {
    if ($value === null) return true;
    if (!is_string($value) || !preg_match('/^\d{4}-\d\d-\d\d$/D', $value)) return false;
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, new DateTimeZone('UTC'));
    return $date && $date->format('Y-m-d') === $value;
}
function kp_valid_evidence(array $r): bool {
    if (!is_string($r['id'] ?? null) || !preg_match('/^[a-z0-9][a-z0-9-]{0,119}$/D', $r['id']) ||
        !is_array($r['place'] ?? null) || !in_array($r['place']['kind'] ?? '', ['campsite','service','spot'], true) ||
        !is_string($r['place']['id'] ?? null) || !kp_coordinates($r['place']['coordinates'] ?? null) ||
        !in_array($r['activity'] ?? '', ['overnight_occupancy','unoccupied_vehicle_parking'], true) ||
        !in_array($r['statement'] ?? '', ['allowed','conditional','prohibited'], true) ||
        !is_string($r['issuer'] ?? null) || $r['issuer'] === '' || !is_string($r['source_url'] ?? null) ||
        !preg_match('~^https://www\.blm\.gov/visit/[a-z0-9-]+$~D', $r['source_url']) ||
        !is_string($r['quote'] ?? null) || $r['quote'] === '' || !is_string($r['sha256'] ?? null) ||
        !hash_equals(hash('sha256', $r['quote']), $r['sha256']) || !is_array($r['conditions'] ?? null) ||
        !is_array($r['supersedes'] ?? null) || !array_key_exists('effective_from', $r) || !array_key_exists('effective_until', $r) ||
        !kp_day($r['effective_from']) || !kp_day($r['effective_until'])) return false;
    foreach ($r['conditions'] as $c) if (!is_string($c)) return false;
    foreach ($r['supersedes'] as $id) if (!is_string($id) || $id === $r['id']) return false;
    $retrieved = kp_utc($r['retrieved_at'] ?? null); $reviewed = kp_utc($r['reviewed_at'] ?? null); $after = kp_utc($r['review_after'] ?? null);
    return $retrieved !== null && $reviewed !== null && $after !== null && $retrieved <= $reviewed && $reviewed < $after &&
        (!$r['effective_from'] || !$r['effective_until'] || $r['effective_from'] <= $r['effective_until']);
}
/** Reports never enter this reducer. Supersession is permanent, even after the replacing notice becomes stale. */
function kp_reduce_evidence(array $records, array $place, ?int $now = null, string $activity = 'overnight_occupancy'): array {
    $now = $now ?? time(); $day = gmdate('Y-m-d', $now); $matched = []; $superseded = [];
    $ids = [];
    foreach ($records as $record) {
        if (!is_array($record) || !kp_valid_evidence($record) || isset($ids[$record['id']])) return kp_reduce_evidence([], $place, $now, $activity);
        $ids[$record['id']] = true;
    }
    foreach ($records as $r) {
        if (!is_array($r) || !kp_valid_evidence($r) || $r['activity'] !== $activity || kp_place_key($r['place']) !== kp_place_key($place)) continue;
        if ((float)$r['place']['coordinates'][0] !== (float)$place['coordinates'][0] || (float)$r['place']['coordinates'][1] !== (float)$place['coordinates'][1]) continue;
        $matched[] = $r;
        // Future-not-yet-effective notices cannot suppress today's rule; once effective the tombstone persists.
        if (kp_utc($r['reviewed_at']) <= $now && (!$r['effective_from'] || $r['effective_from'] <= $day)) foreach ($r['supersedes'] as $id) $superseded[$id] = true;
    }
    $current = []; $historical = false;
    foreach ($matched as &$r) {
        if (isset($superseded[$r['id']])) $r['freshness'] = 'superseded';
        elseif (kp_utc($r['reviewed_at']) > $now || ($r['effective_from'] && $r['effective_from'] > $day)) $r['freshness'] = 'future';
        elseif ($r['effective_until'] && $r['effective_until'] < $day) $r['freshness'] = 'expired';
        elseif (kp_utc($r['review_after']) <= $now) $r['freshness'] = 'stale';
        else { $r['freshness'] = 'current'; $current[] = $r['statement']; }
        if (in_array($r['freshness'], ['superseded','expired','stale'], true)) $historical = true;
    }
    unset($r);
    $types = array_values(array_unique($current));
    if (!$types) $status = $historical ? 'historical' : 'unknown';
    elseif (in_array('prohibited', $types, true) && count($types) > 1) $status = 'conflict';
    elseif (in_array('prohibited', $types, true)) $status = 'prohibited';
    elseif (in_array('conditional', $types, true)) $status = 'conditional';
    else $status = 'allowed';
    $summaries = [
        'unknown'=>'No current official permission evidence is recorded for this exact place and activity.',
        'historical'=>'Only historical or overdue official evidence is available. Current permission is unknown; check with the responsible authority.',
        'conflict'=>'Current official sources disagree. Permission is unresolved; check with the responsible authority.',
        'prohibited'=>'Current official evidence prohibits this activity at this exact place. Review the notice and its dates.',
        'conditional'=>'Official evidence supports this activity only under the listed conditions. Check current notices and site availability.',
        'allowed'=>'Current official evidence allows this activity within the stated scope. Check current notices before relying on it.'
    ];
    return ['status'=>$status,'activity'=>$activity,'evidence'=>$matched,'summary'=>$summaries[$status],'as_of'=>gmdate('Y-m-d\TH:i:s\Z', $now)];
}
function kp_official(array $validatedPlace, ?int $now = null, string $activity = 'overnight_occupancy'): array {
    $data = kp_read_local(kp_data_dir() . '/official.json', 2000000);
    return kp_reduce_evidence(($data['version'] ?? null) === 1 && is_array($data['records'] ?? null) ? $data['records'] : [], $validatedPlace, $now, $activity);
}
