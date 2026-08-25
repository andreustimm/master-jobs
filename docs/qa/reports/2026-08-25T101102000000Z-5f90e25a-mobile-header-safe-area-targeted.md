# QA Run Report — 2026-08-25T101102000000Z-5f90e25a — mobile header safe area targeted

- **Scope:** regressão que permitia à barra do sistema cobrir marca e controles do cabeçalho em uma PWA instalada
- **Cadence tier:** targeted
- **Build percorrido:** `5f90e25` · **Gate automatizado final:** `c349672` · **Environment:** build Next de produção local; Chromium; Safari/PWA físico exige verificação humana
- **Started:** 2026-08-25T10:11:02Z · **Status:** closed

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Candidato em trânsito | `docs/qa/personas.md` | phone-small / 4g / pt-BR | CH-installed-header-safe-area |
| Andreus no celular | `docs/qa/personas.md` | phone-small / 4g / pt-BR | CH-mobile-one-hand-ranking |

## Flows in Scope

- `J-open-dashboard-direct` — abrir o Cockpit instalado sem camadas ou controles encobertos (`../journeys/J-open-dashboard-direct.md`)
- `J-switch-workspace-screen` — canário adjacente do shell e da navegação móvel (`../journeys/J-switch-workspace-screen.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-installed-header-safe-area | J-open-dashboard-direct / PWA-installed-header-safe-area | Candidato em trânsito | Feature Tour | Blocked (needs human verify) | BUG-20260825-pwa-header-status-bar-overlap | `5f90e25` |
| 2 | CH-mobile-one-hand-ranking | J-switch-workspace-screen / canário adjacente | Andreus no celular | Feature Tour | Pass | | |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-installed-header-safe-area — Candidato em trânsito

- **Ran:** 2026-08-25T10:12:00Z → 2026-08-25T10:18:00Z (box respected: yes)
- **Findings:** o fix corrigiu o observável no Chromium emulado; a última perna só pode ser confirmada no Safari/PWA instalado que produziu a foto original.
- **Bugs filed/updated:** BUG-20260825-pwa-header-status-bar-overlap.
- **Scenarios settled:** PWA-installed-header-safe-area → Blocked (needs human verify).
- **Paper cuts:** nenhum novo.
- **Surprises:** o launcher pode manter a barra sobre o viewport mesmo entregando inset zero; a correção precisa de um piso somente em contexto de toque.
- **Suggested next charter:** repetir este charter no aparelho físico depois do deploy de staging.

### CH-mobile-one-hand-ranking — Andreus no celular

- **Ran:** 2026-08-25T10:18:00Z → 2026-08-25T10:20:00Z (box respected: yes)
- **Findings:** o menu móvel abriu, navegou para Vagas e permaneceu em `/jobs` após recarga, com `scrollWidth` menor que 375 px.
- **Bugs filed/updated:** nenhum.
- **Scenarios settled:** nenhum; o canário não substitui o contrato amplo de navegação.
- **Paper cuts:** nenhum.
- **Surprises:** nenhuma.
- **Suggested next charter:** nenhum para esta mudança targeted.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-open-dashboard-direct | pass | pass | pass | friction | pass | friction | `docs/qa/evidence/2026-08-25T101102000000Z-5f90e25a-mobile-header-safe-area-targeted/header-portrait-touch.png`; `header-landscape-touch.png`, `header-tablet-touch.png` e `header-desktop.png` no mesmo diretório; Safari/PWA físico pendente |
| J-switch-workspace-screen | pass | pass | pass | pass | pass | pass | `docs/qa/evidence/2026-08-25T101102000000Z-5f90e25a-mobile-header-safe-area-targeted/mobile-jobs-canary.png`; rota e contenção sobreviveram à recarga |

## What Was Fixed

### BUG-20260825-pwa-header-status-bar-overlap: barra do sistema cobre o cabeçalho da PWA
- **Symptom:** relógio e indicadores do aparelho se sobrepunham à marca e aos controles do cabeçalho instalado.
- **Root cause:** alguns launchers mantêm a barra do sistema sobre o viewport mesmo reportando `safe-area-inset-top: 0`.
- **Fix:** `5f90e25`, um piso de espaçamento do `DESIGN.md` apenas em contexto instalado com toque; o inset real continua prevalecendo e desktop não recebe faixa artificial.
- **Regression test:** `tests/pwa-chrome.test.ts` falhou antes e passou depois; `376d242` também trava a ligação dos tokens aos insets do aparelho, e `tests/e2e/ui.mjs` mede a geometria em quatro viewports.
- **Retested:** as sessões percorreram `5f90e25`; em `c349672`, o gate automatizado repetiu as quatro viewports e o canário móvel a partir de nova carga, com o manifest liberado para retrato e paisagem.

## Paper Cuts

Nenhum registrado até o momento.

## Runtime Errors Observed

Nenhum; `agent-browser errors` e `agent-browser console` não retornaram ocorrências.

## Human Verifications Needed

- [ ] No mesmo aparelho da foto, instalar/atualizar a PWA, abrir o Cockpit em retrato e paisagem e confirmar que relógio e indicadores ficam acima da marca e de todos os controles (row #1).

## Decisions for a Human

Nenhuma.

## Learnings

- Um PWA instalado pode desenhar a barra do sistema sobre o viewport e ainda reportar inset superior igual a zero; a matriz automatizada precisa cobrir esse contrato explicitamente.

## Final Status

- **Exit gate (runtime `c349672`):** `pnpm check` — 148 arquivos, 2.090 testes passados e 6 ignorados; cobertura 96,5% statements / 93,05% branches / 96,99% functions / 97,4% lines. `pnpm test:e2e` — 182/182 jornadas e 8/8 páginas axe WCAG 2.2 AA. `pnpm test:pwa-browser` — 25/25 testes passados.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 · Friction 1 · Cosmetic 0
- **Coverage:** jornada afetada percorrida e canário adjacente executado; a perna física de Safari/PWA está explicitamente bloqueada para verificação humana.
- **Verdict:** ready-with-blocked-items — pronto para PR e staging; confirmar no aparelho físico antes de declarar o bug verificado em produção.
