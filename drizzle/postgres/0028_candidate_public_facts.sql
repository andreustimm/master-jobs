ALTER TABLE "production"."candidate" ADD COLUMN "work_model" text[];--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "experience_level" text;--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "availability" text;--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "start_timeframe" text;--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "open_to_relocation" boolean;--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "languages" text;--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "public_work_model" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "public_experience_level" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "public_availability" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "public_start_timeframe" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "public_relocation" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "public_area" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "production"."candidate" ADD COLUMN "public_languages" boolean DEFAULT false;