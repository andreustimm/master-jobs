DROP INDEX "production"."target_account_url_idx";--> statement-breakpoint
ALTER TABLE "production"."target_account" ADD COLUMN "candidate_id" integer;--> statement-breakpoint
ALTER TABLE "production"."target_account" ADD CONSTRAINT "target_account_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "production"."candidate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "target_account_candidate_url_idx" ON "production"."target_account" USING btree ("candidate_id","linkedin_url");