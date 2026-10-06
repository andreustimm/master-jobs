---
status: pending
title: "Login social: OIDC, rotas, vínculo automático e provedor falso"
type: backend
complexity: critical
---

# Login social: OIDC, rotas, vínculo automático e provedor falso

## Overview

Liga o Google e o LinkedIn ao login existente: porta `OidcProvider` com
adapters sobre `oauth4webapi`, rotas GET de início e callback, decisão pura
de identidade (entrar, ligar automaticamente, conflito, recusado, cadastro,
e-mail não verificado), botões no `/login` e o provedor OIDC falso do E2E.
Também traz a emenda da regra 1 do LinkedIn, que precisa sair junto.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
1. MUST adicionar `oauth4webapi` (última versão) e implementar `OidcProvider` (Core Interfaces) com PKCE S256, `state`, `nonce` e validação completa do ID token; LinkedIn pede só `openid profile email`.
2. MUST implementar `resolveIdentity` puro e o serviço que aplica a decisão: sessão via `completeLogin`, vínculo automático (`origin=automatic`) só com e-mail verificado igual e conta habilitada sem identidade do provedor; conflito, recusa e não verificado com mensagens neutras (US-001–US-003).
3. MUST criar `GET /login/oauth/[provider]` e `GET /login/oauth/[provider]/callback` com `redirect303`, origem por `resolvePublicOrigin` (G17), `next` só relativo e mesmo domínio, e registrá-las em `proxy.ts`, `PUBLIC_ROUTES` (`tests/architecture.test.ts`), `tests/e2e/routes.mjs` e `config/e2e-spec-map.json`.
4. MUST esconder os botões e recusar o início fora de produção/local ou sem credenciais (ADR-005); o callback de pendência social grava `auth_signup(kind=social)` e redireciona para `/signup` (a tela em si é da task_03).
5. MUST compartilhar a janela de tentativas com o login por senha e registrar `oidc_signin`, `identity_linked`, `oidc_failed` em `auth_event`.
6. MUST criar `tests/e2e/fake-oidc.mjs` no `run-isolated` (só loopback) e aceitar `JHO_OIDC_ISSUER_*` só fora de produção.
7. MUST incluir os arquivos que fazem `fetch` na lista de `tests/outbound-transport-boundary.test.ts`.
8. MUST emendar a regra 1 do `AGENTS.md`, a G01 de `docs/engineering/rules/security.md` e `docs/linkedin-policy.md` no mesmo commit (G62), permitindo OpenID Connect só para autenticação, sem `w_member_social` e sem dado de perfil (ADR-003).
</requirements>

## Subtasks
- [ ] 2.1 Dependência `oauth4webapi`, porta e adapters Google/LinkedIn.
- [ ] 2.2 Decisão pura de identidade e serviço de login/vínculo automático.
- [ ] 2.3 Rotas de início e callback com cookie do fluxo e `next` seguro.
- [ ] 2.4 Botões no `/login`, mensagens de erro do dicionário e estado indisponível.
- [ ] 2.5 Pendência social gravada para o cadastro.
- [ ] 2.6 Eventos de auditoria e janela de tentativas compartilhada.
- [ ] 2.7 Provedor OIDC falso e cenários E2E por papel.
- [ ] 2.8 Registros de rota pública e de transporte de saída.
- [ ] 2.9 Emenda da regra 1, G01 e política do LinkedIn.

## Implementation Details

Seguir "Core Interfaces", "API Endpoints" e "Integration Points" da TechSpec.
Modelo de callback: `app/login/callback/route.ts`; sessão: `src/contexts/auth/app/session.ts` (`completeLogin`).

### Relevant Files
- `src/contexts/auth/ports.ts`, `src/contexts/auth/index.ts` — portas e composição.
- `src/contexts/auth/app/session.ts` — `completeLogin`.
- `src/contexts/auth/infra/password-login.ts` — janela de tentativas.
- `app/login/page.tsx`, `app/login/actions.ts`, `app/login/callback/route.ts` — tela e padrão de callback.
- `proxy.ts`, `tests/architecture.test.ts` (`PUBLIC_ROUTES`), `tests/e2e/routes.mjs`, `config/e2e-spec-map.json`.
- `tests/e2e/run-isolated.mjs`, `tests/e2e/setup.mjs`, `tests/e2e/ui/roles.mjs` — E2E.
- `tests/outbound-transport-boundary.test.ts`.
- `AGENTS.md`, `docs/engineering/rules/security.md`, `docs/linkedin-policy.md`.

### Dependent Files
- `package.json`, `pnpm-lock.yaml` — nova dependência.
- `src/core/i18n/*` — mensagens de login.

### Related ADRs
- [ADR-001](adrs/adr-001.md), [ADR-003](adrs/adr-003.md), [ADR-005](adrs/adr-005.md), [ADR-008](adrs/adr-008.md), [ADR-010](adrs/adr-010.md), [ADR-012](adrs/adr-012.md)

## Deliverables
- Login com Google e LinkedIn funcionando contra o provedor falso, com vínculo automático.
- Regra 1, G01 e política do LinkedIn emendadas.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [ ] UT-020, UT-021, UT-022, UT-023, UT-024, UT-025, UT-026, UT-027, UT-028, UT-029, UT-036, UT-037, UT-038 — decisão de identidade
- [ ] UT-040, UT-041, UT-042, UT-043, UT-044, UT-045, UT-046, UT-047 — adapters OIDC
- [ ] IT-001, IT-002, IT-003, IT-004, IT-005, IT-006, IT-007, IT-008, IT-009, IT-010, IT-011, IT-012, IT-013 — login e vínculo
- [ ] IT-055 — admin entra por login social
- [ ] IT-065, IT-104, IT-105 — rotas e gate de emissor
- [ ] IT-100 — adapter contra o emissor falso
- [ ] E2E-001, E2E-002, E2E-003, E2E-004, E2E-005, E2E-006, E2E-007, E2E-008, E2E-009, E2E-010 — jornadas de login social
- [ ] E2E-022, E2E-023 — disponibilidade dos botões

## Success Criteria
- Every assigned test case implemented and passing
- Nenhuma chamada real a Google ou LinkedIn em teste
- `pnpm check:instructions` verde com a emenda da regra 1
