# QA Run Report — 2026-09-29 — alvo de toque 44px, targeted

- **Scope:** `@media (pointer: coarse)` de `app/globals.css` fixava `min-height: 40px`, fora de `@layer`, vencendo `min-h-11` (44px) do Tailwind — DESIGN.md pede 44px (#403)
- **Cadence tier:** targeted
- **Build percorrido:** `b7a3fbc` (base) + branch `fix/alvo-toque-44px`, ainda não mesclada · **Environment:** build Next de produção local; Chromium com `hasTouch: true, isMobile: true` via `tests/e2e/run-isolated.mjs`
- **Started:** 2026-09-29T14:30:00Z · **Status:** closed (rodada 2, pós-revisão L1, em 2026-09-29T16:00:00Z–16:20:00Z)

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus no celular | `docs/qa/personas.md` | phone-small / local / pt-BR | CH-touch-target-real-pointer |

## Flows in Scope

- `J-tap-primary-controls-mobile` — controles principais tocados com `pointer: coarse` real (`../journeys/J-tap-primary-controls-mobile.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-touch-target-real-pointer | J-tap-primary-controls-mobile / PROF-touch-target-44px | Andreus no celular | Feature Tour | Pass | | pendente (PR ainda não mesclada) |
| 2 | CH-touch-overflow-sweep | J-tap-primary-controls-mobile / PROF-touch-target-44px | Andreus no celular | Feature Tour | Pass | | pendente (PR ainda não mesclada) |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-touch-target-real-pointer — Andreus no celular

- **Ran:** 2026-09-29T14:30:00Z → 2026-09-29T14:50:00Z (box respected: yes)
- **Findings:** charter automatizado, não sessão manual com `agent-browser`. `node tests/e2e/run-isolated.mjs --areas mobile` sobe um build de produção real; dentro dele, um bloco novo de `tests/e2e/ui/mobile.mjs` abre um contexto Playwright com `hasTouch: true, isMobile: true, viewport: 375×812` (reaproveitando a sessão autenticada via `storageState`, sem novo login) e mede `boundingBox().height` de seis controles: `save-public-facts` e `save-visibility` em `/candidate`, e `public-profile-linkedin`, `public-profile-github`, `public-profile-copy-link`, `public-skill-more` em `/p/<slug>`. Todos mediram 44px; nenhuma das duas telas ganhou rolagem horizontal.
- **Bugs filed/updated:** nenhum novo — corrige o achado do `/impeccable audit` já descrito em #403.
- **Scenarios settled:** PROF-touch-target-44px → Pass.
- **Paper cuts:** nenhum novo.
- **Surprises:** `save-public-facts`/`save-visibility` não têm `min-h-11` explícito — dependiam inteiramente da regra global para escapar dos 28/32px nativos do botão `size="sm"`. Antes da correção mediam exatamente 40px (confirmado revertendo o valor e rerodando: reprovou com os seis alvos em 40px), não um valor entre 32 e 40 — a regra global realmente vencia o resto.
- **Suggested next charter:** sessão manual com `agent-browser` tocando fisicamente os controles (não só medindo `boundingBox`) para confirmar a experiência subjetiva de "acerta de primeira" — não bloqueia esta entrega.

### CH-touch-overflow-sweep — Andreus no celular (rodada 2, pós-revisão L1)

- **Ran:** 2026-09-29T16:00:00Z → 2026-09-29T16:20:00Z (box respected: yes)
- **Findings:** a revisão L1 apontou que o bump de 40→44px vale para TODO `button`/`[role="button"]`/`summary`/link `inline-flex` em toque, não só os seis controles medidos na rodada 1 — e pediu uma varredura de overflow sob `hasTouch`/`isMobile` em `/jobs` (chips de filtro, barra de filtro) e no cabeçalho (idioma, aparência, sessão), reaproveitando `OVERFLOW_SWEEP` se existir. `OVERFLOW_SWEEP` (`tests/e2e/routes.mjs`) já existe e já é usado pela varredura SEM toque no topo do próprio `mobile.mjs`; o mesmo contexto de toque agora percorre as dez rotas (`/`, `/jobs`, `/jobs?track=all`, `/jobs/905000031`, `/searches`, `/compare`, `/candidate`, `/candidate/skills`, `/pipeline`, `/p/e2e-cv-formatado`) em 375px, com a mesma lógica de `scrollWidth` e "elemento além da borda" — estendida de `main *` para `main *, header *`, porque o cabeçalho (com idioma/aparência/sessão) não é filho de `main`. Nada quebrou: as dez rotas passaram sem rolagem horizontal nem elemento cortado, `31/31` verificações da área.
- **Bugs filed/updated:** nenhum novo.
- **Scenarios settled:** PROF-touch-target-44px → Pass (critério e evidência ampliados para cobrir a varredura inteira, não só os seis controles).
- **Paper cuts:** nenhum novo.
- **Surprises:** nenhuma quebra — os 4px extras do piso de toque não estouraram nenhuma das dez rotas, nem os chips de filtro de `/jobs`/`/jobs?track=all` nem os três controles do cabeçalho. O risco que a revisão apontou era real (a regra vale para TODO controle da lista), mas o layout tinha folga suficiente.
- **Suggested next charter:** nenhum novo além do já sugerido acima.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-tap-primary-controls-mobile | pass | pass | n/a | pass | n/a | friction | `tests/e2e/ui/mobile.mjs` (seis controles, dois telas); sem screenshot — nenhuma sessão visual foi rodada nesta rodada |

## What Was Fixed

### #403: alvo de toque de 40px em `pointer: coarse`, abaixo dos 44px do DESIGN.md
- **Symptom:** `min-h-11` (44px) e a "proteção" que a regra global dava a botões `size="sm"` sem altura explícita caíam para 40px num aparelho de toque real; a suíte não pegava porque nenhum contexto rodava com `hasTouch`/`isMobile`.
- **Root cause:** CSS fora de `@layer` em `app/globals.css` vencia qualquer utilitário Tailwind v4 (que mora em `@layer utilities`), e o número escolhido (40) nunca bateu com o piso do DESIGN.md (44).
- **Fix:** `app/globals.css`, `min-height: 40px` → `44px` na regra `@media (pointer: coarse)`.
- **Regression test:** bloco novo em `tests/e2e/ui/mobile.mjs`, isolado no seu próprio `try` (padrão do WebKit em `design.mjs`); confirmado que reprova sem o fix (revertido temporariamente e rerodado: os seis alvos mediram 40px, `28/29` verificações) e passa com ele (`29/29`). Rodada 2: o mesmo contexto de toque ganhou uma varredura de `OVERFLOW_SWEEP` inteiro (dez rotas) em 375px, cobrindo `/jobs` e o cabeçalho — não é regressão de altura (isso já estava provado), é confirmação de que o piso mais alto não estourou layout em nenhuma tela medida.
- **Retested:** `node tests/e2e/run-isolated.mjs --areas mobile` nesta sessão, três vezes no total (rodada 1: sem e com a correção; rodada 2: com a varredura nova, mais `pnpm typecheck` isolado).

## Paper Cuts

Nenhum registrado.

## Runtime Errors Observed

Nenhum reportado pela suíte automatizada; nenhuma sessão com `agent-browser console`/`errors` foi rodada nesta rodada.

## Human Verifications Needed

- [ ] Sessão manual tocando fisicamente os seis controles (não só medindo `boundingBox`), para confirmar a experiência subjetiva além da métrica.

## Decisions for a Human

Nenhuma — a issue listava três opções e o dono já delegou a escolha para o DESIGN.md (44px), conforme instrução do orquestrador desta tarefa.

## Learnings

- Um botão pode medir 44px "no papel" (sem toque) e 40px na mão (com toque real) ao mesmo tempo, quando uma regra de `pointer: coarse` compete com a altura base. Suíte sem `hasTouch`/`isMobile` mede o primeiro número, não o segundo.

## Final Status

- **Exit gate:** `node tests/e2e/run-isolated.mjs --areas mobile` — 31/31 (inclui a fumaça `auth`), rodada 2. `pnpm typecheck` — sem erros.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 · Friction 0 · Cosmetic 0 (era Accessibility, corrigido)
- **Coverage:** verificação automatizada dos seis controles citados no achado original (dois telas) MAIS `OVERFLOW_SWEEP` inteiro (dez rotas, inclusive `/jobs` com filtros e o cabeçalho) em 375px de toque real; sessão visual humana não rodada nesta rodada (ver Human Verifications Needed).
- **Verdict:** ready — pronto para PR; item de verificação humana não bloqueia por ser confirmação redundante de uma métrica já medida com precisão maior que a mão.
