-- Complete Link Nest MySQL schema.
-- Schema only: no users, passwords, sessions, tokens, or saved links.

CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(36)   PRIMARY KEY,
  username      VARCHAR(100)  UNIQUE NOT NULL,
  password_hash TEXT          NOT NULL,
  created_at    DATETIME(3)   NOT NULL,
  updated_at    DATETIME(3)   NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS links (
  id                  VARCHAR(36)  PRIMARY KEY,
  url                 TEXT         NOT NULL,
  title               VARCHAR(300) NOT NULL DEFAULT '',
  host                VARCHAR(255) NOT NULL DEFAULT '',
  status              VARCHAR(20)  NOT NULL DEFAULT 'saved',
  tags                JSON         NOT NULL,
  pinned              TINYINT(1)   NOT NULL DEFAULT 0,
  date                VARCHAR(10)  NOT NULL DEFAULT '',
  created_at          DATETIME(3)  NOT NULL,
  updated_at          DATETIME(3)  NOT NULL,
  deleted_at          DATETIME(3)  DEFAULT NULL,
  last_opened_at      DATETIME(3)  DEFAULT NULL,
  opened_count        INT          NOT NULL DEFAULT 0,
  remind_at           DATETIME(3)  DEFAULT NULL,
  notes               TEXT         NOT NULL DEFAULT (''),
  first_meaningful_at DATETIME(3)  DEFAULT NULL,
  UNIQUE KEY uniq_url (url(768)),
  INDEX idx_links_updated_at (updated_at),
  INDEX idx_links_created_at (created_at),
  INDEX idx_links_status (status),
  INDEX idx_links_date (date),
  INDEX idx_links_pinned (pinned),
  INDEX idx_links_deleted_at (deleted_at),
  INDEX idx_links_last_opened_at (last_opened_at),
  INDEX idx_links_remind_at (remind_at)
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
  revoked_at DATETIME(3)  DEFAULT NULL,
  INDEX idx_rt_expires_at (expires_at),
  INDEX idx_rt_user_revoked (user_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_tokens (
  id           VARCHAR(36)  PRIMARY KEY,
  user_id      VARCHAR(36)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  token_hash   VARCHAR(64)  NOT NULL,
  scope        VARCHAR(10)  NOT NULL DEFAULT 'write',
  created_at   DATETIME(3)  NOT NULL,
  last_used_at DATETIME(3)  DEFAULT NULL,
  expires_at   DATETIME(3)  DEFAULT NULL,
  revoked_at   DATETIME(3)  DEFAULT NULL,
  UNIQUE KEY uq_api_tokens_hash (token_hash),
  INDEX idx_api_tokens_user (user_id),
  INDEX idx_api_tokens_revoked (revoked_at),
  CONSTRAINT fk_api_tokens_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
