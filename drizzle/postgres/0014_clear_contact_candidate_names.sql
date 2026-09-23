-- Nome de candidato que é e-mail volta a ficar vazio (BUG-20260922-public-profile-shows-email-as-name).
--
-- Na 1.22.0, `jho auth add-user` criava o candidato próprio da conta com o
-- e-mail no lugar do nome, e `/p/<endereço>` publicava esse nome como título.
-- O código deixou de gravar isso; esta migration limpa o que já foi gravado.
--
-- Só dados, sem mudança de schema, idempotente, e SOBRESCREVE sem guardar o valor anterior: zera `name` quando ele é igual ao e-mail da
-- conta dona do candidato, igual ao e-mail do próprio candidato, ou tem forma
-- de e-mail. Nome vazio é o estado "ainda sem nome": `/candidate` pede um, e o
-- perfil público mostra um título neutro. Rodar de novo não acha nada, porque
-- string vazia não casa com nenhuma das três condições.
--
-- Telefone não entra: não há caminho no produto que o grave como nome, e a
-- leitura (`publicProfile()` → `containsContact()`) já o esconde de todo modo.
UPDATE "production"."candidate" AS c
SET "name" = '', "updated_at" = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE c."name" <> ''
  AND (
    c."name" ~ '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}'
    OR lower(btrim(c."name")) = lower(btrim(coalesce(c."email", '')))
    OR EXISTS (
      SELECT 1
      FROM "production"."auth_user" AS u
      WHERE u."candidate_id" = c."id"
        AND lower(btrim(c."name")) = lower(btrim(u."email"))
    )
  );
