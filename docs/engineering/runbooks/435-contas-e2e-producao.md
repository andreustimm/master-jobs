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

**Os ids não bastam.** A leitura de 01/10 não procurou tudo o que aquele run
cria. O `setup.mjs` de 20/08 (`cc38d200`) semeia cinco contas, todas com a
senha `conta-de-teste-e2e-42`, que está publicada em `tests/e2e/ui.mjs` num
repositório público:

| Conta | Papéis | Candidato criado |
| --- | --- | --- |
| `e2e@local.test` | admin, candidate | o `default` (via `seedOwner`) |
| `e2e-candidato@local.test` | candidate | `e2e-e2e-candidato` |
| `e2e-recrutador@local.test` | recruiter | nenhum |
| `e2e-alvo@local.test` | candidate | `e2e-e2e-alvo` |
| `e2e-desabilitada@local.test` | candidate (desabilitada) | `e2e-e2e-desabilitada` |

Por isso este roteiro procura pela **assinatura** do E2E, não pelos ids: conta
com e-mail em `@local.test` (domínio reservado, nenhuma pessoa real o usa) e
candidato com slug `e2e-%`. Os ids 4, 2 e 3 são só o que já se viu.

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

Rode todas e guarde a saída. **Pare** (não siga para o passo 3) se qualquer
condição de parada abaixo aparecer. A contenção do passo 2 vale mesmo assim.

```sql
-- 1.1 Quem está marcado como dono.
SELECT id, slug, name, visibility, public_slug, photo_key, cover_key, created_at
FROM production.candidate
WHERE is_default
ORDER BY id;

-- 1.2 Toda conta do E2E (e-mail em @local.test) e toda conta ligada a um
-- candidato do E2E, com e sem senha. Inclui a conta 4 e a do recrutador, que
-- não tem candidato.
SELECT u.id, u.email, u.roles, u.candidate_id, c.slug AS candidate_slug,
       u.password_hash IS NOT NULL AS tem_senha, u.disabled_at, u.created_at
FROM production.auth_user u
LEFT JOIN production.candidate c ON c.id = u.candidate_id
WHERE lower(u.email) LIKE '%@local.test'
   OR c.slug LIKE 'e2e-%'
ORDER BY u.id;

-- 1.3 Todo candidato do E2E, não só o 2 e o 3.
SELECT id, slug, name, is_default, visibility, public_slug, photo_key, cover_key, created_at
FROM production.candidate
WHERE slug LIKE 'e2e-%'
ORDER BY id;

-- 1.4 Candidaturas dos candidatos do E2E. Precisa voltar vazio (regra 2).
SELECT candidate_id, count(*) AS candidaturas
FROM production.application
WHERE candidate_id IN (SELECT id FROM production.candidate WHERE slug LIKE 'e2e-%')
GROUP BY candidate_id;

-- 1.5 O que cai junto com os candidatos do E2E (cascade, exceto auth_user).
WITH e2e AS (SELECT id FROM production.candidate WHERE slug LIKE 'e2e-%')
SELECT 'application (cascade)' AS tabela, count(*) FROM production.application WHERE candidate_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'job_score (cascade)', count(*) FROM production.job_score WHERE candidate_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'score_cursor (cascade)', count(*) FROM production.score_cursor WHERE candidate_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'score_task (cascade)', count(*) FROM production.score_task WHERE candidate_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'target_account (cascade)', count(*) FROM production.target_account WHERE candidate_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'candidate_document (cascade)', count(*) FROM production.candidate_document WHERE candidate_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'candidate_matching_profile (cascade)', count(*) FROM production.candidate_matching_profile WHERE candidate_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'target_track (cascade)', count(*) FROM production.target_track WHERE candidate_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'saved_term (cascade)', count(*) FROM production.saved_term WHERE candidate_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'saved_term_request (cascade)', count(*) FROM production.saved_term_request WHERE candidate_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'candidate_skill (cascade)', count(*) FROM production.candidate_skill WHERE candidate_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'recruiter_candidate (cascade)', count(*) FROM production.recruiter_candidate WHERE candidate_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'auth_user (set null)', count(*) FROM production.auth_user WHERE candidate_id IN (SELECT id FROM e2e);

-- 1.6 O que muda ao apagar as contas @local.test.
WITH e2e AS (SELECT id FROM production.auth_user WHERE lower(email) LIKE '%@local.test')
SELECT 'auth_session (cascade)' AS tabela, count(*) FROM production.auth_session WHERE user_id IN (SELECT id FROM e2e) OR impersonated_by IN (SELECT id FROM e2e)
UNION ALL SELECT 'recruiter_candidate.recruiter_user_id (cascade)', count(*) FROM production.recruiter_candidate WHERE recruiter_user_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'recruiter_candidate.created_by (set null)', count(*) FROM production.recruiter_candidate WHERE created_by IN (SELECT id FROM e2e)
UNION ALL SELECT 'auth_event (set null, auditoria preservada)', count(*) FROM production.auth_event WHERE user_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'job.posted_by_user_id (set null)', count(*) FROM production.job WHERE posted_by_user_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'source_run.actor_user_id (set null)', count(*) FROM production.source_run WHERE actor_user_id IN (SELECT id FROM e2e)
UNION ALL SELECT 'job_analysis.requested_by (set null)', count(*) FROM production.job_analysis WHERE requested_by IN (SELECT id FROM e2e);

-- 1.7 As FKs reais do banco que apontam para candidate e auth_user.
-- confdeltype: c = cascade, n = set null, r = restrict, a = no action.
SELECT conrelid::regclass AS tabela, conname, confrelid::regclass AS alvo, confdeltype
FROM pg_constraint
WHERE contype = 'f'
  AND confrelid IN ('production.candidate'::regclass, 'production.auth_user'::regclass)
ORDER BY alvo, tabela;
```

