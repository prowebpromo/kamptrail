<?php
// Visitor-reported posted clearances. Submitted through api/submit.php, moderated in api/admin.php,
// published by api/clearance-reports.php only when a moderator sets the report to "applied".
declare(strict_types=1);
const KCR_VERSION = '006_clearance_reports';
const KCR_DIRECTIONS = ['both', 'one_direction', 'unsure'];
function kcr_ready(PDO $pdo): bool { return in_array(KCR_VERSION, kt_applied_migrations($pdo), true); }
/** Same syntax as clearances.js and scripts/clearance_parse.py. Returns hundredths of an inch, floored for metric input, or null. */
function kcr_hundredths(string $raw): ?int {
    if (preg_match('/^(\d+)(?:\.(\d{1,6}))?(?: m)?$/D', $raw, $m)) {
        if (strlen($m[1]) > 6) return null;
        $micro = (int)$m[1] * 1000000 + (int)str_pad($m[2] ?? '', 6, '0');
        return $micro > 0 && $micro <= 100000000 ? intdiv($micro, 254) : null;
    }
    if (preg_match('/^(\d{1,4})\'(?:(\d{1,2})")?$/D', $raw, $m) && (!isset($m[2]) || $m[2] === '' || (int)$m[2] < 12)) {
        $inches = (int)$m[1] * 12 + (int)($m[2] ?? 0);
        return $inches > 0 && $inches * 0.0254 <= 100 ? $inches * 100 : null;
    }
    return null;
}
/** @return array{posted:string,hundredths:int,observed_on:string,direction:string,osm_ref:?string}|array{error:string} */
function kcr_validate($in): array {
    if (!is_array($in)) return ['error' => 'Enter the posted clearance.'];
    $posted = is_string($in['posted'] ?? null) ? trim($in['posted']) : '';
    $hundredths = strlen($posted) <= 40 ? kcr_hundredths($posted) : null;
    if ($hundredths === null) return ['error' => 'Enter the posted height as 13\'6" or 4.1 m.'];
    $date = is_string($in['observed_on'] ?? null) ? $in['observed_on'] : '';
    $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
    if (!$parsed || $parsed->format('Y-m-d') !== $date || $date > gmdate('Y-m-d') || $date < '2000-01-01') return ['error' => 'Enter the date you saw the sign, today or earlier.'];
    $direction = $in['direction'] ?? 'unsure';
    if (!in_array($direction, KCR_DIRECTIONS, true)) return ['error' => 'Choose a listed direction.'];
    $ref = $in['osm_ref'] ?? null;
    if ($ref !== null && (!is_string($ref) || !preg_match('/^osm:(?:node|way):[1-9][0-9]{0,15}$/D', $ref))) return ['error' => 'Invalid OpenStreetMap reference.'];
    return ['posted' => $posted, 'hundredths' => $hundredths, 'observed_on' => $date, 'direction' => $direction, 'osm_ref' => $ref];
}
function kcr_read(PDO $pdo, int $id): ?array {
    if (!kcr_ready($pdo)) return null;
    $q = $pdo->prepare('SELECT posted, hundredths, observed_on, direction, osm_ref FROM clearance_reports WHERE submission_id = ?');
    $q->execute([$id]);
    return $q->fetch() ?: null;
}
