-- Backfill do endereço público (#235). Idempotente: só toca quem ainda não tem.
--
-- Todo candidato existente passa a responder em `/p/<public_slug>` pelo mesmo
-- endereço de antes, porque até aqui a rota lia `slug`. `slug` é único, então
-- a cópia não colide com o índice único recém-criado.
--
-- Exceto `user-<e-mail>`, o slug que o cadastro pelo admin deriva do e-mail:
-- copiá-lo publicaria o e-mail no endereço. Essas contas ficam sem endereço
-- até a própria pessoa escolher um — ausência nega, nunca publica.
UPDATE "production"."candidate"
SET "public_slug" = "slug"
WHERE "public_slug" IS NULL
  AND "slug" NOT LIKE 'user-%';
