CREATE TABLE `recruiter_candidate` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recruiter_user_id` integer NOT NULL,
	`candidate_id` integer NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`recruiter_user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidate`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recruiter_candidate_idx` ON `recruiter_candidate` (`recruiter_user_id`,`candidate_id`);--> statement-breakpoint
CREATE INDEX `recruiter_candidate_candidate_idx` ON `recruiter_candidate` (`candidate_id`);--> statement-breakpoint
ALTER TABLE `auth_session` ADD `impersonated_by` integer REFERENCES auth_user(id);--> statement-breakpoint
ALTER TABLE `job` ADD `posted_by_user_id` integer REFERENCES auth_user(id);