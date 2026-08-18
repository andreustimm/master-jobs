CREATE TABLE `fx_rate` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`base` text NOT NULL,
	`currency` text NOT NULL,
	`rate` real NOT NULL,
	`provider` text NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_rate_unique_idx` ON `fx_rate` (`date`,`base`,`currency`);