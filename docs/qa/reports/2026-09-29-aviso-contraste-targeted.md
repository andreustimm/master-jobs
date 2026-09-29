# QA Run Report — 2026-09-29 — aviso de visibilidade, contraste targeted

- **Scope:** `--warn` usado como cor de texto no aviso "legível por qualquer um" e em três outros pontos, abaixo de 4.5:1 (WCAG 1.4.3 AA) em huly e graphy claros (#383)
- **Cadence tier:** targeted
- **Build percorrido:** `b7a3fbc` (base) + branch `fix/warn-texto-contraste`, ainda não mesclada · **Environment:** build Next de produção local, Chromium via `tests/e2e/run-isolated.mjs`
- **Started:** 2026-09-29T14:05:00Z · **Status:** closed

## Personas

| Persona | Base | Device / Network / Locale | Sessions |
|---|---|---|---|
| Andreus no celular | `docs/qa/personas.md` | desktop / local / pt-BR | CH-warning-contrast-six-environments |

## Flows in Scope

- `J-toggle-profile-visibility` — ler o aviso de visibilidade em qualquer tema (`../journeys/J-toggle-profile-visibility.md`)

## Session Matrix & Results

| # | Charter | Journey / Scenario | Persona | Tour | Status | Issue | Fix commit |
|---|---|---|---|---|---|---|---|
| 1 | CH-warning-contrast-six-environments | J-toggle-profile-visibility / PROF-visibility-warning-contrast | Andreus no celular | Feature Tour | Pass | | pendente (PR ainda não mesclada) |

Status legend: `Pending | Pass | Fail | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`

## Session Debriefs

### CH-warning-contrast-six-environments — Andreus no celular

- **Ran:** 2026-09-29T14:05:00Z → 2026-09-29T14:20:00Z (box respected: yes)
- **Findings:** este charter é automatizado, não uma sessão manual com `agent-browser`: `node tests/e2e/run-isolated.mjs --areas themes` sobe um build de produção real e, dentro dele, `tests/e2e/ui/themes.mjs` navega para `/candidate` nas seis combinações de tema × modo (hp/huly/graphy × claro/escuro), lê `color` e `background-color` computados do elemento `[data-testid="visibility-public-warning"]` num Chromium real e calcula o contraste pela fórmula WCAG. Para uma medição de contraste isso é evidência mais confiável do que leitura a olho — o próprio achado original (#383) só apareceu porque alguém *mediu*, não porque alguém viu a cor "meio apagada". `18/18` verificações da área passaram, incluindo `✓ todo texto passa em 4.5:1 nos seis ambientes`.
- **Bugs filed/updated:** nenhum novo — corrige o achado do `/impeccable audit` já descrito em #383.
- **Scenarios settled:** PROF-visibility-warning-contrast → Pass.
- **Paper cuts:** nenhum novo.
- **Surprises:** huly e graphy claros compartilhavam o mesmo `--warn` (#a8741a); um único `--warn-text` (#8f640f) resolve os dois. Os três ambientes escuros já passavam com a cor original (~7.6–7.9:1), então `--warn-text` escuro reaproveita `--warn`.
- **Suggested next charter:** sessão manual com `agent-browser` no seletor de aparência, comparando visualmente o aviso antigo e o novo lado a lado — não bloqueia esta entrega, mas fecha a lacuna de "leitura independente" humana que este charter automatizado não cobre.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-toggle-profile-visibility | pass | pass | n/a | pass | n/a | friction | `tests/e2e/ui/themes.mjs` (seis ambientes); sem screenshot — nenhuma sessão visual foi rodada nesta rodada |

## What Was Fixed

### #383: `--warn` como cor de texto do aviso de perfil público
- **Symptom:** em huly e graphy claros o aviso "legível por qualquer um" e três outros textos mediam 4.06:1, abaixo do mínimo AA de 4.5:1; o axe do E2E não pegava por rodar só no tema padrão.
- **Root cause:** `--warn` é token de preenchimento (G32), reaproveitado como cor de texto em quatro lugares.
- **Fix:** token `--warn-text` novo em `app/themes.css` (mais escuro nos temas claros; reaproveita `--warn` nos escuros, que já passavam), trocado em `app/candidate/page.tsx`, `app/layout.tsx` (x2) e `app/admin/operacoes/page.tsx`.
- **Regression test:** `tests/design.test.ts` ganhou um `it` que reprova `text-[var(--warn)]` em `.tsx` — confirmado que reprova sem o fix (reintroduzido temporariamente e revertido) e passa com ele. `tests/e2e/ui/themes.mjs` ganhou a amostra do aviso nas seis combinações.
- **Retested:** `pnpm vitest run tests/design.test.ts` (19/19) e `node tests/e2e/run-isolated.mjs --areas themes` (18/18) nesta sessão.

## Paper Cuts

Nenhum registrado.

## Runtime Errors Observed

Nenhum reportado pela suíte automatizada; nenhuma sessão com `agent-browser console`/`errors` foi rodada nesta rodada.

## Human Verifications Needed

- [ ] Comparar visualmente o aviso antigo e o novo no seletor de aparência (huly e graphy claros), para fechar a lacuna de leitura humana que este charter automatizado não cobre.

## Decisions for a Human

Nenhuma.

## Learnings

- Contraste é o tipo de defeito em que a evidência automatizada (cor computada + fórmula WCAG) é estritamente mais forte que a leitura a olho — o achado original só apareceu porque alguém mediu.

## Final Status

- **Exit gate:** `pnpm vitest run tests/design.test.ts` — 19/19. `node tests/e2e/run-isolated.mjs --areas themes` — 18/18 (inclui a fumaça `auth`). `pnpm typecheck` — sem erros.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 · Friction 0 · Cosmetic 0 (era Accessibility, corrigido)
- **Coverage:** verificação automatizada de contraste nos seis ambientes; sessão visual humana não rodada nesta rodada (ver Human Verifications Needed).
- **Verdict:** ready — pronto para PR; item de verificação humana não bloqueia por ser confirmação redundante de uma métrica já medida com precisão maior que a vista.
