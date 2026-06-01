-- Link Nest API tokens
-- MariaDB 11.8 / Hostinger — run via phpMyAdmin on u580993728_linknest
-- Required before deploying the scoped API tokens feature.

CREATE TABLE IF NOT EXISTS `api_tokens` (
  `id`           VARCHAR(36)   PRIMARY KEY,
  `user_id`      VARCHAR(36)   NOT NULL,
  `name`         VARCHAR(100)  NOT NULL,
  `token_hash`   VARCHAR(64)   NOT NULL,
  `scope`        VARCHAR(20)   NOT NULL DEFAULT 'write',
  `created_at`   DATETIME(3)   NOT NULL,
  `last_used_at` DATETIME(3)   DEFAULT NULL,
  `expires_at`   DATETIME(3)   DEFAULT NULL,
  `revoked_at`   DATETIME(3)   DEFAULT NULL,
  UNIQUE KEY `uniq_token_hash` (`token_hash`),
  INDEX `idx_api_tokens_user_id`  (`user_id`),
  INDEX `idx_api_tokens_revoked`  (`revoked_at`),
  CONSTRAINT `fk_api_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
