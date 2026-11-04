ALTER TABLE "production"."job_retention_tombstone" ADD COLUMN "original_job_id" integer;--> statement-breakpoint
ALTER TABLE "production"."job_retention_tombstone" ADD COLUMN "batch_id" text;