CREATE INDEX "job_described_open_idx" ON "production"."job" USING btree ("id") WHERE "production"."job"."closed_at" is null and substr(coalesce("production"."job"."description_text", ''), 200, 1) <> '';--> statement-breakpoint
-- `INCLUDE` escrito à mão: o Drizzle não declara colunas incluídas (ver o
-- comentário do índice em `schema.ts`). O snapshot guarda só as chaves, e o
-- `drizzle-kit generate` continua sem diferença a gerar.
CREATE INDEX "job_score_board_cover_idx" ON "production"."job_score" USING btree ("candidate_id","track_id","job_id") INCLUDE ("fit","cluster","blockers");
