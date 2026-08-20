-- Corrige duas chaves estrangeiras que o schema declara e o banco não aplica.
--
-- A migração 0021 acrescentou `job.posted_by_user_id` e
-- `auth_session.impersonated_by` com `ALTER TABLE ... ADD <col> integer
-- REFERENCES auth_user(id)` — sem a cláusula `ON DELETE`. O SQLite aceita e
-- assume `NO ACTION`, então o que o `schema.ts` declara e o que o banco faz
-- divergiram em silêncio:
--
--   job.posted_by_user_id       declarado SET NULL, aplicado NO ACTION
--   auth_session.impersonated_by declarado CASCADE,  aplicado NO ACTION
--
-- O efeito está invertido nos dois casos. Apagar a conta de um recrutador que
-- cadastrou uma vaga passa a ser RECUSADO pelo banco, em vez de a vaga esquecer
-- quem a cadastrou — e a atribuição é metadado, enquanto a vaga é o dado.
-- Apagar um admin que assumiu uma identidade é recusado pela sessão emprestada,
-- que deveria cair junto.
--
-- Hoje é latente: não há rota que apague conta. Vira defeito no dia em que
-- houver, e aí a exclusão falha com erro de constraint sem explicação óbvia.
--
-- SQLite não altera chave estrangeira por `ALTER`; a única saída é reconstruir
-- a tabela. `job` tem 8.700 linhas, e por isso a cópia é explícita coluna a
-- coluna: `INSERT ... SELECT *` dependeria da ordem física das colunas, que os
-- `ALTER TABLE ADD` anteriores já embaralharam em relação ao `schema.ts`.

PRAGMA foreign_keys=OFF;--> statement-breakpoint

CREATE TABLE `auth_session_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`impersonated_by` integer,
	`revoked_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`impersonated_by`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint

INSERT INTO `auth_session_new`
  (`id`, `token_hash`, `user_id`, `expires_at`, `impersonated_by`, `revoked_at`, `created_at`)
SELECT `id`, `token_hash`, `user_id`, `expires_at`, `impersonated_by`, `revoked_at`, `created_at`
FROM `auth_session`;--> statement-breakpoint

DROP TABLE `auth_session`;--> statement-breakpoint
ALTER TABLE `auth_session_new` RENAME TO `auth_session`;--> statement-breakpoint
CREATE UNIQUE INDEX `auth_session_token_idx` ON `auth_session` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_session_user_idx` ON `auth_session` (`user_id`);--> statement-breakpoint

CREATE TABLE `job_new` (
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
	`checked_at` text,
	`check_status` text,
	`check_code` integer,
	`posted_by_user_id` integer,
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
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_by_user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint

INSERT INTO `job_new`
  (`id`, `fingerprint`, `content_hash`, `source_id`, `external_id`, `company_id`,
   `company_name`, `title`, `description_html`, `description_text`, `checked_at`,
   `check_status`, `check_code`, `posted_by_user_id`, `location_raw`, `remote`,
   `employment_type`, `seniority_raw`, `comp_min`, `comp_max`, `comp_currency`,
   `comp_period`, `url`, `apply_url`, `posted_at`, `first_seen_at`, `last_seen_at`,
   `closed_at`, `raw`)
SELECT
   `id`, `fingerprint`, `content_hash`, `source_id`, `external_id`, `company_id`,
   `company_name`, `title`, `description_html`, `description_text`, `checked_at`,
   `check_status`, `check_code`, `posted_by_user_id`, `location_raw`, `remote`,
   `employment_type`, `seniority_raw`, `comp_min`, `comp_max`, `comp_currency`,
   `comp_period`, `url`, `apply_url`, `posted_at`, `first_seen_at`, `last_seen_at`,
   `closed_at`, `raw`
FROM `job`;--> statement-breakpoint

DROP TABLE `job`;--> statement-breakpoint
ALTER TABLE `job_new` RENAME TO `job`;--> statement-breakpoint
CREATE UNIQUE INDEX `job_fingerprint_idx` ON `job` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `job_source_idx` ON `job` (`source_id`);--> statement-breakpoint
CREATE INDEX `job_company_idx` ON `job` (`company_name`);--> statement-breakpoint
CREATE INDEX `job_last_seen_idx` ON `job` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `job_closed_idx` ON `job` (`closed_at`);--> statement-breakpoint

PRAGMA foreign_keys=ON;
