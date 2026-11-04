<?php
// Additive, rerunnable DDL: no review, rating, fee or official-evidence records change.
declare(strict_types=1);
$versions = [];
foreach (['mysql', 'sqlite'] as $driver) {
    $mysql = $driver === 'mysql';
    $id = $mysql ? 'BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $ref = $mysql ? 'BIGINT UNSIGNED' : 'INTEGER';
    $text = $mysql ? 'VARCHAR(255)' : 'TEXT';
    $hash = $mysql ? 'BINARY(32)' : 'BLOB';
    $suffix = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
    $versions[$driver] = [
        "CREATE TABLE IF NOT EXISTS permission_reports (id $id, owner_hash $hash NULL UNIQUE, place_key $text NOT NULL, place_kind VARCHAR(16) NOT NULL, place_id $text NOT NULL, place_name $text NOT NULL, lng DOUBLE NULL, lat DOUBLE NULL, activity VARCHAR(40) NOT NULL, observation VARCHAR(40) NOT NULL, visited_on VARCHAR(10) NOT NULL, firsthand INTEGER NOT NULL, display_name VARCHAR(60) NOT NULL, body TEXT NOT NULL, authority_role VARCHAR(120) NOT NULL, authority_office VARCHAR(120) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'pending', version INTEGER NOT NULL DEFAULT 1, public_note TEXT NOT NULL, created_at VARCHAR(20) NOT NULL, updated_at VARCHAR(20) NOT NULL" . ($mysql ? ', INDEX idx_permission_place (place_key,status,id), INDEX idx_permission_queue (status,id)' : '') . ")$suffix",
        "CREATE TABLE IF NOT EXISTS permission_flags (id $id, report_id $ref NOT NULL, reason TEXT NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'open', version INTEGER NOT NULL DEFAULT 1, created_at VARCHAR(20) NOT NULL, FOREIGN KEY (report_id) REFERENCES permission_reports(id))$suffix",
        "CREATE TABLE IF NOT EXISTS permission_audit (id $id, report_id $ref NOT NULL, action VARCHAR(32) NOT NULL, from_status VARCHAR(16) NOT NULL, to_status VARCHAR(16) NOT NULL, report_version INTEGER NOT NULL, actor VARCHAR(16) NOT NULL, created_at VARCHAR(20) NOT NULL, FOREIGN KEY (report_id) REFERENCES permission_reports(id))$suffix",
        "CREATE TABLE IF NOT EXISTS permission_events (id $id, client_hash CHAR(64) NOT NULL, kind VARCHAR(32) NOT NULL, created_at VARCHAR(20) NOT NULL" . ($mysql ? ', INDEX idx_permission_rate (client_hash,kind,created_at)' : '') . ")$suffix",
        "CREATE TABLE IF NOT EXISTS permission_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL)$suffix",
        'INSERT INTO permission_state (id,revision) SELECT 1,1 WHERE NOT EXISTS (SELECT 1 FROM permission_state WHERE id=1)',
    ];
    if (!$mysql) $versions[$driver] = array_merge($versions[$driver], [
        'CREATE INDEX IF NOT EXISTS idx_permission_place ON permission_reports (place_key,status,id)',
        'CREATE INDEX IF NOT EXISTS idx_permission_queue ON permission_reports (status,id)',
        'CREATE INDEX IF NOT EXISTS idx_permission_rate ON permission_events (client_hash,kind,created_at)',
    ]);
}
return $versions;
