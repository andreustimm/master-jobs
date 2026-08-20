ALTER TABLE `job_score` ADD `eligibility_status` text DEFAULT 'unverifiable' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_score` ADD `eligibility_reasons` text DEFAULT '[]' NOT NULL;