---
status: pending
title: "Fundação: tabelas, cópia dos vínculos, predicado de acesso, política e e-mails"
type: backend
complexity: critical
---

# Fundação: tabelas, cópia dos vínculos, predicado de acesso, política e e-mails

## Overview

Cria o contrato de que todas as outras tarefas dependem: as seis tabelas
aditivas (ADR-011) com a cópia dos vínculos de `recruiter_candidate` para
`recruiter_grant`, o predicado único de acesso em `linkedCandidatesFor` e nas
leituras do admin (ADR-012), as regras puras de acesso, as quatro ações novas
da política e os construtores de e-mail do recrutador. Depois dela o sistema
se comporta como hoje para quem já tem vínculo, mas o acesso passa a ler
concessões com estado e prazo.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
1. MUST criar `recruiter_grant`, `recruiter_invite`, `recruiter_access_event`, `recruiter_suggestion`, `recruiter_suggestion_by` e `recruiter_directory_query` com as colunas, CHECKs, únicos parciais e `ON DELETE` da ADR-011, no schema e no DDL (G20), numa migração só, aditiva.
2. MUST copiar cada linha de `recruiter_candidate` para `recruiter_grant` (`active`, sem fim, e-mail de `auth_user`, `created_by`/`created_at` preservados) com um evento `grant_created` de ator `system`, na mesma migração; `recruiter_candidate` fica sem leitura nem escrita e NÃO é removida.
3. MUST fazer `linkedCandidatesFor` ler só concessões `active` com `expires_at` nulo ou futuro (relógio de `clock()`), mantendo `[]` sem papel de recrutador; `linkedCandidates`/`linksOf` usam o mesmo predicado.
4. MUST trocar `unlinkById` (DELETE) por `revokeGrant(grantId, by)` — UPDATE condicional em `status = 'active'` com histórico na mesma transação — e encerrar as concessões ativas como `ended_account_removed` dentro de `UserDirectory.remove`.
5. MUST manter `linkRecruiterToCandidate` só para fixtures, gravando concessão ativa com evento `system`.
6. MUST implementar as funções puras de `src/contexts/auth/domain/recruiter-access.ts` da seção Core Interfaces (sem banco, rede nem relógio implícito — G05).
7. MUST acrescentar `access:manage`, `suggestion:create`, `suggestion:decide` e `candidate:discover` a `ACTIONS` e decidi-las em `can()` como na TechSpec; `access:manage` e `suggestion:decide` negam sessão emprestada (G24).
8. MUST criar `src/contexts/auth/app/recruiter-emails.ts` com os construtores localizados (pt-BR e en) e as chaves `email.recruiter.*` no dicionário (regra 9), sem CV, funil, notas nem token fora do link.
9. MUST registrar a regra de arquitetura (IT-015): só os três arquivos de infra importam `recruiterGrant`; ninguém atualiza nem apaga `recruiter_access_event`; ninguém mais importa `recruiterCandidate`.
</requirements>

## Subtasks
- [ ] 1.1 Tabelas, restrições e migração com a cópia dos vínculos, mais o teste de upgrade.
- [ ] 1.2 Predicado de acesso em `linkedCandidatesFor` e nas leituras do admin.
- [ ] 1.3 `revokeGrant`, encerramento na remoção de conta e ajuste da porta `UserDirectory`.
- [ ] 1.4 Regras puras de acesso (e-mail, data de fim e fuso, alvo, limite, convite, exibição, máscara).
- [ ] 1.5 Quatro ações novas na política, com testes de tabela.
- [ ] 1.6 Construtores de e-mail do recrutador e chaves do dicionário.
- [ ] 1.7 Fixture `linkRecruiterToCandidate` e testes de arquitetura das tabelas novas.

## Implementation Details

