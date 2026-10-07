---
status: pending
title: "Convite: página sob /signup e conclusão no cadastro e no login"
type: backend
complexity: high
---

# Convite: página sob /signup e conclusão no cadastro e no login

## Overview

Fecha o caminho de quem recebeu o convite: a página pública
`/signup/invite?token=…`, o cookie que atravessa o cadastro social, a
conclusão quando uma conta de recrutador prova o e-mail convidado (no fim do
cadastro da #464, no login e pelo botão "Aceitar e abrir") e as mensagens de
chegada (ADR-018). O acesso alcança só o endereço que o candidato digitou.

**Bloqueio:** só começa depois que a task_03 de `.compozy/tasks/login-social/`
(tela `/signup`, `src/contexts/auth/app/signup.ts`) estiver mesclada em `dev`.

<critical>
- ALWAYS READ the PRD, the TechSpec, and their catalogs (`_user_stories.md`, `_tests.md`) before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — implement every test case assigned in ## Tests
</critical>

<requirements>
1. MUST responder com a MESMA página neutra para token expirado, usado, substituído, cancelado, desconhecido ou de candidato desabilitado/removido (sem revelar existência).
2. MUST guardar o token cru só no cookie httpOnly `jho_invite` (`SameSite=Lax`, validade ≤ a do convite) e nunca em log; o banco tem só o hash (G18, regra 16).
3. MUST implementar `completeInvitesForAccount(userId, cookieToken | null)` sob a trava do candidato: exige papel de recrutador, conta ativa e e-mail verificado (ou o token válido do mesmo e-mail no `acceptInviteAction`, que então grava `email_verified_at`); queima o convite ANTES de criar a concessão; copia `access_expires_at`/`expiry_tz`; conclui todo convite pendente e válido para o e-mail; grava histórico e envia o e-mail de acesso concedido.
4. MUST chamar a conclusão no fim do cadastro de recrutador (social e manual, depois do commit da conta) e depois de todo login bem-sucedido de conta com papel de recrutador (senha, link e OIDC).
5. MUST levar ao `/recruiter/<candidateId>` quando o convite do cookie concluir e a `/recruiter?invite=mismatch|not_recruiter|period_over|invalid` nos outros casos, com o texto do dicionário; o descompasso grava `auth_event(invite_mismatch)` sem dado do candidato.
6. MUST tratar os estados com sessão: e-mail igual com papel → botão "Aceitar e abrir" (Server Action); outro e-mail → mensagem com e-mail mascarado; e-mail igual sem papel → "precisa de conta de recrutador". Nenhum altera dado.
7. MUST registrar `/signup/invite` em `proxy.ts` e `PUBLIC_ROUTES`, `startInvitedSignup` em `UNGUARDED_BY_DESIGN` com o controle que substitui a sessão, e a rota em `tests/e2e/routes.mjs` (ou `UNMEASURED_PAGES` com motivo); 375 px, dicionário, `data-testid`.
8. MUST atualizar `docs/qa/personas.md` ("Recrutadora convidada") e a jornada de QA do convite.
</requirements>

## Subtasks
- [ ] 3.1 Página `/signup/invite` com estados sem sessão, com sessão e neutro.
- [ ] 3.2 `startInvitedSignup` e o cookie; integração com a tela `/signup` (Recrutador pré-selecionado, "Convidado por").
- [ ] 3.3 `completeInvitesForAccount` com queima antes da concessão e cópia da data de fim.
- [ ] 3.4 Ganchos no fim do cadastro e no login; `acceptInviteAction`.
- [ ] 3.5 Mensagens de chegada em `/recruiter` e evento de descompasso.
- [ ] 3.6 Inventário de rota pública e spec E2E `tests/e2e/ui/recruiter-invite.mjs`.
- [ ] 3.7 Docs de QA (persona e jornada do convite).

## Implementation Details

Seguir a ADR-018 e as linhas de `/signup/invite`, `startInvitedSignup` e
`acceptInviteAction` em "API Endpoints" da TechSpec. A busca por hash e a
conclusão usam a loja da task_02.

### Relevant Files
- `app/login/reset/page.tsx` — token na query, conferido antes de mostrar o formulário.
- `src/contexts/auth/infra/flow-cookie.ts` — cookie que sobrevive à ida ao provedor.
- `app/signup/*`, `src/contexts/auth/app/signup.ts` — entregues pela task_03 do login social.
- `app/login/actions.ts`, `app/login/oauth/[provider]/callback` (#464), `src/contexts/auth/infra/password-login.ts`, `drizzle-store.ts` — caminhos de login.
- `proxy.ts`, `tests/architecture.test.ts` (`PUBLIC_ROUTES`), `tests/support/entry-inventory.ts`, `tests/e2e/routes.mjs`, `config/e2e-spec-map.json`.
- `tests/e2e/fake-oidc.mjs` e `JHO_MAIL_SINK` (#464).

### Dependent Files
- `app/recruiter/page.tsx` — aviso de chegada (`?invite=`).
- `src/core/i18n/pt-BR.ts`, `en.ts` — textos `recruiterInvite.*`.
- `docs/qa/personas.md`, `docs/qa/` (jornadas).

### Related ADRs
- [ADR-001](adrs/adr-001.md), [ADR-006](adrs/adr-006.md), [ADR-018](adrs/adr-018.md)

## Deliverables
- Convite aceito pelo cadastro social, manual ou pelo login, só com o e-mail convidado.
- Página pública registrada e sem vazamento de existência.
- Every test case assigned in `## Tests` implemented and passing **(REQUIRED)**

## Tests

Cases assigned from `_tests.md`, the test contract — read each ID's full definition there before writing tests.

- [ ] IT-079, IT-080, IT-081, IT-082 — página e cookie
- [ ] IT-083, IT-084, IT-085, IT-086, IT-087, IT-088 — conclusão no cadastro e e-mail
- [ ] IT-089, IT-090, IT-091, IT-092 — convite morto, período encerrado, data copiada, duas abas
- [ ] IT-093, IT-094, IT-095, IT-096, IT-097 — conta existente e estados com sessão
- [ ] IT-098, IT-099, IT-100, IT-101, IT-102 — token fora do log, limites da #464, reativação, e-mail não verificado, inventário
- [ ] E2E-010, E2E-011 — convite por cadastro social e manual
- [ ] E2E-012, E2E-013, E2E-014 — outro e-mail, link inválido, sessão de outra conta
- [ ] E2E-015 — 375 px e axe

## Success Criteria
- Every assigned test case implemented and passing
- Link encaminhado a outro endereço nunca dá acesso
- Nenhum token cru em log ou banco
- Revisão L2 (auth, rota pública) com SHIP
