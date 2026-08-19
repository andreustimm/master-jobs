CREATE TABLE `candidate_skill` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`skill_id` integer NOT NULL,
	`source` text DEFAULT 'cv' NOT NULL,
	`status` text DEFAULT 'detected' NOT NULL,
	`evidence` text,
	`level` text,
	`occurrences` integer DEFAULT 1 NOT NULL,
	`detected_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`audited_at` text,
	`audited_by` text,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidate`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skill`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_skill_unique_idx` ON `candidate_skill` (`candidate_id`,`skill_id`);--> statement-breakpoint
CREATE INDEX `candidate_skill_status_idx` ON `candidate_skill` (`status`);--> statement-breakpoint
CREATE TABLE `skill` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`canonical_name` text NOT NULL,
	`category` text NOT NULL,
	`aliases` text NOT NULL,
	`verified_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_slug_idx` ON `skill` (`slug`);--> statement-breakpoint
CREATE INDEX `skill_category_idx` ON `skill` (`category`);