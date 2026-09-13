-- Run manually in Hostinger phpMyAdmin before deploying application changes.

ALTER TABLE `links`
  ADD COLUMN `notes` TEXT NOT NULL DEFAULT ('') AFTER `remind_at`;

ALTER TABLE `links`
  ADD COLUMN `first_meaningful_at` DATETIME(3) DEFAULT NULL AFTER `notes`;

ALTER TABLE `links`
  ADD COLUMN `first_useful_at` DATETIME(3) DEFAULT NULL AFTER `first_meaningful_at`,
  ADD INDEX `idx_links_first_useful_at` (`first_useful_at`);

ALTER TABLE `links`
  ADD COLUMN `last_useful_reviewed_at` DATETIME(3) DEFAULT NULL AFTER `first_useful_at`;

CREATE TABLE IF NOT EXISTS `link_relationships` (
  `link_id_a` VARCHAR(36) NOT NULL,
  `link_id_b` VARCHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`link_id_a`, `link_id_b`),
  CONSTRAINT `chk_link_relationship_order` CHECK (`link_id_a` < `link_id_b`),
  CONSTRAINT `fk_link_relationship_a` FOREIGN KEY (`link_id_a`) REFERENCES `links` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_link_relationship_b` FOREIGN KEY (`link_id_b`) REFERENCES `links` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
