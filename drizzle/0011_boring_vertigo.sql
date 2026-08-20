ALTER TABLE `application` ADD `candidate_id` integer REFERENCES candidate(id);--> statement-breakpoint
CREATE INDEX `application_candidate_idx` ON `application` (`candidate_id`);--> statement-breakpoint
ALTER TABLE `job_score` ADD `candidate_id` integer REFERENCES candidate(id);--> statement-breakpoint
CREATE INDEX `job_score_candidate_idx` ON `job_score` (`candidate_id`);