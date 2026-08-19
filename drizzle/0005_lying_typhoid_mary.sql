ALTER TABLE `job_score` ADD `freshness_score` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `job_score` ADD `benefit_score` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `job_score` ADD `detected_benefits` text;--> statement-breakpoint
ALTER TABLE `job_score` ADD `age_days` integer;