O esperado, pela tabela acima: em 1.2, até cinco contas `@local.test`; em 1.3,
até três candidatos `e2e-e2e-…`. Conta ou candidato com a assinatura e id fora
de {4} e {2, 3} **entra na limpeza**, não é exceção: a limpeza do passo 3 mira
a assinatura inteira.

**Condições de parada:**

- 1.1 não mostra uma linha com `slug = 'default'`. Sem ela, desmarcar os
  outros deixa a instalação sem dono.
- Você entra em produção com uma conta `@local.test`. Crie antes a sua conta
  real (`jho auth add-user` e `jho auth set-password`), porque os passos 2 e 3
  desligam e apagam todas elas.
- 1.2 mostra conta cujo e-mail não termina em `@local.test` ligada a um
  candidato `e2e-%` (uma pessoa real num candidato do E2E), ou conta
  `@local.test` ligada a candidato que não é `e2e-%` nem o `default`.
- 1.3 mostra candidato com `photo_key` ou `cover_key` preenchidos. Apagá-lo
  deixaria o objeto órfão no armazenamento.
- 1.4 devolve qualquer linha. Candidatura é a decisão de uma pessoa e não se
  apaga em limpeza (regra 2).
- 1.7 mostra uma tabela que não está em 1.5 ou 1.6, ou um `confdeltype`
  diferente do anotado. Nesse caso o roteiro está desatualizado em relação ao
  schema: corrija-o antes de seguir.

Os efeitos esperados vêm de `src/core/db/schema.ts`. Por cascata indireta,
apagar `application` levaria junto `application_event`, e apagar `target_track`
levaria junto as linhas de `job_score`, `score_cursor` e `saved_term` da
trilha, que já estão contadas em 1.5. `term_attribution`, `term_capture` e
`mail_*` não têm coluna de candidato.

## 2. Contenção imediata

Rode logo depois de 1.2, **mesmo que uma condição de parada tenha aparecido**:
toda conta `@local.test` com senha definida entra com uma senha publicada, e
`e2e@local.test` é admin. A contenção desliga a conta (`disabled_at`, que o
login e a carga de sessão recusam), apaga a senha e derruba as sessões, sem
apagar nada que o passo 1 ainda precise conferir.

