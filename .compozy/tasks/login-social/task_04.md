---
status: completed
title: "Métodos de acesso: conta, admin, CLI, avisos e recuperação"
type: frontend
complexity: high
---

# Métodos de acesso: conta, admin, CLI, avisos e recuperação

## Overview

Dá a cada pessoa e ao admin controle sobre como a conta é acessada: lista
de métodos na `/account` (senha, Google, LinkedIn, datas, origem, versões
aceitas dos termos), ligar e desligar provedor com proteção do último
método, definir a primeira senha, coluna e ação de desligar no admin,
`jho auth methods`/`unlink` na CLI, e-mails de aviso de vínculo e a
recuperação de senha com e-mail localizado.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
1. MUST listar os métodos na `/account` sem expor token, nome, foto ou e-mail de provedor de terceiros (US-010).
2. MUST ligar provedor pela rota `intent=link` (task_02) só com sessão própria, nunca em personificação (G24), e recusar identidade já ligada a outra conta.
3. MUST recusar desligar o último método (sem senha e sem outro provedor), inclusive sob concorrência (lock de linha), para dono, admin e CLI.
4. MUST permitir definir a primeira senha em conta só social, com as regras atuais (mínimo 12).
5. MUST mostrar provedores e senha por conta em `/admin/users` e permitir ao admin desligar (nunca ligar), registrando quem fez; ações chamam `guard(...)` antes de qualquer efeito (regra 15).
6. MUST criar `jho auth methods <email>` e `jho auth unlink <email> <provider>` (sem `link`), documentados em `docs/cli.md`.
7. MUST enviar aviso por e-mail em todo vínculo e desvínculo (automático, manual, admin, CLI), e mover a recuperação de senha para o construtor localizado mantendo G17/G18.
8. MUST cobrir o E2E por papel (G16) e 375 px para as telas alteradas.
</requirements>

## Subtasks
- [x] 4.1 Serviço de métodos: listar, desligar com proteção do último, definir senha.
- [x] 4.2 `/account`: lista, ligar, desligar, definir senha, versões aceitas.
- [x] 4.3 `/admin/users`: coluna de métodos e desligar.
- [x] 4.4 CLI `methods` e `unlink`, com `docs/cli.md`.
- [x] 4.5 Avisos de vínculo por e-mail.
- [x] 4.6 Recuperação de senha com e-mail localizado.
- [x] 4.7 Política (`can`) para as ações novas e E2E por papel.

## Implementation Details

Seguir "API Endpoints" (ações de conta, admin e CLI) e "Monitoring" da TechSpec.

### Relevant Files
- `app/account/*` — tela da conta atual.
- `app/admin/users/*`, `app/admin/actions.ts` — admin de usuários.
- `src/contexts/auth/domain/policy.ts`, `src/contexts/auth/domain/types.ts` — `can()` e ações.
- `src/contexts/auth/app/password-reset.ts`, `src/contexts/auth/infra/password-login.ts` — recuperação e senha.
- `src/cli.ts` (grupo `auth`, linhas ~2245–2456), `tests/cov-cli-harness.ts`, `docs/cli.md`.
- `app/impersonation.ts` — sessão personificada.

### Dependent Files
- `tests/support/entry-inventory.ts`, `tests/architecture.test.ts` — inventário de ações.
- `tests/e2e/ui/roles.mjs`, `tests/e2e/ui/password-reset.mjs`.

### Related ADRs
- [ADR-001](adrs/adr-001.md), [ADR-003](adrs/adr-003.md), [ADR-004](adrs/adr-004.md), [ADR-011](adrs/adr-011.md)

## Deliverables
- Gestão de métodos na conta, no admin e na CLI.
- Avisos de vínculo e recuperação por e-mail localizados.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [x] UT-090, UT-091, UT-092, UT-093, UT-094, UT-095 — política e visão de métodos
- [x] IT-040, IT-041, IT-042, IT-043, IT-044, IT-045 — ligar provedor
- [x] IT-046, IT-047, IT-048, IT-049, IT-050, IT-051 — desligar, senha, listar
- [x] IT-052, IT-053, IT-054 — admin
- [x] IT-060, IT-061, IT-062, IT-063, IT-064 — CLI
- [x] IT-086, IT-087 — avisos de vínculo
- [x] IT-088, IT-089, IT-090, IT-091, IT-092, IT-093 — recuperação de senha
- [x] E2E-016, E2E-017, E2E-018, E2E-019, E2E-020, E2E-021 — conta e admin
- [x] E2E-030 — recuperação de senha

## Success Criteria
- Every assigned test case implemented and passing
- Nenhuma conta fica sem método de acesso
- Nenhuma ação nova sem `guard(...)` ou registro em `UNGUARDED_BY_DESIGN`
