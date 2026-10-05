ALTER TABLE `links`
  ADD COLUMN `save_reason` VARCHAR(500) NOT NULL DEFAULT '' AFTER `notes`;

ALTER TABLE `links`
  ADD COLUMN `reading_position` JSON DEFAULT NULL AFTER `save_reason`;

CREATE TABLE IF NOT EXISTS `link_events` (
  `id` VARCHAR(36) PRIMARY KEY,
  `link_id` VARCHAR(36) NOT NULL,
  `actor_id` VARCHAR(36) DEFAULT NULL,
  `type` VARCHAR(32) NOT NULL,
  `occurred_at` DATETIME(3) NOT NULL,
  `metadata` JSON NOT NULL,
  INDEX `idx_link_events_timeline` (`link_id`, `occurred_at`, `id`),
  CONSTRAINT `fk_link_events_link` FOREIGN KEY (`link_id`) REFERENCES `links` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_link_events_actor` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `links`
  ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS `link_actions` (
  `id` VARCHAR(36) PRIMARY KEY,
  `actor_id` VARCHAR(36) NOT NULL,
  `request_id` VARCHAR(36) DEFAULT NULL,
  `fingerprint` CHAR(64) NOT NULL,
  `kind` VARCHAR(20) NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `undone_at` DATETIME(3) DEFAULT NULL,
  `result_json` JSON DEFAULT NULL,
  `undo_result` JSON DEFAULT NULL,
  UNIQUE KEY `uq_link_actions_request` (`actor_id`, `request_id`),
  INDEX `idx_link_actions_cleanup` (`created_at`),
  CONSTRAINT `fk_link_actions_actor` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `link_action_items` (
  `action_id` VARCHAR(36) NOT NULL,
  `link_id` VARCHAR(36) NOT NULL,
  `before_values` JSON NOT NULL,
  `after_revision` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`action_id`, `link_id`),
  CONSTRAINT `fk_link_action_items_action` FOREIGN KEY (`action_id`) REFERENCES `link_actions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
