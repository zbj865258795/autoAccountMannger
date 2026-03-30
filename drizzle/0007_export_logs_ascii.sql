CREATE TABLE IF NOT EXISTS `export_logs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `exportBatchId` varchar(64) NOT NULL,
  `email` varchar(320) NOT NULL,
  `password` varchar(255) NOT NULL,
  `token` text,
  `userId` varchar(64),
  `displayname` varchar(128),
  `phone` varchar(32),
  `membershipVersion` varchar(64),
  `totalCredits` int DEFAULT 0,
  `inviteCode` varchar(64),
  `referrerCode` varchar(64),
  `registeredAt` timestamp NULL,
  `exportedAt` timestamp NOT NULL DEFAULT (now()),
  `notes` text,
  CONSTRAINT `export_logs_id` PRIMARY KEY(`id`)
);
CREATE INDEX `export_logs_batchId_idx` ON `export_logs` (`exportBatchId`);
CREATE INDEX `export_logs_email_idx` ON `export_logs` (`email`);
CREATE INDEX `export_logs_exportedAt_idx` ON `export_logs` (`exportedAt`);
