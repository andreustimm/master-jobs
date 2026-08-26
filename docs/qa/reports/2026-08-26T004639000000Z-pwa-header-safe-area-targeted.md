# QA Run Report — 2026-08-26T004639000000Z — pwa-header-safe-area-targeted

- **Scope:** conteúdo do cabeçalho instalado sem sobreposição da barra de
  status, incluindo o caso em que o launcher informa inset superior zero
- **Cadence tier:** targeted
- **Build percorrido:** working tree `codex/next-backlog-tasks` · **Environment:**
  build Next.js de produção local, Chromium com display-mode instalado e
  quatro viewports reais do contrato (375×812, 812×375, 768×1024 e 1280×900)
- **Started:** 2026-08-26T00:46:39Z · **Status:** closed

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Candidato em trânsito | `docs/qa/personas.md` | phone-small / 4g / pt-BR | CH-installed-header-safe-area |
| Andreus em triagem noturna | `docs/qa/personas.md` | tablet e desktop / wifi-fast / pt-BR | canário de navegação do `test:e2e` |

## Flows in Scope

- `J-open-dashboard-direct` — abrir a aplicação instalada sem que a barra do
  sistema cubra a marca ou os controles (`../journeys/J-open-dashboard-direct.md`)
- `J-switch-workspace-screen` — canário adjacente de navegação e contenção do
  shell (`../journeys/J-switch-workspace-screen.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-installed-header-safe-area | J-open-dashboard-direct / PWA-installed-header-safe-area | Candidato em trânsito | Feature Tour | Pass (automated) | physical Safari/PWA still needs human verify | pending commit |
| 2 | CH-mobile-one-hand-ranking | J-switch-workspace-screen / canário adjacente | Andreus em triagem noturna | Feature Tour | Pass | | pending commit |
| 3 | CH-no-cv-ranking-state | J-refresh-candidate-ranking / PROF-rescore-status-no-cv | Andreus em triagem noturna | Feature Tour | Pass (automated) | | pending commit |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-installed-header-safe-area — Candidato em trânsito

- **Ran:** 2026-08-26T00:46Z → 2026-08-26T00:50Z (box respected: yes)
- **Findings:** o cabeçalho instalado reserva a área segura, mantém pelo menos
  56px de conteúdo depois do inset e mantém marca e controles dentro do próprio
  box em retrato, paisagem, tablet e desktop. O caso de retrato com inset zero
  usa o piso definido nos tokens; não houve overflow horizontal. Nenhum erro de
  navegador foi observado.
- **Bugs filed/updated:** BUG-20260825-pwa-header-status-bar-overlap
- **Scenarios settled:** PWA-installed-header-safe-area → pass (automated); a
  confirmação no Safari/PWA físico que originou a foto continua explicitamente
  pendente para uma pessoa com o aparelho.
- **Paper cuts:** nenhum novo.
- **Surprises:** o defeito só aparece quando o padding de área segura compartilha
  uma altura fixa; a altura mínima mantém a mesma faixa no desktop sem deixar os
  controles transbordarem para cima no celular.

### CH-mobile-one-hand-ranking — canário adjacente

- **Ran:** 2026-08-26T00:46Z → 2026-08-26T00:50Z (box respected: yes)
- **Findings:** menu e rotas permaneceram alcançáveis nos quatro viewports, sem
  rolagem horizontal.
- **Bugs filed/updated:** nenhum.
- **Scenarios settled:** nenhum; o canário não substitui o contrato amplo.
- **Paper cuts:** nenhum.
- **Surprises:** nenhuma.

### CH-no-cv-ranking-state — Andreus em triagem noturna

- **Ran:** 2026-08-26T00:46Z → 2026-08-26T00:50Z (box respected: yes)
- **Findings:** a conta sem CV recebeu `data-state="noCv"`, o texto português
  `Aguardando currículo` e nenhuma chave literal ou cópia inglesa; retrato,
  paisagem, tablet e desktop permaneceram contidos e a leitura sobreviveria a
  uma nova carga.
- **Bugs filed/updated:** nenhum.
- **Scenarios settled:** PROF-rescore-status-no-cv → pass.
- **Paper cuts:** nenhum.
- **Surprises:** nenhuma.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-open-dashboard-direct | pass | pass | pass | pass (Chromium emulado) | pass | pass for local production build; physical pending | `tests/e2e/ui.mjs`, `tests/pwa-chrome.test.ts` |
| J-switch-workspace-screen | pass | pass | pass | pass | pass | pass | `tests/e2e/ui.mjs` e axe |
| J-refresh-candidate-ranking | pass | pass | pass | pass | pass | pass | `tests/e2e/ui.mjs`, `tests/scoring-queue.test.ts` |

## What Was Fixed

- O contêiner interno do cabeçalho passou de altura fixa para altura mínima. A
  área segura pode ocupar o topo sem reduzir o espaço dos controles a poucos
  pixels e fazê-los transbordar sobre o relógio.
- O teste de browser mede a geometria efetiva da marca, o conteúdo e o header;
  o teste PWA impede o retorno da classe `h-14`.

## Runtime Errors Observed

Nenhum erro de console ou falha de navegação. A suíte completa reportou 191/191
verificações e 8/8 páginas sem violações axe WCAG 2.2 AA.

## Human Verifications Needed

- [ ] No mesmo aparelho da foto, atualizar/reinstalar a PWA, abrir o Cockpit em
  retrato e paisagem e confirmar visualmente que relógio e indicadores ficam
  acima da marca, menu, idioma e aparência.

## Final Status

- **Automated exit gate:** `rtk pnpm test:e2e` — 191/191 verificações; 8/8
  páginas sem violações axe WCAG 2.2 AA. Os testes direcionados do PWA e o
  typecheck também passaram.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0
  · Friction 0 (automated) · Cosmetic 0
- **Coverage:** quatro viewports exercitados; validação física explicitamente
  pendente.
- **Verdict:** ready for deep review; não declarar verificação física completa
  até a confirmação no aparelho real.
