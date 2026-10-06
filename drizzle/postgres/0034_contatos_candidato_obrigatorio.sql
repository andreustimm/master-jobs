-- A rede gravada antes da 0031 volta para o dono, e o contato passa a ter dono
-- obrigatório (#405, continuação do #379). MIGRAÇÃO NÃO ADITIVA: reescreve
-- dado, cria índice único sobre coluna existente, remove o índice global e
-- torna `candidate_id` obrigatório. Exige revisão humana antes da promoção
-- (ADR 0028).
--
-- Para quem vão as linhas: o candidato de slug `default`. Toda linha sem dono
-- veio da CLI (`jho contacts add`, `jho contacts seed`) ou do seed, que operam
-- sobre o candidato ativo da CLI — o de slug `default` (`activeCandidateId()`).
-- O slug é único (`candidate_slug_idx`); `is_default` não serve, porque um
-- defeito antigo de `ensureCandidate` o gravou `true` em candidato de
-- convidado e poderia casar com mais de uma linha.
--
-- Deduplicação (pedida na #405): se alguém rodou `jho contacts seed` ou
-- recadastrou um contato depois da 0031, o `default` já tem uma linha com dono
-- e a antiga, sem dono, é a gêmea dela. A órfã é apagada quando:
--   - não tem `linkedin_url` (a URL é a identidade da pessoa; órfã com URL
--     nunca é apagada, e o índice global garante que nenhuma outra linha a
--     tem); e
--   - existe linha do `default` com o mesmo `name`, a mesma `category` e a
--     mesma `company`, comparando nulo com nulo (`IS NOT DISTINCT FROM`).
-- Fica a linha com dono: é a mais recente e a que o seed atualiza. As notas da
-- órfã não são fundidas. Em 01/10/2026 a produção não tinha esse caso.
--
-- O índice único por candidato não encontra conflito no backfill: até aqui
-- `target_account_url_idx` impedia a mesma URL em duas linhas quaisquer.
--
-- Sem candidato `default`, o DELETE e o UPDATE não tocam nada e o
-- `SET NOT NULL` falha (23502) se houver linha sem dono. O migrador roda o
-- lote numa transação só: tudo volta atrás, nenhum contato é apagado nem
-- entregue a um candidato qualquer, e o índice global continua lá.
DELETE FROM "production"."target_account" AS orphan
WHERE orphan."candidate_id" IS NULL
  AND orphan."linkedin_url" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "production"."target_account" AS owned
    JOIN "production"."candidate" AS c ON c."id" = owned."candidate_id"
    WHERE c."slug" = 'default'
      AND owned."name" = orphan."name"
      AND owned."category" = orphan."category"
      AND owned."company" IS NOT DISTINCT FROM orphan."company"
  );--> statement-breakpoint
UPDATE "production"."target_account" AS t
SET "candidate_id" = c."id"
FROM "production"."candidate" AS c
WHERE c."slug" = 'default'
  AND t."candidate_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "target_account_candidate_url_idx" ON "production"."target_account" USING btree ("candidate_id","linkedin_url");--> statement-breakpoint
DROP INDEX "production"."target_account_url_idx";--> statement-breakpoint
ALTER TABLE "production"."target_account" ALTER COLUMN "candidate_id" SET NOT NULL;
