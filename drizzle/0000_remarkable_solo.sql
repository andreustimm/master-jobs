CREATE TABLE `application` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
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
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_job_idx` ON `application` (`job_id`);--> statement-breakpoint
CREATE INDEX `application_status_idx` ON `application` (`status`);--> statement-breakpoint
CREATE INDEX `application_next_action_idx` ON `application` (`next_action_at`);--> statement-breakpoint
CREATE TABLE `application_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`kind` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`detail` text,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `application_event_app_idx` ON `application_event` (`application_id`);--> statement-breakpoint
CREATE TABLE `company` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`website` text,
	`careers_url` text,
	`hires_contractors` integer,
	`hires_latam` integer,
	`via_agency` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_slug_idx` ON `company` (`slug`);--> statement-breakpoint
CREATE TABLE `engagement` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`target_url` text NOT NULL,
	`target_name` text,
	`target_role` text,
	`target_company` text,
	`rationale` text,
	`draft` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`queued_for` text,
	`done_at` text,
	`outcome` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `engagement_status_idx` ON `engagement` (`status`,`queued_for`);--> statement-breakpoint
CREATE TABLE `job` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fingerprint` text NOT NULL,
	`content_hash` text NOT NULL,
	`source_id` text NOT NULL,
	`external_id` text NOT NULL,
	`company_id` integer,
	`company_name` text NOT NULL,
	`title` text NOT NULL,
	`description_html` text,
	`description_text` text,
	`location_raw` text,
	`remote` integer,
	`employment_type` text,
	`seniority_raw` text,
	`comp_min` integer,
	`comp_max` integer,
	`comp_currency` text,
	`comp_period` text,
	`url` text NOT NULL,
	`apply_url` text,
	`posted_at` text,
	`first_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`closed_at` text,
	`raw` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_fingerprint_idx` ON `job` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `job_source_idx` ON `job` (`source_id`);--> statement-breakpoint
CREATE INDEX `job_company_idx` ON `job` (`company_name`);--> statement-breakpoint
CREATE INDEX `job_last_seen_idx` ON `job` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `job_closed_idx` ON `job` (`closed_at`);--> statement-breakpoint
CREATE TABLE `job_score` (
	`job_id` integer PRIMARY KEY NOT NULL,
	`fit` real NOT NULL,
	`title_score` real NOT NULL,
	`keyword_score` real NOT NULL,
	`seniority_score` real NOT NULL,
	`geo_score` real NOT NULL,
	`comp_score` real NOT NULL,
	`penalty` real DEFAULT 0 NOT NULL,
	`cluster` text NOT NULL,
	`matched_keywords` text NOT NULL,
	`missing_keywords` text NOT NULL,
	`reasons` text NOT NULL,
	`blockers` text NOT NULL,
	`scorer_version` text NOT NULL,
	`scored_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_score_fit_idx` ON `job_score` (`fit`);--> statement-breakpoint
CREATE TABLE `metric_snapshot` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`key` text NOT NULL,
	`value` real NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metric_at_key_idx` ON `metric_snapshot` (`at`,`key`);--> statement-breakpoint
CREATE TABLE `positioning_task` (
	`id` text PRIMARY KEY NOT NULL,
	`horizon` text NOT NULL,
	`title` text NOT NULL,
	`why` text,
	`how` text,
	`expected` text,
	`priority` text NOT NULL,
	`effort` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`done_at` text,
	`source_ref` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `post` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`pillar` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`lang` text DEFAULT 'en' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`scheduled_for` text,
	`published_at` text,
	`linkedin_urn` text,
	`impressions` integer,
	`reactions` integer,
	`comment_count` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_slug_idx` ON `post` (`slug`);--> statement-breakpoint
CREATE TABLE `source` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`handle` text NOT NULL,
	`label` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`rationale` text,
	`last_synced_at` text,
	`last_status` text,
	`last_error` text,
	`last_job_count` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_kind_handle_idx` ON `source` (`kind`,`handle`);--> statement-breakpoint
CREATE TABLE `target_account` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`linkedin_url` text,
	`category` text NOT NULL,
	`company` text,
	`role` text,
	`country` text,
	`status` text DEFAULT 'identified' NOT NULL,
	`last_touch_at` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `target_account_url_idx` ON `target_account` (`linkedin_url`);