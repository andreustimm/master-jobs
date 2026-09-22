ALTER TABLE "production"."candidate" ADD COLUMN "public_slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_public_slug_idx" ON "production"."candidate" USING btree ("public_slug");