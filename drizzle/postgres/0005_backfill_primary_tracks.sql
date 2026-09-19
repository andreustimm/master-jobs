-- Backfill das trilhas principais (ADR-008, ADR-009). Idempotente: rodar de novo
-- não cria segunda principal nem duplica linhas.
--
-- Quem tem perfil próprio ganha a principal com a parte-alvo desse perfil.
-- O dono da instalação (`is_default`) sem perfil gravado ganha a principal com
-- alvo nulo: ele pontua pelo profile.yaml, que a aplicação copia para a trilha
-- no primeiro uso. Qualquer outro candidato sem perfil próprio fica sem trilha
-- e sem pontuação (M-06). Como nunca existiu editor de perfil, o perfil gravado
-- de quem não é dono veio de derivação e herdou alvos e faixas do padrão: por
-- isso esses dois campos entram como "não revisados".
INSERT INTO "production"."target_track"
  ("candidate_id", "name", "name_key", "is_primary", "status", "position", "target_json", "unreviewed_json")
SELECT
  c."id",
  'Principal',
  'principal',
  true,
  'active',
  1,
  CASE
    WHEN p."profile_json" IS NULL THEN NULL
    ELSE jsonb_build_object(
      'targets', (p."profile_json"::jsonb) -> 'targets',
      'keywords', (p."profile_json"::jsonb) -> 'keywords',
      'seniority', jsonb_build_object(
        'min_years_expected', (p."profile_json"::jsonb) -> 'seniority' -> 'min_years_expected',
        'reject_below_years', (p."profile_json"::jsonb) -> 'seniority' -> 'reject_below_years'
      ),
      'compensation', jsonb_build_object(
        'reference_currency', (p."profile_json"::jsonb) -> 'compensation' -> 'reference_currency',
        'ranges', (p."profile_json"::jsonb) -> 'compensation' -> 'ranges'
      )
    )::text
  END,
  CASE
    WHEN p."profile_json" IS NOT NULL AND NOT c."is_default" THEN '["targets","compensation"]'
    ELSE '[]'
  END
FROM "production"."candidate" c
LEFT JOIN "production"."candidate_matching_profile" p ON p."candidate_id" = c."id"
WHERE (p."candidate_id" IS NOT NULL OR c."is_default")
  AND NOT EXISTS (
    SELECT 1 FROM "production"."target_track" t
    WHERE t."candidate_id" = c."id" AND t."is_primary"
  );
--> statement-breakpoint
UPDATE "production"."job_score" s
SET "track_id" = t."id"
FROM "production"."target_track" t
WHERE t."candidate_id" = s."candidate_id"
  AND t."is_primary"
  AND s."track_id" IS NULL;
--> statement-breakpoint
-- Sobra só linha de candidato sem trilha: pontuada com o perfil de outra pessoa.
DELETE FROM "production"."job_score" WHERE "track_id" IS NULL;
