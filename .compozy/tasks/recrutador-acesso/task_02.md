---
status: pending
title: "Candidato concede, convida, limita e revoga; histórico, admin e varredura"
type: backend
complexity: high
---

# Candidato concede, convida, limita e revoga; histórico, admin e varredura

## Overview

Entrega o lado do candidato e do admin: a seção "Acesso de recrutadores" em
`/account` com concessão por e-mail, convite, data de fim no fuso do
navegador, revogação, reenvio, cancelamento e histórico; os limites
persistentes por candidato; a tela do admin que revoga e cancela; e o job
horário que expira concessões e convites e o expurgo semanal. É o que faz o
consentimento nascer e morrer pela mão do candidato (G25, LGPD art. 18 VII).

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
1. MUST implementar o serviço `src/contexts/auth/app/recruiter-access.ts` e a loja `drizzle-recruiter-access.ts`: conceder, convidar, revogar, alterar data de fim, reenviar, cancelar, dispensar, revogar e cancelar pelo admin, listar e paginar o histórico.
2. MUST tomar `pg_advisory_xact_lock(hashtext('recruiter-access'), candidate_id)` antes de contar e gravar, contando pelo histórico (10 por 24 h com ator candidato) e pelos convites pendentes não expirados (20), sem contar recusas, revogações, cancelamentos nem ações do admin (ADR-017, G13).
3. MUST guardar só o hash SHA-256 do token do convite, com validade de 7 dias; reenvio marca o anterior `superseded` e cria outro na mesma transação.
4. MUST encerrar concessões por UPDATE condicional com histórico na mesma transação; quem perde a corrida recebe `already_ended` e não envia e-mail (ADR-012).
5. MUST enviar os e-mails depois do commit; falha grava `auth_event(email_send_failed)` e, no convite, `delivery_failed_at`, sem desfazer a ação.
6. MUST tirar o candidato só da sessão (G40): toda Server Action chama `guard("access:manage", …)` antes de qualquer efeito; sessão emprestada vê a seção em modo leitura (G24).
7. MUST mostrar a declaração de escopo antes do primeiro acesso e junto do formulário; status sempre em texto; nomes e e-mails com `data-user-content`; confirmação em revogar e cancelar; texto do dicionário; 375 px; `data-testid` (regras 9–11).
8. MUST trocar a remoção de vínculo do admin por revogação de concessão e cancelamento de convite, guardados por `user:manage`, sem nenhuma ação de conceder ou convidar no admin nem na CLI.
9. MUST acrescentar `recruiterAccess` a `SweepDeps` sob `atMostEvery(…, "manutencao:recruiter-access", 1 h)` (expira concessões e convites; o resumo de sugestões é ligado pela task_04) e `purgeDeadInvites` a `runDatabaseCleanup` (ADR-016).
10. MUST registrar as actions e a seção no inventário (`tests/support/entry-inventory.ts`, `PAGE_POLICY`) e criar o spec E2E `tests/e2e/ui/recruiter-access.mjs` com a área no `config/e2e-spec-map.json`.
</requirements>

## Subtasks
- [ ] 2.1 Serviço e loja de concessões e convites com trava, limites e histórico.
- [ ] 2.2 Server Actions do candidato e da área de acesso em `/account` (formulário, lista, convites, histórico paginado).
- [ ] 2.3 Data de fim com fuso do navegador (campo oculto, rótulo do fuso, recaída em UTC).
- [ ] 2.4 Envio dos e-mails pós-commit e registro de falha.
- [ ] 2.5 Revogação e cancelamento pelo admin em `/admin/users`, com nome do admin no histórico.
- [ ] 2.6 Job horário de expiração e expurgo semanal.
- [ ] 2.7 Inventário, fixtures E2E (candidata, recrutador com conta) e cenários por papel.

## Implementation Details

Seguir "Data flow" (itens 1 e 6), "API Endpoints" (linhas de `/account` e
admin) e "Data Models" da TechSpec. A seção mora em
`app/account/recruiter-access.tsx` com actions em
`app/account/recruiter-access-actions.ts`.

