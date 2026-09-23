CREATE TABLE "production"."score_cursor" (
	"candidate_id" integer NOT NULL,
	"track_id" integer NOT NULL,
	"profile_hash" text NOT NULL,
	"scorer_version" text NOT NULL,
	"position_key" text,
	"position_job_id" integer,
	"last_completed_at" text,
	"first_completed_at" text,
	"created_at" text DEFAULT to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "score_cursor_candidate_track_pk" PRIMARY KEY("candidate_id","track_id")
);
--> statement-breakpoint
ALTER TABLE "production"."score_cursor" ADD CONSTRAINT "score_cursor_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "production"."candidate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production"."score_cursor" ADD CONSTRAINT "score_cursor_track_id_target_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "production"."target_track"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_recency_open_idx" ON "production"."job" USING btree (coalesce("posted_at", "first_seen_at"),"id") WHERE "production"."job"."closed_at" is null;