-- 初始化建表脚本（完整版）
-- 包含系统所有 9 张表，全部使用 CREATE TABLE IF NOT EXISTS，可重复执行

-- ─────────────────────────────────────────────
-- 1. 用户表（OAuth 登录，本地部署无需使用）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `users` (
  `id` int AUTO_INCREMENT NOT NULL,
  `openId` varchar(64) NOT NULL,
  `name` text,
  `email` varchar(320),
  `loginMethod` varchar(64),
  `role` enum('user','admin') NOT NULL DEFAULT 'user',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `lastSignedIn` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `users_id` PRIMARY KEY(`id`),
  CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);

-- ─────────────────────────────────────────────
-- 2. 账号表：存储所有通过邀请码链式注册的账号
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `accounts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `email` varchar(320) NOT NULL,
  `password` varchar(255) NOT NULL,
  `token` text,
  `userId` varchar(64),
  `displayname` varchar(128),
  `membershipVersion` varchar(64) DEFAULT 'free',
  `phone` varchar(32),
  `clientId` varchar(64),
  `totalCredits` int DEFAULT 0,
  `freeCredits` int DEFAULT 0,
  `refreshCredits` int DEFAULT 0,
  `inviteCode` varchar(64),
  `inviteCodeId` varchar(64),
  `inviteStatus` enum('unused','in_progress','used') NOT NULL DEFAULT 'unused',
  `invitedByCode` varchar(64),
  `referrerCode` varchar(64),
  `invitedById` int,
  `registeredAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `notes` text,
  CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
  CONSTRAINT `accounts_email_unique` UNIQUE(`email`),
  CONSTRAINT `accounts_inviteCode_unique` UNIQUE(`inviteCode`)
);

-- ─────────────────────────────────────────────
-- 3. 代理账号表：存储代理账号、地区、代理 URL
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `proxy_accounts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(128) NOT NULL,
  `region` enum('us','tw','hk','jp') NOT NULL,
  `proxyUrl` varchar(1024) NOT NULL,
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `proxy_accounts_id` PRIMARY KEY(`id`)
);

-- ─────────────────────────────────────────────
-- 4. 自动化任务表：管理定时扫描和自动注册任务
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `automation_tasks` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(128) NOT NULL,
  `status` enum('idle','running','paused','stopped') NOT NULL DEFAULT 'idle',
  `scanIntervalSeconds` int DEFAULT 10,
  `adspowerApiUrl` varchar(512) DEFAULT 'http://127.0.0.1:50325',
  `adspowerApiKey` varchar(256),
  `adspowerGroupId` varchar(64),
  `targetUrl` varchar(512),
  `proxyAccountId` int,
  `proxyUrl` varchar(1024),
  `maxConcurrent` int DEFAULT 1,
  `targetCount` int,
  `totalAccountsCreated` int DEFAULT 0,
  `totalSuccess` int DEFAULT 0,
  `totalFailed` int DEFAULT 0,
  `startedAt` timestamp NULL,
  `lastExecutedAt` timestamp NULL,
  `nextExecutionAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `automation_tasks_id` PRIMARY KEY(`id`)
);

-- ─────────────────────────────────────────────
-- 5. 任务执行日志表：记录每次自动化任务的执行详情
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `task_logs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `taskId` int,
  `status` enum('pending','running','success','failed','skipped') NOT NULL DEFAULT 'pending',
  `usedInviteCode` varchar(64),
  `sourceAccountId` int,
  `newAccountId` int,
  `adspowerBrowserId` varchar(128),
  `exitIp` varchar(64),
  `acquiredPhoneId` int,
  `errorMessage` text,
  `durationMs` int,
  `startedAt` timestamp NULL DEFAULT (now()),
  `completedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `task_logs_id` PRIMARY KEY(`id`)
);

-- ─────────────────────────────────────────────
-- 6. 任务步骤日志表：记录每次注册任务的详细步骤进度
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `task_step_logs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `taskLogId` int NOT NULL,
  `source` varchar(32) NOT NULL DEFAULT 'Automation',
  `level` enum('info','success','warning','error') NOT NULL DEFAULT 'info',
  `message` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `task_step_logs_id` PRIMARY KEY(`id`)
);

-- ─────────────────────────────────────────────
-- 7. 手机号表：存储用于注册的手机号和接码 URL
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `phone_numbers` (
  `id` int AUTO_INCREMENT NOT NULL,
  `phone` varchar(32) NOT NULL,
  `smsUrl` varchar(1024) NOT NULL,
  `status` enum('unused','in_use','used') NOT NULL DEFAULT 'unused',
  `usedByEmail` varchar(320),
  `usedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `notes` text,
  CONSTRAINT `phone_numbers_id` PRIMARY KEY(`id`),
  CONSTRAINT `phone_numbers_phone_unique` UNIQUE(`phone`)
);

-- ─────────────────────────────────────────────
-- 8. 导出日志表：记录每次导出操作的账号明细
-- ─────────────────────────────────────────────
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
CREATE INDEX IF NOT EXISTS `export_logs_batchId_idx` ON `export_logs` (`exportBatchId`);
CREATE INDEX IF NOT EXISTS `export_logs_email_idx` ON `export_logs` (`email`);
CREATE INDEX IF NOT EXISTS `export_logs_exportedAt_idx` ON `export_logs` (`exportedAt`);

-- ─────────────────────────────────────────────
-- 9. 已用出口IP池表：防止重复使用同一IP注册
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `used_ip_pool` (
  `id` int AUTO_INCREMENT NOT NULL,
  `ip` varchar(64) NOT NULL,
  `usedByEmail` varchar(320),
  `taskLogId` int,
  `usedAt` timestamp NOT NULL DEFAULT (now()),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `used_ip_pool_id` PRIMARY KEY(`id`),
  CONSTRAINT `used_ip_pool_ip_unique` UNIQUE(`ip`)
);
