CREATE TABLE "production"."saved_term_request" (
	"candidate_id" integer NOT NULL,
	"window_day" text NOT NULL,
	"requested" integer DEFAULT 0 NOT NULL,
	"updated_at" text DEFAULT to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "saved_term_request_pk" PRIMARY KEY("candidate_id","window_day")
);
--> statement-breakpoint
ALTER TABLE "production"."saved_term_request" ADD CONSTRAINT "saved_term_request_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "production"."candidate"("id") ON DELETE cascade ON UPDATE no action;