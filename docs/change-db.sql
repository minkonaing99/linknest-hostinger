-- Run manually in Hostinger phpMyAdmin before deploying application changes.

ALTER TABLE `links`
  ADD COLUMN `notes` TEXT NOT NULL DEFAULT ('') AFTER `remind_at`;

ALTER TABLE `links`
  ADD COLUMN `first_meaningful_at` DATETIME(3) DEFAULT NULL AFTER `notes`;
