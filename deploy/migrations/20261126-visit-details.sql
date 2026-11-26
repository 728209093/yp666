-- Additive migration. Back up Visit (schema and rows) before applying once.
-- Keep Visit_visitorId_date_key: one browser visitor per Asia/Shanghai day.
ALTER TABLE `Visit`
  ADD COLUMN `lastSeenAt` DATETIME(3) NULL,
  ADD COLUMN `ipAddress` VARCHAR(45) NULL,
  ADD COLUMN `deviceType` VARCHAR(16) NOT NULL DEFAULT 'unknown',
  ADD COLUMN `browser` VARCHAR(80) NULL,
  ADD COLUMN `os` VARCHAR(80) NULL,
  ADD COLUMN `userAgent` VARCHAR(512) NULL,
  ADD COLUMN `referrer` VARCHAR(1000) NULL;

-- Historical rows must keep their original time, not the migration time.
UPDATE `Visit` SET `lastSeenAt` = `createdAt` WHERE `lastSeenAt` IS NULL;

ALTER TABLE `Visit`
  MODIFY COLUMN `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
