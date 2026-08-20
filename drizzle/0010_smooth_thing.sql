CREATE TABLE `verify_task` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`url` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` real DEFAULT 0 NOT NULL,
	`origin` text DEFAULT 'periodic' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`claimed_at` text,
	`claimed_by` text,
	`run_after` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verify_task_job_idx` ON `verify_task` (`job_id`);--> statement-breakpoint
CREATE INDEX `verify_task_claim_idx` ON `verify_task` (`status`,`priority`);--> statement-breakpoint
ALTER TABLE `job` ADD `checked_at` text;--> statement-breakpoint
ALTER TABLE `job` ADD `check_status` text;--> statement-breakpoint
ALTER TABLE `job` ADD `check_code` integer;