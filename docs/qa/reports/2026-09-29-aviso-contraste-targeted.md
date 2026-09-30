# QA Run Report — 2026-09-29 — aviso de visibilidade, contraste targeted

- **Scope:** `--warn` usado como cor de texto no aviso "legível por qualquer um" e em três outros pontos, abaixo de 4.5:1 (WCAG 1.4.3 AA) em huly e graphy claros (#383)
- **Cadence tier:** targeted
- **Build percorrido:** `b7a3fbc` (base) + branch `fix/warn-texto-contraste`, ainda não mesclada · **Environment:** build Next de produção local, Chromium via `tests/e2e/run-isolated.mjs`
- **Started:** 2026-09-29T14:05:00Z · **Status:** closed (rodada 2, pós-revisão L1, em 2026-09-29T15:10:00Z–15:50:00Z)

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
| 2 | CH-borrowed-session-banner-contrast | J-toggle-profile-visibility / PROF-visibility-warning-contrast | Andreus no celular | Feature Tour | Pass | | pendente (PR ainda não mesclada) |

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

### CH-borrowed-session-banner-contrast — Andreus no celular (rodada 2, pós-revisão L1)

- **Ran:** 2026-09-29T15:10:00Z → 2026-09-29T15:50:00Z (box respected: yes)
- **Findings:** a revisão L1 achou o que a rodada 1 não cobria: a faixa de sessão emprestada (`app/layout.tsx`) pinta o texto sobre `bg-[var(--warn)]/10`, e o fundo REAL ali não é `--card` sólido — é `--warn` a 10% composto sobre `--background`, mais escuro. Medido com `--warn-text` original (`#8f640f`): graphy claro dava 4,27:1 contra esse fundo (achado da revisão), embora passasse 6,70:1 contra `--card`. Ao tentar medir isso automaticamente achei um SEGUNDO defeito, desta vez no próprio teste: o Tailwind v4 resolve `bg-[var(--warn)]/10` para `oklab(L a b / 0.1)`, não `rgba()`; um regex que só entendia `rgba?(...)` ignorava essa camada silenciosamente (sem erro, sem `NaN`) e media contra o fundo sólido de baixo como se o `/10` não existisse — reproduzi isso com `console.log` de diagnóstico antes de corrigir. Corrigido com um canvas de 1×1 por camada (`fillStyle` aceita qualquer sintaxe de cor CSS; `getImageData` devolve `{r,g,b,a}` em sRGB) compondo manualmente pela fórmula "over" do alfa. Um segundo bug menor apareceu no caminho: a string `rgb(245.007...)` com decimais quebrava o `toRgb()` de `shared.mjs` (que só entende `\d+`), dando contrastes como `7.4e20` sem nenhum sinal de erro — corrigido arredondando antes de montar a string. `--warn-text` recalibrado para `#7a5510`, que passa com margem nos dois contextos (mínimo 5,44:1 contra o fundo composto, 6,70:1 contra `--card`) nos seis ambientes.
- **Bugs filed/updated:** nenhum issue novo — achado e corrigido dentro do ciclo desta PR, antes de qualquer usuário ver.
- **Scenarios settled:** PROF-visibility-warning-contrast → Pass (critério e evidência atualizados para cobrir os dois elementos).
- **Paper cuts:** nenhum novo.
- **Surprises:** um teste que mede contraste pode estar ele mesmo errado de um jeito que não reprova nada — o regex ignorando `oklab()` silenciosamente é exatamente o tipo de falso positivo que este processo existe para pegar. Reproduzi a reprovação revertendo `--warn-text` para `#8f640f` antes de fixar em `#7a5510`, para confirmar que o teste corrigido pega o defeito original (graphy claro deu 4,26:1, batendo com os 4,27:1 da revisão).
- **Suggested next charter:** nenhum novo além do já sugerido acima.

## Experiential Lens Results

| Journey | Usability | Accessibility | Perceived performance | Compatibility | Error recoverability | Production parity | Evidence / findings |
|---|---|---|---|---|---|---|---|
| J-toggle-profile-visibility | pass | pass | n/a | pass | n/a | friction | `tests/e2e/ui/themes.mjs` (seis ambientes); sem screenshot — nenhuma sessão visual foi rodada nesta rodada |

## What Was Fixed

### #383: `--warn` como cor de texto do aviso de perfil público
- **Symptom:** em huly e graphy claros o aviso "legível por qualquer um" e três outros textos mediam 4.06:1, abaixo do mínimo AA de 4.5:1; o axe do E2E não pegava por rodar só no tema padrão.
- **Root cause:** `--warn` é token de preenchimento (G32), reaproveitado como cor de texto em quatro lugares.
- **Fix:** token `--warn-text` novo em `app/themes.css` (`#7a5510` nos temas claros, recalibrado na rodada 2 para passar também contra o fundo composto da faixa; reaproveita `--warn` nos escuros, que já passavam), trocado em `app/candidate/page.tsx`, `app/layout.tsx` (x2) e `app/admin/operacoes/page.tsx`.
- **Regression test:** `tests/design.test.ts` ganhou um `it` que reprova `text-[var(--warn)]` em `.tsx` — confirmado que reprova sem o fix (reintroduzido temporariamente e revertido) e passa com ele. `tests/e2e/ui/themes.mjs` mede `[data-testid="visibility-public-warning"]` (/candidate) e `[data-testid="impersonation-banner-text"]` (faixa de sessão emprestada, /jobs numa sessão impersonada própria) nas seis combinações.
- **Retested:** `pnpm vitest run tests/design.test.ts` (19/19) e `node tests/e2e/run-isolated.mjs --areas themes` (19/19, rodada 2) nesta sessão — mais duas execuções de sanity check (valor antigo reprovando, valor novo passando).

### #383 (achado durante a correção): teste de contraste ignorava fundo `oklab()` com alfa
- **Symptom:** um teste que mede contraste podia estar medindo o fundo ERRADO sem nenhum sinal de erro — passava mesmo quando o defeito real (fundo composto abaixo de 4,5:1) existia.
- **Root cause:** `getComputedStyle(el).backgroundColor` para `bg-[var(--warn)]/10` no Tailwind v4 devolve `oklab(L a b / 0.1)`, não `rgba()`; o parser do teste só reconhecia `rgba?(...)` e pulava essa camada silenciosamente, caindo direto no fundo sólido de baixo.
- **Fix:** `readCompositedContrastSample()` em `tests/e2e/ui/themes.mjs` resolve cada camada com um canvas de 1×1 (`fillStyle` aceita qualquer sintaxe CSS de cor; `getImageData` devolve `{r,g,b,a}` em sRGB) e compõe manualmente pela fórmula "over" do alfa, subindo a árvore até um fundo opaco. Também corrigido: arredondar os componentes antes de montar a string `rgb(...)`, porque `toRgb()` de `shared.mjs` só entende dígitos inteiros e um decimal cru produzia contrastes absurdos (`~10^21`) sem `NaN` para denunciar.
- **Regression test:** o próprio `readCompositedContrastSample`, exercitado nas seis combinações; sanity check manual nesta sessão (reverter para o valor antigo reproduziu 4,26:1 em graphy claro, batendo com o achado da revisão).
- **Retested:** `node tests/e2e/run-isolated.mjs --areas themes`, três vezes nesta sessão (com debug, sem debug, valor antigo e valor novo).

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

- **Exit gate:** `pnpm vitest run tests/design.test.ts` — 19/19. `node tests/e2e/run-isolated.mjs --areas themes` — 19/19 (inclui a fumaça `auth`), rodado três vezes na rodada 2 (valor antigo reprovando, valor novo passando, versão final sem debug). `pnpm typecheck` — sem erros.
- **Issues by user impact:** Blocks-Completion 0 · Data-Loss 0 · Trust-Damage 0 · Friction 0 · Cosmetic 0 (era Accessibility, corrigido nos dois elementos)
- **Coverage:** verificação automatizada de contraste nos seis ambientes, para os dois elementos que usam `--warn-text` sobre fundo distinto (`/candidate` sólido e a faixa composta em `/jobs`); sessão visual humana não rodada nesta rodada (ver Human Verifications Needed).
- **Verdict:** ready — pronto para PR; item de verificação humana não bloqueia por ser confirmação redundante de uma métrica já medida com precisão maior que a vista.
