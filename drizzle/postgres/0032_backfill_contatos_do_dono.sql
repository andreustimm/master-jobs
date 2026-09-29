-- Contatos existentes passam a ser do dono da instalação (#379).
--
-- Até aqui `target_account` não tinha dono: `/referrals` mostrava a rede
-- inteira, com nomes de pessoas, para qualquer conta. Toda linha gravada até
-- agora veio da CLI (`jho contacts add`, `jho contacts seed`) ou do seed, que
-- operam sobre o candidato ativo da CLI: o de slug `default` (`getCandidate()`,
-- `activeCandidateId()`). É para ele que as linhas vão.
--
-- Por que `slug = 'default'` e não `is_default`: o slug é único
-- (`candidate_slug_idx`), então a escolha é determinística; `is_default` já foi
-- gravado como `true` em candidato de convidado por um defeito antigo de
-- `ensureCandidate`, e poderia casar com mais de uma linha.
--
-- Idempotente: só toca linha ainda sem dono. Sem candidato `default`, nada é
-- atualizado e a migration seguinte (`SET NOT NULL`) falha e desfaz o lote
-- inteiro — contato órfão não é apagado nem entregue a um candidato qualquer.
UPDATE "production"."target_account" AS t
SET "candidate_id" = c."id"
FROM "production"."candidate" AS c
WHERE c."slug" = 'default'
  AND t."candidate_id" IS NULL;
