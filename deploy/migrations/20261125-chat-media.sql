-- Additive migration for the chat media release. Apply once before starting the new API.
-- Back up the yp666 database first. Existing text messages keep type = 'text'.
ALTER TABLE `Message`
  ADD COLUMN `type` VARCHAR(16) NOT NULL DEFAULT 'text',
  ADD COLUMN `mediaUrl` VARCHAR(255) NULL,
  ADD COLUMN `fileName` VARCHAR(160) NULL;

CREATE TABLE `MediaUpload` (
  `id` VARCHAR(32) NOT NULL,
  `url` VARCHAR(255) NOT NULL,
  `type` VARCHAR(16) NOT NULL,
  `fileName` VARCHAR(160) NOT NULL,
  `visitorId` VARCHAR(32) NULL,
  `adminId` VARCHAR(32) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `MediaUpload_url_key` (`url`),
  INDEX `MediaUpload_visitorId_createdAt_idx` (`visitorId`, `createdAt`),
  INDEX `MediaUpload_adminId_createdAt_idx` (`adminId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `MediaUpload_visitorId_fkey` FOREIGN KEY (`visitorId`) REFERENCES `Visitor` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `MediaUpload_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `Admin` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
