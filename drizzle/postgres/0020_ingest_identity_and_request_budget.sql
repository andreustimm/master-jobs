CREATE TABLE "production"."request_budget" (
	"routine" text NOT NULL,
	"day" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"refused" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "request_budget_pk" PRIMARY KEY("routine","day")
);
--> statement-breakpoint
CREATE INDEX "job_source_external_idx" ON "production"."job" USING btree ("source_id","external_id");