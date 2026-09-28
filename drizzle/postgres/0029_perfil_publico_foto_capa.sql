ALTER TABLE "production"."candidate" ADD COLUMN "photo_key" text;--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "cover_key" text;--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "public_photo" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "public_cover" boolean DEFAULT false;