ALTER TABLE "production"."job_score" DROP CONSTRAINT "job_score_candidate_job_pk";--> statement-breakpoint
ALTER TABLE "production"."job_score" ALTER COLUMN "track_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "production"."job_score" ADD CONSTRAINT "job_score_candidate_track_job_pk" PRIMARY KEY("candidate_id","track_id","job_id");--> statement-breakpoint
CREATE INDEX "job_score_candidate_track_fit_idx" ON "production"."job_score" USING btree ("candidate_id","track_id","fit");