CREATE TABLE "production"."job_retention_tombstone" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"external_usable" boolean DEFAULT false NOT NULL,
	"first_seen_at" text NOT NULL,
	"expired_at" text NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "job_retention_tombstone_source_external_idx" ON "production"."job_retention_tombstone" USING btree ("source_id","external_id");