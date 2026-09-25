-- Custom: o Drizzle não declara `INCLUDE`, então este índice não está em
-- `schema.ts` (ver o comentário em `jobScore`). Cobre as leituras do quadro,
-- das facetas e do cockpit por (candidato, trilha) sem visitar a tabela (#222).
CREATE INDEX "job_score_board_cover_idx" ON "production"."job_score" USING btree ("candidate_id","track_id","job_id") INCLUDE ("fit","cluster","blockers");
