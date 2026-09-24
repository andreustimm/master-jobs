ALTER TABLE "production"."source" ADD COLUMN "retired_at" text;--> statement-breakpoint
ALTER TABLE "production"."source" ADD COLUMN "origin" text DEFAULT 'system';--> statement-breakpoint
ALTER TABLE "production"."source" ADD COLUMN "config_revision" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "production"."source" ADD COLUMN "secret_ref" text;--> statement-breakpoint
ALTER TABLE "production"."source" ADD COLUMN "managed_at" text;