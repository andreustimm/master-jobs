PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_application` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`job_id` integer NOT NULL,
	`status` text DEFAULT 'backlog' NOT NULL,
	`channel` text,
	`applied_at` text,
	`cv_variant` text,
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
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_application`("id", "candidate_id", "job_id", "status", "channel", "applied_at", "cv_variant", "cover_letter_path", "contact_name", "contact_url", "rate_discussed", "next_action", "next_action_at", "notes", "created_at", "updated_at") SELECT "id", "candidate_id", "job_id", "status", "channel", "applied_at", "cv_variant", "cover_letter_path", "contact_name", "contact_url", "rate_discussed", "next_action", "next_action_at", "notes", "created_at", "updated_at" FROM `application`;--> statement-breakpoint
DROP TABLE `application`;--> statement-breakpoint
ALTER TABLE `__new_application` RENAME TO `application`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `application_candidate_job_idx` ON `application` (`candidate_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `application_candidate_idx` ON `application` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `application_status_idx` ON `application` (`status`);--> statement-breakpoint
CREATE INDEX `application_next_action_idx` ON `application` (`next_action_at`);--> statement-breakpoint
CREATE TABLE `__new_job_score` (
	`candidate_id` integer NOT NULL,
	`job_id` integer NOT NULL,
	`fit` real NOT NULL,
	`title_score` real NOT NULL,
	`keyword_score` real NOT NULL,
	`seniority_score` real NOT NULL,
	`geo_score` real NOT NULL,
	`comp_score` real NOT NULL,
	`freshness_score` real DEFAULT 0 NOT NULL,
	`benefit_score` real DEFAULT 0 NOT NULL,
	`penalty` real DEFAULT 0 NOT NULL,
	`cluster` text NOT NULL,
	`matched_keywords` text NOT NULL,
	`missing_keywords` text NOT NULL,
	`detected_benefits` text,
	`age_days` integer,
	`reasons` text NOT NULL,
	`blockers` text NOT NULL,
	`scorer_version` text NOT NULL,
	`scored_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`candidate_id`, `job_id`),
	FOREIGN KEY (`candidate_id`) REFERENCES `candidate`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_job_score`("candidate_id", "job_id", "fit", "title_score", "keyword_score", "seniority_score", "geo_score", "comp_score", "freshness_score", "benefit_score", "penalty", "cluster", "matched_keywords", "missing_keywords", "detected_benefits", "age_days", "reasons", "blockers", "scorer_version", "scored_at") SELECT "candidate_id", "job_id", "fit", "title_score", "keyword_score", "seniority_score", "geo_score", "comp_score", "freshness_score", "benefit_score", "penalty", "cluster", "matched_keywords", "missing_keywords", "detected_benefits", "age_days", "reasons", "blockers", "scorer_version", "scored_at" FROM `job_score`;--> statement-breakpoint
DROP TABLE `job_score`;--> statement-breakpoint
ALTER TABLE `__new_job_score` RENAME TO `job_score`;--> statement-breakpoint
CREATE INDEX `job_score_fit_idx` ON `job_score` (`fit`);--> statement-breakpoint
CREATE INDEX `job_score_candidate_idx` ON `job_score` (`candidate_id`);