-- Link Nest — initial MySQL schema
-- Run this in Hostinger hPanel > Databases > phpMyAdmin before first deploy.

CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(36)   PRIMARY KEY,
  username      VARCHAR(100)  UNIQUE NOT NULL,
  password_hash TEXT          NOT NULL,
  created_at    DATETIME(3)   NOT NULL,
  updated_at    DATETIME(3)   NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS links (
  id         VARCHAR(36)  PRIMARY KEY,
  url        TEXT         NOT NULL,
  title      TEXT         NOT NULL DEFAULT '',
  host       VARCHAR(255) NOT NULL DEFAULT '',
  status     VARCHAR(20)  NOT NULL DEFAULT 'saved',
  tags       JSON         NOT NULL,
  pinned     TINYINT(1)   NOT NULL DEFAULT 0,
  date       VARCHAR(10)  NOT NULL DEFAULT '',
  created_at DATETIME(3)  NOT NULL,
  updated_at DATETIME(3)  NOT NULL,
  deleted_at DATETIME(3),
  UNIQUE KEY uniq_url (url(768)),
  INDEX idx_links_updated_at  (updated_at),
  INDEX idx_links_created_at  (created_at),
  INDEX idx_links_status      (status),
  INDEX idx_links_date        (date),
  INDEX idx_links_pinned      (pinned),
  INDEX idx_links_deleted_at  (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token      VARCHAR(64)  PRIMARY KEY,
  user_id    VARCHAR(36)  NOT NULL,
  username   VARCHAR(100) NOT NULL,
  created_at DATETIME(3)  NOT NULL,
  expires_at DATETIME(3)  NOT NULL,
  INDEX idx_sessions_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token      VARCHAR(64)  PRIMARY KEY,
  user_id    VARCHAR(36)  NOT NULL,
  username   VARCHAR(100) NOT NULL,
  created_at DATETIME(3)  NOT NULL,
  expires_at DATETIME(3)  NOT NULL,
  revoked_at DATETIME(3),
  INDEX idx_rt_expires_at (expires_at),
  INDEX idx_rt_user_revoked (user_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
