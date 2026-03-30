-- 新增导出日志表
-- 每条记录对应一个被导出的账号，同一批次通过 exportBatchId 聚合
-- 账号导出后从 accounts 表物理删除，数据永久保存在此表

CREATE TABLE `export_logs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `exportBatchId` varchar(64) NOT NULL COMMENT '批次号，同一次导出操作共享',
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
  `registeredAt` timestamp,
  `exportedAt` timestamp NOT NULL DEFAULT (now()),
  `notes` text,
  CONSTRAINT `export_logs_id` PRIMARY KEY(`id`)
);

-- 为常用查询字段建立索引
CREATE INDEX `export_logs_batchId_idx` ON `export_logs` (`exportBatchId`);
CREATE INDEX `export_logs_email_idx` ON `export_logs` (`email`);
CREATE INDEX `export_logs_exportedAt_idx` ON `export_logs` (`exportedAt`);
