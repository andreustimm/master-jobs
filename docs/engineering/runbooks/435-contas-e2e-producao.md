# Roteiro: contas do E2E no banco de produção (#435)

**Quem executa:** o dono. É escrita no banco de produção, e nenhum agente roda
este roteiro. O SQL foi revisado na PR, mas não rodou contra produção.

## O que aconteceu

Em 01/10/2026, uma leitura no banco de produção mostrou contas do E2E criadas
em 20/08/2026: os candidatos 2 e 3 (slugs `e2e-…`), ambos com
`is_default = true`, e o usuário 4 (papel `candidate`), ligado ao candidato 2.
Quatro candidatos estavam marcados como dono. `isOwner` só escapa porque
prefere o slug `default`.

**Causa.** O `setup.mjs` rodou contra o banco local de trabalho em 20/08. Esse
banco foi copiado para o Supabase no corte. Na época, `ensureCandidate` marcava
`is_default` em todo candidato que criava, e esse defeito já foi corrigido
(ver [security.md](../../security.md)). A guarda `tests/e2e/database-guard.mjs`
nasceu em 22/09 (`d0a1cc01`) e recusa banco fora do loopback. Desde a #435,
`ui.mjs` e `a11y.mjs` também a consultam, e ela passou a recusar `E2E_BASE`
fora do loopback e `JHO_TEST_DATABASE_URL` diferente de `DATABASE_URL`.

**Lacuna aberta.** Um banco no loopback com qualquer nome ainda passa pela
guarda, inclusive o banco local de trabalho, que pode voltar a ser copiado.
Restringir o nome a `jho_test_*` é decisão do dono.

## Conexão

