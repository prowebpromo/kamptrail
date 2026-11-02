<?php
// Only explicitly shared, coarse app diagnostics. Never URLs, locations or stored trips.
declare(strict_types=1);
function kfb_diagnostics(array $in): string {
    if (($in['include_diagnostics'] ?? false) !== true || !is_array($in['diagnostics'] ?? null)) return '';
    $d = $in['diagnostics']; $out = [];
    if (is_string($d['version'] ?? null) && preg_match('/^\d{1,3}\.\d{1,3}\.\d{1,3}$/D', $d['version'])) $out['version'] = $d['version'];
    foreach (['language' => ['en','es','fr'], 'browser' => ['Firefox','Edge','Chrome','Safari','Other'], 'connection' => ['online','offline']] as $key => $allowed) {
        if (in_array($d[$key] ?? null, $allowed, true)) $out[$key] = $d[$key];
    }
    foreach (['width','height'] as $key) {
        if (is_int($d[$key] ?? null) && $d[$key] >= 1 && $d[$key] <= 20000) $out[$key] = $d[$key];
    }
    return $out ? json_encode($out, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) : '';
}
