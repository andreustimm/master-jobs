# QA Run Report — 2026-08-24-navigation-final-bf19bba-7c9e2a41

- **Scope:** `bf19bba` — readiness por commit sem root streaming, normalização `_rsc`, preservação de status e gate PWA fail-capable.
- **Cadence tier:** targeted
- **Build:** `bf19bba` · **Environment:** `http://127.0.0.1:3016`, build Next de produção e SQLite isolado.
- **Started:** 2026-08-24T16:25:00Z · **Status:** closed

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Candidato por teclado | `docs/qa/personas.md` | Chromium 1280×900 / loopback / en-US | CH-keyboard-navigation-feature |

## Flows in Scope

- `J-switch-workspace-screen` — confirmar navegação operável e responsiva no build que restaurou o gesto de zoom.

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-keyboard-navigation-feature | J-switch-workspace-screen / NAV-accessible-mobile-transition | Candidato por teclado | Feature Tour | Pass | | bf19bba |

## Session Debrief

- **Ran:** 2026-08-24T17:48:00Z → 2026-08-24T17:52:00Z (box respected: yes).
- **Findings:** nenhum. A candidata entrou pela UI real, alcançou Jobs e ativou Pipeline usando apenas Tab e Enter. O foco visível estava em Pipeline antes da ação e avançou para Referrals no destino, sem prisão ou overlay residual.
- **Observable:** URL final `/pipeline`; heading `Pipeline`; Voltar chegou a `/jobs`; Avançar e reload restauraram `/pipeline`; árvore acessível permaneceu operável; console e erros do navegador vazios.
- **Edges attempted:** login por teclado, recarga antes da navegação, continuação do Tab após o destino, Voltar, Avançar, reload e deep-link preservado.
- **Evidence:** `docs/qa/evidence/2026-08-24-navigation-final-bf19bba-7c9e2a41/CH-keyboard-navigation-feature-focus.png`; `docs/qa/evidence/2026-08-24-navigation-final-bf19bba-7c9e2a41/CH-keyboard-navigation-feature-destination.png`.
- **Automation corroboration:** `rtk pnpm check` no commit atual aprovou 148 arquivos e 2.083 testes; `rtk pnpm test:pwa-browser` aprovou 22/22. O E2E mede `touch-action: auto`, contenção móvel/desktop em 200%, status canônicos e a mensagem `_rsc` normalizada.
- **Bugs filed/updated:** nenhum.
- **Scenarios settled:** NAV-accessible-mobile-transition → Pass.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-switch-workspace-screen | pass | pass | pass | pass | pass | pass com lacuna física | foco antes/depois, URL, back/forward/reload e console limpo no build bf19bba |

## Human Verifications Needed

- [ ] No Full QA de staging, confirmar pinch zoom e VoiceOver em iPhone físico; o gesto permitido e a geometria já estão cobertos no Chromium do build atual.

## Final Status

- **Exit gate:** `rtk pnpm check` — 148/148 arquivos e 2.083 testes aprovados, 6 pulados, 13/13 contratos QA; `rtk pnpm test:e2e` — 178/178 e 8/8 páginas axe WCAG 2.2 AA; `rtk pnpm test:pwa-browser` — 22/22.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 · Friction 0 · Cosmetic 0.
- **Verdict:** ready para o escopo targeted; pinch e VoiceOver em iPhone físico permanecem no Full QA de staging.
