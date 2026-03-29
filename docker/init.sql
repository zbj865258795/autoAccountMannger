-- 账号管理系统数据库初始化脚本
-- 由所有 drizzle 迁移文件合并生成

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

CREATE TABLE IF NOT EXISTS `accounts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `email` varchar(320) NOT NULL,
  `password` varchar(255) NOT NULL,
  `token` text,
  `userId` varchar(64),
  `displayname` varchar(128),
  `phone` varchar(32),
  `clientId` varchar(64),
  `membershipVersion` varchar(64) DEFAULT 'free',
  `totalCredits` int DEFAULT 0,
  `freeCredits` int DEFAULT 0,
  `refreshCredits` int DEFAULT 0,
  `inviteCode` varchar(64),
  `inviteCodeId` varchar(64),
  `inviteStatus` enum('unused','in_progress','used') NOT NULL DEFAULT 'unused',
  `invitedByCode` varchar(64),
  `invitedById` int,
  `referrerCode` varchar(64),
  `registeredAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `notes` text,
  CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
  CONSTRAINT `accounts_email_unique` UNIQUE(`email`),
  CONSTRAINT `accounts_inviteCode_unique` UNIQUE(`inviteCode`)
);

CREATE TABLE IF NOT EXISTS `automation_tasks` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(128) NOT NULL,
  `status` enum('idle','running','paused','stopped') NOT NULL DEFAULT 'idle',
  `scanIntervalSeconds` int DEFAULT 60,
  `adspowerApiUrl` varchar(512) DEFAULT 'http://host.docker.internal:50325',
  `adspowerApiKey` varchar(256),
  `adspowerGroupId` varchar(64),
  `targetUrl` varchar(512),
  `maxConcurrent` int DEFAULT 1,
  `targetCount` int,
  `totalAccountsCreated` int DEFAULT 0,
  `totalSuccess` int DEFAULT 0,
  `totalFailed` int DEFAULT 0,
  `startedAt` timestamp,
  `lastExecutedAt` timestamp,
  `nextExecutionAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `automation_tasks_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `task_logs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `taskId` int,
  `status` enum('pending','running','success','failed','skipped') NOT NULL DEFAULT 'pending',
  `usedInviteCode` varchar(64),
  `sourceAccountId` int,
  `newAccountId` int,
  `adspowerBrowserId` varchar(128),
  `errorMessage` text,
  `durationMs` int,
  `startedAt` timestamp DEFAULT (now()),
  `completedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `task_logs_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `phone_numbers` (
  `id` int AUTO_INCREMENT NOT NULL,
  `phone` varchar(32) NOT NULL,
  `smsUrl` varchar(1024) NOT NULL,
  `status` enum('unused','in_use','used') NOT NULL DEFAULT 'unused',
  `usedByEmail` varchar(320),
  `usedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `notes` text,
  CONSTRAINT `phone_numbers_id` PRIMARY KEY(`id`),
  CONSTRAINT `phone_numbers_phone_unique` UNIQUE(`phone`)
);
