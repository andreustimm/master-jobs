---
status: pending
title: "Cadastro em tela única (social e manual com código)"
type: frontend
complexity: high
---

# Cadastro em tela única (social e manual com código)

## Overview

Entrega o cadastro no padrão da Tecla: a tela `/signup`, que aceita a
pendência social (e-mail verificado) ou o formulário manual, escolhe
Candidato ou Recrutador, recebe nome, título e CV e o aceite dos termos; a
etapa `/signup/verify` com código de 6 dígitos; o limite por IP; a criação
de conta e perfil numa transação só; o e-mail de boas-vindas; o estado vazio
do recrutador; e as páginas públicas `/terms` e `/privacy`.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
1. MUST implementar as regras puras de `signup-rules` (papel, expiração, código, tentativas, reenvio, limite) e o serviço `signup.ts` com `SignupResult` (Core Interfaces).
2. MUST criar conta, identidade (social) e candidato com o CV como primeira versão numa **única** transação, reaproveitando `parseOwnProfile`, `readCvPdf` e `insertOwnCandidate`; papel admin nunca é aceito.
3. MUST aplicar o limite de 3 cadastros concluídos por `ip_hmac` por hora (configurável), reservando antes do `await` sob concorrência (G13), sem gravar IP cru.
4. MUST tratar e-mail já cadastrado no cadastro manual sem revelar: mesma tela, e-mail "conta já existe" sem código.
5. MUST deixar o cadastro manual indisponível no Preview com aviso, e o social conforme ADR-005.
6. MUST registrar `/signup`, `/signup/verify`, `/terms`, `/privacy` e as Server Actions públicas em `proxy.ts`, `PAGE_POLICY`, `UNGUARDED_BY_DESIGN`, `tests/e2e/routes.mjs` e `config/e2e-spec-map.json`; toda tela a 375 px, com texto do dicionário e `data-testid` (regras 9–11).
7. MUST seguir o layout da ADR-007 (formulário + painel de marca) com tokens do tema (regra 10).
8. MUST enviar boas-vindas só para conta criada por cadastro, no idioma escolhido; falha de envio não bloqueia (grava `email_send_failed`).
9. MUST atualizar `docs/product/vision.md`, personas e a doc de primeiro acesso: o cadastro aberto existe para candidato e recrutador.
</requirements>

## Subtasks
- [ ] 3.1 Regras puras de cadastro e código.
- [ ] 3.2 Serviço de cadastro (início manual, código, reenvio, confirmação, conclusão social) e loja.
- [ ] 3.3 Limite por IP com reserva sob concorrência.
- [ ] 3.4 Tela `/signup` (modo social e manual) e `/signup/verify`.
- [ ] 3.5 Boas-vindas e "conta já existe".
- [ ] 3.6 Estado vazio do recrutador.
- [ ] 3.7 Páginas `/terms` e `/privacy`.
- [ ] 3.8 Registros de rota/ação pública e E2E.
- [ ] 3.9 Docs de produto (visão, personas, primeiro acesso).

## Implementation Details

Seguir "Data flow" (itens 2 e 3), "API Endpoints" e "Data Models" da TechSpec.

### Relevant Files
- `app/candidate/create-profile.tsx`, `app/candidate/actions.ts` — onboarding atual a reaproveitar.
- `src/core/candidate-identity.ts` (`parseOwnProfile`, `CV_MIN`, `CV_PDF_MAX_MB`), `src/core/pdf.ts` (`readCvPdf`), `src/core/candidate.ts` (`insertOwnCandidate`, `requestCvRescore`).
- `src/contexts/auth/infra/drizzle-directory.ts` — transação com `FOR UPDATE`, `createUser`.
- `src/contexts/auth/domain/password.ts` — hash scrypt.
- `src/core/rate-limit.ts` (`clientKey`) — IP do cliente.
- `app/login/page.tsx` — padrão visual; `DESIGN.md`, `app/themes.css`.
- `proxy.ts`, `tests/architecture.test.ts`, `tests/support/entry-inventory.ts`, `tests/e2e/routes.mjs`, `config/e2e-spec-map.json`.
- `docs/product/vision.md`, `docs/product/personas.md`.

### Dependent Files
- `app/score-queue-drain.ts` — fila de score após CV.
- `src/core/i18n/*` — textos de cadastro.

### Related ADRs
- [ADR-002](adrs/adr-002.md), [ADR-006](adrs/adr-006.md), [ADR-007](adrs/adr-007.md), [ADR-009](adrs/adr-009.md), [ADR-011](adrs/adr-011.md), [ADR-012](adrs/adr-012.md)

## Deliverables
- Cadastro social e manual funcionando ponta a ponta, com perfil e CV.
- Páginas legais públicas.
- Docs de produto atualizadas.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [ ] UT-060, UT-061, UT-062, UT-063, UT-064, UT-065, UT-066, UT-067, UT-068, UT-069 — regras de cadastro e limite
- [ ] UT-070, UT-071, UT-072, UT-073, UT-074, UT-075, UT-076, UT-077, UT-078, UT-079 — cadastro manual e código
- [ ] IT-020, IT-021, IT-022, IT-023, IT-024, IT-025, IT-026, IT-027, IT-028, IT-029, IT-030, IT-031 — conclusão do cadastro
- [ ] IT-032, IT-033, IT-034, IT-035 — limite por IP e não criação por login
- [ ] IT-066 — recrutador com acesso não vê estado vazio
- [ ] IT-070, IT-071, IT-072, IT-073, IT-074, IT-076, IT-077, IT-078, IT-079, IT-080, IT-081, IT-082, IT-083 — código e confirmação
- [ ] IT-084, IT-085 — boas-vindas e falha de envio
- [ ] IT-094 — versões legais
- [ ] E2E-011, E2E-012, E2E-013, E2E-014, E2E-015 — cadastro social e recusas
- [ ] E2E-024 — 375 px e axe das telas novas
- [ ] E2E-025, E2E-026, E2E-027, E2E-028, E2E-029 — cadastro manual com código
- [ ] E2E-031 — páginas legais

## Success Criteria
- Every assigned test case implemented and passing
- Conta e perfil nunca existem pela metade (transação única)
- Nenhum IP cru gravado
