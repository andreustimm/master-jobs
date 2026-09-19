ALTER TABLE "production"."job" ADD COLUMN "archived_at" text;--> statement-breakpoint
CREATE INDEX "job_archive_scan_idx" ON "production"."job" USING btree ("closed_at","archived_at");