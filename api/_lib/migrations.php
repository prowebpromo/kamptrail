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
];
