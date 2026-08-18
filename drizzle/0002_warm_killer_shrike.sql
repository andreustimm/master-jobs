CREATE TABLE `mail_message` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text NOT NULL,
	`from_address` text,
	`from_name` text,
	`subject` text,
	`received_at` text,
	`kind` text DEFAULT 'unknown' NOT NULL,
	`provider` text,
	`company_guess` text,
	`body_text` text,
	`extracted_jobs` integer DEFAULT 0 NOT NULL,
	`imported_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_message_id_idx` ON `mail_message` (`message_id`);--> statement-breakpoint
CREATE INDEX `mail_kind_idx` ON `mail_message` (`kind`);--> statement-breakpoint
CREATE INDEX `mail_received_idx` ON `mail_message` (`received_at`);--> statement-breakpoint
CREATE TABLE `mail_suggestion` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mail_id` integer NOT NULL,
	`application_id` integer,
	`job_id` integer,
	`suggested_status` text,
	`rationale` text,
	`confidence` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`mail_id`) REFERENCES `mail_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mail_suggestion_status_idx` ON `mail_suggestion` (`status`);