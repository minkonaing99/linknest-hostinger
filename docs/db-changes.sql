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
