DROP INDEX `candidate_document_current_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_document_one_current_idx` ON `candidate_document` (`candidate_id`,`kind`) WHERE "candidate_document"."is_current" = 1;--> statement-breakpoint
ALTER TABLE `application` ADD `candidate_document_id` integer REFERENCES candidate_document(id);--> statement-breakpoint
CREATE INDEX `application_candidate_document_idx` ON `application` (`candidate_document_id`);