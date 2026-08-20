PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_application` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`job_id` integer NOT NULL,
	`status` text DEFAULT 'backlog' NOT NULL,
	`channel` text,
	`applied_at` text,
	`candidate_document_id` integer,
	`cover_letter_path` text,
	`contact_name` text,
	`contact_url` text,
	`rate_discussed` text,
	`next_action` text,
	`next_action_at` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidate`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_document_id`,`candidate_id`) REFERENCES `candidate_document`(`id`,`candidate_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_application`("id", "candidate_id", "job_id", "status", "channel", "applied_at", "candidate_document_id", "cover_letter_path", "contact_name", "contact_url", "rate_discussed", "next_action", "next_action_at", "notes", "created_at", "updated_at") SELECT "id", "candidate_id", "job_id", "status", "channel", "applied_at", "candidate_document_id", "cover_letter_path", "contact_name", "contact_url", "rate_discussed", "next_action", "next_action_at", "notes", "created_at", "updated_at" FROM `application`;--> statement-breakpoint
DROP TABLE `application`;--> statement-breakpoint
ALTER TABLE `__new_application` RENAME TO `application`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `application_candidate_job_idx` ON `application` (`candidate_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `application_candidate_idx` ON `application` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `application_candidate_document_idx` ON `application` (`candidate_document_id`);--> statement-breakpoint
CREATE INDEX `application_status_idx` ON `application` (`status`);--> statement-breakpoint
CREATE INDEX `application_next_action_idx` ON `application` (`next_action_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_document_identity_idx` ON `candidate_document` (`id`,`candidate_id`);