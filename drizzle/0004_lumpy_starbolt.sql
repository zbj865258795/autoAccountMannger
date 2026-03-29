CREATE TABLE `phone_numbers` (
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
