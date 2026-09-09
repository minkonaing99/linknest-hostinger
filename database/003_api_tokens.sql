-- Scoped long-lived API tokens for external integrations (iOS, browser extension, scripts).
-- Raw token shown once on creation; only SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS api_tokens (
  id           VARCHAR(36)  NOT NULL,
  user_id      VARCHAR(36)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  token_hash   VARCHAR(64)  NOT NULL,
  scope        VARCHAR(10)  NOT NULL DEFAULT 'write',
  created_at   DATETIME(3)  NOT NULL,
  last_used_at DATETIME(3)  NULL,
  expires_at   DATETIME(3)  NULL,
  revoked_at   DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_tokens_hash (token_hash),
  INDEX idx_api_tokens_user (user_id),
  INDEX idx_api_tokens_revoked (revoked_at),
  CONSTRAINT fk_api_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