Use a URL de migração do Supabase (`SUPABASE_MIGRATION_URL`), a mesma do
[deploy.md](../deploy.md#migrar-o-banco), num `psql` que só você opera. As
tabelas ficam no schema `production`. Não use o `.env` do checkout: o CLI lê
`DATABASE_URL` dele primeiro.

```bash
psql "$SUPABASE_MIGRATION_URL" -v ON_ERROR_STOP=1
```

## 1. Consultas só de leitura

Rode todas e guarde a saída. **Pare** (não siga para o passo 2) se qualquer
condição de parada abaixo aparecer.

```sql
-- 1.1 Quem está marcado como dono.
SELECT id, slug, name, visibility, public_slug, photo_key, cover_key, created_at
FROM production.candidate
WHERE is_default
ORDER BY id;

-- 1.2 As contas em jogo: a 4 e qualquer uma ligada aos candidatos 2 e 3.
SELECT id, email, roles, candidate_id, disabled_at, created_at
FROM production.auth_user
WHERE id = 4 OR candidate_id IN (2, 3)
ORDER BY id;

-- 1.3 Candidaturas dos candidatos 2 e 3. Precisa voltar vazio (regra 2).
SELECT candidate_id, count(*) AS candidaturas
FROM production.application
WHERE candidate_id IN (2, 3)
GROUP BY candidate_id;

-- 1.4 O que cai junto com os candidatos 2 e 3 (cascade, exceto auth_user).
SELECT 'application (cascade)' AS tabela, count(*) FROM production.application WHERE candidate_id IN (2, 3)
UNION ALL SELECT 'job_score (cascade)', count(*) FROM production.job_score WHERE candidate_id IN (2, 3)
UNION ALL SELECT 'score_cursor (cascade)', count(*) FROM production.score_cursor WHERE candidate_id IN (2, 3)
UNION ALL SELECT 'score_task (cascade)', count(*) FROM production.score_task WHERE candidate_id IN (2, 3)
UNION ALL SELECT 'target_account (cascade)', count(*) FROM production.target_account WHERE candidate_id IN (2, 3)
UNION ALL SELECT 'candidate_document (cascade)', count(*) FROM production.candidate_document WHERE candidate_id IN (2, 3)
UNION ALL SELECT 'candidate_matching_profile (cascade)', count(*) FROM production.candidate_matching_profile WHERE candidate_id IN (2, 3)
UNION ALL SELECT 'target_track (cascade)', count(*) FROM production.target_track WHERE candidate_id IN (2, 3)
UNION ALL SELECT 'saved_term (cascade)', count(*) FROM production.saved_term WHERE candidate_id IN (2, 3)
UNION ALL SELECT 'saved_term_request (cascade)', count(*) FROM production.saved_term_request WHERE candidate_id IN (2, 3)
UNION ALL SELECT 'candidate_skill (cascade)', count(*) FROM production.candidate_skill WHERE candidate_id IN (2, 3)
UNION ALL SELECT 'recruiter_candidate (cascade)', count(*) FROM production.recruiter_candidate WHERE candidate_id IN (2, 3)
UNION ALL SELECT 'auth_user (set null)', count(*) FROM production.auth_user WHERE candidate_id IN (2, 3);

-- 1.5 O que muda ao apagar o usuário 4.
SELECT 'auth_session (cascade)' AS tabela, count(*) FROM production.auth_session WHERE user_id = 4 OR impersonated_by = 4
UNION ALL SELECT 'recruiter_candidate.recruiter_user_id (cascade)', count(*) FROM production.recruiter_candidate WHERE recruiter_user_id = 4
UNION ALL SELECT 'recruiter_candidate.created_by (set null)', count(*) FROM production.recruiter_candidate WHERE created_by = 4
UNION ALL SELECT 'auth_event (set null, auditoria preservada)', count(*) FROM production.auth_event WHERE user_id = 4
UNION ALL SELECT 'job.posted_by_user_id (set null)', count(*) FROM production.job WHERE posted_by_user_id = 4
UNION ALL SELECT 'source_run.actor_user_id (set null)', count(*) FROM production.source_run WHERE actor_user_id = 4
UNION ALL SELECT 'job_analysis.requested_by (set null)', count(*) FROM production.job_analysis WHERE requested_by = 4;

-- 1.6 As FKs reais do banco que apontam para candidate e auth_user.
-- confdeltype: c = cascade, n = set null, r = restrict, a = no action.
SELECT conrelid::regclass AS tabela, conname, confrelid::regclass AS alvo, confdeltype
FROM pg_constraint
WHERE contype = 'f'
  AND confrelid IN ('production.candidate'::regclass, 'production.auth_user'::regclass)
ORDER BY alvo, tabela;
```

**Condições de parada:**

- 1.1 não mostra uma linha com `slug = 'default'`. Sem ela, desmarcar os
  outros deixa a instalação sem dono.
- Os candidatos 2 ou 3 não têm slug começando com `e2e-`, ou têm `photo_key`
  ou `cover_key` preenchidos. Apagar o candidato deixaria o objeto órfão no
  armazenamento.
- 1.2 mostra conta diferente da 4, conta com e-mail que não termina em
  `@local.test`, ou a conta 4 ligada a outro candidato que não o 2 ou o 3.
- 1.3 devolve qualquer linha. Candidatura é a decisão de uma pessoa e não se
  apaga em limpeza (regra 2).
- 1.6 mostra uma tabela que não está em 1.4 ou 1.5, ou um `confdeltype`
  diferente do anotado. Nesse caso o roteiro está desatualizado em relação ao
  schema: corrija-o antes de seguir.

Os efeitos esperados vêm de `src/core/db/schema.ts`. Por cascata indireta,
apagar `application` levaria junto `application_event`, e apagar `target_track`
levaria junto as linhas de `job_score`, `score_cursor` e `saved_term` da
trilha, que já estão contadas em 1.4. `term_attribution`, `term_capture` e
`mail_*` não têm coluna de candidato.

## 2. Limpeza numa transação

Só depois de o passo 1 passar sem nenhuma parada. Cada comando confere de novo
a condição de segurança, de modo que um id trocado não apaga uma pessoa real.

```sql
BEGIN;

-- 2.1 Um dono só: desmarca todo candidato que não é o `default`.
UPDATE production.candidate
SET is_default = false,
    updated_at = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE is_default
  AND slug <> 'default'
  AND EXISTS (SELECT 1 FROM production.candidate WHERE slug = 'default' AND is_default);

-- 2.2 A conta 4. As sessões caem em cascata; auth_event fica, com user_id nulo.
DELETE FROM production.auth_user
WHERE id = 4
  AND lower(email) LIKE '%@local.test'
  AND candidate_id IN (2, 3);

-- 2.3 Os candidatos 2 e 3, só se ainda forem do E2E, sem candidatura e sem
-- conta ligada (uma conta que 2.2 não apagou ficaria sem candidato).
DELETE FROM production.candidate c
WHERE c.id IN (2, 3)
  AND c.slug LIKE 'e2e-%'
  AND NOT EXISTS (SELECT 1 FROM production.application a WHERE a.candidate_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM production.auth_user u WHERE u.candidate_id = c.id);

-- 2.4 Verificação antes do COMMIT.
SELECT id, slug FROM production.candidate WHERE is_default;          -- uma linha: default
SELECT count(*) FROM production.candidate WHERE id IN (2, 3);        -- 0
SELECT count(*) FROM production.auth_user WHERE id = 4;              -- 0
SELECT count(*) FROM production.auth_session WHERE user_id = 4;      -- 0
SELECT count(*) FROM production.auth_event WHERE user_id = 4;        -- 0 (eventos ficam com user_id nulo)
```

Confira a contagem de linhas que cada `UPDATE` e `DELETE` informou: 2.1 deve
mostrar o número de linhas marcadas em 1.1 menos uma, e 2.2 e 2.3 devem
informar 1 e 2. Se algum número divergir, ou a verificação 2.4 não bater, rode
`ROLLBACK;`. Se tudo bater, rode `COMMIT;`.

## 3. Depois

- `pnpm jho auth status`, com `DATABASE_URL` apontada para produção, não lista
  a conta 4. `/admin/users`, em `jobs.mastertimm.com.br`, também não a mostra.
- `pnpm jho stats` continua contando as vagas e o funil do dono como antes.
- A consulta abaixo deve devolver `1`. Ela é o pré-requisito para uma migração
  futura com índice único parcial em `candidate (is_default) WHERE is_default`,
  que fica como decisão pendente do dono. Enquanto houver mais de uma linha
  marcada, essa migração falha.

```sql
SELECT count(*) FROM production.candidate WHERE is_default;
```

Registre o resultado na issue #435.
