CREATE TABLE `candidate` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`headline` text,
	`location` text,
	`email` text,
	`linkedin_url` text,
	`github_url` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_slug_idx` ON `candidate` (`slug`);--> statement-breakpoint
CREATE TABLE `candidate_document` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`kind` text DEFAULT 'cv' NOT NULL,
	`label` text NOT NULL,
	`format` text DEFAULT 'text' NOT NULL,
	`content` text NOT NULL,
	`source_filename` text,
	`is_current` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidate`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `candidate_document_candidate_idx` ON `candidate_document` (`candidate_id`,`kind`);--> statement-breakpoint
CREATE INDEX `candidate_document_current_idx` ON `candidate_document` (`is_current`);