Seguir "Data Models", "Core Interfaces" e "Component Overview" da TechSpec e
as ADR-011 e ADR-012. A migração entra como próximo número em
`drizzle/postgres/` e é registrada onde as migrações de produção são
selecionadas (`select-production.ts`, como na #464).

### Relevant Files
- `src/core/db/schema.ts` — `recruiterCandidate` (~1644), `authUser`, `application`, `job`, `candidate`; padrão de comentário das tabelas.
- `drizzle/postgres/0035_login_social.sql` e `meta/` — última migração aditiva como modelo.
- `src/contexts/auth/infra/drizzle-store.ts` — `linkedCandidatesFor` (~71), `resolve()`.
- `src/contexts/auth/infra/drizzle-directory.ts` — `linkedCandidates`, `linksOf`, `linkCandidate`, `unlinkById`, `remove`.
- `src/contexts/auth/ports.ts` — `UserDirectory` (~140-160).
- `src/contexts/auth/index.ts` — `linkRecruiterToCandidate`, `removeRecruiterLink`.
- `src/contexts/auth/domain/types.ts`, `policy.ts` — `ACTIONS`, `ADMIN_ACTIONS`, `can()`.
- `src/contexts/auth/app/account-emails.ts` — padrão `compose()`/`formatMoment()`.
- `src/core/i18n/pt-BR.ts`, `en.ts` — chaves `email.*`.
- `tests/migration-target-tracks.test.ts` — padrão de teste de migração com dado.
- `tests/auth-policy.test.ts`, `tests/auth-session.test.ts`, `tests/cov-auth-directory.test.ts`, `tests/architecture.test.ts`.

### Dependent Files
- `app/admin/actions.ts` (`unlinkAction`) e `app/admin/users/page.tsx` — passam a usar `revokeGrant`; a UI nova de admin é da task_02.
- `tests/e2e/setup.mjs` (~696-701) — fixture continua chamando `linkRecruiterToCandidate`.
- `tests/impersonation.test.ts`, `tests/cov-auth-session-app.test.ts` — fakes de `UserDirectory`.
- `src/contexts/auth/infra/password-login.ts` — consome `linkedCandidatesFor`.

### Related ADRs
- [ADR-011](adrs/adr-011.md) — tabelas e cópia.
- [ADR-012](adrs/adr-012.md) — predicado e encerramento por UPDATE.
- [ADR-008](adrs/adr-008.md) — admin revoga, nunca concede.
- [ADR-013](adrs/adr-013.md) — ação `candidate:discover`.

## Deliverables
- Migração aditiva com cópia dos vínculos e teste de upgrade.
- Predicado único de acesso e revogação por UPDATE.
- Regras puras, política e e-mails prontos para as tarefas seguintes.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [ ] UT-001, UT-002, UT-003, UT-004, UT-005, UT-006 — normalização de e-mail
- [ ] UT-007, UT-008, UT-009, UT-010, UT-011, UT-012, UT-013, UT-014 — data de fim e fuso
- [ ] UT-015, UT-016, UT-017, UT-018, UT-019, UT-020 — alvo da concessão
- [ ] UT-021, UT-022, UT-023 — limite em janela móvel
- [ ] UT-024, UT-025, UT-026, UT-027, UT-028, UT-029, UT-030, UT-031, UT-032 — conclusão de convite
- [ ] UT-033, UT-034 — exibição e máscara
- [ ] UT-035, UT-036, UT-037, UT-038, UT-039, UT-040, UT-041, UT-042 — política
- [ ] UT-043, UT-044, UT-045, UT-046, UT-047, UT-048, UT-049 — e-mails do recrutador
- [ ] IT-001, IT-002, IT-003, IT-004 — migração, FKs e restrições
- [ ] IT-005, IT-006, IT-007, IT-008, IT-009, IT-010 — predicado de acesso
- [ ] IT-011, IT-012, IT-013, IT-014, IT-015 — revogação do admin, remoção de conta, fixture e arquitetura

## Success Criteria
- Every assigned test case implemented and passing
- Recrutador com vínculo antigo continua vendo o mesmo candidato depois da migração
- Nenhuma leitura de `recruiter_candidate` restante no código
- Revisão L2 (schema, auth) com SHIP