```sql
BEGIN;

-- 2.1 Desliga e tira a senha de toda conta do E2E.
UPDATE production.auth_user
SET disabled_at = coalesce(disabled_at,
      to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    password_hash = NULL
WHERE lower(email) LIKE '%@local.test';

-- 2.2 Derruba as sessões delas, inclusive a de quem elas assumiram.
DELETE FROM production.auth_session
WHERE user_id IN (SELECT id FROM production.auth_user WHERE lower(email) LIKE '%@local.test')
   OR impersonated_by IN (SELECT id FROM production.auth_user WHERE lower(email) LIKE '%@local.test');

-- 2.3 Verificação: nenhuma linha.
SELECT id, email FROM production.auth_user
WHERE lower(email) LIKE '%@local.test'
  AND (disabled_at IS NULL OR password_hash IS NOT NULL);
```

2.1 deve informar o número de contas `@local.test` de 1.2. Se bater e 2.3
voltar vazia, rode `COMMIT;`; senão, `ROLLBACK;`.

## 3. Limpeza numa transação

Só depois de o passo 1 passar sem nenhuma parada. Cada comando confere de novo
a condição de segurança, de modo que uma linha inesperada não apaga uma pessoa
real.

```sql
BEGIN;

-- 3.1 Um dono só: desmarca todo candidato que não é o `default`.
UPDATE production.candidate
SET is_default = false,
    updated_at = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE is_default
  AND slug <> 'default'
  AND EXISTS (SELECT 1 FROM production.candidate WHERE slug = 'default' AND is_default);

-- 3.2 Toda conta do E2E, inclusive a do recrutador (sem candidato) e a ligada
-- ao `default`. As sessões caem em cascata; auth_event fica, com user_id nulo.
DELETE FROM production.auth_user u
WHERE lower(u.email) LIKE '%@local.test'
  AND (u.candidate_id IS NULL
       OR u.candidate_id IN (SELECT id FROM production.candidate
                             WHERE slug LIKE 'e2e-%' OR slug = 'default'));

-- 3.3 Todo candidato do E2E, só sem candidatura, sem arquivo no armazenamento
-- e sem conta ligada (uma conta que 3.2 não apagou ficaria sem candidato).
DELETE FROM production.candidate c
WHERE c.slug LIKE 'e2e-%'
  AND c.photo_key IS NULL
  AND c.cover_key IS NULL
  AND NOT EXISTS (SELECT 1 FROM production.application a WHERE a.candidate_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM production.auth_user u WHERE u.candidate_id = c.id);

-- 3.4 Verificação antes do COMMIT.
SELECT id, slug FROM production.candidate WHERE is_default;                       -- uma linha: default
SELECT count(*) FROM production.candidate WHERE slug LIKE 'e2e-%';                -- 0
SELECT count(*) FROM production.auth_user WHERE lower(email) LIKE '%@local.test'; -- 0
SELECT count(*) FROM production.auth_event
WHERE lower(email) LIKE '%@local.test' AND user_id IS NOT NULL;                   -- 0 (eventos ficam com user_id nulo)
```

Confira a contagem de linhas que cada `UPDATE` e `DELETE` informou: 3.1 deve
mostrar o número de linhas marcadas em 1.1 menos uma, 3.2 o número de contas
`@local.test` de 1.2, e 3.3 o número de candidatos de 1.3. Se algum número
divergir, ou a verificação 3.4 não bater, rode `ROLLBACK;`. Se tudo bater, rode
`COMMIT;`.

## 4. Depois

- `pnpm jho auth status`, com `DATABASE_URL` apontada para produção, não lista
  nenhuma conta `@local.test`. `/admin/users`, em `jobs.mastertimm.com.br`,
  também não.
- `pnpm jho stats` continua contando as vagas e o funil do dono como antes.
- A consulta abaixo deve devolver `1`. Ela é o pré-requisito para uma migração
  futura com índice único parcial em `candidate (is_default) WHERE is_default`,
  que fica como decisão pendente do dono. Enquanto houver mais de uma linha
  marcada, essa migração falha.

```sql
SELECT count(*) FROM production.candidate WHERE is_default;
```

Registre o resultado na issue #435, inclusive o que 1.2 e 1.3 mostraram além
dos ids 4, 2 e 3.
