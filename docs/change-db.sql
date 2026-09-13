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
