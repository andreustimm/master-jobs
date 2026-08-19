CREATE TABLE `llm_model` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_id` integer NOT NULL,
	`model_id` text NOT NULL,
	`label` text NOT NULL,
	`supports_reasoning` integer DEFAULT false NOT NULL,
	`default_effort` text,
	`max_output_tokens` integer DEFAULT 4096 NOT NULL,
	`input_cost_per_mtok` real,
	`output_cost_per_mtok` real,
	`enabled` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `llm_provider`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_model_unique_idx` ON `llm_model` (`provider_id`,`model_id`);--> statement-breakpoint
CREATE INDEX `llm_model_default_idx` ON `llm_model` (`is_default`);--> statement-breakpoint
CREATE TABLE `llm_provider` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`base_url` text,
	`api_key_env` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_provider_slug_idx` ON `llm_provider` (`slug`);