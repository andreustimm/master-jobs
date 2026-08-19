CREATE TABLE `job_page` (
	`job_id` integer PRIMARY KEY NOT NULL,
	`final_url` text NOT NULL,
	`http_status` integer NOT NULL,
	`html` text,
	`text` text,
	`extracted` text,
	`content_hash` text NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`parsed_at` text,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_page_parsed_idx` ON `job_page` (`parsed_at`);--> statement-breakpoint
CREATE TABLE `scrape_task` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`url` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` real DEFAULT 0 NOT NULL,
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
CREATE UNIQUE INDEX `scrape_task_job_idx` ON `scrape_task` (`job_id`);--> statement-breakpoint
CREATE INDEX `scrape_task_claim_idx` ON `scrape_task` (`status`,`priority`);