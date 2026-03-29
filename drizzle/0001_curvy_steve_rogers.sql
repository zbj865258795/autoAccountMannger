CREATE TABLE `accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`password` varchar(255) NOT NULL,
	`token` text,
	`userId` varchar(64),
	`displayname` varchar(128),
	`membershipVersion` varchar(64) DEFAULT 'free',
	`totalCredits` int DEFAULT 0,
	`freeCredits` int DEFAULT 0,
	`refreshCredits` int DEFAULT 0,
	`inviteCode` varchar(64),
	`inviteCodeId` varchar(64),
	`inviteStatus` enum('unused','in_progress','used') NOT NULL DEFAULT 'unused',
	`invitedByCode` varchar(64),
	`invitedById` int,
	`registeredAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`notes` text,
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `accounts_email_unique` UNIQUE(`email`),
	CONSTRAINT `accounts_inviteCode_unique` UNIQUE(`inviteCode`)
);
--> statement-breakpoint
CREATE TABLE `automation_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`status` enum('idle','running','paused','stopped') NOT NULL DEFAULT 'idle',
	`scanIntervalSeconds` int DEFAULT 60,
	`adspowerApiUrl` varchar(512) DEFAULT 'http://local.adspower.net:50325',
	`adspowerGroupId` varchar(64),
	`maxConcurrent` int DEFAULT 1,
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
--> statement-breakpoint
CREATE TABLE `task_logs` (
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
