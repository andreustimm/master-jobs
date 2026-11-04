ALTER TABLE "production"."job_retention_tombstone" DROP CONSTRAINT "job_retention_tombstone_pkey";
--> statement-breakpoint
ALTER TABLE "production"."job_retention_tombstone" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE INDEX "job_retention_tombstone_fingerprint_idx" ON "production"."job_retention_tombstone" USING btree ("fingerprint");