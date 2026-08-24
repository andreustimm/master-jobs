# QA report: 2026-08-23 — task-02-loading-transicoes

## Scope and Preconditions

- Tier: targeted — `J-switch-workspace-screen` plus adjacent canary `J-open-dashboard-direct`.
- Automated precondition: `rtk pnpm test:e2e` on Node 24.19.0 passed 160/160 against a production Next 16.3.2 build.
- Browser driver: `agent-browser` against the local application through its public UI.
- Production-parity gaps to qualify before closure: local database/server, no physical screen reader, no real flaky radio/network, and browser matrix beyond the automated harness.
- Taxonomy: the screen-switch journey covers end-to-end navigation, functional destination ownership, perceived status, error/abandonment edges, responsiveness and accessibility. The direct-load canary covers startup/hydration regression. External side effects and data mutation do not exist in this slice.

## Session Matrix

| Charter | Persona | Journey | Tour | Time-box | Verdict |
| --- | --- | --- | --- | --- | --- |
| CH-keyboard-screen-transition · NAV-switch-screen-ready | Candidato por teclado | J-switch-workspace-screen | Accessibility Tour | 30 min | Pass |
| CH-keyboard-screen-transition · NAV-accessible-mobile-transition | Candidato por teclado | J-switch-workspace-screen | Accessibility Tour | 30 min | Pass |
| CH-mobile-transition-recovery · NAV-slow-screen-truthful | Candidato em trânsito | J-switch-workspace-screen | Interrupt Tour | 30 min | Skipped |
| CH-mobile-transition-recovery · NAV-failed-screen-retry | Candidato em trânsito | J-switch-workspace-screen | Interrupt Tour | 30 min | Skipped |
| CH-direct-startup-canary · PWA-direct-load-startup-singleton | Andreus em triagem | J-open-dashboard-direct | Feature Tour | 30 min | Pass |

## Session Debriefs

### CH-keyboard-screen-transition

- Entrada real: login com senha, URL `/jobs`, 1280×900, locale English.
- Caminho: Tab percorreu a navegação global até Pipeline; o destino ficou operável, o foco não permaneceu em overlay removido e a recarga confirmou o mesmo destino.
- Edge probes: keyboard-only, fresh deep link, refresh after goal, opposite-locale scan.
- Resultado: lifecycle passou; encontrou-se o paper cut sharp `BUG-20260823-pipeline-empty-state-mixed-locale` no conteúdo preexistente do destino.
- Evidência: `docs/qa/evidence/2026-08-23-task-02-loading-transicoes/CH-keyboard-screen-transition-goal.png`.

### CH-mobile-transition-recovery

- Entrada real: `/pipeline` em 375×812, locale trocado pela UI para pt-BR.
- Caminho: menu móvel → Vagas → Voltar → Avançar; o menu fechou, o destino permaneceu contido e o histórico terminou sem overlay órfão.
- Edge probes: viewport 375×812, troca de locale, menu por toque, back/forward, recarga. Espera longa e erro foram skipped porque não há gatilho público legítimo; permanecem provados pelo E2E do build.
- Uma primeira tentativa foi invalidada: o viewport havia sido redimensionado com o popover de idioma já aberto. A sessão foi reiniciada do zero em 375×812 e o controle funcionou normalmente.
- Evidência: `docs/qa/evidence/2026-08-23-task-02-loading-transicoes/CH-mobile-transition-recovery-goal.png`.

### CH-direct-startup-canary

- Entrada real: URL `/` e recarga, 1280×900.
- Caminho: carga direta → cockpit → recarga; o shell permaneceu operável e não surgiu overlay de navegação residual.
- Edge probes: direct deep link, refresh, hydration, empty local corpus.
- Evidência: `docs/qa/evidence/2026-08-23-task-02-loading-transicoes/CH-direct-startup-canary-goal.png`.

## Experiential Lens Pass

- `J-switch-workspace-screen`: usability pass; accessibility pass com lacuna de leitor físico; perceived performance pass no caminho normal; compatibility pass em Chromium 1280/375 e complementada pelo E2E; recoverability skipped no dogfood e green no E2E; parity qualificada por backend local.
- `J-open-dashboard-direct`: usability pass; accessibility sem novo bloqueio; perceived performance pass; compatibility coberta em desktop/mobile pelo E2E; error recoverability não aplicável ao happy path; parity qualificada por execução local.

## Findings and Decisions for a Human

### Funil vazio mistura idiomas (`BUG-20260823-pipeline-empty-state-mixed-locale`)

- What's broken: o true end state da navegação para um funil vazio mistura inglês e português.
- Why not auto-fixed: o defeito é preexistente em `app/pipeline/page.tsx`; corrigi-lo expandiria o slice de transição para conteúdo da tela de destino, contra a regra desta tarefa de registrar follow-up em vez de ampliar escopo silenciosamente.
- Options:
  1. Mover a frase inteira e o rótulo do link para o dicionário tipado e ampliar a varredura E2E inglesa — correção pequena e estrutural.
  2. Manter o bug aberto — conserva o escopo, mas mantém Trust-Damage em inglês.
- Recommendation: opção 1 em uma tarefa curta de i18n.

## Automated Exit Gate

- `rtk pnpm check` under Node 24.19.0: exit 0; 147/147 test files, 2,070 passed, 2 pre-existing skipped, 97.4% line coverage.
- `rtk pnpm test:e2e` under Node 24.19.0: exit 0; optimized Next 16.3.2 production build and 160/160 browser checks.
- Agent implementation audit: PASS, 14/14 assigned contracts covered, no weak or missing mapping.
- Deslop/self-review: PASS; no unrelated production cleanup added.
- Environmental note: a first gate attempt coincided with external Git-heavy suites and timed out in an unrelated release test. Trace evidence isolated host process-start contention; the unchanged canonical command passed once the host cleared.

## Final Status

Pass for Task 2. The two dogfood-only slow/error rows remain intentionally skipped because the public product exposes no fixture controls; both paths pass in the production-browser E2E. The pre-existing mixed-locale pipeline empty state remains a separately registered follow-up and does not block this transition slice.
