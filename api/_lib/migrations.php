<?php
// Ordered schema migrations. Each version lists MySQL and SQLite statements (SQLite is used in automated tests).
declare(strict_types=1);

return [
    '001_contributions' => [
        'mysql' => [
            "CREATE TABLE submissions (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                public_token CHAR(32) NOT NULL UNIQUE,
                kind VARCHAR(20) NOT NULL,
                campsite_id VARCHAR(200) NULL,
                campsite_name VARCHAR(200) NULL,
                lat DECIMAL(9,6) NULL,
                lng DECIMAL(9,6) NULL,
                problems VARCHAR(500) NULL,
                details TEXT NOT NULL,
                source_note VARCHAR(500) NULL,
                contact_email VARCHAR(200) NULL,
                client_hash CHAR(64) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'received',
                public_note VARCHAR(1000) NULL,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                INDEX idx_status_created (status, created_at),
                INDEX idx_client_created (client_hash, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            "CREATE TABLE moderation_log (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                submission_id BIGINT UNSIGNED NOT NULL,
                action VARCHAR(20) NOT NULL,
                from_status VARCHAR(20) NOT NULL,
                to_status VARCHAR(20) NOT NULL,
                note VARCHAR(1000) NULL,
                moderator VARCHAR(100) NOT NULL,
                created_at DATETIME NOT NULL,
                INDEX idx_submission (submission_id),
                CONSTRAINT fk_log_submission FOREIGN KEY (submission_id) REFERENCES submissions(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        ],
        'sqlite' => [
            "CREATE TABLE submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                public_token TEXT NOT NULL UNIQUE,
                kind TEXT NOT NULL,
                campsite_id TEXT NULL,
                campsite_name TEXT NULL,
                lat REAL NULL,
                lng REAL NULL,
                problems TEXT NULL,
                details TEXT NOT NULL,
                source_note TEXT NULL,
                contact_email TEXT NULL,
                client_hash TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'received',
                public_note TEXT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            "CREATE INDEX idx_status_created ON submissions (status, created_at)",
            "CREATE INDEX idx_client_created ON submissions (client_hash, created_at)",
            "CREATE TABLE moderation_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                submission_id INTEGER NOT NULL REFERENCES submissions(id),
                action TEXT NOT NULL,
                from_status TEXT NOT NULL,
                to_status TEXT NOT NULL,
                note TEXT NULL,
                moderator TEXT NOT NULL,
                created_at TEXT NOT NULL
            )",
            "CREATE INDEX idx_submission ON moderation_log (submission_id)",
        ],
    ],
    '002_community' => [
        'mysql' => [
            "CREATE TABLE community_reviews (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, owner_hash VARCHAR(200) NOT NULL UNIQUE, campsite_id VARCHAR(200) NOT NULL, campsite_name VARCHAR(200) NOT NULL, display_name VARCHAR(200) NOT NULL, rating INTEGER NOT NULL, body TEXT NOT NULL, visited_on VARCHAR(200) NOT NULL, rig VARCHAR(200) NOT NULL, status VARCHAR(200) NOT NULL DEFAULT 'pending', public_note TEXT NULL, created_at VARCHAR(200) NOT NULL, updated_at VARCHAR(200) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            "CREATE INDEX idx_community_campsite ON community_reviews (campsite_id, status, id)",
            "CREATE INDEX idx_community_queue ON community_reviews (status, id)",
            "CREATE TABLE community_photos (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, review_id BIGINT UNSIGNED NOT NULL, image_data MEDIUMBLOB NULL, byte_size INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, status VARCHAR(200) NOT NULL DEFAULT 'pending', created_at VARCHAR(200) NOT NULL, FOREIGN KEY (review_id) REFERENCES community_reviews(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            "CREATE INDEX idx_community_photo ON community_photos (review_id, status)",
            "CREATE TABLE community_reports (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, review_id BIGINT UNSIGNED NOT NULL, photo_id BIGINT UNSIGNED NULL, reason TEXT NOT NULL, status VARCHAR(200) NOT NULL DEFAULT 'open', created_at VARCHAR(200) NOT NULL, FOREIGN KEY (review_id) REFERENCES community_reviews(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            "CREATE INDEX idx_community_reports ON community_reports (status, id)",
            "CREATE TABLE community_events (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, client_hash VARCHAR(200) NOT NULL, kind VARCHAR(200) NOT NULL, created_at VARCHAR(200) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            "CREATE INDEX idx_community_rate ON community_events (client_hash, kind, created_at)",
            "CREATE TABLE community_audit (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, review_id BIGINT UNSIGNED NOT NULL, action VARCHAR(200) NOT NULL, from_status VARCHAR(200) NOT NULL, to_status VARCHAR(200) NOT NULL, actor VARCHAR(200) NOT NULL, created_at VARCHAR(200) NOT NULL, FOREIGN KEY (review_id) REFERENCES community_reviews(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            "CREATE INDEX idx_community_audit ON community_audit (review_id, id)",
            "CREATE TABLE community_storage (id INTEGER PRIMARY KEY, used_bytes BIGINT UNSIGNED NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            "INSERT INTO community_storage (id,used_bytes) VALUES (1,0)",
        ],
        'sqlite' => [
            "CREATE TABLE community_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_hash TEXT NOT NULL UNIQUE, campsite_id TEXT NOT NULL, campsite_name TEXT NOT NULL, display_name TEXT NOT NULL, rating INTEGER NOT NULL, body TEXT NOT NULL, visited_on TEXT NOT NULL, rig TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', public_note TEXT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
            "CREATE INDEX idx_community_campsite ON community_reviews (campsite_id, status, id)",
            "CREATE INDEX idx_community_queue ON community_reviews (status, id)",
            "CREATE TABLE community_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, review_id INTEGER NOT NULL, image_data BLOB NULL, byte_size INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, FOREIGN KEY (review_id) REFERENCES community_reviews(id))",
            "CREATE INDEX idx_community_photo ON community_photos (review_id, status)",
            "CREATE TABLE community_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, review_id INTEGER NOT NULL, photo_id INTEGER NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, FOREIGN KEY (review_id) REFERENCES community_reviews(id))",
            "CREATE INDEX idx_community_reports ON community_reports (status, id)",
            "CREATE TABLE community_events (id INTEGER PRIMARY KEY AUTOINCREMENT, client_hash TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL)",
            "CREATE INDEX idx_community_rate ON community_events (client_hash, kind, created_at)",
            "CREATE TABLE community_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, review_id INTEGER NOT NULL, action TEXT NOT NULL, from_status TEXT NOT NULL, to_status TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (review_id) REFERENCES community_reviews(id))",
            "CREATE INDEX idx_community_audit ON community_audit (review_id, id)",
            "CREATE TABLE community_storage (id INTEGER PRIMARY KEY, used_bytes INTEGER NOT NULL)",
            "INSERT INTO community_storage (id,used_bytes) VALUES (1,0)",
        ],
    ],
    '003_routing' => [
        'mysql' => [
            "CREATE TABLE routing_state (id INTEGER PRIMARY KEY, last_started_ms BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            "INSERT INTO routing_state (id,last_started_ms) VALUES (1,0)",
            "CREATE TABLE routing_events (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, client_hash CHAR(64) NOT NULL, created_at DATETIME NOT NULL, INDEX idx_routing_client (client_hash,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        ],
        'sqlite' => [
            "CREATE TABLE routing_state (id INTEGER PRIMARY KEY, last_started_ms INTEGER NOT NULL)",
            "INSERT INTO routing_state (id,last_started_ms) VALUES (1,0)",
            "CREATE TABLE routing_events (id INTEGER PRIMARY KEY AUTOINCREMENT, client_hash TEXT NOT NULL, created_at TEXT NOT NULL)",
            "CREATE INDEX idx_routing_client ON routing_events (client_hash,created_at)",
        ],
    ],
    '004_observations' => [
        'mysql' => [
            "CREATE TABLE IF NOT EXISTS community_observations (review_id BIGINT UNSIGNED PRIMARY KEY, details TEXT NOT NULL, FOREIGN KEY (review_id) REFERENCES community_reviews(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            "CREATE TABLE IF NOT EXISTS community_discovery_state (id INTEGER PRIMARY KEY, revision BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            "INSERT INTO community_discovery_state (id,revision) SELECT 1,1 WHERE NOT EXISTS (SELECT 1 FROM community_discovery_state WHERE id=1)",
        ],
        'sqlite' => [
            "CREATE TABLE IF NOT EXISTS community_observations (review_id INTEGER PRIMARY KEY, details TEXT NOT NULL, FOREIGN KEY (review_id) REFERENCES community_reviews(id))",
            "CREATE TABLE IF NOT EXISTS community_discovery_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL)",
            "INSERT INTO community_discovery_state (id,revision) SELECT 1,1 WHERE NOT EXISTS (SELECT 1 FROM community_discovery_state WHERE id=1)",
        ],
    ],
];
