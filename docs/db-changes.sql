ALTER TABLE `links`
  ADD COLUMN `save_reason` VARCHAR(500) NOT NULL DEFAULT '' AFTER `notes`;

ALTER TABLE `links`
  ADD COLUMN `reading_position` JSON DEFAULT NULL AFTER `save_reason`;
