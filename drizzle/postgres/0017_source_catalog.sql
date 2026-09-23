ALTER TABLE "production"."source" ADD COLUMN "retired_at" text;--> statement-breakpoint
ALTER TABLE "production"."source" ADD COLUMN "origin" text DEFAULT 'system';--> statement-breakpoint
ALTER TABLE "production"."source" ADD COLUMN "config_revision" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "production"."source" ADD COLUMN "secret_ref" text;--> statement-breakpoint
ALTER TABLE "production"."source" ADD COLUMN "managed_at" text;--> statement-breakpoint
-- Toda linha de sync existente nasceu do YAML (`ensureSources`). As demais —
-- `manual`, `recruiter` e `<kind>:~terms` — ficam com `system`. Nenhuma linha
-- vira gerida aqui: isso só acontece por `jho sources import --apply` ou por
-- edição do admin, para que ambiente vazio e fixture continuem pelo arquivo.
UPDATE "production"."source"
SET "origin" = 'yaml'
WHERE "kind" IN ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'himalayas', 'remotive', 'arbeitnow', 'remoteok', 'adzuna', 'braintrust', 'careers', 'jobicy', 'workable', 'hackernews')
  AND "handle" NOT LIKE '~%';