### Relevant Files
- `app/account/page.tsx`, `app/account/actions.ts` — página e padrão das actions da conta.
- `app/auth.ts` (via `guard`, `requirePage`, `guardOwnCandidate`) — guardas.
- `src/contexts/auth/infra/password-login.ts` — padrão "grava e depois conta".
- `src/contexts/matching/infra/drizzle-tracks.ts` — uso de `pg_advisory_xact_lock`.
- `src/contexts/auth/infra/resend-mailer.ts`, `ports-mailer.ts` — `Mailer`, `configuredMailer`, `fileMailer`.
- `src/contexts/auth/domain/public-origin.ts` — origem dos links (G17).
- `app/admin/actions.ts` (`unlinkAction` ~209), `app/admin/users/page.tsx`.
- `src/contexts/operations/app/sweep.ts` (`atMostEvery` ~141, `runSweepSlice` ~221), `app/api/cron/varredura/route.ts` — composição.
- `src/core/db/retention.ts` (`runDatabaseCleanup` ~162).
- `tests/entry-denial.test.ts`, `tests/sweep-slice.test.ts`, `tests/db-retention.test.ts`, `tests/e2e/setup.mjs`, `tests/e2e/ui/account.mjs`, `tests/e2e/ui/admin.mjs`.

### Dependent Files
- `src/core/i18n/pt-BR.ts`, `en.ts` — textos `recruiterAccess.*`.
- `tests/support/entry-inventory.ts`, `tests/architecture.test.ts`, `config/e2e-spec-map.json`.
- `src/cli.ts` — conferido para não ganhar verbo de conceder.

### Related ADRs
- [ADR-001](adrs/adr-001.md), [ADR-004](adrs/adr-004.md), [ADR-005](adrs/adr-005.md), [ADR-006](adrs/adr-006.md), [ADR-007](adrs/adr-007.md), [ADR-008](adrs/adr-008.md)
- [ADR-012](adrs/adr-012.md), [ADR-016](adrs/adr-016.md), [ADR-017](adrs/adr-017.md)

## Deliverables
- Seção de acesso funcional em `/account`, com histórico.
- Admin revoga e cancela; ninguém além do candidato concede.
- Expiração horária e expurgo semanal.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [ ] IT-016, IT-017, IT-018, IT-019, IT-020, IT-021, IT-022, IT-023, IT-024, IT-025, IT-026, IT-027 — concessão
- [ ] IT-028, IT-029, IT-030, IT-031, IT-032 — convite
- [ ] IT-033, IT-034, IT-035, IT-036, IT-037 — limites
- [ ] IT-038, IT-039, IT-040, IT-041, IT-042, IT-043 — revogação
- [ ] IT-044, IT-045, IT-046, IT-047, IT-048, IT-049 — data de fim
- [ ] IT-050, IT-051, IT-052, IT-053, IT-054, IT-055 — reenvio, cancelamento e dispensa
- [ ] IT-056, IT-057, IT-058, IT-059, IT-060 — nova concessão, histórico e listas
- [ ] IT-061, IT-062, IT-063, IT-064, IT-065 — varredura e expurgo
- [ ] IT-066, IT-067, IT-068, IT-069, IT-070 — admin
- [ ] IT-071, IT-072, IT-073, IT-074, IT-075, IT-076, IT-077, IT-078 — sessão emprestada, id forjado, CLI e inventário
- [ ] E2E-001, E2E-002, E2E-003, E2E-004, E2E-005, E2E-006 — jornada do candidato
- [ ] E2E-007, E2E-008 — admin e sessão emprestada
- [ ] E2E-009 — 375 px e axe

## Success Criteria
- Every assigned test case implemented and passing
- Revogação corta o acesso na requisição seguinte do recrutador
- Nunca mais que 10 ações contadas por candidato em 24 h, mesmo sob concorrência
- Revisão L2 (auth) com SHIP
