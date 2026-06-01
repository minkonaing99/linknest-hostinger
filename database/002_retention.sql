-- Link Nest retention fields
-- MariaDB 11.8 / Hostinger — run via phpMyAdmin on u580993728_linknest
-- Safe to run on a live table: ADD COLUMN with defaults does not lock rows.

ALTER TABLE `links`
  ADD COLUMN `last_opened_at` datetime(3) DEFAULT NULL AFTER `deleted_at`,
  ADD COLUMN `opened_count`   int(11)     NOT NULL DEFAULT 0 AFTER `last_opened_at`,
  ADD COLUMN `remind_at`      datetime(3) DEFAULT NULL AFTER `opened_count`;

CREATE INDEX `idx_links_last_opened_at` ON `links` (`last_opened_at`);
CREATE INDEX `idx_links_remind_at`      ON `links` (`remind_at`);
