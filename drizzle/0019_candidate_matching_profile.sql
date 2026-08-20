CREATE TABLE `candidate_matching_profile` (
	`candidate_id` integer PRIMARY KEY NOT NULL,
	`profile_json` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidate`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `job_score` ADD `profile_hash` text DEFAULT 'legacy' NOT NULL;