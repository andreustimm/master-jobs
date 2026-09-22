-- Backfill do endereço público (#235). Idempotente: só toca quem ainda não tem.
--
-- Todo candidato existente passa a responder em `/p/<public_slug>` pelo mesmo
-- endereço de antes, porque até aqui a rota lia `slug`. `slug` é único, então
-- a cópia não colide com o índice único recém-criado.
UPDATE "production"."candidate"
SET "public_slug" = "slug"
WHERE "public_slug" IS NULL;
